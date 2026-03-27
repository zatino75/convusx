import { readRoutingScores, readScoreboard, readTaskRoutingScores } from "../orchestra/scoreboard.js"

function safeNumber(value: any, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normalizeProviderRow(row: any) {
  return {
    provider: row?.provider ?? null,
    task: row?.task ?? null,

    uses: safeNumber(row?.uses),
    wins: safeNumber(row?.wins),
    task_uses: safeNumber(row?.task_uses),
    task_wins: safeNumber(row?.task_wins),

    recent_uses: safeNumber(row?.recent_uses),
    recent_wins: safeNumber(row?.recent_wins),
    task_recent_uses: safeNumber(row?.task_recent_uses),
    task_recent_wins: safeNumber(row?.task_recent_wins),

    win_rate: safeNumber(row?.win_rate),
    blended_win_rate: safeNumber(row?.blended_win_rate),
    task_win_rate: row?.task_win_rate == null ? null : safeNumber(row?.task_win_rate),
    task_blended_win_rate: row?.task_blended_win_rate == null ? null : safeNumber(row?.task_blended_win_rate),
    effective_win_rate: safeNumber(row?.effective_win_rate),

    recent_win_rate: safeNumber(row?.recent_win_rate),
    task_recent_win_rate: row?.task_recent_win_rate == null ? null : safeNumber(row?.task_recent_win_rate),

    avg_latency: safeNumber(row?.avg_latency),
    avg_cost: safeNumber(row?.avg_cost),
    task_avg_latency: row?.task_avg_latency == null ? null : safeNumber(row?.task_avg_latency),
    task_avg_cost: row?.task_avg_cost == null ? null : safeNumber(row?.task_avg_cost),

    routing_score: safeNumber(row?.routing_score),
    exploration_bonus: safeNumber(row?.exploration_bonus),
    freshness_bonus: safeNumber(row?.freshness_bonus),

    conflict_penalty_recent: safeNumber(row?.conflict_penalty_recent),
    context_conflicts_recent: safeNumber(row?.context_conflicts_recent),
    provider_conflicts_recent: safeNumber(row?.provider_conflicts_recent),
    conflict_penalty: safeNumber(row?.conflict_penalty),

    bandit_score: safeNumber(row?.bandit_score),
    routing_floor: safeNumber(row?.routing_floor),

    last_used_at: safeNumber(row?.last_used_at),
    last_conflict_at: safeNumber(row?.last_conflict_at)
  }
}

function buildProviderUsageSummary() {
  return readRoutingScores().map((row: any) => normalizeProviderRow(row))
}

function buildTaskRoutingSummary() {
  const byTask = readTaskRoutingScores()

  return Object.keys(byTask).sort().reduce((acc: Record<string, any[]>, task) => {
    acc[task] = Array.isArray(byTask?.[task])
      ? byTask[task].map((row: any) => normalizeProviderRow(row))
      : []
    return acc
  }, {})
}

export async function runUsageRoute(_req: any, res: any) {
  return res.json({
    ok: true,
    providers: buildProviderUsageSummary(),
    task_routing_scores: buildTaskRoutingSummary()
  })
}

export async function runScoreboardRoute(_req: any, res: any) {
  return res.json({
    ok: true,
    scoreboard: readScoreboard(),
    routing_scores: buildProviderUsageSummary(),
    task_routing_scores: buildTaskRoutingSummary()
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
