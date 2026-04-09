// Gemini Veo 3.1 — 비디오 생성 어댑터
// API: Google AI Studio / Vertex AI
// 모델: 환경변수 VEO_MODEL 또는 기본 veo-3.0-generate-preview

function env(key: string): string {
  return String((globalThis as any)?.process?.env?.[key] ?? "").trim()
}

export type VeoGenerateParams = {
  prompt: string
  duration?: 5 | 8       // 초 단위, 기본 5
  aspectRatio?: "16:9" | "9:16" | "1:1"
  resolution?: "720p" | "1080p"
}

export type VeoResult = {
  ok: boolean
  video_url?: string      // 완료 후 GCS URI or base64 data URI
  operation_name?: string // 폴링용 operation name
  status?: "pending" | "done" | "failed"
  error?: string
}

import { GEMINI_BASE } from "../config/defaults.js"

const VEO_MODEL = String((globalThis as any)?.process?.env?.VEO_MODEL ?? "").trim() || "veo-3.0-generate-preview"
const VEO_BASE = GEMINI_BASE
const POLL_INTERVAL_MS = 5000
const POLL_MAX = 60 // 최대 5분 (60 * 5s)

async function pollOperation(
  operationName: string,
  apiKey: string
): Promise<VeoResult> {
  for (let i = 0; i < POLL_MAX; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))

    const res = await fetch(
      `${VEO_BASE}/${operationName}?key=${apiKey}`,
      { headers: { "Content-Type": "application/json" } }
    ).catch(() => null)

    if (!res?.ok) continue

    const data = await res.json().catch(() => ({}))

    if (data?.done === true) {
      const videoUri =
        data?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
        ?? data?.response?.videos?.[0]?.uri
        ?? null

      if (videoUri) {
        return { ok: true, video_url: videoUri, status: "done" }
      }
      return { ok: false, status: "failed", error: "no video uri in response" }
    }

    // 아직 진행 중
    if (data?.error) {
      return { ok: false, status: "failed", error: data.error?.message ?? "operation error" }
    }
  }

  return { ok: false, status: "failed", error: "polling timeout (2min)" }
}

export async function generateVideoVeo(params: VeoGenerateParams): Promise<VeoResult> {
  const apiKey = env("GEMINI_API_KEY")
  if (!apiKey) return { ok: false, error: "missing GEMINI_API_KEY" }

  const body = {
    model: VEO_MODEL,
    instances: [{
      prompt: params.prompt,
      duration: `${params.duration ?? 5}s`,
      aspectRatio: params.aspectRatio ?? "16:9",
      resolution: params.resolution ?? "720p"
    }]
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30000)

    const res = await fetch(
      `${VEO_BASE}/models/${VEO_MODEL}:generateVideo?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      }
    )
    clearTimeout(timer)

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      return { ok: false, error: data?.error?.message ?? `HTTP ${res.status}` }
    }

    // 즉시 완료 (비동기 아닌 경우)
    const directUri =
      data?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
      ?? data?.videos?.[0]?.uri
      ?? null

    if (directUri) {
      return { ok: true, video_url: directUri, status: "done" }
    }

    // Long-running operation → 폴링
    const operationName: string =
      data?.name ?? data?.operationName ?? ""

    if (!operationName) {
      return { ok: false, error: "no operation name returned" }
    }

    return await pollOperation(operationName, apiKey)

  } catch (e: any) {
    return { ok: false, error: e?.message ?? "veo_error" }
  }
}
