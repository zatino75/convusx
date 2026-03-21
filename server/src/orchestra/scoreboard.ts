import fs from "fs"

const SCORE_PATH = "server/data/scoreboard.json"

type ProviderBoardRow = {
  wins: number
  uses: number
  avg_latency: number
  avg_cost: number
  recent_uses?: number
  recent_wins?: number
  last_used_at?: number
}

function ensureDir() {
  try {
    fs.mkdirSync("server/data", { recursive: true })
  } catch {}
}

function load(): Record<string, ProviderBoardRow> {
  try {
    return JSON.parse(fs.readFileSync(SCORE_PATH, "utf-8"))
  } catch {
    return {}
  }
}

function save(data: Record<string, ProviderBoardRow>) {
  ensureDir()
  fs.writeFileSync(SCORE_PATH, JSON.stringify(data, null, 2), "utf-8")
}

function safeNumber(value: any, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function nowSec() {
  return Math.floor(Date.now() / 1000)
}

function ensureRow(data: Record<string, ProviderBoardRow>, provider: string) {
  if (!data[provider]) {
    data[provider] = {
      wins: 0,
      uses: 0,
      avg_latency: 0,
      avg_cost: 0,
      recent_uses: 0,
      recent_wins: 0,
      last_used_at: 0
    }
  }

  if (typeof data[provider].recent_uses !== "number") data[provider].recent_uses = 0
  if (typeof data[provider].recent_wins !== "number") data[provider].recent_wins = 0
  if (typeof data[provider].last_used_at !== "number") data[provider].last_used_at = 0

  return data[provider]
}

export function readScoreboard() {
  return load()
}

export function resetScoreboard() {
  save({})
  return {}
}

export function updateScoreboardFromBenchmark(record: any) {
  const data = load()

  const executedProviders = Array.isArray(record?.executed_providers)
    ? record.executed_providers
    : []

  const finalProvider = String(record?.final_provider ?? "").trim().toLowerCase()
  const latencyMs = safeNumber(record?.latency_ms)
  const estimatedCostUsd = safeNumber(record?.estimated_cost_usd)
  const currentTime = nowSec()

  for (const rawProvider of executedProviders) {
    const provider = String(rawProvider ?? "").trim().toLowerCase()
    if (!provider) continue

    const item = ensureRow(data, provider)

    const prevUses = safeNumber(item.uses)
    const nextUses = prevUses + 1

    item.uses = nextUses
    item.recent_uses = safeNumber(item.recent_uses) + 1
    item.last_used_at = currentTime

    if (finalProvider === provider) {
      item.wins = safeNumber(item.wins) + 1
      item.recent_wins = safeNumber(item.recent_wins) + 1
    }

    item.avg_latency =
      prevUses <= 0
        ? latencyMs
        : Number((((safeNumber(item.avg_latency) * prevUses) + latencyMs) / nextUses).toFixed(4))

    item.avg_cost =
      prevUses <= 0
        ? estimatedCostUsd
        : Number((((safeNumber(item.avg_cost) * prevUses) + estimatedCostUsd) / nextUses).toFixed(8))
  }

  save(data)
  return data
}

export function recordProviderExecution(providerInput: any, result: {
  success?: boolean
  latency_ms?: number
  estimated_cost_usd?: number
  selected_as_final?: boolean
}) {
  const provider = String(providerInput ?? "").trim().toLowerCase()
  if (!provider) return null

  const data = load()
  const item = ensureRow(data, provider)
  const currentTime = nowSec()

  const prevUses = safeNumber(item.uses)
  const nextUses = prevUses + 1

  item.uses = nextUses
  item.recent_uses = safeNumber(item.recent_uses) + 1
  item.last_used_at = currentTime

  if (Boolean(result?.selected_as_final)) {
    item.wins = safeNumber(item.wins) + 1
    item.recent_wins = safeNumber(item.recent_wins) + 1
  }

  const latencyMs = safeNumber(result?.latency_ms)
  const estimatedCostUsd = safeNumber(result?.estimated_cost_usd)

  item.avg_latency =
    prevUses <= 0
      ? latencyMs
      : Number((((safeNumber(item.avg_latency) * prevUses) + latencyMs) / nextUses).toFixed(4))

  item.avg_cost =
    prevUses <= 0
      ? estimatedCostUsd
      : Number((((safeNumber(item.avg_cost) * prevUses) + estimatedCostUsd) / nextUses).toFixed(8))

  save(data)
  return data[provider]
}

export function getProviderRoutingScore(provider: string) {
  const data = load()
  const normalized = String(provider ?? "").trim().toLowerCase()
  const row = ensureRow(data, normalized)

  const uses = safeNumber(row.uses)
  const wins = safeNumber(row.wins)
  const avgLatency = safeNumber(
    row.avg_latency,
    normalized === "perplexity" ? 7000 : normalized === "gemini" ? 9000 : normalized === "claude" ? 13000 : 10000
  )
  const avgCost = safeNumber(
    row.avg_cost,
    normalized === "perplexity" ? 0.012 : normalized === "gemini" ? 0.015 : normalized === "claude" ? 0.025 : 0.03
  )

  const winRate = uses > 0 ? wins / uses : 0.5
  const sampleConfidence = clamp(uses / 20, 0, 1)

  const latencyScore = clamp(1 - (avgLatency / 20000), 0, 1)
  const costScore = clamp(1 - (avgCost / 0.06), 0, 1)

  const routingScore =
    winRate * 0.55 +
    sampleConfidence * 0.15 +
    latencyScore * 0.15 +
    costScore * 0.15

  const recentUses = safeNumber(row.recent_uses)
  const recentWins = safeNumber(row.recent_wins)
  const recentWinRate = recentUses > 0 ? recentWins / recentUses : 0.5

  const explorationBonus =
    clamp((1 - clamp(recentUses / 12, 0, 1)) * 0.14, 0, 0.14) +
    clamp((0.55 - recentWinRate) * 0.08, 0, 0.08)

  const ageSeconds = Math.max(0, nowSec() - safeNumber(row.last_used_at))
  const freshnessBonus = clamp(ageSeconds / 86400, 0, 1) * 0.04

  const banditScore = routingScore + explorationBonus + freshnessBonus

  return {
    provider: normalized,
    wins,
    uses,
    recent_uses: recentUses,
    recent_wins: recentWins,
    win_rate: Number(winRate.toFixed(4)),
    recent_win_rate: Number(recentWinRate.toFixed(4)),
    avg_latency: Number(avgLatency.toFixed(4)),
    avg_cost: Number(avgCost.toFixed(8)),
    routing_score: Number(routingScore.toFixed(4)),
    exploration_bonus: Number(explorationBonus.toFixed(4)),
    freshness_bonus: Number(freshnessBonus.toFixed(4)),
    bandit_score: Number(banditScore.toFixed(4)),
    last_used_at: safeNumber(row.last_used_at)
  }
}

export function decayRecentBanditSignals() {
  const data = load()
  let changed = false

  for (const provider of Object.keys(data)) {
    const row = ensureRow(data, provider)

    const decayedRecentUses = Math.floor(safeNumber(row.recent_uses) * 0.9)
    const decayedRecentWins = Math.floor(safeNumber(row.recent_wins) * 0.9)

    if (decayedRecentUses !== safeNumber(row.recent_uses) || decayedRecentWins !== safeNumber(row.recent_wins)) {
      row.recent_uses = decayedRecentUses
      row.recent_wins = Math.min(decayedRecentWins, decayedRecentUses)
      changed = true
    }
  }

  if (changed) {
    save(data)
  }

  return data
}

export function readRoutingScores() {
  const data = load()
  const providers = Object.keys(data)

  const baseProviders = ["openai", "claude", "gemini", "perplexity"]
  const allProviders = Array.from(new Set([...baseProviders, ...providers]))

  return allProviders
    .map((provider) => getProviderRoutingScore(provider))
    .sort((a, b) => b.bandit_score - a.bandit_score)
}
