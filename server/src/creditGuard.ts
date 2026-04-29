/**
 * creditGuard.ts — 경량 일일 비용 트래커 (조회 전용).
 *
 * 2026-04-24 Session 4 Phase 2.
 * 한도/차단/경고 없음 — provider 별 오늘 누적만 in-memory 로 유지.
 * Phase 3 대시보드가 실시간 표시에 사용한다.
 *
 * 진실 소스(source of truth)는 여전히 journalctl 의 `[adapter:usage]` cost_usd
 * 구조화 로그. 이 모듈은 단순히 당일 요약을 빠르게 조회하기 위한 휘발성 캐시.
 * 서버 재시작 시 초기화되는 것은 허용 — 월간/장기 집계는 journalctl 파싱으로.
 *
 * 호출 규약 (CLAUDE.md 규칙 #16 준수):
 *   shared.ts 의 recordProviderMetric 은 그대로 유지하고,
 *   그 옆에서 recordCost() 를 병행 호출한다. 기존 ctx.model/ctx.usage 제거 금지.
 *
 * 날짜 롤오버: KST (UTC+9) 기준 자정. 조회 시점에 state.date 가 오늘과 다르면 초기화.
 */

import { logger } from "./observability/logger.js"
import { corvusxDb } from "./db/corvusxDb.js"
import { getCostGuard } from "./settingsStore.js"

export interface DailyUsage {
  /** YYYY-MM-DD (KST). 날짜가 바뀌면 롤오버된다. */
  date: string
  /** provider(lowercased) → 오늘 누적 USD */
  totals: Record<string, number>
}

export type GuardLevel = "ok" | "warn" | "limit" | "block"

export interface GuardCheckResult {
  /** ok = 통과, warn = 로그 경고만, limit = director 모드 차단, block = 모든 LLM 호출 차단 */
  level: GuardLevel
  /** 오늘 합계 (KST) */
  dailyTotal: number
  /** 이번 달 합계 (KST 기준 1일~오늘) — 정확치는 SQLite 집계 */
  monthlyTotal: number
  /** 발동된 임계값 (해당 시) */
  threshold?: number
  /** 사람이 읽을 수 있는 메시지 */
  reason?: string
}

let usage: DailyUsage = { date: todayKst(), totals: {} }

function todayKst(): string {
  const kstMs = Date.now() + 9 * 60 * 60 * 1000
  const kst = new Date(kstMs)
  const y = kst.getUTCFullYear()
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0")
  const d = String(kst.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function rollIfNewDay(): void {
  const d = todayKst()
  if (usage.date !== d) {
    logger.info("[creditGuard] daily rollover", { from: usage.date, to: d })
    usage = { date: d, totals: {} }
  }
}

/**
 * 확정된 비용을 오늘 누적에 더한다. 음수/NaN/0 은 무시.
 * provider 는 lowercase 로 정규화해서 키 중복을 막는다.
 */
export function recordCost(provider: string, costUsd: number): void {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return
  rollIfNewDay()
  const p = String(provider || "unknown").toLowerCase()
  usage.totals[p] = (usage.totals[p] ?? 0) + costUsd
}

/** 오늘 전체 누적 (date + provider 별 합계). 6자리 반올림. */
export function getDailyUsage(): DailyUsage {
  rollIfNewDay()
  return {
    date: usage.date,
    totals: Object.fromEntries(
      Object.entries(usage.totals).map(([k, v]) => [k, +v.toFixed(6)]),
    ),
  }
}

/** provider 별 오늘 사용량. 대시보드용. 한도/차단 정보는 포함하지 않는다. */
export function getStatus(): Record<string, { current: number }> {
  rollIfNewDay()
  return Object.fromEntries(
    Object.entries(usage.totals).map(([k, v]) => [k, { current: +v.toFixed(6) }]),
  )
}

/** 오늘 누적 합계 (모든 provider). 가드 평가용. */
function todayTotalUsd(): number {
  rollIfNewDay()
  let sum = 0
  for (const v of Object.values(usage.totals)) sum += v
  return +sum.toFixed(6)
}

/**
 * 이번 달 누적 합계 (KST). cost_entries 에서 1일 0시(KST) 이후 cost_usd SUM.
 * 호출 시점에 SQLite 한 번만 집계 — 비용 평가 hot path.
 */
const stmtMonthlyTotal = corvusxDb.prepare(
  `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM cost_entries WHERE timestamp >= ?`,
)
function monthlyTotalUsd(): number {
  try {
    const kstMs = Date.now() + 9 * 60 * 60 * 1000
    const kst = new Date(kstMs)
    const monthStartKst = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1, 0, 0, 0)
    const monthStartMs = monthStartKst - 9 * 60 * 60 * 1000
    const row = stmtMonthlyTotal.get(monthStartMs) as { total: number } | undefined
    return +(Number(row?.total ?? 0)).toFixed(6)
  } catch {
    return 0
  }
}

/** 마지막 경고 발화 시각 (provider:level 별) — 동일 임계값 반복 알림 방지. */
const warnEmittedAt: Record<string, number> = {}
const WARN_INTERVAL_MS = 30 * 60 * 1000  // 30분 1회

/**
 * 비용 가드 평가.
 * settingsStore.getCostGuard() 임계값 기준으로 ok/warn/limit/block 결정.
 * mode='director' 면 dailyLimit 체크 활성, mode='any' 면 dailyBlock + monthlyLimit 만 체크.
 *
 * 호출 위치 (예정):
 *   - chat.ts / directorStream.ts: mode='director' 진입 직전
 *   - adapters/shared.ts.recordProviderMetric 옆: mode='any' 사후 경고
 */
export function evaluateGuard(mode: "director" | "any" = "any"): GuardCheckResult {
  let dailyWarn = 5
  let dailyLimit = 10
  let dailyBlock = 20
  let monthlyLimit = 100
  try {
    const cfg = getCostGuard()
    dailyWarn = cfg.dailyWarn
    dailyLimit = cfg.dailyLimit
    dailyBlock = cfg.dailyBlock
    monthlyLimit = cfg.monthlyLimit
  } catch {
    // settingsStore 미로드 — defaults 사용
  }

  const daily = todayTotalUsd()
  const monthly = monthlyTotalUsd()

  if (daily >= dailyBlock) {
    return { level: "block", dailyTotal: daily, monthlyTotal: monthly, threshold: dailyBlock,
      reason: `일일 차단 임계값 도달 ($${daily.toFixed(2)} / $${dailyBlock.toFixed(2)})` }
  }
  if (monthly >= monthlyLimit) {
    return { level: "block", dailyTotal: daily, monthlyTotal: monthly, threshold: monthlyLimit,
      reason: `월간 한도 도달 ($${monthly.toFixed(2)} / $${monthlyLimit.toFixed(2)})` }
  }
  if (mode === "director" && daily >= dailyLimit) {
    return { level: "limit", dailyTotal: daily, monthlyTotal: monthly, threshold: dailyLimit,
      reason: `일일 director 한도 도달 ($${daily.toFixed(2)} / $${dailyLimit.toFixed(2)}) — single_agent 만 허용` }
  }
  if (daily >= dailyWarn) {
    const k = `daily_warn`
    const last = warnEmittedAt[k] ?? 0
    if (Date.now() - last > WARN_INTERVAL_MS) {
      logger.warn("[creditGuard] 일일 경고 임계값 도달", {
        daily: +daily.toFixed(4), warn: dailyWarn, limit: dailyLimit, block: dailyBlock,
      })
      warnEmittedAt[k] = Date.now()
    }
    return { level: "warn", dailyTotal: daily, monthlyTotal: monthly, threshold: dailyWarn,
      reason: `일일 경고 임계값 도달 ($${daily.toFixed(2)} / $${dailyWarn.toFixed(2)})` }
  }
  return { level: "ok", dailyTotal: daily, monthlyTotal: monthly }
}

/** 가드 상태 전체 (대시보드/디버그). */
export function getGuardSnapshot(): GuardCheckResult {
  return evaluateGuard("any")
}
