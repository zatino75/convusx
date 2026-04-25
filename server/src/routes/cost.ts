/**
 * cost.ts — 실시간 비용 + 크레딧 대시보드 라우트.
 *
 * GET  /api/cost/stats             — 비용 + 크레딧 종합 (대시보드 폴링용)
 * GET  /api/cost/credits           — 프로바이더별 잔액 (수동 + API) 통합
 * POST /api/cost/credit            — 수동 충전 { provider, amount, memo? }
 * POST /api/cost/credit/refresh    — 강제 API 재조회 { provider? }  (없으면 전체)
 *
 * 모든 엔드포인트는 /api/* 전역 인증 미들웨어로 보호됨.
 */

import {
  getAll,
  getToday,
  getTodayTotal,
  getLast7Days,
  getByModel,
  getByDepartment,
} from "../costStore.js"
import {
  addCredit,
  getSummary as getGlobalCreditSummary,
  getAllProviderSummaries,
  getProviderSummary,
  PROVIDER_IDS,
  type ProviderId,
  type ProviderCreditSummary,
} from "../creditStore.js"
import {
  fetchAllBalances,
  refreshOne,
  TOPUP_URLS,
  API_SUPPORTED,
  type FetchResult,
} from "../connectors/creditFetcher.js"

const ALERT_WARNING_USD = 5
const ALERT_DANGER_USD = 10

function withPercent(rows: { cost: number }[], total: number) {
  if (total <= 0) return rows.map((r) => ({ ...r, percent: 0 }))
  return rows.map((r) => ({ ...r, percent: +((r.cost / total) * 100).toFixed(2) }))
}

function alertLevelFor(today: number): "normal" | "warning" | "danger" {
  if (today >= ALERT_DANGER_USD) return "danger"
  if (today >= ALERT_WARNING_USD) return "warning"
  return "normal"
}

function formatTime(ts: number): string {
  const d = new Date(ts + 9 * 60 * 60 * 1000)
  const hh = String(d.getUTCHours()).padStart(2, "0")
  const mm = String(d.getUTCMinutes()).padStart(2, "0")
  const ss = String(d.getUTCSeconds()).padStart(2, "0")
  return `${hh}:${mm}:${ss}`
}

// ── 합쳐진 ProviderCredit (manual + api) ──────────────────────────
export interface CombinedProviderCredit extends ProviderCreditSummary {
  apiBalance: number | null
  apiSupported: boolean
  lastApiFetch: string | null
  topupUrl: string
  /** UI 가 우선 표시할 잔액. apiBalance 가 null 아니면 그것, 아니면 manual balance. */
  displayBalance: number
}

function combine(p: ProviderId, manual: ProviderCreditSummary, fetched: FetchResult): CombinedProviderCredit {
  const displayBalance = fetched.apiBalance != null ? fetched.apiBalance : manual.balance
  return {
    ...manual,
    apiBalance: fetched.apiBalance,
    apiSupported: API_SUPPORTED[p],
    lastApiFetch: fetched.fetchedAt,
    topupUrl: TOPUP_URLS[p],
    displayBalance: +displayBalance.toFixed(6),
  }
}

async function buildAllCombined(force = false): Promise<Record<ProviderId, CombinedProviderCredit>> {
  const [manualAll, fetchedAll] = await Promise.all([
    Promise.resolve(getAllProviderSummaries(10)),
    fetchAllBalances(force),
  ])
  const out = {} as Record<ProviderId, CombinedProviderCredit>
  for (const p of PROVIDER_IDS) {
    out[p] = combine(p, manualAll[p], fetchedAll[p])
  }
  return out
}

// ── GET /api/cost/stats ───────────────────────────────────────────
export async function runCostStatsRoute(_req: any, res: any) {
  try {
    const today = getToday()
    const todayTotal = +getTodayTotal().toFixed(6)

    const todayByModel = withPercent(getByModel(today), todayTotal).map((r: any) => ({
      model: r.model, cost: r.cost, percent: r.percent,
    }))
    const todayByDept = withPercent(getByDepartment(today), todayTotal).map((r: any) => ({
      dept: r.dept, cost: r.cost, percent: r.percent,
    }))

    const all = getAll()
    const recentCalls = all.slice(-10).reverse().map((e) => ({
      time: formatTime(e.timestamp),
      model: e.model,
      dept: e.department,
      cost: +e.costUsd.toFixed(6),
    }))

    // 크레딧: 캐시 hit 기반 (force=false). 빠른 응답 우선.
    const providers = await buildAllCombined(false)

    res.json({
      ok: true,
      date: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10),
      todayTotal,
      todayByModel,
      todayByDept,
      last7Days: getLast7Days(),
      recentCalls,
      alertLevel: alertLevelFor(todayTotal),
      thresholds: { warning: ALERT_WARNING_USD, danger: ALERT_DANGER_USD },
      // 후방 호환 — 전체 합산.
      credit: getGlobalCreditSummary(10),
      // 신규 — 프로바이더별 (UI 6 카드).
      providers,
    })
  } catch (err: any) {
    res.status?.(500)
    res.json({ ok: false, error: String(err?.message ?? err) })
  }
}

export const costStatsRoute = {
  path: "/api/cost/stats",
  handler: runCostStatsRoute,
}

// ── GET /api/cost/credits ─────────────────────────────────────────
/** 프로바이더별 잔액만 반환 (대시보드 부분 갱신용). */
export async function runCostCreditsRoute(req: any, res: any) {
  try {
    const url = String(req?.url ?? "")
    const force = /[?&]refresh=1\b/.test(url)
    const providers = await buildAllCombined(force)
    res.json({ ok: true, providers })
  } catch (err: any) {
    res.status?.(500)
    res.json({ ok: false, error: String(err?.message ?? err) })
  }
}

export const costCreditsRoute = {
  path: "/api/cost/credits",
  handler: runCostCreditsRoute,
}

// ── POST /api/cost/credit ─────────────────────────────────────────
export async function runCostCreditRoute(req: any, res: any) {
  try {
    const body = (req?.body ?? {}) as Record<string, unknown>
    const providerRaw = body.provider
    const amountRaw = body.amount
    const memoRaw = body.memo

    const provider = String(providerRaw ?? "").toLowerCase().trim()
    if (!provider) {
      res.status?.(400)
      return res.json({ ok: false, error: "provider required" })
    }

    const amount = Number(typeof amountRaw === "string" ? amountRaw.replace(/,/g, "") : amountRaw)
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status?.(400)
      return res.json({ ok: false, error: "amount must be a positive number" })
    }
    const memo = typeof memoRaw === "string" ? memoRaw.slice(0, 200) : undefined

    const entry = addCredit(provider, amount, memo)
    return res.json({
      ok: true,
      entry,
      summary: getProviderSummary(provider, 10),
    })
  } catch (err: any) {
    res.status?.(500)
    res.json({ ok: false, error: String(err?.message ?? err) })
  }
}

export const costCreditRoute = {
  path: "/api/cost/credit",
  handler: runCostCreditRoute,
}

// ── POST /api/cost/credit/refresh ─────────────────────────────────
export async function runCostCreditRefreshRoute(req: any, res: any) {
  try {
    const body = (req?.body ?? {}) as Record<string, unknown>
    const providerRaw = body.provider
    if (providerRaw) {
      const result = await refreshOne(String(providerRaw))
      return res.json({ ok: true, result })
    }
    const providers = await buildAllCombined(true)
    return res.json({ ok: true, providers })
  } catch (err: any) {
    res.status?.(500)
    res.json({ ok: false, error: String(err?.message ?? err) })
  }
}

export const costCreditRefreshRoute = {
  path: "/api/cost/credit/refresh",
  handler: runCostCreditRefreshRoute,
}
