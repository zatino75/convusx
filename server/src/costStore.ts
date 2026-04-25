/**
 * costStore.ts — 실시간 비용 대시보드용 in-memory entry 저장소.
 *
 * 2026-04-25 신규. creditGuard.ts (provider 별 today 누적) 와 별개:
 *   - creditGuard: 가벼운 provider 합계만, 외부 시스템(usage summary) 호환
 *   - costStore : entry 단위 (model + department + tokens + cost) — 대시보드 전용
 *
 * 진실 소스(source of truth)는 여전히 journalctl `[adapter:usage]` 로그.
 * 이 모듈은 휘발성 캐시 — 서버 재시작 시 today 통계가 초기화될 수 있으나
 * journalctl 로 복구 가능하므로 허용.
 *
 * FIFO 1000건 한도. 자정 KST 마다 7일 이상 된 entry 자동 제거.
 */

import { logger } from "./observability/logger.js"

export interface CostEntry {
  /** Unix epoch ms */
  timestamp: number
  /** API 호출 모델 ID (claude-sonnet-4-6, gemini-2.5-pro 등) */
  model: string
  /** 부서 또는 'single_agent' / 'classifier' / 'planner' / 'critic' / 'briefing' */
  department: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

const MAX_ENTRIES = 1000
const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const RETENTION_DAYS = 7

const entries: CostEntry[] = []

function kstDateString(ts: number): string {
  const kst = new Date(ts + KST_OFFSET_MS)
  const y = kst.getUTCFullYear()
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0")
  const d = String(kst.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function todayKst(): string {
  return kstDateString(Date.now())
}

/** 자정 KST 기준 N 일 전 엔트리를 삭제. 1000건 FIFO 한도도 동시 적용. */
function pruneOldEntries(): void {
  const cutoff = Date.now() - RETENTION_DAYS * ONE_DAY_MS
  let removed = 0
  while (entries.length > 0 && entries[0].timestamp < cutoff) {
    entries.shift()
    removed++
  }
  while (entries.length > MAX_ENTRIES) {
    entries.shift()
    removed++
  }
  if (removed > 0) {
    logger.info("[costStore] pruned old entries", { removed, remaining: entries.length })
  }
}

/** 다음 KST 자정까지의 ms */
function msUntilNextKstMidnight(): number {
  const now = Date.now()
  const todayKstStart = now - ((now + KST_OFFSET_MS) % ONE_DAY_MS)
  const nextMidnight = todayKstStart + ONE_DAY_MS
  return Math.max(60_000, nextMidnight - now)
}

let midnightTimer: ReturnType<typeof setTimeout> | null = null
function scheduleMidnightReset(): void {
  if (midnightTimer) clearTimeout(midnightTimer)
  midnightTimer = setTimeout(() => {
    pruneOldEntries()
    logger.info("[costStore] midnight rollover", { remaining: entries.length })
    scheduleMidnightReset()
  }, msUntilNextKstMidnight())
}
scheduleMidnightReset()

// ── 기록 ─────────────────────────────────────────────────────────
export function record(entry: Omit<CostEntry, "timestamp"> & { timestamp?: number }): void {
  const cost = Number(entry.costUsd)
  if (!Number.isFinite(cost) || cost < 0) return
  const final: CostEntry = {
    timestamp: entry.timestamp ?? Date.now(),
    model: String(entry.model || "unknown"),
    department: String(entry.department || "unknown"),
    inputTokens: Number(entry.inputTokens) || 0,
    outputTokens: Number(entry.outputTokens) || 0,
    costUsd: cost,
  }
  entries.push(final)
  if (entries.length > MAX_ENTRIES) entries.shift()
}

// ── 조회 ─────────────────────────────────────────────────────────
export function getAll(): CostEntry[] {
  return [...entries]
}

export function getToday(): CostEntry[] {
  const day = todayKst()
  return entries.filter((e) => kstDateString(e.timestamp) === day)
}

export function getTodayTotal(): number {
  return getToday().reduce((s, e) => s + e.costUsd, 0)
}

export function getLast7Days(): { date: string; total: number }[] {
  const buckets = new Map<string, number>()
  // 최근 7일 자리 미리 채워서 0 인 날도 표시
  for (let i = 6; i >= 0; i--) {
    const d = kstDateString(Date.now() - i * ONE_DAY_MS)
    buckets.set(d, 0)
  }
  for (const e of entries) {
    const d = kstDateString(e.timestamp)
    if (buckets.has(d)) buckets.set(d, (buckets.get(d) ?? 0) + e.costUsd)
  }
  return [...buckets.entries()].map(([date, total]) => ({ date, total: +total.toFixed(6) }))
}

export function getByModel(source: CostEntry[] = entries): { model: string; cost: number }[] {
  const map = new Map<string, number>()
  for (const e of source) map.set(e.model, (map.get(e.model) ?? 0) + e.costUsd)
  return [...map.entries()]
    .map(([model, cost]) => ({ model, cost: +cost.toFixed(6) }))
    .sort((a, b) => b.cost - a.cost)
}

export function getByDepartment(source: CostEntry[] = entries): { dept: string; cost: number }[] {
  const map = new Map<string, number>()
  for (const e of source) map.set(e.department, (map.get(e.department) ?? 0) + e.costUsd)
  return [...map.entries()]
    .map(([dept, cost]) => ({ dept, cost: +cost.toFixed(6) }))
    .sort((a, b) => b.cost - a.cost)
}

/** 디버그/테스트용 — 모든 엔트리 삭제. */
export function reset(): void {
  entries.length = 0
}

export function _kstDate(ts: number): string {
  return kstDateString(ts)
}
