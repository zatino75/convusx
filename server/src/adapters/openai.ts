import type { ModelAdapter, ModelAttempt, ModelError, ModelRequest, ModelResponse } from "./types.js"
import { env, sleep, now, normalizeContent, extractProviderError, recordProviderMetric } from "./shared.js"
import { ADAPTER_TIMEOUT_MS, IMAGE_GEN_TIMEOUT_MS, OPENAI_BASE } from "../config/defaults.js"
import { logger } from "../observability/logger.js"

function shouldFallbackToChat(params: { status?: number; code?: string | null; message?: string | null; model?: string | null }): boolean {
  if (String((globalThis as any)?.process?.env?.OPENAI_FORCE_CHAT_COMPLETIONS ?? "").toLowerCase() === "true") return true
  const model = String(params.model ?? "").toLowerCase()
  if (model.startsWith("gpt-5")) return false
  const status = Number(params.status ?? 0)
  const code = String(params.code ?? "").toLowerCase()
  const message = String(params.message ?? "").toLowerCase()
  const hints = ["responses", "unsupported", "unknown parameter", "invalid parameter", "does not support", "input_text", "max_output_tokens"]
  return (status === 400 || status === 404) && hints.some((h) => code.includes(h) || message.includes(h))
}

function normalizeMessages(messages: ModelRequest["messages"]) {
  const mapped = (Array.isArray(messages) ? messages : [])
    .map((message) => ({
      role: message.role,
      content: [
        {
          type: message.role === "assistant" ? "output_text" : "input_text",
          text: normalizeContent((message as any).content)
        }
      ]
    }))
    .filter((message) => String(message.content?.[0]?.text ?? "").trim().length > 0)

  const deduped: typeof mapped = []
  for (const msg of mapped) {
    const last = deduped[deduped.length - 1]
    const text = msg.content?.[0]?.text ?? ""
    const lastText = last?.content?.[0]?.text ?? ""
    if (last && last.role === msg.role && text === lastText) continue
    deduped.push(msg)
  }
  return deduped
}

function buildInput(messages: ModelRequest["messages"]) {
  const normalized = normalizeMessages(messages)
  if (normalized.length > 0) return normalized
  return [{ role: "user", content: [{ type: "input_text", text: "" }] }]
}

function extractText(data: any): string {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim()

  const output = Array.isArray(data?.output) ? data.output : []
  for (const item of output) {
    if (typeof item?.text === "string" && item.text.trim()) return item.text.trim()
    const parts = Array.isArray(item?.content) ? item.content : []
    for (const part of parts) {
      if (typeof part?.text === "string" && part.text.trim()) return part.text.trim()
      if (typeof part?.output_text === "string" && part.output_text.trim()) return part.output_text.trim()
    }
  }

  const choices = Array.isArray(data?.choices) ? data.choices : []
  for (const choice of choices) {
    const msg = choice?.message?.content ?? choice?.delta?.content ?? ""
    if (typeof msg === "string" && msg.trim()) return msg.trim()
  }

  if (typeof data?.response?.output_text === "string" && data.response.output_text.trim()) {
    return data.response.output_text.trim()
  }

  return ""
}

function extractApiError(data: any, statusCode: number): { code: string; message: string } {
  const errorNode = data?.error ?? {}
  const code =
    typeof errorNode?.code === "string" && errorNode.code.trim()
      ? errorNode.code.trim()
      : typeof errorNode?.type === "string" && errorNode.type.trim()
        ? errorNode.type.trim()
        : `http_${statusCode}`

  const message =
    typeof errorNode?.message === "string" && errorNode.message.trim()
      ? errorNode.message.trim()
      : JSON.stringify(data)

  return { code, message }
}

function isRetriableError(statusCode: number, code?: string): boolean {
  if (statusCode >= 500 || statusCode === 429 || statusCode === 408) return true
  const normalized = String(code ?? "").trim().toLowerCase()
  return normalized.includes("rate_limit") || normalized.includes("server") || normalized.includes("timeout") || normalized.includes("overloaded")
}

function buildError(provider: ModelRequest["provider"], message: string, code?: string, retriable = false): ModelError {
  return { provider, message, code, retriable }
}

function supportsTemperature(model: string): boolean {
  const normalized = String(model ?? "").trim().toLowerCase()
  if (!normalized) return true
  if (normalized.startsWith("gpt-5")) return false
  return true
}

function extractUsage(data: any) {
  return data?.usage ?? data?.response?.usage ?? undefined
}

async function callOpenAI(params: { apiKey: string; model: string; req: ModelRequest; body: any }) {
  const timeoutMs = typeof params.req.timeout_ms === "number" && params.req.timeout_ms > 0 ? params.req.timeout_ms : ADAPTER_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = now()

  try {
    const response = await fetch(`${OPENAI_BASE}/v1/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${params.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(params.body),
      signal: controller.signal
    })

    const latencyMs = now() - startedAt
    const data = await response.json().catch(() => ({}))

    if (!response.ok && shouldFallbackToChat({ status: response.status, code: data?.error?.code, message: data?.error?.message, model: params.body?.model })) {
      const chatBody = {
        model: params.body.model,
        messages: [
          ...(params.body.instructions ? [{ role: "system", content: params.body.instructions }] : []),
          ...(Array.isArray(params.body.input)
            ? params.body.input.map((m: any) => ({
                role: m.role,
                content: Array.isArray(m.content) ? m.content.map((p: any) => p.text ?? p.input_text ?? "").join("") : m.content ?? ""
              }))
            : [{ role: "user", content: String(params.body.input ?? "") }])
        ],
        max_tokens: params.body.max_output_tokens ?? 16384,
        ...(params.body.temperature !== undefined ? { temperature: params.body.temperature } : {})
      }
      const chatResp = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${params.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(chatBody),
        signal: controller.signal
      })
      const chatData = await chatResp.json().catch(() => ({}))
      return { response: chatResp, data: chatData, latencyMs, timedOut: false }
    }

    return { response, data, latencyMs, timedOut: false }
  } catch (error: any) {
    const latencyMs = now() - startedAt
    const timedOut = error?.name === "AbortError" || String(error?.message ?? "").toLowerCase().includes("aborted")
    throw { original: error, latencyMs, timedOut }
  } finally {
    clearTimeout(timer)
  }
}

async function callOpenAIStreaming(params: { apiKey: string; model: string; req: ModelRequest; body: any }): Promise<{ text: string; usage: any; latencyMs: number; timedOut: boolean; errorData?: any; httpStatus?: number }> {
  const timeoutMs = typeof params.req.timeout_ms === "number" && params.req.timeout_ms > 0 ? params.req.timeout_ms : ADAPTER_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = now()

  try {
    const response = await fetch(`${OPENAI_BASE}/v1/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${params.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...params.body, stream: true }),
      signal: controller.signal
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const latencyMs = now() - startedAt
      return { text: "", usage: {}, latencyMs, timedOut: false, errorData, httpStatus: response.status }
    }

    let fullText = ""
    const usage: { input_tokens?: number; output_tokens?: number; total_tokens?: number } = {}
    const reader = response.body?.getReader()
    if (!reader) {
      const latencyMs = now() - startedAt
      return { text: "", usage, latencyMs, timedOut: false }
    }

    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === "data: [DONE]" || !trimmed.startsWith("data: ")) continue
        const jsonStr = trimmed.slice(6)
        try {
          const parsed = JSON.parse(jsonStr)
          const eventType = String(parsed?.type ?? "")
          if (eventType === "response.output_text.delta") {
            const delta = String(parsed?.delta ?? "")
            if (delta) {
              fullText += delta
              await params.req.onToken?.(delta)
            }
          }
          if (eventType === "response.completed") {
            const responseUsage = parsed?.response?.usage
            if (responseUsage) {
              if (typeof responseUsage.input_tokens === "number") usage.input_tokens = responseUsage.input_tokens
              if (typeof responseUsage.output_tokens === "number") usage.output_tokens = responseUsage.output_tokens
              if (typeof responseUsage.total_tokens === "number") usage.total_tokens = responseUsage.total_tokens
            }
          }
        } catch {
          // ignore parse errors
        }
      }
    }

    const latencyMs = now() - startedAt
    return { text: fullText, usage, latencyMs, timedOut: false }
  } catch (error: any) {
    const latencyMs = now() - startedAt
    const timedOut = error?.name === "AbortError" || String(error?.message ?? "").toLowerCase().includes("aborted")
    throw { original: error, latencyMs, timedOut }
  } finally {
    clearTimeout(timer)
  }
}

export const openaiAdapter: ModelAdapter = {
  async generate(req: ModelRequest): Promise<ModelResponse> {
    const apiKey = env("OPENAI_API_KEY")
    const model = req.model?.trim() || "gpt-5.4"  // 최상위 버전 고정 (CLAUDE.md)
    const attempts: ModelAttempt[] = []

    if (!apiKey) {
      return {
        provider: req.provider,
        model,
        answer: "",
        attempts,
        error: buildError(req.provider, "missing OPENAI_API_KEY", "missing_api_key")
      }
    }

    const systemPrompt = req.system_prompt ??
      "You are CORVUS X, a powerful multi-AI workspace powered by GPT-5.4, Claude Opus 4.6, Gemini 2.5 Pro, and Perplexity sonar-pro. These are the actual models running in this system. Answer questions about these models based on your knowledge. Respond in the same language the user writes in. Be concise, accurate, and genuinely helpful."

    const body: any = {
      model,
      instructions: systemPrompt,
      input: buildInput(req.messages),
      max_output_tokens: req.max_tokens ?? 16384
    }

    if (supportsTemperature(model)) {
      body.temperature = req.temperature ?? 0
    }

    const maxAttempts = typeof req.max_retries === "number" && req.max_retries >= 1 ? req.max_retries + 1 : 2
    const wantsStreaming = Boolean(req.stream || typeof req.onToken === "function")

    if (wantsStreaming && typeof req.onToken === "function") {
      try {
        const streamResult = await callOpenAIStreaming({ apiKey, model, req, body })
        if (streamResult.httpStatus !== undefined && streamResult.httpStatus >= 400) {
          logger.warn(`[OpenAI] streaming HTTP ${streamResult.httpStatus}, falling back to non-streaming`)
        } else if (streamResult.text || !streamResult.errorData) {
          const text = streamResult.text.trim()
          const latencyMs = streamResult.latencyMs
          if (text) {
            attempts.push({
              provider: req.provider,
              model,
              status: "success",
              latency_ms: latencyMs,
              error: null,
              attempt_no: 1,
              outcome: "success",
              retriable: false
            })
            recordProviderMetric("openai", latencyMs, true)
            return {
              provider: req.provider,
              model,
              answer: text,
              usage: streamResult.usage,
              attempts,
              streaming_supported: true
            }
          }
          logger.warn("[OpenAI] streaming returned empty text, falling back to non-streaming")
        }
      } catch (e: any) {
        const isAbort = e?.name === "AbortError" ||
          String(e?.message ?? "").toLowerCase().includes("aborted") ||
          String(e?.original?.message ?? "").toLowerCase().includes("aborted")

        if (isAbort) {
          attempts.push({
            provider: req.provider,
            model,
            status: "error",
            latency_ms: 0,
            error: "aborted",
            attempt_no: 1,
            outcome: "timeout",
            retriable: false,
            error_code: "aborted"
          })
          recordProviderMetric("openai", 0, false)
          return {
            provider: req.provider,
            model,
            answer: "",
            attempts,
            error: buildError(req.provider, `[${model}] aborted`, "aborted", false)
          }
        }

        logger.warn("[OpenAI] streaming error, falling back to non-streaming:", { detail: e?.original?.message ?? e?.message ?? "unknown" })
      }
    }

    for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo += 1) {
      try {
        const { response, data, latencyMs } = await callOpenAI({ apiKey, model, req, body })
        const text = extractText(data)
        const usage = extractUsage(data)

        if (!response.ok) {
          const apiError = extractProviderError("openai", data, response.status)
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
          recordProviderMetric("openai", latencyMs, false)

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
            error: buildError(req.provider, `[${model}] ${apiError.message}`, apiError.code, apiError.retriable)
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
          recordProviderMetric("openai", latencyMs, false)

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
            error: buildError(req.provider, `[${model}] empty_response`, "empty_response", false)
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
        recordProviderMetric("openai", latencyMs, true)

        return {
          provider: req.provider,
          model,
          answer: text,
          usage,
          attempts
        }
      } catch (wrapped: any) {
        const original = wrapped?.original
        const latencyMs = typeof wrapped?.latencyMs === "number" ? wrapped.latencyMs : 0
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
        recordProviderMetric("openai", latencyMs, false)

        if (attemptNo < maxAttempts) {
          await sleep(500 * attemptNo)
          continue
        }

        return {
          provider: req.provider,
          model,
          answer: "",
          attempts,
          error: buildError(req.provider, `[${model}] ${message}`, code, retriable)
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
  return openaiAdapter.generate(req)
}

export async function generateImage(params: {
  prompt: string
  size?: "1024x1024" | "1792x1024" | "1024x1792"
  quality?: "standard" | "hd"
  style?: "vivid" | "natural"
}): Promise<{ ok: boolean; url?: string; revised_prompt?: string; error?: string }> {
  const apiKey = env("OPENAI_API_KEY")
  if (!apiKey) return { ok: false, error: "missing OPENAI_API_KEY" }

  const body = {
    model: "dall-e-3",
    prompt: params.prompt,
    n: 1,
    size: params.size ?? "1024x1024",
    quality: params.quality ?? "standard",
    style: params.style ?? "vivid",
    response_format: "url"
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), IMAGE_GEN_TIMEOUT_MS)
    const response = await fetch(`${OPENAI_BASE}/v1/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    clearTimeout(timer)

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      return { ok: false, error: data?.error?.message ?? `HTTP ${response.status}` }
    }

    const url = data?.data?.[0]?.url
    const revised_prompt = data?.data?.[0]?.revised_prompt
    if (!url) return { ok: false, error: "no image url returned" }
    return { ok: true, url, revised_prompt }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "network_error" }
  }
}
