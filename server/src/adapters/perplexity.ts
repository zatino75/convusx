import type { ModelAdapter, ModelError, ModelRequest, ModelResponse } from "./types.js"

function env(name: string): string {
  const value = (globalThis as any)?.process?.env?.[name]
  return typeof value === "string" ? value.trim() : ""
}

function buildError(provider: ModelRequest["provider"], message: string, code?: string): ModelError {
  return { provider, message, code, retriable: false }
}

export const perplexityAdapter: ModelAdapter = {
  async generate(req: ModelRequest): Promise<ModelResponse> {
    const apiKey = env("PERPLEXITY_API_KEY")
    const model = req.model?.trim() || (req.force_pro ? "sonar-pro" : "sonar")

    if (!apiKey) {
      return {
        provider: req.provider,
        model,
        answer: "",
        attempts: [],
        error: buildError(req.provider, "missing PERPLEXITY_API_KEY", "missing_api_key")
      }
    }

    const messages = Array.isArray(req.messages) && req.messages.length > 0
      ? req.messages
      : [{ role: "user", content: String(req.raw_input?.message ?? "") }]

    try {
      const response = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: req.max_tokens ?? 2048,
          temperature: 0.2,
          return_citations: true,
          search_recency_filter: "month"
        })
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const errMsg = data?.error?.message ?? `http_${response.status}`
        return {
          provider: req.provider,
          model,
          answer: "",
          attempts: [],
          error: buildError(req.provider, errMsg, data?.error?.type ?? "api_error")
        }
      }

      const choices = Array.isArray(data?.choices) ? data.choices : []
      const rawText = typeof choices?.[0]?.message?.content === "string"
        ? choices[0].message.content.trim()
        : ""

      // citations 추가
      const citations = Array.isArray(data?.citations) ? data.citations : []
      const citationText = citations.length > 0
        ? "\n\n**출처:**\n" + citations.slice(0, 5).map((c: string, i: number) => `${i + 1}. ${c}`).join("\n")
        : ""

      return {
        provider: req.provider,
        model,
        answer: rawText + citationText,
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
