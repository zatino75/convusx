import type { ModelAdapter, ModelAttempt, ModelError, ModelRequest, ModelResponse } from "./types.js"

function env(name: string): string {
  const value = (globalThis as any)?.process?.env?.[name]
  return typeof value === "string" ? value.trim() : ""
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function now() {
  return Date.now()
}

function normalizeContent(value: any): string {
  if (typeof value === "string") return value

  if (Array.isArray(value)) {
    return value
      .map((x: any) => {
        if (typeof x === "string") return x
        if (typeof x?.text === "string") return x.text
        if (typeof x?.content === "string") return x.content
        return ""
      })
      .filter(Boolean)
      .join("\n")
      .trim()
  }

  if (value == null) return ""
  return String(value)
}

function normalizeMessages(messages: ModelRequest["messages"]) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => ({
      role: message.role,
      content: [
        {
          type: "input_text",
          text: normalizeContent((message as any).content)
        }
      ]
    }))
    .filter((message) => String(message.content?.[0]?.text ?? "").trim().length > 0)
}

function buildInput(messages: ModelRequest["messages"]) {
  const normalized = normalizeMessages(messages)

  if (normalized.length > 0) {
    return normalized
  }

  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: ""
        }
      ]
    }
  ]
}

function extractTextFromPart(part: any): string {
  if (typeof part?.text === "string" && part.text.trim()) {
    return part.text.trim()
  }

  if (typeof part?.output_text === "string" && part.output_text.trim()) {
    return part.output_text.trim()
  }

  if (typeof part?.content === "string" && part.content.trim()) {
    return part.content.trim()
  }

  return ""
}

function extractText(data: any): string {
  // /v1/responses 최상위 output_text
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim()
  }

  // /v1/responses: output[].content[].text (type: "output_text")
  const output = Array.isArray(data?.output) ? data.output : []
  for (const item of output) {
    if (typeof item?.text === "string" && item.text.trim()) return item.text.trim()

    const parts = Array.isArray(item?.content) ? item.content : []
    for (const part of parts) {
      if (typeof part?.text === "string" && part.text.trim()) return part.text.trim()
      if (typeof part?.output_text === "string" && part.output_text.trim()) return part.output_text.trim()
    }
  }

  // /v1/chat/completions fallback
  const choices = Array.isArray(data?.choices) ? data.choices : []
  for (const choice of choices) {
    const msg = choice?.message?.content ?? choice?.delta?.content ?? ""
    if (typeof msg === "string" && msg.trim()) return msg.trim()
  }

  const contentArray = Array.isArray(data?.content) ? data.content : []
  for (const part of contentArray) {
    const text = extractTextFromPart(part)
    if (text) return text
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
  if (statusCode >= 500) return true
  if (statusCode === 429) return true
  if (statusCode === 408) return true

  const normalized = String(code ?? "").trim().toLowerCase()

  if (normalized.includes("rate_limit")) return true
  if (normalized.includes("server")) return true
  if (normalized.includes("timeout")) return true
  if (normalized.includes("overloaded")) return true

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

function supportsTemperature(model: string): boolean {
  const normalized = String(model ?? "").trim().toLowerCase()

  if (!normalized) return true
  if (normalized.startsWith("gpt-5")) return false

  return true
}

function extractUsage(data: any) {
  return data?.usage ?? data?.response?.usage ?? undefined
}

async function callOpenAI(params: {
  apiKey: string
  model: string
  req: ModelRequest
  body: any
}) {
  const timeoutMs =
    typeof params.req.timeout_ms === "number" && params.req.timeout_ms > 0
      ? params.req.timeout_ms
      : 60000

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = now()

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${params.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(params.body),
      signal: controller.signal
    })

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

    throw {
      original: error,
      latencyMs,
      timedOut
    }
  } finally {
    clearTimeout(timer)
  }
}

export const openaiAdapter: ModelAdapter = {
  async generate(req: ModelRequest): Promise<ModelResponse> {
    const apiKey = env("OPENAI_API_KEY")
    const model = req.model?.trim() || (req.force_pro ? "gpt-5.4-pro" : "gpt-5.2")
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

    const systemPrompt = req.system_prompt
      ?? "You are AI Orchestra, a powerful multi-AI workspace that uses GPT-5.4, Claude Sonnet 4.6, Gemini 3.1 Pro, and Perplexity Pro. These are the actual models running in this system. Answer questions about these models based on your knowledge. Respond in the same language the user writes in. Be concise, accurate, and genuinely helpful."

    const body: any = {
      model,
      instructions: systemPrompt,
      input: buildInput(req.messages),
      max_output_tokens: req.max_tokens ?? 2048
    }

    if (supportsTemperature(model)) {
      body.temperature = req.temperature ?? 0
    }

    const maxAttempts =
      typeof req.max_retries === "number" && req.max_retries >= 1
        ? req.max_retries + 1
        : 2

    for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo += 1) {
      try {
        const { response, data, latencyMs } = await callOpenAI({
          apiKey,
          model,
          req,
          body
        })

        const text = extractText(data)
        const usage = extractUsage(data)

        if (!response.ok) {
          const apiError = extractApiError(data, response.status)
          const retriable = isRetriableError(response.status, apiError.code)

          attempts.push({
            provider: req.provider,
            model,
            status: "error",
            latency_ms: latencyMs,
            error: apiError.message,
            attempt_no: attemptNo,
            outcome: "error",
            retriable,
            http_status: response.status,
            error_code: apiError.code
          })

          if (retriable && attemptNo < maxAttempts) {
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
              retriable
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
  return openaiAdapter.generate(req)
}

// ─── DALL-E 3 이미지 생성 ─────────────────────────────────────
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
    const timer = setTimeout(() => controller.abort(), 60000)

    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })

    clearTimeout(timer)

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      return {
        ok: false,
        error: data?.error?.message ?? `HTTP ${response.status}`
      }
    }

    const url = data?.data?.[0]?.url
    const revised_prompt = data?.data?.[0]?.revised_prompt

    if (!url) return { ok: false, error: "no image url returned" }

    return { ok: true, url, revised_prompt }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "network_error" }
  }
}
