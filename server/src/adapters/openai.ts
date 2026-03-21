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

function toInput(messages: ModelRequest["messages"]): string {
  return messages.map(m => `${m.role}: ${m.content}`).join("\n")
}

function extractText(data: any): string {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim()
  }

  const outputs = Array.isArray(data?.output) ? data.output : []

  for (const item of outputs) {
    const content = Array.isArray(item?.content) ? item.content : []
    for (const part of content) {
      if (typeof part?.text === "string" && part.text.trim()) {
        return part.text.trim()
      }
    }
  }

  return ""
}

function supportsTemperature(model: string): boolean {
  const normalized = String(model ?? "").trim().toLowerCase()

  if (!normalized) return true
  if (normalized.startsWith("gpt-5")) return false

  return true
}

export const openaiAdapter: ModelAdapter = {
  async generate(req: ModelRequest): Promise<ModelResponse> {
    const apiKey = env("OPENAI_API_KEY")
    const model = req.model?.trim() || "gpt-5.3"

    if (!apiKey) {
      return {
        provider: req.provider,
        model,
        answer: "",
        attempts: [],
        error: buildError(req.provider, "missing OPENAI_API_KEY", "missing_api_key")
      }
    }

    try {
      const body: any = {
        model,
        input: toInput(req.messages),
        max_output_tokens: req.max_tokens ?? 1024
      }

      if (supportsTemperature(model)) {
        body.temperature = req.temperature ?? 0
      }

      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        return {
          provider: req.provider,
          model,
          answer: "",
          attempts: [],
          error: buildError(req.provider, JSON.stringify(data), "openai_error")
        }
      }

      const text = extractText(data)

      if (!text) {
        return {
          provider: req.provider,
          model,
          answer: "",
          attempts: [],
          usage: data?.usage,
          error: buildError(req.provider, "empty_response", "empty_response")
        }
      }

      return {
        provider: req.provider,
        model,
        answer: text,
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
  return openaiAdapter.generate(req)
}
