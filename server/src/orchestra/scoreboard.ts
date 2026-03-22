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

type ProviderDefaults = {
  prior_win_rate: number
  routing_floor: number
  avg_latency: number
  avg_cost: number
}

const PROVIDER_DEFAULTS: Record<string, ProviderDefaults> = {
  openai: {
    prior_win_rate: 0.62,
    routing_floor: 0.38,
    avg_latency: 14000,
    avg_cost: 0.028
  },
  claude: {
    prior_win_rate: 0.6,
    routing_floor: 0.36,
    avg_latency: 13000,
    avg_cost: 0.022
  },
  gemini: {
    prior_win_rate: 0.53,
    routing_floor: 0.28,
    avg_latency: 9000,
    avg_cost: 0.012
  },
  perplexity: {
    prior_win_rate: 0.56,
    routing_floor: 0.3,
    avg_latency: 7000,
    avg_cost: 0.01
  }
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

function normalizeProvider(provider: any) {
  return String(provider ?? "").trim().toLowerCase()
}

function getDefaults(providerInput: any): ProviderDefaults {
  const provider = normalizeProvider(providerInput)
  return PROVIDER_DEFAULTS[provider] ?? {
    prior_win_rate: 0.55,
    routing_floor: 0.3,
    avg_latency: 12000,
    avg_cost: 0.02
  }
}

function ensureRow(data: Record<string, ProviderBoardRow>, providerInput: string) {
  const provider = normalizeProvider(providerInput)
  const defaults = getDefaults(provider)

  if (!data[provider]) {
    data[provider] = {
      wins: 0,
      uses: 0,
      avg_latency: defaults.avg_latency,
      avg_cost: defaults.avg_cost,
      recent_uses: 0,
      recent_wins: 0,
      last_used_at: 0
    }
  }

  if (typeof data[provider].recent_uses !== "number") data[provider].recent_uses = 0
  if (typeof data[provider].recent_wins !== "number") data[provider].recent_wins = 0
  if (typeof data[provider].last_used_at !== "number") data[provider].last_used_at = 0
  if (typeof data[provider].avg_latency !== "number" || !Number.isFinite(data[provider].avg_latency)) {
    data[provider].avg_latency = defaults.avg_latency
  }
  if (typeof data[provider].avg_cost !== "number" || !Number.isFinite(data[provider].avg_cost)) {
    data[provider].avg_cost = defaults.avg_cost
  }

  return data[provider]
}

function applyWeightedUpdate(params: {
  row: ProviderBoardRow
  provider: string
  latency_ms?: number
  estimated_cost_usd?: number
  selected_as_final?: boolean
  weight?: number
  effective?: boolean
}) {
  const defaults = getDefaults(params.provider)
  const weight = clamp(safeNumber(params.weight, 1), 0, 1)
  const effective = params.effective !== false

  if (weight <= 0) {
    return
  }

  const prevUses = safeNumber(params.row.uses)
  const nextUses = Number((prevUses + weight).toFixed(4))

  params.row.uses = nextUses
  params.row.recent_uses = Number((safeNumber(params.row.recent_uses) + weight).toFixed(4))
  params.row.last_used_at = nowSec()

  if (Boolean(params.selected_as_final)) {
    params.row.wins = Number((safeNumber(params.row.wins) + weight).toFixed(4))
    params.row.recent_wins = Number((safeNumber(params.row.recent_wins) + weight).toFixed(4))
  }

  if (!effective) {
    return
  }

  const normalizedLatency = safeNumber(params.latency_ms, defaults.avg_latency) > 0
    ? safeNumber(params.latency_ms, defaults.avg_latency)
    : defaults.avg_latency

  const normalizedCost = safeNumber(params.estimated_cost_usd, defaults.avg_cost) > 0
    ? safeNumber(params.estimated_cost_usd, defaults.avg_cost)
    : defaults.avg_cost

  params.row.avg_latency =
    prevUses <= 0
      ? normalizedLatency
      : Number((((safeNumber(params.row.avg_latency, defaults.avg_latency) * prevUses) + (normalizedLatency * weight)) / nextUses).toFixed(4))

  params.row.avg_cost =
    prevUses <= 0
      ? normalizedCost
      : Number((((safeNumber(params.row.avg_cost, defaults.avg_cost) * prevUses) + (normalizedCost * weight)) / nextUses).toFixed(8))
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

  const finalProvider = normalizeProvider(record?.final_provider)
  const latencyMs = safeNumber(record?.latency_ms)
  const estimatedCostUsd = safeNumber(record?.estimated_cost_usd)

  for (const rawProvider of executedProviders) {
    const provider = normalizeProvider(rawProvider)
    if (!provider) continue

    const item = ensureRow(data, provider)

    applyWeightedUpdate({
      row: item,
      provider,
      latency_ms: latencyMs,
      estimated_cost_usd: estimatedCostUsd,
      selected_as_final: finalProvider === provider,
      weight: 1,
      effective: true
    })
  }

  save(data)
  return data
}

export function recordProviderExecution(providerInput: any, result: {
  success?: boolean
  latency_ms?: number
  estimated_cost_usd?: number
  selected_as_final?: boolean
  effective?: boolean
  weight?: number
  error_code?: string | null
}) {
  const provider = normalizeProvider(providerInput)
  if (!provider) return null

  const errorCode = String(result?.error_code ?? "").trim().toLowerCase()
  const environmentFailure =
    errorCode === "missing_api_key" ||
    errorCode === "invalid_api_key" ||
    errorCode === "forbidden" ||
    errorCode === "unauthorized"

  const data = load()
  const item = ensureRow(data, provider)

  applyWeightedUpdate({
    row: item,
    provider,
    latency_ms: Number(result?.latency_ms ?? 0),
    estimated_cost_usd: Number(result?.estimated_cost_usd ?? 0),
    selected_as_final: Boolean(result?.selected_as_final),
    effective: result?.effective !== false && !environmentFailure,
    weight: environmentFailure ? 0 : Number(result?.weight ?? 1)
  })

  save(data)
  return data[provider]
}

export function getProviderRoutingScore(providerInput: string) {
  const data = load()
  const provider = normalizeProvider(providerInput)
  const defaults = getDefaults(provider)
  const row = ensureRow(data, provider)

  const uses = safeNumber(row.uses)
  const wins = safeNumber(row.wins)

  const avgLatency = safeNumber(row.avg_latency, defaults.avg_latency)
  const avgCost = safeNumber(row.avg_cost, defaults.avg_cost)

  const observedWinRate = uses > 0 ? wins / uses : defaults.prior_win_rate
  const priorWeight = 8
  const blendedWinRate =
    ((observedWinRate * uses) + (defaults.prior_win_rate * priorWeight)) /
    Math.max(1, uses + priorWeight)

  const sampleConfidence = clamp(uses / 24, 0, 1)

  const latencyPenalty = clamp(avgLatency / 180000, 0, 0.7)
  const costPenalty = clamp(avgCost / 0.12, 0, 0.7)

  const latencyScore = clamp(0.9 - latencyPenalty, 0.15, 1)
  const costScore = clamp(0.9 - costPenalty, 0.15, 1)

  const rawRoutingScore =
    blendedWinRate * 0.55 +
    sampleConfidence * 0.15 +
    latencyScore * 0.15 +
    costScore * 0.15

  const routingScore = Math.max(defaults.routing_floor, rawRoutingScore)

  const recentUses = safeNumber(row.recent_uses)
  const recentWins = safeNumber(row.recent_wins)
  const recentWinRate = recentUses > 0 ? recentWins / recentUses : defaults.prior_win_rate

  const explorationBonus =
    clamp((1 - clamp(recentUses / 12, 0, 1)) * 0.14, 0, 0.14) +
    clamp((0.55 - recentWinRate) * 0.05, 0, 0.05)

  const ageSeconds = Math.max(0, nowSec() - safeNumber(row.last_used_at))
  const freshnessBonus = clamp(ageSeconds / 86400, 0, 1) * 0.04

  const banditScore = routingScore + explorationBonus + freshnessBonus

  return {
    provider,
    wins,
    uses,
    recent_uses: recentUses,
    recent_wins: recentWins,
    win_rate: Number(observedWinRate.toFixed(4)),
    blended_win_rate: Number(blendedWinRate.toFixed(4)),
    recent_win_rate: Number(recentWinRate.toFixed(4)),
    avg_latency: Number(avgLatency.toFixed(4)),
    avg_cost: Number(avgCost.toFixed(8)),
    routing_score: Number(routingScore.toFixed(4)),
    exploration_bonus: Number(explorationBonus.toFixed(4)),
    freshness_bonus: Number(freshnessBonus.toFixed(4)),
    bandit_score: Number(banditScore.toFixed(4)),
    routing_floor: Number(defaults.routing_floor.toFixed(4)),
    last_used_at: safeNumber(row.last_used_at)
  }
}

export function decayRecentBanditSignals() {
  const data = load()
  let changed = false

  for (const provider of Object.keys(data)) {
    const row = ensureRow(data, provider)

    const decayedRecentUses = Number((safeNumber(row.recent_uses) * 0.9).toFixed(4))
    const decayedRecentWins = Number((safeNumber(row.recent_wins) * 0.9).toFixed(4))

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
