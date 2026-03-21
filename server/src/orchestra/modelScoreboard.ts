import fs from "fs"
import path from "path"

export type ModelScoreNode = {
  runs: number
  success: number
  avg_latency: number
  wins: number
  success_rate: number
  win_rate: number
  total_tokens: number
  avg_tokens: number
  estimated_cost_usd: number
  avg_cost_usd: number
  avg_cost_per_1k_tokens_usd: number
  cost_efficiency: number

  recent_runs: number
  recent_success_rate: number
  recent_win_rate: number
  recent_avg_latency: number
  recent_avg_tokens: number
  recent_avg_cost_usd: number
  recent_win_streak: number
  freshness_score: number
}

export type ModelTaskBoard = {
  [model: string]: ModelScoreNode
}

export type ProviderTaskModelBoard = {
  [task: string]: ModelTaskBoard
}

export type ModelScoreboard = {
  [provider: string]: ProviderTaskModelBoard
}

const MODEL_SCORE_PATH = path.join(process.cwd(), "server", "model-scoreboard.json")
const RECENT_ALPHA = 0.35

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function round(value: number, digits = 8): number {
  return Number(Number(value ?? 0).toFixed(digits))
}

function createEmptyNode(): ModelScoreNode {
  return {
    runs: 0,
    success: 0,
    avg_latency: 0,
    wins: 0,
    success_rate: 0,
    win_rate: 0,
    total_tokens: 0,
    avg_tokens: 0,
    estimated_cost_usd: 0,
    avg_cost_usd: 0,
    avg_cost_per_1k_tokens_usd: 0,
    cost_efficiency: 0,

    recent_runs: 0,
    recent_success_rate: 0,
    recent_win_rate: 0,
    recent_avg_latency: 0,
    recent_avg_tokens: 0,
    recent_avg_cost_usd: 0,
    recent_win_streak: 0,
    freshness_score: 0
  }
}

function recalcNode(node: ModelScoreNode): ModelScoreNode {
  const runs = Math.max(0, Number(node?.runs ?? 0))
  const success = Math.max(0, Number(node?.success ?? 0))
  const wins = Math.max(0, Number(node?.wins ?? 0))
  const avgLatency = Math.max(0, Number(node?.avg_latency ?? 0))
  const totalTokens = Math.max(0, Number(node?.total_tokens ?? 0))
  const estimatedCostUsd = Math.max(0, Number(node?.estimated_cost_usd ?? 0))

  const avgTokens = runs > 0 ? totalTokens / runs : 0
  const avgCostUsd = runs > 0 ? estimatedCostUsd / runs : 0
  const avgCostPer1kTokensUsd = totalTokens > 0 ? (estimatedCostUsd / totalTokens) * 1000 : 0

  const quality = runs > 0 ? ((success / runs) * 0.5 + (wins / runs) * 0.5) : 0
  const costPenalty = avgCostPer1kTokensUsd > 0 ? Math.min(1, avgCostPer1kTokensUsd / 0.05) : 0
  const latencyPenalty = avgLatency > 0 ? Math.min(1, avgLatency / 20000) : 0
  const costEfficiency = Math.max(
    0,
    Number((quality - costPenalty * 0.35 - latencyPenalty * 0.15).toFixed(4))
  )

  const recentRuns = Math.max(0, Number(node?.recent_runs ?? 0))
  const recentSuccessRate = clamp(Number(node?.recent_success_rate ?? 0), 0, 1)
  const recentWinRate = clamp(Number(node?.recent_win_rate ?? 0), 0, 1)
  const recentAvgLatency = Math.max(0, Number(node?.recent_avg_latency ?? 0))
  const recentAvgTokens = Math.max(0, Number(node?.recent_avg_tokens ?? 0))
  const recentAvgCostUsd = Math.max(0, Number(node?.recent_avg_cost_usd ?? 0))
  const recentWinStreak = Math.max(0, Number(node?.recent_win_streak ?? 0))

  const recentLatencyScore =
    recentAvgLatency > 0
      ? clamp(1 - recentAvgLatency / 20000, 0, 1)
      : 0.7

  const freshnessScore = clamp(
    recentSuccessRate * 0.4 +
    recentWinRate * 0.3 +
    recentLatencyScore * 0.15 +
    Math.min(1, recentWinStreak / 4) * 0.15,
    0,
    1
  )

  return {
    runs,
    success,
    avg_latency: avgLatency,
    wins,
    success_rate: runs > 0 ? Number((success / runs).toFixed(4)) : 0,
    win_rate: runs > 0 ? Number((wins / runs).toFixed(4)) : 0,
    total_tokens: totalTokens,
    avg_tokens: Number(avgTokens.toFixed(2)),
    estimated_cost_usd: round(estimatedCostUsd),
    avg_cost_usd: round(avgCostUsd),
    avg_cost_per_1k_tokens_usd: round(avgCostPer1kTokensUsd),
    cost_efficiency: costEfficiency,

    recent_runs: recentRuns,
    recent_success_rate: Number(recentSuccessRate.toFixed(4)),
    recent_win_rate: Number(recentWinRate.toFixed(4)),
    recent_avg_latency: Math.round(recentAvgLatency),
    recent_avg_tokens: Number(recentAvgTokens.toFixed(2)),
    recent_avg_cost_usd: round(recentAvgCostUsd),
    recent_win_streak: recentWinStreak,
    freshness_score: Number(freshnessScore.toFixed(4))
  }
}

function normalizeProvider(value: any): string {
  return String(value ?? "").trim().toLowerCase()
}

function normalizeModel(value: any): string {
  return String(value ?? "").trim()
}

function normalizeBoard(input: any): ModelScoreboard {
  const board: ModelScoreboard = {}

  if (!input || typeof input !== "object") {
    return board
  }

  for (const provider of Object.keys(input)) {
    if (!input[provider] || typeof input[provider] !== "object") continue

    board[provider] = {}

    for (const task of Object.keys(input[provider])) {
      if (!input[provider][task] || typeof input[provider][task] !== "object") continue

      board[provider][task] = {}

      for (const model of Object.keys(input[provider][task])) {
        board[provider][task][model] = recalcNode({
          ...createEmptyNode(),
          ...(input[provider][task][model] ?? {})
        })
      }
    }
  }

  return board
}

function loadBoard(): ModelScoreboard {
  try {
    if (!fs.existsSync(MODEL_SCORE_PATH)) {
      return {}
    }

    const raw = fs.readFileSync(MODEL_SCORE_PATH, "utf-8")
    return normalizeBoard(JSON.parse(raw))
  } catch {
    return {}
  }
}

function saveBoard(board: ModelScoreboard) {
  fs.writeFileSync(MODEL_SCORE_PATH, JSON.stringify(normalizeBoard(board), null, 2), "utf-8")
}

function ensureNode(board: ModelScoreboard, provider: string, task: string, model: string): ModelScoreNode {
  if (!board[provider]) {
    board[provider] = {}
  }

  if (!board[provider][task]) {
    board[provider][task] = {}
  }

  if (!board[provider][task][model]) {
    board[provider][task][model] = createEmptyNode()
  }

  board[provider][task][model] = recalcNode(board[provider][task][model])
  return board[provider][task][model]
}

function blend(previous: number, current: number) {
  return previous <= 0 ? current : (previous * (1 - RECENT_ALPHA)) + (current * RECENT_ALPHA)
}

export function readModelScoreboard(): ModelScoreboard {
  return loadBoard()
}

export function updateModelScoreboard(payload: any): ModelScoreboard {
  const board = loadBoard()

  const task = String(payload?.task ?? "unknown").trim() || "unknown"
  const finalProvider = normalizeProvider(payload?.final_provider)
  const usageRows = Array.isArray(payload?.provider_usage) ? payload.provider_usage : []

  for (const row of usageRows) {
    const provider = normalizeProvider(row?.provider)
    const model = normalizeModel(row?.model)

    if (!provider || !model) continue

    const node = ensureNode(board, provider, task, model)

    const providerSuccess = Boolean(row?.success)
    const providerLatency = Math.max(0, Number(row?.latency_ms ?? 0))
    const providerTotalTokens = Math.max(0, Number(row?.usage?.total_tokens ?? 0))
    const providerEstimatedCost = Math.max(0, Number(row?.usage?.estimated_cost_usd ?? 0))
    const providerWon = finalProvider.length > 0 && provider === finalProvider

    node.runs += 1

    if (providerSuccess) {
      node.success += 1
    }

    if (providerLatency > 0) {
      node.avg_latency =
        node.avg_latency <= 0
          ? providerLatency
          : Math.round((node.avg_latency * 0.8) + (providerLatency * 0.2))
    }

    if (providerWon) {
      node.wins += 1
    }

    node.total_tokens += providerTotalTokens
    node.estimated_cost_usd += providerEstimatedCost

    node.recent_runs = Math.min(8, Math.max(1, node.recent_runs + 1))
    node.recent_success_rate = blend(node.recent_success_rate, providerSuccess ? 1 : 0)
    node.recent_win_rate = blend(node.recent_win_rate, providerWon ? 1 : 0)

    if (providerLatency > 0) {
      node.recent_avg_latency = blend(node.recent_avg_latency, providerLatency)
    }

    if (providerTotalTokens > 0) {
      node.recent_avg_tokens = blend(node.recent_avg_tokens, providerTotalTokens)
    }

    node.recent_avg_cost_usd = blend(node.recent_avg_cost_usd, providerEstimatedCost)

    if (providerWon) {
      node.recent_win_streak = Math.min(5, node.recent_win_streak + 1)
    } else {
      node.recent_win_streak = Math.max(0, node.recent_win_streak - 1)
    }

    board[provider][task][model] = recalcNode(node)
  }

  saveBoard(board)
  return board
}
