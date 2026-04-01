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
  if (status === 429) return true
  if (status === 408) return true
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

async function callAnthropic(params: {
  apiKey: string
  payload: any
  timeoutMs?: number
}) {
  const timeoutMs = typeof params.timeoutMs === "number" && params.timeoutMs > 0
    ? params.timeoutMs
    : 60000

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = now()

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": params.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify(params.payload),
      signal: controller.signal
    })

    const latency = now() - start
    const data = await response.json().catch(() => ({}))

    return { response, data, latency, timedOut: false }
  } catch (error: any) {
    const latency = now() - start
    const timedOut =
      error?.name === "AbortError" ||
      String(error?.message ?? "").toLowerCase().includes("aborted")

    throw { original: error, latency, timedOut }
  } finally {
    clearTimeout(timer)
  }
}

async function streamAnthropic(params: {
  apiKey: string
  payload: any
  onToken?: (chunk: string) => void | Promise<void>
  timeoutMs?: number
}) {
  const timeoutMs = typeof params.timeoutMs === "number" && params.timeoutMs > 0
    ? params.timeoutMs
    : 60000

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = now()

  try {
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
      }),
      signal: controller.signal
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
        errorCode: typeof data?.error?.type === "string" ? data.error.type : "request_failed",
        timedOut: false
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
      data: { usage: {} },
      errorCode: null,
      timedOut: false
    }
  } catch (error: any) {
    const latency = now() - start
    const timedOut =
      error?.name === "AbortError" ||
      String(error?.message ?? "").toLowerCase().includes("aborted")

    return {
      ok: false,
      latency,
      text: "",
      data: {},
      errorCode: timedOut ? "timeout" : "network_error",
      timedOut
    }
  } finally {
    clearTimeout(timer)
  }
}

export const claudeAdapter: ModelAdapter = {
  async generate(req: ModelRequest): Promise<ModelResponse> {
    const apiKey = env("ANTHROPIC_API_KEY")
    const model = req.model?.trim() || (req.force_pro ? "claude-opus-4-6" : "claude-sonnet-4-6")
    const attempts: ModelAttempt[] = []
    const { system, conversation } = splitSystemAndMessages(req.messages)
    const onToken = typeof (req as any)?.onToken === "function" ? (req as any).onToken : undefined

    const timeoutMs =
      typeof (req as any).timeout_ms === "number" && (req as any).timeout_ms > 0
        ? (req as any).timeout_ms
        : 60000

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

    // ── 스트리밍 경로: 재시도 1회
    if (onToken) {
      const maxAttempts = 2

      for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo += 1) {
        const streamed = await streamAnthropic({ apiKey, payload, onToken, timeoutMs })

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
          retriable: !!streamed.errorCode
        })

        if (isSuccess) {
          return {
            provider: req.provider,
            model,
            answer: streamed.text,
            usage: streamed?.data?.usage,
            attempts,
            streaming_supported: true
          }
        }

        // 재시도 가능 + 남은 시도 있을 때만 대기
        if (attemptNo < maxAttempts) {
          await sleep(500 * attemptNo)
          continue
        }
      }

      return {
        provider: req.provider,
        model,
        answer: "",
        attempts,
        error: buildError(req.provider, "stream_request_failed", "stream_failed", true)
      }
    }

    // ── 일반(비스트리밍) 경로: loop 기반 retry
    const maxAttempts =
      typeof req.max_retries === "number" && req.max_retries >= 1
        ? req.max_retries + 1
        : 2

    for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo += 1) {
      try {
        const { response, data, latency } = await callAnthropic({ apiKey, payload, timeoutMs })

        const code = typeof data?.error?.type === "string" ? data.error.type : undefined
        const retriable = isRetriableError(response.status, code)
        const answer = extractText(data)

        if (!response.ok) {
          attempts.push({
            provider: req.provider,
            model,
            status: "error",
            latency_ms: latency,
            error: code ?? "request_failed",
            attempt_no: attemptNo,
            http_status: response.status,
            error_code: code,
            retriable
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
            usage: data?.usage,
            error: buildError(req.provider, "request_failed", code, retriable)
          }
        }

        if (!answer) {
          attempts.push({
            provider: req.provider,
            model,
            status: "error",
            latency_ms: latency,
            error: "empty_response",
            attempt_no: attemptNo,
            http_status: response.status,
            error_code: "empty_response",
            retriable: attemptNo < maxAttempts
          })

          if (attemptNo < maxAttempts) {
            await sleep(400 * attemptNo)
            continue
          }

          return {
            provider: req.provider,
            model,
            answer: "",
            attempts,
            usage: data?.usage,
            error: buildError(req.provider, "empty_response", "empty_response", false)
          }
        }

        attempts.push({
          provider: req.provider,
          model,
          status: "success",
          latency_ms: latency,
          error: null,
          attempt_no: attemptNo,
          http_status: response.status,
          error_code: undefined,
          retriable: false
        })

        return {
          provider: req.provider,
          model,
          answer,
          usage: data?.usage,
          attempts
        }

      } catch (wrapped: any) {
        const latency = typeof wrapped?.latency === "number" ? wrapped.latency : 0
        const timedOut = wrapped?.timedOut === true
        const code = timedOut ? "timeout" : "network_error"
        const message = String(wrapped?.original?.message ?? code)

        attempts.push({
          provider: req.provider,
          model,
          status: "error",
          latency_ms: latency,
          error: message,
          attempt_no: attemptNo,
          http_status: 0,
          error_code: code,
          retriable: true
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
          error: buildError(req.provider, message, code, true)
        }
      }
    }

    return {
      provider: req.provider,
      model,
      answer: "",
      attempts,
      error: buildError(req.provider, "unexpected_fallback", "unexpected_fallback")
    }
  }
}

export async function generate(req: ModelRequest): Promise<ModelResponse> {
  return claudeAdapter.generate(req)
}

export default claudeAdapter
