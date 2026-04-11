// usage.ts — CORVUS X Usage Route (Phase 4)
// NOTE (2026-04-11): orchestra/scoreboard + orchestra/adaptiveRouter 폐기.
// provider usage 통계는 tool_call_log 기반으로 전환 예정.
// 현재는 빈 데이터를 반환해 프론트 호환성 유지.

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
