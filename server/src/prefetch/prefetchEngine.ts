/**
 * prefetchEngine.ts — 부서별 외부 데이터 병렬 수집기.
 *
 * 2026-04-29 신규 (Session 8 — Pre-fetch 도입).
 *
 * 흐름:
 *   1. 호출자: Planner / DepartmentAgent 가 부서 결정 직후 호출.
 *   2. DEPT_PREFETCH_SOURCES[dept] 의 모든 소스를 condition 통과한 것만 병렬 실행.
 *   3. 각 소스: SQLite prefetch_cache 먼저 조회 → 캐시 미스 시 외부 호출.
 *   4. Promise.allSettled → 일부 실패해도 나머지 결과는 유지, 실패는 명시.
 *   5. 결과를 LLM 시스템 프롬프트에 주입할 수 있는 텍스트 블록으로 포맷.
 *
 * No fallback 정책: 실패한 소스는 ⚠️ 표시로 사용자/LLM 에 노출. 학습 데이터 추정 금지.
 */

import crypto from "node:crypto"
import { corvusxDb } from "../db/corvusxDb.js"
import { DEPT_PREFETCH_SOURCES, type PrefetchSourceConfig } from "./prefetchSources.js"
import { fetchMfdsNews } from "../connectors/mfdsRss.js"
import { searchNaverNews } from "../connectors/naverNews.js"
import { logger } from "../observability/logger.js"
import { PERPLEXITY_BASE } from "../config/defaults.js"

// ── 캐시 prepared statements ───────────────────────────────────────
const stmtGetCache = corvusxDb.prepare(
  `SELECT content, url FROM prefetch_cache WHERE cache_key = ? AND expires_at > ?`
)
const stmtSetCache = corvusxDb.prepare(`
  INSERT INTO prefetch_cache (cache_key, dept, source_key, content, url, fetched_at, ttl_seconds, expires_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(cache_key) DO UPDATE SET
    content    = excluded.content,
    url        = excluded.url,
    fetched_at = excluded.fetched_at,
    ttl_seconds= excluded.ttl_seconds,
    expires_at = excluded.expires_at
`)

function getCached(cacheKey: string): { content: string; url: string } | null {
  const now = Math.floor(Date.now() / 1000)
  const row = stmtGetCache.get(cacheKey, now) as { content?: string; url?: string } | undefined
  return row?.content ? { content: String(row.content), url: String(row.url ?? "") } : null
}

function setCache(cacheKey: string, dept: string, sourceKey: string, url: string, content: string, ttl: number): void {
  const now = Math.floor(Date.now() / 1000)
  stmtSetCache.run(cacheKey, dept, sourceKey, content, url, now, ttl, now + ttl)
}

// ── Perplexity 직접 호출 ────────────────────────────────────────────
async function searchPerplexity(query: string, timeoutMs: number): Promise<string> {
  const key = process.env.PERPLEXITY_API_KEY
  if (!key) throw new Error("PERPLEXITY_API_KEY 미설정")

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${PERPLEXITY_BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [{ role: "user", content: query }],
        max_tokens: 800,
        return_citations: true,
        search_recency_filter: "month",
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`Perplexity ${res.status}`)
    const json = await res.json() as any
    const text = String(json?.choices?.[0]?.message?.content ?? "")
    const cites = Array.isArray(json?.citations)
      ? json.citations.slice(0, 5).map((c: any) => typeof c === "string" ? c : c?.url).filter(Boolean)
      : []
    return cites.length > 0
      ? `${text}\n\n[citations] ${cites.join(", ")}`
      : text
  } finally {
    clearTimeout(timer)
  }
}

// ── 일반 웹페치 (HTML → 텍스트 단순 추출) ────────────────────────────
async function fetchUrl(url: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "CORVUS-X/1.0 (+prefetch)" },
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000)
  } finally {
    clearTimeout(timer)
  }
}

// ── 단일 소스 실행 ──────────────────────────────────────────────────
interface SourceResult {
  key: string
  content: string
  url: string
  cached: boolean
}

async function runSource(
  dept: string,
  sourceKey: string,
  config: PrefetchSourceConfig,
  query: string,
  userMessage: string,
): Promise<SourceResult | null> {
  if (!config.condition(query, userMessage)) return null

  const cacheKey = crypto
    .createHash("md5")
    .update(`${dept}|${sourceKey}|${query}|${userMessage.slice(0, 80)}`)
    .digest("hex")

  const cached = getCached(cacheKey)
  if (cached) {
    return { key: sourceKey, content: cached.content, url: cached.url, cached: true }
  }

  let content = ""
  const baseUrl = config.url ?? ""
  let url = baseUrl

  if (config.type === "rss") {
    // 카테고리 매핑: source key 에 cosmetic/drug 키워드 포함 여부
    const lk = sourceKey.toLowerCase()
    const category: "food" | "cosmetic" | "drug" =
      lk.includes("cosmetic") ? "cosmetic" :
      lk.includes("drug") || lk.includes("pharm") ? "drug" : "food"
    const items = await fetchMfdsNews(category, 8)
    if (items.length === 0) throw new Error("rss empty")
    content = items
      .map((i) => `[${i.pubDate || "n/a"}] ${i.title}\n  ${(i.description ?? "").slice(0, 200)}\n  ${i.link}`)
      .join("\n")
  } else if (config.type === "fetch") {
    content = await fetchUrl(baseUrl, config.timeout)
  } else if (config.type === "perplexity") {
    if (!config.query) throw new Error("perplexity source missing query()")
    const q = config.query(query)
    content = await searchPerplexity(q, config.timeout)
  } else if (config.type === "naver") {
    if (!config.query) throw new Error("naver source missing query()")
    const q = config.query(query)
    const items = await searchNaverNews(q, 8)
    if (items.length === 0) throw new Error("naver empty")
    content = items
      .map((i) => `[${i.pubDate || "n/a"}] ${i.title}\n  ${(i.description ?? "").slice(0, 200)}\n  ${i.link}`)
      .join("\n")
  } else {
    throw new Error(`unknown_type:${(config as any).type}`)
  }

  if (!content || !content.trim()) throw new Error("empty_content")
  setCache(cacheKey, dept, sourceKey, url, content, config.ttl)
  return { key: sourceKey, content, url, cached: false }
}

// ── 메인 진입점 ────────────────────────────────────────────────────
export interface PrefetchResult {
  dept: string
  /** LLM 시스템 프롬프트에 그대로 주입할 수 있는 텍스트 블록. 빈 문자열 가능. */
  context: string
  /** 실패 소스 목록 (key + 메시지). LLM 에 ⚠️ 로 노출됨. */
  failures: Array<{ source: string; reason: string }>
  /** 캐시 히트 소스 키 목록. */
  cacheHits: string[]
  /** 신선 호출 소스 키 목록. */
  freshHits: string[]
  /** 전체 소요 ms. */
  totalMs: number
}

// 2026-04-29 Session 8 보강: 컨텍스트 크기 + 소스 수 제한 (입력 토큰 폭증 방지).
//   기존: 8 소스 × 2000자 = legal 부서 +16k 토큰 → 호출당 +$0.07
//   변경: 4 소스 × 1000자 = legal 부서 +5k 토큰 (~3x 절감)
const MAX_SOURCES_PER_DEPT = 4
const MAX_CHARS_PER_SOURCE = 1000

/**
 * 부서 결정 직후 호출. query 는 Planner 가 만든 부서 task,
 * userMessage 는 사용자 원문 (FDA/EU 같은 해외 키워드 감지용).
 */
export async function runPrefetch(
  dept: string,
  query: string,
  userMessage: string,
): Promise<PrefetchResult> {
  const t0 = Date.now()
  const sources = DEPT_PREFETCH_SOURCES[dept] ?? {}

  const failures: Array<{ source: string; reason: string }> = []
  const cacheHits: string[] = []
  const freshHits: string[] = []
  const results: SourceResult[] = []

  const tasks = Object.entries(sources).map(([key, config]) =>
    runSource(dept, key, config, query, userMessage)
      .then((r) => {
        if (r) {
          results.push(r)
          if (r.cached) cacheHits.push(key); else freshHits.push(key)
        }
      })
      .catch((err) => {
        const reason = err instanceof Error ? err.message : String(err)
        failures.push({ source: key, reason })
      }),
  )

  await Promise.allSettled(tasks)

  // ── 소스 수 제한 (priority: 캐시 > fresh, 등록 순서 유지) ────────
  // 캐시 히트는 비용 0 이라 우선. 나머지는 declarative 순서 (소유자가 중요도순으로 등재).
  const sourceOrder = Object.keys(sources)
  const usableAll = results.filter((r) => r.content.trim())
  usableAll.sort((a, b) => {
    if (a.cached !== b.cached) return a.cached ? -1 : 1
    return sourceOrder.indexOf(a.key) - sourceOrder.indexOf(b.key)
  })
  const usable = usableAll.slice(0, MAX_SOURCES_PER_DEPT)
  const trimmed = usableAll.slice(MAX_SOURCES_PER_DEPT).map((r) => r.key)

  // ── LLM 컨텍스트 포맷 ─────────────────────────────────────────────
  const now = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
  let context = ""

  if (usable.length > 0) {
    const lines: string[] = []
    lines.push(`--- 실시간 데이터 (Pre-fetch ${now} KST) ---`)
    for (const r of usable) {
      const label = r.key.replace(/_/g, " ").toUpperCase()
      const tag = r.cached ? " (캐시)" : ""
      lines.push("")
      lines.push(`[${label}${tag}]`)
      if (r.url) lines.push(`출처: ${r.url}`)
      lines.push(r.content.slice(0, MAX_CHARS_PER_SOURCE))
    }
    lines.push("")
    lines.push("--- 실시간 데이터 끝 ---")
    context = lines.join("\n")
  }

  if (failures.length > 0) {
    context += `\n\n⚠️ 조회 실패 소스 (답변에 미포함, 학습 데이터로 추정 금지):\n`
    for (const f of failures) context += `- ${f.source}: ${f.reason}\n`
  }
  if (trimmed.length > 0) {
    context += `\n(컨텍스트 크기 제한으로 제외된 추가 소스: ${trimmed.join(", ")})\n`
  }

  const totalMs = Date.now() - t0
  // 2026-04-29 보강: failures / cacheHits / freshHits / trimmed 모두 소스 키 배열로 출력.
  logger.info("[prefetch] 완료", {
    dept,
    query: query.slice(0, 60),
    sourcesAttempted: Object.keys(sources).length,
    sourcesUsed: usable.length,
    sourcesTrimmed: trimmed,
    failureCount: failures.length,
    failureSources: failures.map((f) => f.source),
    failureReasons: failures.slice(0, 6).map((f) => `${f.source}:${f.reason.slice(0, 60)}`),
    cacheHits,
    freshHits,
    totalMs,
  })

  return { dept, context, failures, cacheHits, freshHits, totalMs }
}
