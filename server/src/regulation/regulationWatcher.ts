// regulationWatcher.ts — CORVUS X Automatic Regulation Watcher (Phase 4-B)
//
// 주기적으로 REGULATION_SOURCES 를 순회하며 Perplexity sonar-pro 로
// 최근 변경 사항을 조회하고, 캐시에 upsert 한다. 변경 감지 시 로그/이벤트 발행.
// agent loop 의 legal_review / *_regulation_check 도구는 이 캐시를 우선 조회한다.

import { PERPLEXITY_BASE, ADAPTER_TIMEOUT_MS } from "../config/defaults.js"
import { logger } from "../observability/logger.js"
import {
  REGULATION_SOURCES,
  type RegulationSource,
  type RegulationCategory,
  getSourceById,
  getSourcesByCategory,
} from "./regulationSources.js"
import {
  hashContent,
  upsertSnapshot,
  getSnapshot,
  getAllSnapshots,
  type RegulationSnapshot,
} from "./regulationCache.js"

const DEFAULT_MODEL = "sonar-pro"
const DEFAULT_INTERVAL_MS = 1000 * 60 * 60 * 6 // 6시간마다 스케줄러 tick
const SYSTEM_INSTRUCTION = `당신은 한국 규제 모니터링 전문가입니다.
주어진 법규/고시/공지 사이트의 최근 변경사항만 간결히 요약하세요.
- 가장 최근 개정/신설/폐지 조항 3~5건을 bullet 로 나열
- 각 항목에 시행일 또는 공포일을 반드시 포함
- 검색결과가 불충분하면 "변경 사항 없음" 이라고만 답변
- 출처 URL 은 citations 로 자동 반영되므로 본문엔 다시 쓰지 말 것`

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

function extractCitations(data: any): string[] {
  const raw = data?.citations
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const c of raw) {
    if (typeof c === "string") out.push(c)
    else if (c && typeof c === "object" && typeof c.url === "string") out.push(c.url)
  }
  return out.slice(0, 12)
}

export type FetchResult = {
  source_id: string
  ok: boolean
  changed: boolean
  snapshot: RegulationSnapshot | null
  error?: string
}

/**
 * 단일 source 를 Perplexity 로 조회해 cache 에 upsert.
 * changed=true 면 content_hash 가 바뀐 것(변경 감지).
 */
export async function fetchOneSource(source: RegulationSource): Promise<FetchResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY
  if (!apiKey) {
    return { source_id: source.id, ok: false, changed: false, snapshot: null, error: "missing_api_key" }
  }

  const body = {
    model: DEFAULT_MODEL,
    messages: [
      { role: "system", content: SYSTEM_INSTRUCTION },
      { role: "user", content: `${source.watch_query}\n\n도메인: ${source.domain_hint}\n공식 사이트: ${source.url}` },
    ],
    max_tokens: 1200,
    temperature: 0.1,
    return_citations: true,
    search_recency_filter: "month",
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
      logger.warn("[regulationWatcher] api error", { source: source.id, status: response.status, msg: errMsg })
      const snap: RegulationSnapshot = {
        source_id: source.id,
        category: source.category,
        fetched_at: Date.now(),
        content_hash: hashContent(`error:${errMsg}`),
        last_change_at: Date.now(),
        latest_answer: "",
        citations: [],
        ok: false,
        error: errMsg,
      }
      const { changed } = upsertSnapshot(snap)
      return { source_id: source.id, ok: false, changed, snapshot: snap, error: errMsg }
    }

    const text = extractMessageText(data)
    const citations = extractCitations(data)
    const hash = hashContent(text)
    const snap: Omit<RegulationSnapshot, "last_change_at"> = {
      source_id: source.id,
      category: source.category,
      fetched_at: Date.now(),
      content_hash: hash,
      latest_answer: text,
      citations,
      ok: true,
    }
    const { changed, current } = upsertSnapshot(snap)

    const latency = Date.now() - startedAt
    logger.info("[regulationWatcher] fetched", {
      source: source.id,
      changed,
      text_len: text.length,
      citations: citations.length,
      latency_ms: latency,
    })

    return { source_id: source.id, ok: true, changed, snapshot: current }
  } catch (error: any) {
    const msg = safeString(error?.message) || "network_error"
    logger.warn("[regulationWatcher] fetch failed", { source: source.id, error: msg })
    return { source_id: source.id, ok: false, changed: false, snapshot: null, error: msg }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 강제로 카테고리 혹은 전체를 갱신.
 * legal_review / regulation_check 도구에서 cache 가 stale 할 때 호출.
 */
export async function refreshRegulations(opts: { category?: RegulationCategory; source_id?: string } = {}) {
  let targets: RegulationSource[] = []
  if (opts.source_id) {
    const s = getSourceById(opts.source_id)
    if (s) targets = [s]
  } else if (opts.category) {
    targets = getSourcesByCategory(opts.category)
  } else {
    targets = REGULATION_SOURCES
  }

  const results: FetchResult[] = []
  for (const src of targets) {
    const r = await fetchOneSource(src)
    results.push(r)
  }
  const changed = results.filter((r) => r.changed).length
  return { total: results.length, changed, results }
}

/**
 * 특정 source 의 캐시가 interval 을 넘겨 stale 한지 확인.
 */
export function isStale(source: RegulationSource): boolean {
  const snap = getSnapshot(source.id)
  if (!snap) return true
  const age = Date.now() - (snap.fetched_at ?? 0)
  const limit = Math.max(1, source.interval_days) * 24 * 60 * 60 * 1000
  return age >= limit
}

/**
 * stale 한 source 만 골라 갱신 — 정기 tick 에서 호출.
 */
export async function refreshStaleOnly() {
  const targets = REGULATION_SOURCES.filter(isStale)
  if (targets.length === 0) {
    return { total: 0, changed: 0, results: [] as FetchResult[] }
  }
  logger.info("[regulationWatcher] tick", { stale: targets.length })
  const results: FetchResult[] = []
  for (const src of targets) {
    const r = await fetchOneSource(src)
    results.push(r)
  }
  const changed = results.filter((r) => r.changed).length
  return { total: results.length, changed, results }
}

// ── 스케줄러 ──────────────────────────────────────────────────────────────
let tickTimer: ReturnType<typeof setInterval> | null = null

export function startRegulationWatcher(opts: { tick_interval_ms?: number; immediate?: boolean } = {}) {
  if (tickTimer) {
    logger.warn("[regulationWatcher] already running")
    return
  }
  const flag = safeString(process.env.CORVUS_ENABLE_REGULATION_WATCHER).toLowerCase()
  if (flag !== "1" && flag !== "true" && flag !== "yes" && flag !== "on") {
    logger.info("[regulationWatcher] disabled (set CORVUS_ENABLE_REGULATION_WATCHER=1 to enable)")
    return
  }
  const interval = Math.max(60_000, Number(opts.tick_interval_ms ?? DEFAULT_INTERVAL_MS))
  logger.info("[regulationWatcher] started", { tick_ms: interval, sources: REGULATION_SOURCES.length })

  const tick = async () => {
    try {
      const r = await refreshStaleOnly()
      if (r.changed > 0) logger.info("[regulationWatcher] changes detected", { changed: r.changed, total: r.total })
    } catch (error: any) {
      logger.warn("[regulationWatcher] tick error", { error: String(error?.message ?? error) })
    }
  }

  tickTimer = setInterval(tick, interval)
  if (opts.immediate !== false) {
    // fire-and-forget initial sync
    void tick()
  }
}

export function stopRegulationWatcher() {
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
    logger.info("[regulationWatcher] stopped")
  }
}

/** UI/설정 화면에서 캐시 상태 요약 조회 */
export function getWatcherStatus() {
  const snaps = getAllSnapshots()
  let lastFetch = 0
  let lastChange = 0
  let okCount = 0
  for (const s of snaps) {
    if (s.fetched_at > lastFetch) lastFetch = s.fetched_at
    if (s.last_change_at > lastChange) lastChange = s.last_change_at
    if (s.ok) okCount += 1
  }
  return {
    running: tickTimer !== null,
    cached_sources: snaps.length,
    total_sources: REGULATION_SOURCES.length,
    ok_count: okCount,
    last_fetch_at: lastFetch || null,
    last_change_at: lastChange || null,
  }
}
