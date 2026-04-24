// ── 어댑터 공용 유틸 ──
// claude.ts, openai.ts, gemini.ts, perplexity.ts에서 중복되던 함수 통합

import type { ModelResponse } from "./types.js"

export function env(key: string): string {
  return String(process.env?.[key] ?? "").trim()
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function now(): number {
  return Date.now()
}

export function buildError(
  code: string,
  message: string,
  extra?: Record<string, any>
): ModelResponse {
  return {
    ok: false,
    provider: "unknown",
    answer: "",
    error_code: code,
    error_message: message,
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 },
    latency_ms: 0,
    attempts: [],
    ...extra
  }
}

export function isRetriableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 529
}

export function isRetriableError(err: any): boolean {
  if (!err) return false
  const msg = String(err?.message ?? err ?? "").toLowerCase()
  if (msg.includes("rate") || msg.includes("overloaded") || msg.includes("timeout")) return true
  if (msg.includes("econnreset") || msg.includes("enotfound") || msg.includes("socket")) return true
  const status = Number(err?.status ?? err?.statusCode ?? 0)
  return isRetriableStatus(status)
}

/**
 * 각 AI provider의 에러 응답을 표준 { code, message, retriable } 포맷으로 추출.
 * 기존 각 어댑터에 흩어진 extractApiError/isRetriableError 로직을 통합 보완.
 */
export function extractProviderError(
  provider: string,
  data: any,
  statusCode: number
): { code: string; message: string; retriable: boolean } {
  const p = String(provider ?? "").trim().toLowerCase()
  const errorNode = data?.error ?? {}

  let code = ""
  let message = ""

  if (p === "claude" || p === "anthropic") {
    // Anthropic: error.type + error.message
    code = typeof errorNode?.type === "string" && errorNode.type.trim()
      ? errorNode.type.trim()
      : `http_${statusCode}`
    message = typeof errorNode?.message === "string" && errorNode.message.trim()
      ? errorNode.message.trim()
      : JSON.stringify(data)
  } else if (p === "gemini" || p === "google") {
    // Gemini: error.status + error.message + error.details
    const statusText = typeof errorNode?.status === "string" ? errorNode.status.trim() : ""
    const messageText = typeof errorNode?.message === "string" ? errorNode.message.trim() : ""
    const detailsText = Array.isArray(errorNode?.details) ? JSON.stringify(errorNode.details) : ""
    code = statusText || (typeof errorNode?.code === "number" ? `http_${errorNode.code}` : `http_${statusCode}`)
    message = messageText || detailsText || JSON.stringify(data)
  } else {
    // OpenAI / Perplexity / 기타: error.code || error.type + error.message
    code = typeof errorNode?.code === "string" && errorNode.code.trim()
      ? errorNode.code.trim()
      : typeof errorNode?.type === "string" && errorNode.type.trim()
        ? errorNode.type.trim()
        : `http_${statusCode}`
    message = typeof errorNode?.message === "string" && errorNode.message.trim()
      ? errorNode.message.trim()
      : JSON.stringify(data)
  }

  const retriable = isRetriableStatus(statusCode) || isRetriableErrorCode(code)
  return { code, message, retriable }
}

function isRetriableErrorCode(code: string): boolean {
  const c = String(code ?? "").trim().toLowerCase()
  return c.includes("rate_limit") || c.includes("overloaded") || c.includes("timeout")
    || c === "resource_exhausted" || c === "unavailable" || c === "deadline_exceeded"
    || c === "server_error"
}

/**
 * APM Provider 호출 기록 래퍼 (D5 연동).
 * 각 어댑터에서 이미 계산한 latencyMs와 성공 여부를 넘기면 됨.
 * import 순환 방지를 위해 dynamic import 사용.
 *
 * 2026-04-23: 옵션 ctx (model + usage) 를 받으면 성공 호출에 한해
 * 토큰 사용량과 USD 비용을 구조화 로그로 함께 emit. 비용 관측 인프라 기반.
 */
export function recordProviderMetric(
  provider: string,
  latencyMs: number,
  success: boolean,
  ctx?: { model?: string; usage?: any }
) {
  import("../observability/apm.js")
    .then(mod => mod.recordProviderCall(provider, latencyMs, success))
    .catch(() => { /* APM 미사용 환경 무시 */ })

  // 성공 호출 + usage 제공된 경우에만 비용 로그 emit
  if (!success || !ctx?.usage || !ctx?.model) return
  const usage = ctx.usage
  const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0
  const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0
  if (inputTokens === 0 && outputTokens === 0) return

  Promise.all([
    import("../cost/costCalc.js"),
    import("../observability/logger.js"),
  ]).then(([costMod, logMod]) => {
    const costUsd = costMod.estimateCostUsd(ctx.model, usage)
    logMod.logger.info("[adapter:usage]", {
      provider,
      model: ctx.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: Number(costUsd.toFixed(6)),
      latency_ms: latencyMs,
    })
    // 2026-04-24 Phase 2: 조회 전용 트래커에 병행 집계.
    // 기존 journalctl 로그는 그대로 두고 (CLAUDE.md 규칙 #16),
    // 대시보드 실시간 조회용으로만 in-memory 누적.
    import("../creditGuard.js")
      .then(guardMod => guardMod.recordCost(provider, costUsd))
      .catch(() => { /* 트래커 실패는 무시 (hot path 보호) */ })
  }).catch(() => { /* 로깅 실패 무시 (hot path 보호) */ })
}

export function normalizeContent(content: any): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === "string") return part
        if (typeof part?.text === "string") return part.text
        return ""
      })
      .join("\n")
  }
  return String(content ?? "")
}

