import { readRoutingScores, readScoreboard } from "../orchestra/scoreboard.js"

function safeNumber(value: any, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function buildProviderUsageSummary() {
  return readRoutingScores().map((row: any) => ({
    provider: row?.provider ?? null,
    uses: safeNumber(row?.uses),
    wins: safeNumber(row?.wins),
    recent_uses: safeNumber(row?.recent_uses),
    recent_wins: safeNumber(row?.recent_wins),
    win_rate: safeNumber(row?.win_rate),
    recent_win_rate: safeNumber(row?.recent_win_rate),
    avg_latency: safeNumber(row?.avg_latency),
    avg_cost: safeNumber(row?.avg_cost),
    routing_score: safeNumber(row?.routing_score),
    exploration_bonus: safeNumber(row?.exploration_bonus),
    freshness_bonus: safeNumber(row?.freshness_bonus),
    bandit_score: safeNumber(row?.bandit_score),
    last_used_at: safeNumber(row?.last_used_at)
  }))
}

export async function runUsageRoute(_req: any, res: any) {
  return res.json({
    ok: true,
    providers: buildProviderUsageSummary()
  })
}

export async function runScoreboardRoute(_req: any, res: any) {
  return res.json({
    ok: true,
    scoreboard: readScoreboard(),
    routing_scores: buildProviderUsageSummary()
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
