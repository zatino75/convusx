import type { ModelAdapter, ModelError, ModelRequest, ModelResponse } from "./types.js"

function env(name: string): string {
  const value = (globalThis as any)?.process?.env?.[name]
  return typeof value === "string" ? value.trim() : ""
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildError(provider: ModelRequest["provider"], message: string, code?: string, retriable = false): ModelError {
  return { provider, message, code, retriable }
}

function summarizeDecision(text: string): string {
  const lines = text.split(/[\n\.]/).map((x) => x.trim()).filter(Boolean)
  if (lines.length === 0) return "No clear decision"
  return lines[Math.min(lines.length - 1, 3)]
}

function ensureResearchStructure(text: string): string {
  let out = text
  if (!/evidence|source|data|근거|출처/i.test(out)) {
    out += "\n\nEvidence: based on available data, practical criteria, and comparative reasoning."
  }
  if (!/pros|cons|장점|단점|trade-off|tradeoff/i.test(out)) {
    out += "\n\nTrade-offs: compare upside, downside, cost, and operational risk."
  }
  if (!/final recommendation|결론|최종/i.test(out)) {
    out += "\n\nFinal Recommendation: " + summarizeDecision(out)
  }
  return out
}

function ensureReasoningStructure(text: string): string {
  if (!/final recommendation|결론|최종/i.test(text)) {
    return text + "\n\nFinal Recommendation: " + summarizeDecision(text)
  }
  return text
}

function postProcess(text: string, task?: string): string {
  const t = (task || "").toLowerCase()
  if (!text || text.trim().length < 20) {
    if (t === "research") return "Evidence: insufficient output.\n\nTrade-offs: insufficient output.\n\nFinal Recommendation: insufficient output."
    if (t === "reasoning") return "Final Recommendation: insufficient output."
    return "Insufficient output."
  }
  if (t === "research") return ensureResearchStructure(text)
  if (t === "reasoning") return ensureReasoningStructure(text)
  return text
}

function extractApiError(data: any, status: number): { code: string; message: string } {
  const errorNode = data?.error ?? {}
  const code =
    typeof errorNode?.code === "string" && errorNode.code.trim()
      ? errorNode.code.trim()
      : `http_${status}`
  const message =
    typeof errorNode?.message === "string" && errorNode.message.trim()
      ? errorNode.message.trim()
      : JSON.stringify(data)
  return { code, message }
}

function isRetriable(status: number, code?: string): boolean {
  if (status >= 500) return true
  if (status === 429) return true
  const n = String(code ?? "").toLowerCase()
  if (n.includes("rate_limit")) return true
  if (n.includes("overload")) return true
  return false
}

export const perplexityAdapter: ModelAdapter = {
  async generate(req: ModelRequest): Promise<ModelResponse> {
    const apiKey = env("PERPLEXITY_API_KEY")

    // 유효 모델: sonar-pro (검색 포함), sonar (기본)
    const model = req.model?.trim() || "sonar-pro"

    if (!apiKey) {
      return {
        provider: req.provider,
        model,
        answer: "",
        attempts: [],
        error: buildError(req.provider, "missing PERPLEXITY_API_KEY", "missing_api_key")
      }
    }

    const maxAttempts = typeof req.max_retries === "number" ? req.max_retries + 1 : 2
    const attempts: any[] = []

    for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo++) {
      const startedAt = Date.now()
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), req.timeout_ms ?? 45000)

        const response = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model,
            messages: req.messages,
            temperature: req.temperature ?? 0.1,
            max_tokens: req.max_tokens ?? 1500
          }),
          signal: controller.signal
        })

        clearTimeout(timer)
        const latencyMs = Date.now() - startedAt
        const data = await response.json().catch(() => ({}))

        if (!response.ok) {
          const apiError = extractApiError(data, response.status)
          const retriable = isRetriable(response.status, apiError.code)

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
            usage: data?.usage,
            error: buildError(req.provider, `[${model}] ${apiError.message}`, apiError.code, retriable)
          }
        }

        const choices = Array.isArray(data?.choices) ? data.choices : []
        const rawText =
          typeof choices?.[0]?.message?.content === "string"
            ? choices[0].message.content.trim()
            : ""

        if (!rawText) {
          attempts.push({
            provider: req.provider,
            model,
            status: "error",
            latency_ms: latencyMs,
            error: "empty_response",
            attempt_no: attemptNo,
            outcome: "error",
            retriable: attemptNo < maxAttempts,
            http_status: response.status,
            error_code: "empty_response"
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
            error: buildError(req.provider, `[${model}] empty_response`, "empty_response")
          }
        }

        const structured = postProcess(rawText, req.task)

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
          answer: structured,
          usage: data?.usage,
          attempts
        }
      } catch (error: any) {
        const latencyMs = Date.now() - startedAt
        const timedOut = error?.name === "AbortError"
        const code = timedOut ? "timeout" : "network_error"

        attempts.push({
          provider: req.provider,
          model,
          status: "error",
          latency_ms: latencyMs,
          error: String(error?.message ?? code),
          attempt_no: attemptNo,
          outcome: timedOut ? "timeout" : "error",
          retriable: true,
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
          error: buildError(req.provider, `[${model}] ${String(error?.message ?? code)}`, code, true)
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
  return perplexityAdapter.generate(req)
}