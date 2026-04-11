// perplexitySearch.ts — Perplexity sonar-pro 실시간 웹 검색 도구
//
// adapter 를 거치지 않고 에이전트 루프에서 직접 호출하는 단일 도구 버전.
// 시민정보·최신 뉴스·법규·경쟁사·가격 등 모델 내부 지식으로 답할 수 없는 쿼리에 사용.

import { registerTool, type ToolResult } from "../toolRegistry.js"
import { PERPLEXITY_BASE, ADAPTER_TIMEOUT_MS } from "../../config/defaults.js"
import { logger } from "../../observability/logger.js"

const DEFAULT_MODEL = "sonar-pro"
const DEFAULT_MAX_TOKENS = 1200
const DEFAULT_RECENCY = "month"

function safeString(value: any): string {
  return String(value ?? "").trim()
}

function extractMessageText(data: any): string {
  const choice = Array.isArray(data?.choices) ? data.choices[0] : null
  const msg = choice?.message
  if (!msg) return ""
  const content = msg.content
  if (typeof content === "string") return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((p: any) => (typeof p?.text === "string" ? p.text : typeof p === "string" ? p : ""))
      .filter(Boolean)
      .join("\n")
      .trim()
  }
  return ""
}

function extractCitations(data: any): Array<{ title?: string; url: string }> {
  const rawCitations = data?.citations
  if (Array.isArray(rawCitations)) {
    return rawCitations
      .map((c: any): { title?: string; url: string } | null => {
        if (typeof c === "string") return { url: c }
        if (c && typeof c === "object" && typeof c.url === "string") {
          return { title: safeString(c.title) || undefined, url: c.url }
        }
        return null
      })
      .filter((v): v is { title?: string; url: string } => v !== null)
      .slice(0, 10)
  }
  return []
}

registerTool({
  name: "perplexity_search",
  description:
    "Perplexity sonar-pro 를 호출해 인터넷 실시간 검색 + 요약을 수행한다. 최신 뉴스, 시세, 법규 개정, " +
    "경쟁사 동향, 규제 공고, 논문 요약, 기업 정보, 인물 사실 확인 등 모델 내부 지식으로 답할 수 없는 " +
    "쿼리에 사용한다. 단, 사용자의 일상 대화나 개인 파일 해석 같은 비검색 질의에는 호출하지 말 것. " +
    "한국 관련 정보는 한국어로 질의하고, 전세계 정보는 영어로 질의하면 정확도가 높다. " +
    "recency 는 'day'|'week'|'month'|'year' 중 선택 (기본 month).",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "검색 질의문 (구체적이고 키워드가 명확할수록 좋다)",
      },
      recency: {
        type: "string",
        enum: ["day", "week", "month", "year"],
        description: "검색 최신성 필터 (기본 month)",
      },
      system_instruction: {
        type: "string",
        description: "(선택) 답변 형식 지시 — 예: 'bullet 5개로 요약', '수치·출처 포함' 등",
      },
      max_tokens: {
        type: "number",
        description: "응답 상한 (기본 1200, 최대 4000)",
      },
    },
    required: ["query"],
  },
  cost_tier: "paid",
  async handler(input): Promise<ToolResult> {
    const query = safeString(input?.query)
    if (!query) {
      return {
        ok: false,
        output_text: JSON.stringify({ ok: false, error: "query is required" }),
        error: "missing_query",
      }
    }

    const apiKey = process.env.PERPLEXITY_API_KEY
    if (!apiKey) {
      return {
        ok: false,
        output_text: JSON.stringify({ ok: false, error: "PERPLEXITY_API_KEY is not configured" }),
        error: "missing_api_key",
      }
    }

    const recency = (safeString(input?.recency) as "day" | "week" | "month" | "year") || DEFAULT_RECENCY
    const maxTokensRaw = Number(input?.max_tokens ?? DEFAULT_MAX_TOKENS)
    const maxTokens = Math.max(256, Math.min(4000, Number.isFinite(maxTokensRaw) ? maxTokensRaw : DEFAULT_MAX_TOKENS))
    const sysInstr = safeString(input?.system_instruction)

    const messages: Array<{ role: "system" | "user"; content: string }> = []
    if (sysInstr) messages.push({ role: "system", content: sysInstr })
    messages.push({ role: "user", content: query })

    const body = {
      model: DEFAULT_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: 0.2,
      return_citations: true,
      search_recency_filter: recency,
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ADAPTER_TIMEOUT_MS)

    try {
      const response = await fetch(`${PERPLEXITY_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      const data: any = await response.json().catch(() => ({}))

      if (!response.ok) {
        const errMsg = safeString(data?.error?.message) || `http_${response.status}`
        logger.warn("[perplexity_search] api error", { status: response.status, message: errMsg })
        return {
          ok: false,
          output_text: JSON.stringify({ ok: false, error: errMsg, http_status: response.status }),
          error: errMsg,
        }
      }

      const text = extractMessageText(data)
      const citations = extractCitations(data)
      const usage = data?.usage ?? null

      return {
        ok: true,
        output_text: JSON.stringify({
          ok: true,
          query,
          recency,
          answer: text,
          citations,
          usage,
        }),
        summary: `perplexity_search "${query.slice(0, 60)}" → ${text.length} chars / ${citations.length} citations`,
      }
    } catch (error: any) {
      const timedOut =
        error?.name === "AbortError" ||
        safeString(error?.message).toLowerCase().includes("aborted")
      const msg = timedOut ? "timeout" : safeString(error?.message) || "network_error"
      logger.warn("[perplexity_search] fetch failed", { error: msg })
      return {
        ok: false,
        output_text: JSON.stringify({ ok: false, error: msg }),
        error: msg,
      }
    } finally {
      clearTimeout(timer)
    }
  },
})
