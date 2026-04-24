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

export interface DailyUsage {
  /** YYYY-MM-DD (KST). 날짜가 바뀌면 롤오버된다. */
  date: string
  /** provider(lowercased) → 오늘 누적 USD */
  totals: Record<string, number>
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
