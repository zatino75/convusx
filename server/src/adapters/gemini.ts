import type { ModelAdapter, ModelAttempt, ModelError, ModelRequest, ModelResponse } from "./types.js"
import { env, sleep, now, normalizeContent, extractProviderError, recordProviderMetric } from "./shared.js"
import {
  ADAPTER_TIMEOUT_GEMINI_MS,
  ADAPTER_TIMEOUT_STREAM_GEMINI_MS,
  IMAGE_GEN_TIMEOUT_MS,
  GEMINI_BASE,
  GEMINI_MODEL_ID,
  GEMINI_DISPLAY_LABEL,
} from "../config/defaults.js"

// Gemini 모델 문자열의 단일 출처는 config/defaults.ts 로 승격되었다.
// 기존 import 경로(adapters/gemini) 호환성을 위해 이 모듈에서도 re-export 한다.
export { GEMINI_MODEL_ID, GEMINI_DISPLAY_LABEL }

function splitSystemAndMessages(messages: ModelRequest["messages"]) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => normalizeContent((m as any).content))
    .join("\n\n")
    .trim()

  const conversation = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [
        {
          text: normalizeContent((m as any).content)
        }
      ]
    }))
    .filter((m) => String(m.parts?.[0]?.text ?? "").trim().length > 0)

  return {
    system,
    conversation: conversation.length > 0
      ? conversation
      : [
          {
            role: "user" as const,
            parts: [{ text: "" }]
          }
        ]
  }
}

function extractText(data: any): string {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : []

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []

    for (const part of parts) {
      if (typeof part?.text === "string" && part.text.trim()) {
        return part.text.trim()
      }
    }
  }

  if (typeof data?.text === "string" && data.text.trim()) {
    return data.text.trim()
  }

  return ""
}

function extractTextChunk(data: any): string {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : []
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
    for (const part of parts) {
      if (typeof part?.text === "string") return part.text
    }
  }
  return ""
}

function extractApiError(data: any, statusCode: number): { code: string; message: string } {
  const apiError = data?.error ?? {}
  const statusText = typeof apiError?.status === "string" ? apiError.status.trim() : ""
  const messageText = typeof apiError?.message === "string" ? apiError.message.trim() : ""
  const detailsText = Array.isArray(apiError?.details) ? JSON.stringify(apiError.details) : ""

  const code =
    statusText ||
    (typeof apiError?.code === "number" ? `http_${apiError.code}` : `http_${statusCode}`)

  const message =
    messageText ||
    detailsText ||
    JSON.stringify(data)

  return { code, message }
}

function isRetriableError(statusCode: number, code?: string): boolean {
  if (statusCode >= 500) return true
  if (statusCode === 429) return true

  const normalized = String(code ?? "").trim().toUpperCase()

  if (normalized === "RESOURCE_EXHAUSTED") return true
  if (normalized === "UNAVAILABLE") return true
  if (normalized === "DEADLINE_EXCEEDED") return true
  if (normalized === "INTERNAL") return true

  return false
}

function buildError(provider: ModelRequest["provider"], message: string, code?: string, retriable = false): ModelError {
  return {
    provider,
    message,
    code,
    retriable
  }
}

function extractUsage(data: any) {
  return data?.usageMetadata ?? undefined
}

async function callGemini(params: {
  apiKey: string
  model: string
  req: ModelRequest
  body: any
  externalSignal?: AbortSignal | null
}) {
  const timeoutMs =
    typeof params.req.timeout_ms === "number" && params.req.timeout_ms > 0
      ? params.req.timeout_ms
      : ADAPTER_TIMEOUT_GEMINI_MS

  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs)

  const externalSignal = params.externalSignal ?? null
  let externalListener: (() => void) | null = null

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer)
      throw { original: new Error("aborted"), latencyMs: 0, timedOut: false, aborted: true }
    }
    externalListener = () => timeoutController.abort()
    externalSignal.addEventListener("abort", externalListener)
  }

  const startedAt = now()

  try {
    const response = await fetch(
      `${GEMINI_BASE}/models/${params.model}:generateContent?key=${params.apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(params.body),
        signal: timeoutController.signal
      }
    )

    const latencyMs = now() - startedAt
    const data = await response.json().catch(() => ({}))

    return {
      response,
      data,
      latencyMs,
      timedOut: false
    }
  } catch (error: any) {
    const latencyMs = now() - startedAt
    const timedOut =
      error?.name === "AbortError" ||
      String(error?.message ?? "").toLowerCase().includes("aborted")

    const clientAborted = externalSignal?.aborted === true

    throw {
      original: error,
      latencyMs,
      timedOut: timedOut && !clientAborted,
      aborted: clientAborted
    }
  } finally {
    clearTimeout(timer)
    if (externalSignal && externalListener) {
      externalSignal.removeEventListener("abort", externalListener)
    }
  }
}

// ─── Gemini SSE 스트리밍 ─────────────────────────────────────────
async function streamGemini(params: {
  apiKey: string
  model: string
  body: any
  onToken?: (chunk: string) => void | Promise<void>
  timeoutMs?: number
  externalSignal?: AbortSignal | null
}) {
  const timeoutMs = typeof params.timeoutMs === "number" && params.timeoutMs > 0
    ? params.timeoutMs
    : ADAPTER_TIMEOUT_STREAM_GEMINI_MS

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = now()

  const externalSignal = params.externalSignal ?? null
  let externalListener: (() => void) | null = null

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer)
      return {
        ok: false,
        latency: 0,
        text: "",
        usage: undefined,
        errorCode: "aborted",
        timedOut: false
      }
    }
    externalListener = () => controller.abort()
    externalSignal.addEventListener("abort", externalListener)
  }

  try {
    const response = await fetch(
      `${GEMINI_BASE}/models/${params.model}:streamGenerateContent?key=${params.apiKey}&alt=sse`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(params.body),
        signal: controller.signal
      }
    )

    const latency = now() - start

    if (!response.ok || !response.body) {
      const data = await response.json().catch(async () => {
        const text = await response.text().catch(() => "")
        return { error: { message: text } }
      })
      return {
        ok: false,
        latency,
        text: "",
        usage: undefined,
        errorCode: extractApiError(data, response.status).code,
        timedOut: false
      }
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()

    let buffer = ""
    let fullText = ""
    let usage: any = undefined

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Gemini SSE: data: {...}\n\n 형식
      while (buffer.includes("\n\n")) {
        const index = buffer.indexOf("\n\n")
        const rawEvent = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)

        const lines = rawEvent
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)

        const dataLine = lines.find((line) => line.startsWith("data:"))
        if (!dataLine) continue

        const jsonStr = dataLine.replace(/^data:\s*/, "")
        if (!jsonStr || jsonStr === "[DONE]") continue

        try {
          const parsed = JSON.parse(jsonStr)

          // 텍스트 청크 추출
          const chunkText = extractTextChunk(parsed)
          if (chunkText) {
            fullText += chunkText
            if (params.onToken) {
              await params.onToken(chunkText)
            }
          }

          // usageMetadata: 마지막 청크에 포함됨
          if (parsed?.usageMetadata) {
            usage = parsed.usageMetadata
          }
        } catch {
          // JSON parse 실패 무시
        }
      }
    }

    return {
      ok: true,
      latency: now() - start,
      text: fullText,
      usage,
      errorCode: null,
      timedOut: false
    }
  } catch (error: any) {
    const latency = now() - start
    const clientAborted = externalSignal?.aborted === true
    const timedOut =
      !clientAborted &&
      (error?.name === "AbortError" ||
        String(error?.message ?? "").toLowerCase().includes("aborted"))

    return {
      ok: false,
      latency,
      text: "",
      usage: undefined,
      errorCode: clientAborted ? "aborted" : timedOut ? "timeout" : "network_error",
      timedOut
    }
  } finally {
    clearTimeout(timer)
    if (externalSignal && externalListener) {
      externalSignal.removeEventListener("abort", externalListener)
    }
  }
}

export const geminiAdapter: ModelAdapter = {
  async generate(req: ModelRequest): Promise<ModelResponse> {
    const apiKey = env("GEMINI_API_KEY")
    const model = req.model?.trim() || GEMINI_MODEL_ID
    const attempts: ModelAttempt[] = []
    const { system, conversation } = splitSystemAndMessages(req.messages)

    const externalSignal: AbortSignal | null = (req as any).abort_signal ?? null
    const onToken = typeof (req as any)?.onToken === "function" ? (req as any).onToken : undefined

    if (!apiKey) {
      return {
        provider: req.provider,
        model,
        answer: "",
        attempts,
        error: buildError(req.provider, "missing GEMINI_API_KEY", "missing_api_key")
      }
    }

    const timeoutMs =
      typeof req.timeout_ms === "number" && req.timeout_ms > 0
        ? req.timeout_ms
        : ADAPTER_TIMEOUT_GEMINI_MS

    const requestBody = {
      contents: conversation,
      ...(system
        ? {
            systemInstruction: {
              parts: [
                {
                  text: system
                }
              ]
            }
          }
        : {}),
      generationConfig: {
        temperature: req.temperature ?? 0,
        maxOutputTokens: req.max_tokens ?? 65536
      }
    }

    // ── 스트리밍 경로 ──────────────────────────────────────────────
    if (onToken) {
      const maxAttempts = 2

      for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo += 1) {
        if (externalSignal?.aborted) {
          return {
            provider: req.provider,
            model,
            answer: "",
            attempts,
            error: buildError(req.provider, `[${model}] aborted`, "aborted", false)
          }
        }

        const streamed = await streamGemini({
          apiKey,
          model,
          body: requestBody,
          onToken,
          timeoutMs,
          externalSignal
        })

        const isSuccess = streamed.ok && !!streamed.text

        attempts.push({
          provider: req.provider,
          model,
          status: isSuccess ? "success" : "error",
          latency_ms: streamed.latency,
          error: streamed.errorCode,
          attempt_no: attemptNo,
          http_status: isSuccess ? 200 : 500,
          error_code: streamed.errorCode ?? undefined,
          retriable: !isSuccess && streamed.errorCode !== "aborted"
        })
        recordProviderMetric("gemini", streamed.latency, isSuccess)

        // 클라이언트 abort → 즉시 반환
        if (streamed.errorCode === "aborted") {
          return {
            provider: req.provider,
            model,
            answer: "",
            attempts,
            error: buildError(req.provider, `[${model}] aborted`, "aborted", false)
          }
        }

        if (isSuccess) {
          return {
            provider: req.provider,
            model,
            answer: streamed.text,
            usage: streamed.usage,
            attempts,
            streaming_supported: true
          }
        }

        if (attemptNo < maxAttempts) {
          await sleep(500 * attemptNo)
          continue
        }
      }

      // 스트리밍 2회 실패 → 논스트리밍 폴백
    }

    // ── 논스트리밍 경로 ────────────────────────────────────────────
    const maxAttempts =
      typeof req.max_retries === "number" && req.max_retries >= 1
        ? req.max_retries + 1
        : 2

    for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo += 1) {
      if (externalSignal?.aborted) {
        return {
          provider: req.provider,
          model,
          answer: "",
          attempts,
          error: buildError(req.provider, `[${model}] aborted`, "aborted", false)
        }
      }

      try {
        const { response, data, latencyMs } = await callGemini({
          apiKey,
          model,
          req,
          body: requestBody,
          externalSignal
        })

        const text = extractText(data)
        const usage = extractUsage(data)

        if (!response.ok) {
          const apiError = extractProviderError("gemini", data, response.status)

          attempts.push({
            provider: req.provider,
            model,
            status: "error",
            latency_ms: latencyMs,
            error: apiError.message,
            attempt_no: attemptNo,
            outcome: "error",
            retriable: apiError.retriable,
            http_status: response.status,
            error_code: apiError.code
          })
          recordProviderMetric("gemini", latencyMs, false)

          if (apiError.retriable && attemptNo < maxAttempts) {
            await sleep(500 * attemptNo)
            continue
          }

          return {
            provider: req.provider,
            model,
            answer: "",
            attempts,
            usage,
            error: buildError(
              req.provider,
              `[${model}] ${apiError.message}`,
              apiError.code,
              apiError.retriable
            )
          }
        }

        if (!text) {
          const retriable = attemptNo < maxAttempts

          attempts.push({
            provider: req.provider,
            model,
            status: "error",
            latency_ms: latencyMs,
            error: "empty_response",
            attempt_no: attemptNo,
            outcome: "error",
            retriable,
            http_status: response.status,
            error_code: "empty_response"
          })
          recordProviderMetric("gemini", latencyMs, false)

          if (retriable) {
            await sleep(400 * attemptNo)
            continue
          }

          return {
            provider: req.provider,
            model,
            answer: "",
            attempts,
            usage,
            error: buildError(
              req.provider,
              `[${model}] empty_response`,
              "empty_response",
              false
            )
          }
        }

        attempts.push({
          provider: req.provider,
          model,
          status: "success",
          latency_ms: latencyMs,
          error: null,
          attempt_no: attemptNo,
          outcome: "success",
          retriable: false,
          http_status: response.status
        })
        recordProviderMetric("gemini", latencyMs, true)

        return {
          provider: req.provider,
          model,
          answer: text,
          usage,
          attempts
        }
      } catch (wrapped: any) {
        const original = wrapped?.original
        const latencyMs =
          typeof wrapped?.latencyMs === "number"
            ? wrapped.latencyMs
            : 0

        if (wrapped?.aborted === true) {
          attempts.push({
            provider: req.provider,
            model,
            status: "error",
            latency_ms: latencyMs,
            error: "aborted",
            attempt_no: attemptNo,
            outcome: "error",
            retriable: false,
            error_code: "aborted"
          })
          recordProviderMetric("gemini", latencyMs, false)

          return {
            provider: req.provider,
            model,
            answer: "",
            attempts,
            error: buildError(req.provider, `[${model}] aborted`, "aborted", false)
          }
        }

        const timedOut = wrapped?.timedOut === true
        const code = timedOut ? "timeout" : "network_error"
        const message = String(original?.message ?? code)
        const retriable = true

        attempts.push({
          provider: req.provider,
          model,
          status: "error",
          latency_ms: latencyMs,
          error: message,
          attempt_no: attemptNo,
          outcome: timedOut ? "timeout" : "error",
          retriable,
          error_code: code
        })
        recordProviderMetric("gemini", latencyMs, false)

        if (attemptNo < maxAttempts) {
          await sleep(500 * attemptNo)
          continue
        }

        return {
          provider: req.provider,
          model,
          answer: "",
          attempts,
          error: buildError(
            req.provider,
            `[${model}] ${message}`,
            code,
            retriable
          )
        }
      }
    }

    return {
      provider: req.provider,
      model,
      answer: "",
      attempts,
      error: buildError(req.provider, `[${model}] unexpected_fallback`, "unexpected_fallback")
    }
  }
}

export async function generate(req: ModelRequest): Promise<ModelResponse> {
  return geminiAdapter.generate(req)
}

export default geminiAdapter

// ─── Gemini Imagen 4 이미지 생성 ─────────────────────────────────
export async function generateImageImagen(params: {
  prompt: string
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4"
}): Promise<{ ok: boolean; url?: string; base64?: string; mimeType?: string; error?: string }> {
  const apiKey = env("GEMINI_API_KEY")
  if (!apiKey) return { ok: false, error: "missing GEMINI_API_KEY" }

  const model = "imagen-4.0-generate-preview-05-20"

  const body = {
    instances: [{ prompt: params.prompt }],
    parameters: {
      aspectRatio: params.aspectRatio ?? "1:1",
      outputMimeType: "image/jpeg"
    }
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), IMAGE_GEN_TIMEOUT_MS)

    const response = await fetch(
      `https://us-central1-aiplatform.googleapis.com/v1/projects/generativelanguage/locations/us-central1/publishers/google/models/${model}:predict?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      }
    )

    clearTimeout(timer)

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      return await generateImageImagen3Fallback(params.prompt, apiKey)
    }

    const prediction = data?.predictions?.[0]
    const base64 = prediction?.bytesBase64Encoded
    const mimeType = prediction?.mimeType ?? "image/jpeg"

    if (!base64) {
      return await generateImageImagen3Fallback(params.prompt, apiKey)
    }

    const url = `data:${mimeType};base64,${base64}`
    return { ok: true, url, base64, mimeType }
  } catch (e: any) {
    return await generateImageImagen3Fallback(params.prompt, apiKey)
  }
}

async function generateImageImagen3Fallback(
  prompt: string,
  apiKey: string
): Promise<{ ok: boolean; url?: string; base64?: string; mimeType?: string; error?: string }> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), IMAGE_GEN_TIMEOUT_MS)

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] }
    }

    const response = await fetch(
      `${GEMINI_BASE}/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      }
    )

    clearTimeout(timer)

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      return { ok: false, error: data?.error?.message ?? `HTTP ${response.status}` }
    }

    const parts = data?.candidates?.[0]?.content?.parts ?? []
    for (const part of parts) {
      if (part?.inlineData?.data) {
        const base64 = part.inlineData.data
        const mimeType = part.inlineData.mimeType ?? "image/jpeg"
        const url = `data:${mimeType};base64,${base64}`
        return { ok: true, url, base64, mimeType }
      }
    }

    return { ok: false, error: "no image in response" }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "network_error" }
  }
}
