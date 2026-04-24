// usage.ts — CORVUS X Usage Route (Phase 4)
// NOTE (2026-04-11): orchestra/scoreboard + orchestra/adaptiveRouter 폐기.
// provider usage 통계는 tool_call_log 기반으로 전환 예정.
// 현재는 빈 데이터를 반환해 프론트 호환성 유지.

import { getDailyUsage } from "../creditGuard.js"
import { execFileSync } from "node:child_process"

export async function runUsageRoute(_req: any, res: any) {
  return res.json({
    ok: true,
    providers: [],
    task_routing_scores: {},
    accumulated: {}
  })
}

export async function runScoreboardRoute(_req: any, res: any) {
  return res.json({
    ok: true,
    scoreboard: [],
    routing_scores: [],
    task_routing_scores: {},
    current_roles: {},
    accumulated: {}
  })
}

export const usageRoute = {
  path: "/api/usage",
  handler: runUsageRoute
}

export const scoreboardRoute = {
  path: "/api/scoreboard",
  handler: runScoreboardRoute
}

export async function runUsageResetRoute(_req: any, res: any) {
  // scoreboard 폐기 — 리셋 대상 없음. 성공 응답만 반환.
  const body = _req?.body ?? {}
  const provider = String(body?.provider ?? "").toLowerCase().trim()
  if (!provider) return res.json({ ok: false, error: "provider required" })
  res.json({ ok: true, provider, note: "scoreboard_deprecated" })
}

export const usageResetRoute = {
  path: "/api/usage/reset",
  handler: runUsageResetRoute
}

// ─── /api/usage/summary (Phase 3 2026-04-24) ───────────────────────────────
// 오늘: creditGuard in-memory 트래커. 이번 달: journalctl [adapter:usage] 파싱.
// 한도/차단 표시 없음 (Phase 2 축소 스펙) — 순수 금액 표시용.

function firstDayOfMonthKst(): string {
  const kstMs = Date.now() + 9 * 60 * 60 * 1000
  const kst = new Date(kstMs)
  const y = kst.getUTCFullYear()
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0")
  return `${y}-${m}-01`
}

function parseMonthlyFromJournalctl(): Record<string, number> {
  const since = firstDayOfMonthKst()
  try {
    // structured JSON logger 가 `[adapter:usage]` msg 를 남긴다 → JSON 파싱으로 집계.
    const raw = execFileSync(
      "journalctl",
      ["-u", "corvusx-backend", "--since", since, "--no-pager", "-o", "cat"],
      { encoding: "utf8", timeout: 8000, maxBuffer: 64 * 1024 * 1024 },
    )
    const totals: Record<string, number> = {}
    for (const rawLine of raw.split("\n")) {
      const line = rawLine.trim()
      if (!line || line[0] !== "{") continue
      if (line.indexOf('"[adapter:usage]"') < 0) continue
      try {
        const obj = JSON.parse(line)
        const provider = typeof obj.provider === "string" ? obj.provider.toLowerCase() : null
        const cost = Number(obj.cost_usd)
        if (!provider || !Number.isFinite(cost) || cost <= 0) continue
        totals[provider] = (totals[provider] ?? 0) + cost
      } catch {
        /* skip malformed line */
      }
    }
    return totals
  } catch {
    // journalctl 미사용 환경 (로컬 dev, Windows 등) 또는 타임아웃 → 빈 객체
    return {}
  }
}

export async function runUsageSummaryRoute(_req: any, res: any) {
  try {
    const daily = getDailyUsage()
    const monthlyRaw = parseMonthlyFromJournalctl()
    const round = (n: number) => +n.toFixed(6)
    const monthly = Object.fromEntries(
      Object.entries(monthlyRaw).map(([k, v]) => [k, round(v)]),
    )
    const totalToday = Object.values(daily.totals).reduce((a, b) => a + b, 0)
    const totalMonthly = Object.values(monthlyRaw).reduce((a, b) => a + b, 0)
    res.json({
      ok: true,
      date: daily.date,
      today: daily.totals,
      monthly,
      total_today: round(totalToday),
      total_monthly: round(totalMonthly),
    })
  } catch (err: any) {
    res.status?.(500)
    res.json({ ok: false, error: String(err?.message ?? err) })
  }
}

export const usageSummaryRoute = {
  path: "/api/usage/summary",
  handler: runUsageSummaryRoute,
}
