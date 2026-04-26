/**
 * fal.ts — fal.ai Queue API 어댑터
 * Design 부서의 비주얼 에셋 생성 (이미지 / 영상 / 3D) 에 사용.
 * 키 미설정 시 throw — 호출부(design 부서)가 nano_banana 등 다음 체인으로 폴백.
 *
 * 2026-04-26: 성공/실패 로깅 + 비용 추적 추가.
 *   - 성공 시 [adapter:usage] 구조화 로그 (provider="fal", model=endpoint, cost_usd)
 *   - costStore (SQLite, 대시보드 진실 소스) 에 entry 기록
 *   - creditStore.recordUsage (fal 크레딧 카드 "사용" 합산)
 *   - creditGuard.recordCost (오늘 누적 in-memory 트래커)
 *   기존 LLM 어댑터의 recordProviderMetric 경로와 동일한 키 셋 (provider/model/cost_usd/latency_ms)
 *   → routes/usage.ts 의 월간 journalctl 파서가 그대로 픽업한다.
 */

import { logger } from "../observability/logger.js"
import * as costStore from "../costStore.js"
import * as creditStore from "../creditStore.js"
import { recordCost as recordGuardCost } from "../creditGuard.js"

const FAL_BASE = "https://queue.fal.run"
const DEFAULT_POLL_INTERVAL_MS = 3000

// ── fal.ai 단가 (USD) — 공식 가격 기준 근사. 정확한 청구는 fal 콘솔과 대조 필요. ──
// flux/dev: per image, kling-video: per 5s clip 기준, triposr: per generation.
const FAL_UNIT_PRICES_USD: Record<string, number> = {
  "fal-ai/flux/dev": 0.025,         // FLUX.1 [dev] — per image
  "fal-ai/kling-video/v2": 0.50,    // Kling Video v2 — per 5s clip (대략)
  "fal-ai/triposr": 0.05,           // TripoSR — per 3D generation
}

/**
 * endpoint + input 으로 호출 비용을 추정한다.
 * 알 수 없는 endpoint 는 0 반환 — pricing 테이블에 등록 후 활성화.
 */
function estimateFalCostUsd(endpoint: string, input: Record<string, unknown>): number {
  const base = FAL_UNIT_PRICES_USD[endpoint]
  if (base === undefined) return 0

  // FLUX 류: num_images 만큼 곱
  if (endpoint.includes("flux")) {
    const n = Number((input as any)?.num_images ?? 1)
    return base * (Number.isFinite(n) && n > 0 ? n : 1)
  }
  // Kling 류: duration 초를 5초 단위로 비례
  if (endpoint.includes("kling-video")) {
    const dur = Number((input as any)?.duration ?? 5)
    const safeDur = Number.isFinite(dur) && dur > 0 ? dur : 5
    return base * (safeDur / 5)
  }
  return base
}

function deptHint(): string {
  // design 부서가 유일한 fal 호출원 — 추후 호출 컨텍스트 전파가 가능해지면 세분화.
  return "design"
}

function recordFalUsage(endpoint: string, costUsd: number, latencyMs: number): void {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return
  // 1) 구조화 로그 — journalctl 월간 집계가 픽업한다
  logger.info("[adapter:usage]", {
    provider: "fal",
    model: endpoint,
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: +costUsd.toFixed(6),
    latency_ms: latencyMs,
  })
  // 2) SQLite 영구 저장 — 대시보드 /api/cost/stats 진실 소스
  try {
    costStore.record({
      model: endpoint,
      provider: "fal",
      department: deptHint(),
      inputTokens: 0,
      outputTokens: 0,
      costUsd: +costUsd.toFixed(6),
    })
  } catch { /* hot path — 실패 무시 */ }
  // 3) fal 크레딧 카드 "사용" 합산
  try {
    creditStore.recordUsage(costUsd, { provider: "fal", model: endpoint, memo: `fal:${endpoint}` })
  } catch { /* hot path — 실패 무시 */ }
  // 4) 오늘 누적 in-memory 트래커
  try {
    recordGuardCost("fal", costUsd)
  } catch { /* hot path — 실패 무시 */ }
}

function requireKey(): string {
  const apiKey = String((globalThis as any)?.process?.env?.FAL_API_KEY ?? "").trim()
  if (!apiKey) throw new Error("FAL_API_KEY not set")
  return apiKey
}

export async function falGenerate(
  endpoint: string,
  input: Record<string, unknown>,
  timeoutMs = 300000,
): Promise<any> {
  const t0 = Date.now()
  const apiKey = requireKey()
  let request_id = ""
  try {
    const submitRes = await fetch(`${FAL_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    })
    if (!submitRes.ok) {
      const body = await submitRes.text().catch(() => "")
      throw new Error(`fal.ai submit ${submitRes.status}: ${body.slice(0, 200)}`)
    }
    const submitJson = (await submitRes.json()) as { request_id: string }
    request_id = submitJson?.request_id ?? ""
    if (!request_id) throw new Error("fal.ai submit: missing request_id")

    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, DEFAULT_POLL_INTERVAL_MS))
      const statusRes = await fetch(`${FAL_BASE}/${endpoint}/requests/${request_id}/status`, {
        headers: { Authorization: `Key ${apiKey}` },
      })
      if (!statusRes.ok) continue
      const status = (await statusRes.json()) as { status: string }
      if (status.status === "COMPLETED") {
        const resultRes = await fetch(`${FAL_BASE}/${endpoint}/requests/${request_id}`, {
          headers: { Authorization: `Key ${apiKey}` },
        })
        const result = await resultRes.json()
        const latencyMs = Date.now() - t0
        const costUsd = estimateFalCostUsd(endpoint, input)
        logger.info("[fal.ai] completed", {
          endpoint, request_id, latency_ms: latencyMs, cost_usd: +costUsd.toFixed(6),
        })
        recordFalUsage(endpoint, costUsd, latencyMs)
        return result
      }
      if (status.status === "FAILED") {
        throw new Error(`fal.ai generation failed (request_id=${request_id})`)
      }
    }
    logger.warn("[fal.ai] 타임아웃", { endpoint, request_id, latency_ms: Date.now() - t0 })
    throw new Error("fal.ai timeout")
  } catch (err: any) {
    const latencyMs = Date.now() - t0
    logger.warn("[fal.ai] failed", {
      endpoint, request_id, latency_ms: latencyMs,
      error: String(err?.message ?? err),
    })
    throw err
  }
}

export async function falImage(prompt: string, opts: { width?: number; height?: number } = {}) {
  return falGenerate(
    "fal-ai/flux/dev",
    {
      prompt,
      image_size: { width: opts.width ?? 1024, height: opts.height ?? 1024 },
      num_images: 1,
    },
    60000,
  )
}

export async function falVideo(prompt: string, opts: { duration?: number; aspectRatio?: string } = {}) {
  return falGenerate(
    "fal-ai/kling-video/v2",
    {
      prompt,
      duration: opts.duration ?? 5,
      aspect_ratio: opts.aspectRatio ?? "16:9",
    },
    300000,
  )
}

export async function fal3D(imageUrl: string) {
  return falGenerate(
    "fal-ai/triposr",
    {
      image_url: imageUrl,
      output_format: "glb",
    },
    120000,
  )
}
