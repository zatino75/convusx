/**
 * costStore.ts — LLM 호출 단위 비용 entry 저장소 (SQLite).
 *
 * 2026-04-25 Phase 8: in-memory → SQLite 영구 저장 전환.
 * 진실 소스(source of truth) = `corvusx.db` 의 cost_entries 테이블.
 * journalctl `[adapter:usage]` 는 이중 백업으로만 유지.
 *
 * 인터페이스는 기존과 호환:
 *   record(), getAll(), getToday(), getTodayTotal(), getLast7Days(),
 *   getByModel(source?), getByDepartment(source?), reset(), _kstDate()
 *
 * 신규: provider 컬럼 추가. 미지정 시 모델 ID 로 추론(creditStore.providerFromModel).
 *
 * ⚠️ CLAUDE.md 규칙 #22 — in-memory 회귀 금지.
 */

import { corvusxDb } from "./db/corvusxDb.js"
import { providerFromModel } from "./creditStore.js"

export interface CostEntry {
  /** Unix epoch ms */
  timestamp: number
  /** API 호출 모델 ID */
  model: string
  /** provider — 'anthropic'|'openai'|'google'|'deepseek'|'perplexity'|'fal'|'unknown' */
  provider: string
  /** 부서 또는 'single_agent' / 'classifier' / 'planner' / 'critic' / 'briefing' */
  department: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000

function kstDateString(ts: number): string {
  const kst = new Date(ts + KST_OFFSET_MS)
  const y = kst.getUTCFullYear()
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0")
  const d = String(kst.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/** KST 자정(UTC 시각) 반환 — getToday/getLast7Days 의 timestamp >= 비교용 */
function startOfKstDayUtcMs(daysAgo = 0): number {
  const now = Date.now()
  const kstNow = now + KST_OFFSET_MS
  const kstMidnight = kstNow - (kstNow % ONE_DAY_MS)
  return kstMidnight - KST_OFFSET_MS - daysAgo * ONE_DAY_MS
}

// ── prepared statements (모듈 로드 시 1회) ───────────────────────
const stmtInsert = corvusxDb.prepare(`
  INSERT INTO cost_entries
    (timestamp, model, provider, department, input_tokens, output_tokens, cost_usd)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`)

const stmtAll = corvusxDb.prepare(`
  SELECT timestamp, model, provider, department, input_tokens, output_tokens, cost_usd
  FROM cost_entries
  ORDER BY timestamp ASC
`)

const stmtSinceMs = corvusxDb.prepare(`
  SELECT timestamp, model, provider, department, input_tokens, output_tokens, cost_usd
  FROM cost_entries
  WHERE timestamp >= ?
  ORDER BY timestamp ASC
`)

const stmtTotalSince = corvusxDb.prepare(`
  SELECT COALESCE(SUM(cost_usd), 0) AS total
  FROM cost_entries
  WHERE timestamp >= ?
`)

const stmtDeleteAll = corvusxDb.prepare(`DELETE FROM cost_entries`)

// ── row → CostEntry ──────────────────────────────────────────────
function rowToEntry(r: any): CostEntry {
  return {
    timestamp: Number(r.timestamp),
    model: String(r.model),
    provider: String(r.provider ?? "unknown"),
    department: String(r.department),
    inputTokens: Number(r.input_tokens ?? 0),
    outputTokens: Number(r.output_tokens ?? 0),
    costUsd: Number(r.cost_usd),
  }
}

// ── 기록 ─────────────────────────────────────────────────────────
export function record(entry: Omit<CostEntry, "timestamp" | "provider"> & {
  timestamp?: number
  provider?: string
}): void {
  const cost = Number(entry.costUsd)
  if (!Number.isFinite(cost) || cost < 0) return
  const provider = String(entry.provider ?? providerFromModel(entry.model) ?? "unknown")
  stmtInsert.run(
    entry.timestamp ?? Date.now(),
    String(entry.model || "unknown"),
    provider,
    String(entry.department || "unknown"),
    Number(entry.inputTokens) || 0,
    Number(entry.outputTokens) || 0,
    cost,
  )
}

// ── 조회 ─────────────────────────────────────────────────────────
export function getAll(): CostEntry[] {
  return (stmtAll.all() as any[]).map(rowToEntry)
}

export function getToday(): CostEntry[] {
  return (stmtSinceMs.all(startOfKstDayUtcMs(0)) as any[]).map(rowToEntry)
}

export function getTodayTotal(): number {
  const r = stmtTotalSince.get(startOfKstDayUtcMs(0)) as { total: number }
  return Number(r?.total ?? 0)
}

export function getLast7Days(): { date: string; total: number }[] {
  const since = startOfKstDayUtcMs(6)  // 6 일 전 자정 ~ 오늘 (총 7 buckets)
  const rows = stmtSinceMs.all(since) as any[]
  const buckets = new Map<string, number>()
  for (let i = 6; i >= 0; i--) {
    buckets.set(kstDateString(Date.now() - i * ONE_DAY_MS), 0)
  }
  for (const r of rows) {
    const d = kstDateString(Number(r.timestamp))
    if (buckets.has(d)) buckets.set(d, (buckets.get(d) ?? 0) + Number(r.cost_usd))
  }
  return [...buckets.entries()].map(([date, total]) => ({ date, total: +total.toFixed(6) }))
}

export function getByModel(source?: CostEntry[]): { model: string; cost: number }[] {
  const entries = source ?? getAll()
  const map = new Map<string, number>()
  for (const e of entries) map.set(e.model, (map.get(e.model) ?? 0) + e.costUsd)
  return [...map.entries()]
    .map(([model, cost]) => ({ model, cost: +cost.toFixed(6) }))
    .sort((a, b) => b.cost - a.cost)
}

export function getByDepartment(source?: CostEntry[]): { dept: string; cost: number }[] {
  const entries = source ?? getAll()
  const map = new Map<string, number>()
  for (const e of entries) map.set(e.department, (map.get(e.department) ?? 0) + e.costUsd)
  return [...map.entries()]
    .map(([dept, cost]) => ({ dept, cost: +cost.toFixed(6) }))
    .sort((a, b) => b.cost - a.cost)
}

/** 디버그/테스트용 — 모든 entry 삭제. */
export function reset(): void {
  stmtDeleteAll.run()
}

export function _kstDate(ts: number): string {
  return kstDateString(ts)
}
