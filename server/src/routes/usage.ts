import { readRoutingScores, readScoreboard, readTaskRoutingScores } from "../orchestra/scoreboard.js"
import { resolveAdaptiveRoute } from "../orchestra/adaptiveRouter.js"
import { readModelScoreboard } from "../orchestra/modelScoreboard.js"

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

// Provider별 누적 토큰/비용 집계 (모든 task 합산)
function buildAccumulatedModelStats() {
  const board = readModelScoreboard()
  const result: Record<string, { total_tokens: number; estimated_cost_usd: number; runs: number; wins: number }> = {}

  for (const [provider, taskMap] of Object.entries(board)) {
    let totalTokens = 0
    let totalCost = 0
    let totalRuns = 0
    let totalWins = 0

    for (const [, modelMap] of Object.entries(taskMap as Record<string, any>)) {
      for (const [, node] of Object.entries(modelMap as Record<string, any>)) {
        const n = node as any
        totalTokens += Number(n?.total_tokens ?? 0)
        totalCost += Number(n?.estimated_cost_usd ?? 0)
        totalRuns += Number(n?.runs ?? 0)
        totalWins += Number(n?.wins ?? 0)
      }
    }

    result[provider] = {
      total_tokens: totalTokens,
      estimated_cost_usd: totalCost,
      runs: totalRuns,
      wins: totalWins
    }
  }

  return result
}

// Dynamic chooseRoles 결과를 태스크별로 계산 → 현재 실제 배정 상태 반환
const ROUTE_TASKS = ["dialogue", "reasoning", "research", "code", "writing", "long_doc"] as const

function buildCurrentRoles(): Record<string, {
  primary: string | null
  verifier: string | null
  optional: string | null
  dynamic_scores: Record<string, { score: number; breakdown: Record<string, number> }>
  router_policy: string
}> {
  return ROUTE_TASKS.reduce<Record<string, {
    primary: string | null
    verifier: string | null
    optional: string | null
    dynamic_scores: Record<string, { score: number; breakdown: Record<string, number> }>
    router_policy: string
  }>>((acc, task) => {
    try {
      const route = resolveAdaptiveRoute({ task })
      acc[task] = {
        primary: route.selected_providers[0] ?? null,
        verifier: route.verifier_providers[0] ?? null,
        optional: route.optional_providers[0] ?? null,
        dynamic_scores: route.dynamic_scores ?? {},
        router_policy: route.router_policy ?? ""
      }
    } catch {
      acc[task] = { primary: null, verifier: null, optional: null, dynamic_scores: {}, router_policy: "" }
    }
    return acc
  }, {})
}

export async function runUsageRoute(_req: any, res: any) {
  return res.json({
    ok: true,
    providers: buildProviderUsageSummary(),
    task_routing_scores: buildTaskRoutingSummary(),
    accumulated: buildAccumulatedModelStats()
  })
}

export async function runScoreboardRoute(_req: any, res: any) {
  return res.json({
    ok: true,
    scoreboard: readScoreboard(),
    routing_scores: buildProviderUsageSummary(),
    task_routing_scores: buildTaskRoutingSummary(),
    current_roles: buildCurrentRoles(),
    accumulated: buildAccumulatedModelStats()
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
