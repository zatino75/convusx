import type { ModelAdapter, ModelAttempt, ModelError, ModelRequest, ModelResponse } from "./types.js"

function env(name: string): string {
  const value = (globalThis as any)?.process?.env?.[name]
  return typeof value === "string" ? value.trim() : ""
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function now() {
  return Date.now()
}

function isRetriableError(status: number, code?: string): boolean {
  if (status >= 500) return true
  if (code === "overloaded_error") return true
  if (code === "rate_limit_error") return true
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

function splitSystemAndMessages(messages: ModelRequest["messages"]) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => normalizeContent((m as any).content))
    .join("\n\n")
    .trim()

  const conversation = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: normalizeContent((m as any).content)
    }))
    .filter((m) => m.content.length > 0)

  return {
    system,
    conversation: conversation.length > 0 ? conversation : [{ role: "user" as const, content: "" }]
  }
}

function extractText(data: any): string {
  const content = Array.isArray(data?.content) ? data.content : []

  const text = content
    .map((part: any) => {
      if (typeof part?.text === "string") return part.text
      if (typeof part?.content === "string") return part.content
      return ""
    })
    .filter(Boolean)
    .join("\n")
    .trim()

  if (text) return text
  if (typeof data?.output_text === "string") return data.output_text.trim()
  return ""
}

async function callAnthropic(apiKey: string, payload: any) {
  const start = now()

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  })

  const latency = now() - start
  const data = await response.json().catch(() => ({}))

  return { response, data, latency }
}

async function streamAnthropic(params: {
  apiKey: string
  payload: any
  onToken?: (chunk: string) => void | Promise<void>
}) {
  const start = now()

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      ...params.payload,
      stream: true
    })
  })

  const latency = now() - start

  if (!response.ok || !response.body) {
    const data = await response.json().catch(async () => {
      const text = await response.text().catch(() => "")
      return { error: { type: "request_failed", message: text } }
    })

    return {
      ok: false,
      latency,
      text: "",
      data,
      errorCode: typeof data?.error?.type === "string" ? data.error.type : "request_failed"
    }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  let buffer = ""
  let fullText = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    while (buffer.includes("\n\n")) {
      const index = buffer.indexOf("\n\n")
      const rawEvent = buffer.slice(0, index)
      buffer = buffer.slice(index + 2)

      const lines = rawEvent
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)

      const eventLine = lines.find((line) => line.startsWith("event:"))
      const dataLine = lines.find((line) => line.startsWith("data:"))

      const eventType = eventLine ? eventLine.replace(/^event:\s*/, "") : ""
      const jsonStr = dataLine ? dataLine.replace(/^data:\s*/, "") : ""

      if (!jsonStr || jsonStr === "[DONE]") continue

      try {
        const parsed = JSON.parse(jsonStr)

        if (eventType === "content_block_delta" || parsed?.type === "content_block_delta") {
          const deltaText =
            typeof parsed?.delta?.text === "string"
              ? parsed.delta.text
              : typeof parsed?.text === "string"
                ? parsed.text
                : ""

          if (deltaText) {
            fullText += deltaText
            if (params.onToken) {
              await params.onToken(deltaText)
            }
          }
        }
      } catch {
      }
    }
  }

  return {
    ok: true,
    latency,
    text: fullText,
    data: {
      usage: {}
    },
    errorCode: null
  }
}

export const claudeAdapter: ModelAdapter = {
  async generate(req: ModelRequest): Promise<ModelResponse> {
    const apiKey = env("ANTHROPIC_API_KEY")
    const model = req.model?.trim() || "claude-sonnet-4-6"
    const attempts: ModelAttempt[] = []
    const { system, conversation } = splitSystemAndMessages(req.messages)
    const onToken = typeof (req as any)?.onToken === "function" ? (req as any).onToken : undefined

    if (!apiKey) {
      return {
        provider: req.provider,
        model,
        answer: "",
        attempts,
        error: buildError(req.provider, "missing ANTHROPIC_API_KEY", "missing_api_key")
      }
    }

    const payload = {
      model,
      system: system || undefined,
      max_tokens: req.max_tokens ?? 2000,
      temperature: req.temperature ?? 0,
      messages: conversation.map((m) => ({
        role: m.role,
        content: [{ type: "text", text: m.content }]
      }))
    }

    try {
      if (onToken) {
        const streamed = await streamAnthropic({
          apiKey,
          payload,
          onToken
        })

        attempts.push({
          provider: req.provider,
          model,
          status: streamed.ok && streamed.text ? "success" : "error",
          latency_ms: streamed.latency,
          error: streamed.errorCode,
          attempt_no: 1,
          http_status: streamed.ok ? 200 : 500,
          error_code: streamed.errorCode ?? undefined,
          retriable: streamed.errorCode ? isRetriableError(500, streamed.errorCode) : false
        })

        if (!streamed.ok || !streamed.text) {
          return {
            provider: req.provider,
            model,
            answer: "",
            attempts,
            usage: streamed?.data?.usage,
            error: buildError(req.provider, "stream_request_failed", streamed.errorCode ?? "request_failed", true)
          }
        }

        return {
          provider: req.provider,
          model,
          answer: streamed.text,
          usage: streamed?.data?.usage,
          attempts,
          streaming_supported: true
        }
      }

      const first = await callAnthropic(apiKey, payload)
      const code = typeof first.data?.error?.type === "string" ? first.data.error.type : undefined
      const retriable = isRetriableError(first.response.status, code)
      const answer = extractText(first.data)

      attempts.push({
        provider: req.provider,
        model,
        status: first.response.ok && answer ? "success" : "error",
        latency_ms: first.latency,
        error: first.response.ok ? null : (code ?? "request_failed"),
        attempt_no: 1,
        http_status: first.response.status,
        error_code: code,
        retriable
      })

      if (!first.response.ok && retriable) {
        await sleep(400)

        const retry = await callAnthropic(apiKey, payload)
        const retryCode = typeof retry.data?.error?.type === "string" ? retry.data.error.type : undefined
        const retryAnswer = extractText(retry.data)

        attempts.push({
          provider: req.provider,
          model,
          status: retry.response.ok && retryAnswer ? "success" : "error",
          latency_ms: retry.latency,
          error: retry.response.ok ? null : (retryCode ?? "request_failed"),
          attempt_no: 2,
          http_status: retry.response.status,
          error_code: retryCode,
          retriable: isRetriableError(retry.response.status, retryCode)
        })

        if (!retry.response.ok || !retryAnswer) {
          return {
            provider: req.provider,
            model,
            answer: "",
            attempts,
            usage: retry.data?.usage,
            error: buildError(req.provider, "retry_failed", retryCode, true)
          }
        }

        return {
          provider: req.provider,
          model,
          answer: retryAnswer,
          usage: retry.data?.usage,
          attempts
        }
      }

      if (!first.response.ok || !answer) {
        return {
          provider: req.provider,
          model,
          answer: "",
          attempts,
          usage: first.data?.usage,
          error: buildError(req.provider, "request_failed", code, retriable)
        }
      }

      return {
        provider: req.provider,
        model,
        answer,
        usage: first.data?.usage,
        attempts
      }

    } catch (error: any) {
      return {
        provider: req.provider,
        model,
        answer: "",
        attempts,
        error: buildError(req.provider, String(error?.message ?? "network_error"), "network_error", true)
      }
    }
  }
}

export async function generate(req: ModelRequest): Promise<ModelResponse> {
  return claudeAdapter.generate(req)
}

export default claudeAdapter
