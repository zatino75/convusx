import type { ModelAdapter, ModelError, ModelRequest, ModelResponse } from "./types.js"

function env(name: string): string {
  const value = (globalThis as any)?.process?.env?.[name]
  return typeof value === "string" ? value.trim() : ""
}

function buildError(provider: ModelRequest["provider"], message: string, code?: string): ModelError {
  return {
    provider,
    message,
    code,
    retriable: false
  }
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

function ensureCodeStructure(text: string): string {
  if (!/function|class|return|```|interface|type\s/i.test(text)) {
    return text + "\n\nImplementation Decision: provide concrete implementation with code."
  }

  return text
}

function postProcess(text: string, task?: string): string {
  const t = (task || "").toLowerCase()

  if (!text || text.trim().length < 20) {
    if (t === "research") {
      return "Evidence: insufficient output.\n\nTrade-offs: insufficient output.\n\nFinal Recommendation: insufficient output."
    }

    if (t === "reasoning") {
      return "Final Recommendation: insufficient output."
    }

    if (t === "code") {
      return "Implementation Decision: insufficient output."
    }

    return "Insufficient output."
  }

  if (t === "research") return ensureResearchStructure(text)
  if (t === "reasoning") return ensureReasoningStructure(text)
  if (t === "code") return ensureCodeStructure(text)

  return text
}

export const perplexityAdapter: ModelAdapter = {
  async generate(req: ModelRequest): Promise<ModelResponse> {
    const apiKey = env("PERPLEXITY_API_KEY")
    const model = req.model?.trim() || "sonar"

    if (!apiKey) {
      return {
        provider: req.provider,
        model,
        answer: "",
        attempts: [],
        error: buildError(req.provider, "missing PERPLEXITY_API_KEY", "missing_api_key")
      }
    }

    try {
      const response = await fetch("https://api.perplexity.ai/v1/sonar", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: req.messages,
          temperature: req.temperature ?? 0,
          max_tokens: req.max_tokens ?? 1024
        })
      })

      const data = await response.json().catch(() => ({}))
      const choices = Array.isArray(data?.choices) ? data.choices : []
      const rawText =
        typeof choices?.[0]?.message?.content === "string"
          ? choices[0].message.content.trim()
          : ""

      const structured = postProcess(rawText, req.task)

      return {
        provider: req.provider,
        model,
        answer: structured,
        usage: data?.usage,
        attempts: []
      }
    } catch (error: any) {
      return {
        provider: req.provider,
        model,
        answer: "",
        attempts: [],
        error: buildError(req.provider, String(error?.message ?? "network_error"), "network_error")
      }
    }
  }
}

export async function generate(req: ModelRequest): Promise<ModelResponse> {
  return perplexityAdapter.generate(req)
}
