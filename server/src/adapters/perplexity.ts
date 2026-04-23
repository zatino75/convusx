import type { ModelAdapter, ModelAttempt, ModelError, ModelRequest, ModelResponse } from "./types.js"
import { env, sleep, now, extractProviderError, recordProviderMetric } from "./shared.js"
import { ADAPTER_TIMEOUT_MS, PERPLEXITY_BASE } from "../config/defaults.js"

function isRetriableStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408
}

function buildError(provider: ModelRequest["provider"], message: string, code?: string, retriable = false): ModelError {
  return { provider, message, code, retriable }
}

async function callPerplexity(params: {
  apiKey: string
  body: any
  timeoutMs: number
}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), params.timeoutMs)
  const start = now()

  try {
    const response = await fetch(`${PERPLEXITY_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${params.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(params.body),
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

export const perplexityAdapter: ModelAdapter = {
  async generate(req: ModelRequest): Promise<ModelResponse> {
    const apiKey = env("PERPLEXITY_API_KEY")
    const model = req.model?.trim() || (req.force_pro ? "sonar-pro" : "sonar")
    const attempts: ModelAttempt[] = []

    const timeoutMs =
      typeof (req as any).timeout_ms === "number" && (req as any).timeout_ms > 0
        ? (req as any).timeout_ms
        : ADAPTER_TIMEOUT_MS

    const maxAttempts =
      typeof req.max_retries === "number" && req.max_retries >= 1
        ? req.max_retries + 1
        : 2

    if (!apiKey) {
      return {
        provider: req.provider,
        model,
        answer: "",
        attempts,
        error: buildError(req.provider, "missing PERPLEXITY_API_KEY", "missing_api_key")
      }
    }

    const messages = Array.isArray(req.messages) && req.messages.length > 0
      ? req.messages
      : [{ role: "user", content: String(req.raw_input?.message ?? "") }]

    const body = {
      model,
      messages,
      max_tokens: req.max_tokens ?? 16384,
      temperature: 0.2,
      return_citations: true,
      search_recency_filter: "month"
    }

    for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo += 1) {
      try {
        const { response, data, latency } = await callPerplexity({ apiKey, body, timeoutMs })

        if (!response.ok) {
          const apiError = extractProviderError("perplexity", data, response.status)

          attempts.push({
            provider: req.provider,
            model,
            status: "error",
            latency_ms: latency,
            error: apiError.message,
            attempt_no: attemptNo,
            http_status: response.status,
            error_code: apiError.code,
            retriable: apiError.retriable
          })
          recordProviderMetric("perplexity", latency, false)

          if (apiError.retriable && attemptNo < maxAttempts) {
            await sleep(500 * attemptNo)
            continue
          }

          return {
            provider: req.provider,
            model,
            answer: "",
            attempts,
            usage: data?.usage,
            error: buildError(req.provider, apiError.message, apiError.code, apiError.retriable)
          }
        }

        const choices = Array.isArray(data?.choices) ? data.choices : []
        const rawText = typeof choices?.[0]?.message?.content === "string"
          ? choices[0].message.content.trim()
          : ""

        if (!rawText) {
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
          recordProviderMetric("perplexity", latency, false)

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

        // citations 추가
        const citations = Array.isArray(data?.citations) ? data.citations : []
        const citationText = citations.length > 0
          ? "\n\n**출처:**\n" + citations.slice(0, 5).map((c: string, i: number) => `${i + 1}. ${c}`).join("\n")
          : ""

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
        recordProviderMetric("perplexity", latency, true, { model, usage: data?.usage })

        return {
          provider: req.provider,
          model,
          answer: rawText + citationText,
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
        recordProviderMetric("perplexity", latency, false)

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
  return perplexityAdapter.generate(req)
}
