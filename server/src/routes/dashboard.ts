import fs from "fs"
import { logger } from "../observability/logger.js"
import { readRoutingScores, readScoreboard, readTaskRoutingScores, readModelScoreboard } from "../orchestra/scoreboard.js"

const BENCH_PATH = "server/data/benchmark.jsonl"

function readJsonl(path: string) {
  try {
    const raw = fs.readFileSync(path, "utf-8")
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  } catch (e) {
    logger.warn("benchmark jsonl read failed", { error: e })
    return []
  }
}

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

function buildRecentSummary(records: any[]) {
  const total = records.length

  const avgLatency =
    records.reduce((sum, row) => sum + safeNumber(row?.latency_ms), 0) / (total || 1)

  const avgCost =
    records.reduce((sum, row) => sum + safeNumber(row?.estimated_cost_usd), 0) / (total || 1)

  const fallbackCount =
    records.reduce((sum, row) => sum + (row?.fallback_used ? 1 : 0), 0)

  const avgJudgeConfidence =
    records.reduce((sum, row) => sum + safeNumber(row?.judge_confidence), 0) / (total || 1)

  const avgConflictCount =
    records.reduce((sum, row) => sum + safeNumber(row?.conflict_count), 0) / (total || 1)

  return {
    total_requests: total,
    avg_latency_ms: Number(avgLatency.toFixed(2)),
    avg_cost_usd: Number(avgCost.toFixed(8)),
    fallback_rate: Number((fallbackCount / (total || 1)).toFixed(4)),
    avg_judge_confidence: Number(avgJudgeConfidence.toFixed(4)),
    avg_conflict_count: Number(avgConflictCount.toFixed(4))
  }
}

function buildTaskSummary(records: any[]) {
  const grouped: Record<string, any[]> = {}

  for (const row of records) {
    const task = String(row?.task ?? "unknown")
    if (!grouped[task]) grouped[task] = []
    grouped[task].push(row)
  }

  return Object.keys(grouped).sort().reduce((acc: any, task) => {
    const rows = grouped[task]
    const total = rows.length

    const avgLatency =
      rows.reduce((sum, row) => sum + safeNumber(row?.latency_ms), 0) / (total || 1)

    const avgCost =
      rows.reduce((sum, row) => sum + safeNumber(row?.estimated_cost_usd), 0) / (total || 1)

    const avgJudgeConfidence =
      rows.reduce((sum, row) => sum + safeNumber(row?.judge_confidence), 0) / (total || 1)

    acc[task] = {
      total_requests: total,
      avg_latency_ms: Number(avgLatency.toFixed(2)),
      avg_cost_usd: Number(avgCost.toFixed(8)),
      avg_judge_confidence: Number(avgJudgeConfidence.toFixed(4))
    }

    return acc
  }, {})
}

function buildRecentRecords(records: any[]) {
  return records
    .slice(-20)
    .reverse()
    .map((row: any) => ({
      timestamp: row?.timestamp ?? null,
      task: row?.task ?? null,
      primary_provider: row?.primary_provider ?? null,
      final_provider: row?.final_provider ?? null,
      executed_providers: Array.isArray(row?.executed_providers) ? row.executed_providers : [],
      latency_ms: safeNumber(row?.latency_ms),
      estimated_cost_usd: safeNumber(row?.estimated_cost_usd),
      fallback_used: Boolean(row?.fallback_used),
      judge_confidence: safeNumber(row?.judge_confidence),
      conflict_count: safeNumber(row?.conflict_count)
    }))
}

function buildBanditBoard() {
  return readRoutingScores().map((row: any) => normalizeProviderRow(row))
}

function buildTaskBanditBoard() {
  const byTask = readTaskRoutingScores()

  return Object.keys(byTask).sort().reduce((acc: Record<string, any[]>, task) => {
    acc[task] = Array.isArray(byTask?.[task])
      ? byTask[task].map((row: any) => normalizeProviderRow(row))
      : []
    return acc
  }, {})
}

export async function runDashboardRoute(_req: any, res: any) {
  const records = readJsonl(BENCH_PATH)

  return res.json({
    ok: true,
    stats: buildRecentSummary(records),
    by_task: buildTaskSummary(records),
    scoreboard: readScoreboard(),
    bandit: buildBanditBoard(),
    task_bandit: buildTaskBanditBoard(),
    model_scoreboard: readModelScoreboard(),
    recent: buildRecentRecords(records)
  })
}

export const dashboardRoute = {
  path: "/api/dashboard",
  handler: runDashboardRoute
}
