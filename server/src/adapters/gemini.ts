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
      : 20000

  // 자체 timeout controller
  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs)

  // 외부 abort_signal (클라이언트 ESC) 연결
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
      `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent?key=${params.apiKey}`,
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

    // 외부 signal에 의한 abort인지 구분
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

export const geminiAdapter: ModelAdapter = {
  async generate(req: ModelRequest): Promise<ModelResponse> {
    const apiKey = env("GEMINI_API_KEY")
    const model = req.model?.trim() || (req.force_pro ? "gemini-3.1-pro-preview" : "gemini-3-flash-preview")
    const attempts: ModelAttempt[] = []
    const { system, conversation } = splitSystemAndMessages(req.messages)

    // abort_signal: adapterDispatcher에서 전달된 클라이언트 중단 신호
    const externalSignal: AbortSignal | null = (req as any).abort_signal ?? null

    if (!apiKey) {
      return {
        provider: req.provider,
        model,
        answer: "",
        attempts,
        error: buildError(req.provider, "missing GEMINI_API_KEY", "missing_api_key")
      }
    }

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
        maxOutputTokens: req.max_tokens ?? 2048
      }
    }

    const maxAttempts =
      typeof req.max_retries === "number" && req.max_retries >= 1
        ? req.max_retries + 1
        : 2

    for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo += 1) {
      // 루프 진입 전 abort 체크
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

        // 클라이언트 ESC에 의한 abort → 즉시 반환, 재시도 없음
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
    const timer = setTimeout(() => controller.abort(), 60000)

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
      // Imagen 4 Vertex AI 실패 → Imagen 3 fallback (AI Studio endpoint)
      return await generateImageImagen3Fallback(params.prompt, apiKey)
    }

    const prediction = data?.predictions?.[0]
    const base64 = prediction?.bytesBase64Encoded
    const mimeType = prediction?.mimeType ?? "image/jpeg"

    if (!base64) {
      return await generateImageImagen3Fallback(params.prompt, apiKey)
    }

    // base64 → data URL
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
  // Gemini 2.0 Flash 이미지 생성 모드 fallback
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60000)

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] }
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${apiKey}`,
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
