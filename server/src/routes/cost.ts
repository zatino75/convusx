/**
 * cost.ts — 실시간 비용 대시보드 라우트.
 *
 * GET /api/cost/stats
 *   {
 *     date,
 *     todayTotal,
 *     todayByModel:  [{ model, cost, percent }],
 *     todayByDept:   [{ dept,  cost, percent }],
 *     last7Days:     [{ date,  total }],
 *     recentCalls:   [{ time, model, dept, cost }],   // 최근 10건 (오늘 외 포함)
 *     alertLevel:    'normal' | 'warning' | 'danger', // $5 / $10 임계
 *     thresholds:    { warning: 5, danger: 10 }
 *   }
 *
 * /api/* 전역 인증 미들웨어로 보호됨 (index.ts).
 */

import {
  getAll,
  getToday,
  getTodayTotal,
  getLast7Days,
  getByModel,
  getByDepartment,
} from "../costStore.js"

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

export async function runCostStatsRoute(_req: any, res: any) {
  try {
    const today = getToday()
    const todayTotal = +getTodayTotal().toFixed(6)

    const todayByModel = withPercent(getByModel(today), todayTotal).map((r: any) => ({
      model: r.model,
      cost: r.cost,
      percent: r.percent,
    }))
    const todayByDept = withPercent(getByDepartment(today), todayTotal).map((r: any) => ({
      dept: r.dept,
      cost: r.cost,
      percent: r.percent,
    }))

    const all = getAll()
    const recentCalls = all
      .slice(-10)
      .reverse()
      .map((e) => ({
        time: formatTime(e.timestamp),
        model: e.model,
        dept: e.department,
        cost: +e.costUsd.toFixed(6),
      }))

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
