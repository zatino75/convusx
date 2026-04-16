// _domainHelper.ts — Phase 4 domain tools shared search helper
//
// 각 도메인 도구는 Perplexity sonar-pro 를 호출해 실시간 데이터를 수집한 뒤
// 도메인 컨텍스트(용어·법규·시장 구조)를 system instruction 으로 주입한다.
// 개별 도메인 도구는 이 헬퍼를 import 해서 아주 얇은 레이어로만 작동한다.

import type { ToolResult } from "../../toolRegistry.js"
import { PERPLEXITY_BASE, ADAPTER_TIMEOUT_MS } from "../../../config/defaults.js"
import { logger } from "../../../observability/logger.js"
import { getSnapshotsByCategory } from "../../../regulation/regulationCache.js"
import type { RegulationCategory } from "../../../regulation/regulationSources.js"

const DEFAULT_MODEL = "sonar-pro"

export type DomainSearchInput = {
  query: string
  system_instruction: string
  recency?: "day" | "week" | "month" | "year"
  max_tokens?: number
  tool_name: string
  /**
   * 존재하면 해당 카테고리의 regulationCache 스냅샷을 system 메시지 뒤에 주입.
   * legal_review / *_regulation_check 도구에서만 사용.
   */
  inject_regulation_cache?: RegulationCategory
}

/** 캐시에서 해당 카테고리 최신 스냅샷을 system 메시지에 붙일 수 있는 텍스트 블록으로 변환 */
function buildRegulationCacheBlock(category: RegulationCategory): string {
  const snaps = getSnapshotsByCategory(category)
  if (snaps.length === 0) return ""
  const lines: string[] = [
    `[자동 법규 갱신 캐시 — ${category}]`,
    `마지막 갱신 시각은 RFC3339 기준이며, 아래 요약은 regulationWatcher 가 주기적으로 수집한 최신 변경사항이다. 아래 내용을 무조건 신뢰하지 말고 사용자 질문에 직접 관련된 조항만 참고하라.`,
  ]
  for (const s of snaps.slice(0, 8)) {
    const fetchedIso = s.fetched_at ? new Date(s.fetched_at).toISOString() : "unknown"
    const changeIso = s.last_change_at ? new Date(s.last_change_at).toISOString() : "unknown"
    const answer = (s.latest_answer || "(내용 없음)").slice(0, 800)
    const cites = (s.citations || []).slice(0, 3).join(", ")
    lines.push(`- ${s.source_id} (fetched=${fetchedIso}, last_change=${changeIso})`)
    lines.push(`  ${answer.replace(/\n/g, " ").trim()}`)
    if (cites) lines.push(`  refs: ${cites}`)
  }
  return lines.join("\n")
}

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
  const raw = data?.citations
  if (!Array.isArray(raw)) return []
  return raw
    .map((c: any): { title?: string; url: string } | null => {
      if (typeof c === "string") return { url: c }
      if (c && typeof c === "object" && typeof c.url === "string") {
        return { title: safeString(c.title) || undefined, url: c.url }
      }
      return null
    })
    .filter((v): v is { title?: string; url: string } => v !== null)
    .slice(0, 12)
}

export async function runDomainSearch(input: DomainSearchInput): Promise<ToolResult> {
  const query = safeString(input.query)
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

  const recency = input.recency ?? "month"
  const maxTokensRaw = Number(input.max_tokens ?? 1600)
  const maxTokens = Math.max(512, Math.min(4000, Number.isFinite(maxTokensRaw) ? maxTokensRaw : 1600))

  let systemContent = input.system_instruction
  if (input.inject_regulation_cache) {
    const block = buildRegulationCacheBlock(input.inject_regulation_cache)
    if (block) systemContent = systemContent + "\n\n" + block
  }

  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: systemContent },
    { role: "user", content: query },
  ]

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
  const startedAt = Date.now()

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
      logger.warn(`[${input.tool_name}] api error`, { status: response.status, message: errMsg })
      return {
        ok: false,
        output_text: JSON.stringify({ ok: false, error: errMsg, http_status: response.status }),
        error: errMsg,
      }
    }

    const text = extractMessageText(data)
    const citations = extractCitations(data)
    const latency_ms = Date.now() - startedAt

    return {
      ok: true,
      output_text: JSON.stringify({
        ok: true,
        tool: input.tool_name,
        query,
        recency,
        latency_ms,
        answer: text,
        citations,
      }),
      summary: `${input.tool_name} "${query.slice(0, 50)}" \u2192 ${text.length}ch / ${citations.length} refs`,
    }
  } catch (error: any) {
    const timedOut =
      error?.name === "AbortError" ||
      safeString(error?.message).toLowerCase().includes("aborted")
    const msg = timedOut ? "timeout" : safeString(error?.message) || "network_error"
    logger.warn(`[${input.tool_name}] fetch failed`, { error: msg })
    return {
      ok: false,
      output_text: JSON.stringify({ ok: false, error: msg }),
      error: msg,
    }
  } finally {
    clearTimeout(timer)
  }
}
