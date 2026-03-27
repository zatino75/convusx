import fs from "fs"

const SCORE_PATH = "server/data/scoreboard.json"

type ConflictTypeStats = {
  numeric?: number
  fact?: number
  risk?: number
  recommendation?: number
  comparison?: number
  implementation?: number
  context?: number
  other?: number
}

type TaskStatsRow = {
  wins: number
  uses: number
  recent_uses?: number
  recent_wins?: number
  avg_latency?: number
  avg_cost?: number
  conflict_penalty_recent?: number
  context_conflicts_recent?: number
  provider_conflicts_recent?: number
  conflict_type_recent?: ConflictTypeStats
  last_used_at?: number
  last_conflict_at?: number
}

type ProviderBoardRow = {
  wins: number
  uses: number
  avg_latency: number
  avg_cost: number
  recent_uses?: number
  recent_wins?: number
  last_used_at?: number
  conflict_penalty_recent?: number
  context_conflicts_recent?: number
  provider_conflicts_recent?: number
  conflict_type_recent?: ConflictTypeStats
  last_conflict_at?: number
  task_stats?: Record<string, TaskStatsRow>
}

type ProviderDefaults = {
  prior_win_rate: number
  routing_floor: number
  avg_latency: number
  avg_cost: number
}

type ConflictTypePayload = {
  type?: string
  count?: number
  weight?: number
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

const TASK_PRIOR_WIN_RATE: Record<string, number> = {
  dialogue: 0.55,
  reasoning: 0.6,
  research: 0.58,
  code: 0.57
}

const CONFLICT_TYPE_WEIGHTS: Record<string, number> = {
  numeric: 0.22,
  fact: 0.16,
  risk: 0.12,
  recommendation: 0.06,
  comparison: 0.08,
  implementation: 0.1,
  context: 0.18,
  other: 0.07
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

function normalizeTask(task: any) {
  return String(task ?? "").trim().toLowerCase()
}

function normalizeConflictBucket(typeInput: any) {
  const type = String(typeInput ?? "").trim().toLowerCase()

  if (!type) return "other"
  if (type.includes("numeric")) return "numeric"
  if (type.includes("fact")) return "fact"
  if (type.includes("risk")) return "risk"
  if (type.includes("recommendation")) return "recommendation"
  if (type.includes("comparison")) return "comparison"
  if (type.includes("implementation")) return "implementation"
  if (type.includes("context")) return "context"
  return "other"
}

function getConflictTypeWeight(typeInput: any) {
  const bucket = normalizeConflictBucket(typeInput)
  return CONFLICT_TYPE_WEIGHTS[bucket] ?? CONFLICT_TYPE_WEIGHTS.other
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

function getTaskPrior(taskInput: any) {
  const task = normalizeTask(taskInput)
  return TASK_PRIOR_WIN_RATE[task] ?? 0.55
}

function emptyConflictTypeStats(): ConflictTypeStats {
  return {
    numeric: 0,
    fact: 0,
    risk: 0,
    recommendation: 0,
    comparison: 0,
    implementation: 0,
    context: 0,
    other: 0
  }
}

function ensureConflictTypeStats(stats: ConflictTypeStats | undefined): ConflictTypeStats {
  const base = {
    ...emptyConflictTypeStats(),
    ...(stats ?? {})
  }

  return {
    numeric: safeNumber(base.numeric),
    fact: safeNumber(base.fact),
    risk: safeNumber(base.risk),
    recommendation: safeNumber(base.recommendation),
    comparison: safeNumber(base.comparison),
    implementation: safeNumber(base.implementation),
    context: safeNumber(base.context),
    other: safeNumber(base.other)
  }
}

function ensureTaskRow(row: ProviderBoardRow, taskInput: any, providerInput: any): TaskStatsRow | null {
  const task = normalizeTask(taskInput)
  if (!task) return null

  if (!row.task_stats) {
    row.task_stats = {}
  }

  const defaults = getDefaults(providerInput)

  if (!row.task_stats[task]) {
    row.task_stats[task] = {
      wins: 0,
      uses: 0,
      recent_uses: 0,
      recent_wins: 0,
      avg_latency: defaults.avg_latency,
      avg_cost: defaults.avg_cost,
      conflict_penalty_recent: 0,
      context_conflicts_recent: 0,
      provider_conflicts_recent: 0,
      conflict_type_recent: emptyConflictTypeStats(),
      last_used_at: 0,
      last_conflict_at: 0
    }
  }

  const taskRow = row.task_stats[task]

  if (typeof taskRow.recent_uses !== "number") taskRow.recent_uses = 0
  if (typeof taskRow.recent_wins !== "number") taskRow.recent_wins = 0
  if (typeof taskRow.avg_latency !== "number") taskRow.avg_latency = defaults.avg_latency
  if (typeof taskRow.avg_cost !== "number") taskRow.avg_cost = defaults.avg_cost
  if (typeof taskRow.conflict_penalty_recent !== "number") taskRow.conflict_penalty_recent = 0
  if (typeof taskRow.context_conflicts_recent !== "number") taskRow.context_conflicts_recent = 0
  if (typeof taskRow.provider_conflicts_recent !== "number") taskRow.provider_conflicts_recent = 0
  if (typeof taskRow.last_used_at !== "number") taskRow.last_used_at = 0
  if (typeof taskRow.last_conflict_at !== "number") taskRow.last_conflict_at = 0
  taskRow.conflict_type_recent = ensureConflictTypeStats(taskRow.conflict_type_recent)

  return taskRow
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
      last_used_at: 0,
      conflict_penalty_recent: 0,
      context_conflicts_recent: 0,
      provider_conflicts_recent: 0,
      conflict_type_recent: emptyConflictTypeStats(),
      last_conflict_at: 0,
      task_stats: {}
    }
  }

  if (typeof data[provider].recent_uses !== "number") data[provider].recent_uses = 0
  if (typeof data[provider].recent_wins !== "number") data[provider].recent_wins = 0
  if (typeof data[provider].last_used_at !== "number") data[provider].last_used_at = 0
  if (typeof data[provider].conflict_penalty_recent !== "number") data[provider].conflict_penalty_recent = 0
  if (typeof data[provider].context_conflicts_recent !== "number") data[provider].context_conflicts_recent = 0
  if (typeof data[provider].provider_conflicts_recent !== "number") data[provider].provider_conflicts_recent = 0
  if (typeof data[provider].last_conflict_at !== "number") data[provider].last_conflict_at = 0
  if (!data[provider].task_stats || typeof data[provider].task_stats !== "object") data[provider].task_stats = {}
  data[provider].conflict_type_recent = ensureConflictTypeStats(data[provider].conflict_type_recent)

  if (typeof data[provider].avg_latency !== "number" || !Number.isFinite(data[provider].avg_latency)) {
    data[provider].avg_latency = defaults.avg_latency
  }

  if (typeof data[provider].avg_cost !== "number" || !Number.isFinite(data[provider].avg_cost)) {
    data[provider].avg_cost = defaults.avg_cost
  }

  return data[provider]
}

function applyWeightedUpdate(params: {
  row: { wins: number; uses: number; avg_latency?: number; avg_cost?: number; recent_uses?: number; recent_wins?: number; last_used_at?: number }
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

function applyConflictTypeLearning(stats: ConflictTypeStats | undefined, conflict_types: ConflictTypePayload[] | undefined, decay = 0.84) {
  const next = ensureConflictTypeStats(stats)
  const typed = Array.isArray(conflict_types) ? conflict_types : []

  for (const key of Object.keys(next) as Array<keyof ConflictTypeStats>) {
    next[key] = Number((safeNumber(next[key]) * decay).toFixed(4))
  }

  for (const item of typed) {
    const bucket = normalizeConflictBucket(item?.type)
    const count = Math.max(0, safeNumber(item?.count, 1))
    const explicitWeight = Math.max(0, safeNumber(item?.weight))
    const inferredWeight = getConflictTypeWeight(bucket)
    const addValue = count * (explicitWeight > 0 ? explicitWeight : inferredWeight)

    next[bucket] = Number((safeNumber(next[bucket]) + addValue).toFixed(4))
  }

  return next
}

function sumConflictTypePenalty(stats: ConflictTypeStats | undefined) {
  const safe = ensureConflictTypeStats(stats)
  let total = 0

  for (const [bucket, value] of Object.entries(safe)) {
    total += safeNumber(value) * getConflictTypeWeight(bucket)
  }

  return Number(total.toFixed(4))
}

function applyConflictLearning(params: {
  row: { conflict_penalty_recent?: number; context_conflicts_recent?: number; provider_conflicts_recent?: number; conflict_type_recent?: ConflictTypeStats; last_conflict_at?: number }
  context_conflicts?: number
  provider_conflicts?: number
  penalty?: number
  weight?: number
  conflict_types?: ConflictTypePayload[]
}) {
  const weight = clamp(safeNumber(params.weight, 1), 0, 1)
  if (weight <= 0) return

  const contextConflicts = Math.max(0, safeNumber(params.context_conflicts))
  const providerConflicts = Math.max(0, safeNumber(params.provider_conflicts))
  const explicitPenalty = Math.max(0, safeNumber(params.penalty))

  params.row.conflict_type_recent = applyConflictTypeLearning(
    params.row.conflict_type_recent,
    params.conflict_types
  )

  const typedPenalty = sumConflictTypePenalty(params.row.conflict_type_recent)
  const inferredPenalty =
    (contextConflicts * 0.12) +
    (providerConflicts * 0.06)

  const penalty = Math.max(explicitPenalty, inferredPenalty, typedPenalty * 0.35)

  params.row.context_conflicts_recent = Number((
    (safeNumber(params.row.context_conflicts_recent) * 0.85) +
    (contextConflicts * weight)
  ).toFixed(4))

  params.row.provider_conflicts_recent = Number((
    (safeNumber(params.row.provider_conflicts_recent) * 0.85) +
    (providerConflicts * weight)
  ).toFixed(4))

  params.row.conflict_penalty_recent = Number((
    (safeNumber(params.row.conflict_penalty_recent) * 0.82) +
    (penalty * weight)
  ).toFixed(4))

  params.row.last_conflict_at = nowSec()
}

function buildRoutingScore(params: {
  provider: string
  row: ProviderBoardRow
  task?: string
}) {
  const provider = normalizeProvider(params.provider)
  const defaults = getDefaults(provider)
  const task = normalizeTask(params.task)
  const taskRow = task ? ensureTaskRow(params.row, task, provider) : null

  const globalUses = safeNumber(params.row.uses)
  const globalWins = safeNumber(params.row.wins)
  const globalObservedWinRate = globalUses > 0 ? globalWins / globalUses : defaults.prior_win_rate
  const globalPriorWeight = 8
  const globalBlendedWinRate =
    ((globalObservedWinRate * globalUses) + (defaults.prior_win_rate * globalPriorWeight)) /
    Math.max(1, globalUses + globalPriorWeight)

  const taskUses = safeNumber(taskRow?.uses)
  const taskWins = safeNumber(taskRow?.wins)
  const taskPrior = getTaskPrior(task)
  const taskObservedWinRate = taskUses > 0 ? taskWins / taskUses : taskPrior
  const taskPriorWeight = 6
  const taskBlendedWinRate =
    task
      ? (((taskObservedWinRate * taskUses) + (taskPrior * taskPriorWeight)) / Math.max(1, taskUses + taskPriorWeight))
      : globalBlendedWinRate

  const sampleConfidence = clamp(globalUses / 24, 0, 1)
  const taskConfidence = task ? clamp(taskUses / 12, 0, 1) : 0

  const avgLatencyGlobal = safeNumber(params.row.avg_latency, defaults.avg_latency)
  const avgCostGlobal = safeNumber(params.row.avg_cost, defaults.avg_cost)
  const avgLatencyTask = safeNumber(taskRow?.avg_latency, avgLatencyGlobal)
  const avgCostTask = safeNumber(taskRow?.avg_cost, avgCostGlobal)

  const blendedLatency = task
    ? ((avgLatencyGlobal * 0.55) + (avgLatencyTask * 0.45))
    : avgLatencyGlobal

  const blendedCost = task
    ? ((avgCostGlobal * 0.55) + (avgCostTask * 0.45))
    : avgCostGlobal

  const latencyPenalty = clamp(blendedLatency / 180000, 0, 0.7)
  const costPenalty = clamp(blendedCost / 0.12, 0, 0.7)

  const latencyScore = clamp(0.9 - latencyPenalty, 0.15, 1)
  const costScore = clamp(0.9 - costPenalty, 0.15, 1)

  const effectiveWinRate = task
    ? ((globalBlendedWinRate * 0.45) + (taskBlendedWinRate * 0.55))
    : globalBlendedWinRate

  const effectiveConfidence = task
    ? ((sampleConfidence * 0.5) + (taskConfidence * 0.5))
    : sampleConfidence

  const rawRoutingScore =
    effectiveWinRate * 0.55 +
    effectiveConfidence * 0.15 +
    latencyScore * 0.15 +
    costScore * 0.15

  const routingScore = Math.max(defaults.routing_floor, rawRoutingScore)

  const recentUsesGlobal = safeNumber(params.row.recent_uses)
  const recentWinsGlobal = safeNumber(params.row.recent_wins)
  const recentWinRateGlobal = recentUsesGlobal > 0 ? recentWinsGlobal / recentUsesGlobal : defaults.prior_win_rate

  const recentUsesTask = safeNumber(taskRow?.recent_uses)
  const recentWinsTask = safeNumber(taskRow?.recent_wins)
  const recentWinRateTask = recentUsesTask > 0 ? recentWinsTask / recentUsesTask : taskPrior

  const effectiveRecentUses = task
    ? ((recentUsesGlobal * 0.5) + (recentUsesTask * 0.5))
    : recentUsesGlobal

  const effectiveRecentWinRate = task
    ? ((recentWinRateGlobal * 0.45) + (recentWinRateTask * 0.55))
    : recentWinRateGlobal

  const explorationBonus =
    clamp((1 - clamp(effectiveRecentUses / 12, 0, 1)) * 0.14, 0, 0.14) +
    clamp((0.55 - effectiveRecentWinRate) * 0.05, 0, 0.05)

  const ageSeconds = Math.max(0, nowSec() - safeNumber(task ? taskRow?.last_used_at : params.row.last_used_at))
  const freshnessBonus = clamp(ageSeconds / 86400, 0, 1) * 0.04

  const conflictPenaltyRecentGlobal = safeNumber(params.row.conflict_penalty_recent)
  const contextConflictsRecentGlobal = safeNumber(params.row.context_conflicts_recent)
  const providerConflictsRecentGlobal = safeNumber(params.row.provider_conflicts_recent)

  const conflictPenaltyRecentTask = safeNumber(taskRow?.conflict_penalty_recent)
  const contextConflictsRecentTask = safeNumber(taskRow?.context_conflicts_recent)
  const providerConflictsRecentTask = safeNumber(taskRow?.provider_conflicts_recent)

  const typePenaltyGlobal = sumConflictTypePenalty(params.row.conflict_type_recent)
  const typePenaltyTask = sumConflictTypePenalty(taskRow?.conflict_type_recent)

  const conflictPenaltyRecent = task
    ? ((conflictPenaltyRecentGlobal * 0.4) + (conflictPenaltyRecentTask * 0.6))
    : conflictPenaltyRecentGlobal

  const contextConflictsRecent = task
    ? ((contextConflictsRecentGlobal * 0.4) + (contextConflictsRecentTask * 0.6))
    : contextConflictsRecentGlobal

  const providerConflictsRecent = task
    ? ((providerConflictsRecentGlobal * 0.4) + (providerConflictsRecentTask * 0.6))
    : providerConflictsRecentGlobal

  const typePenalty = task
    ? ((typePenaltyGlobal * 0.35) + (typePenaltyTask * 0.65))
    : typePenaltyGlobal

  const conflictPenalty =
    clamp(conflictPenaltyRecent, 0, 0.22) +
    clamp(contextConflictsRecent * 0.015, 0, 0.12) +
    clamp(providerConflictsRecent * 0.008, 0, 0.08) +
    clamp(typePenalty * 0.12, 0, 0.18)

  const banditScore = routingScore + explorationBonus + freshnessBonus - conflictPenalty

  return {
    provider,
    task: task || null,
    wins: globalWins,
    uses: globalUses,
    task_wins: task ? taskWins : null,
    task_uses: task ? taskUses : null,
    recent_uses: recentUsesGlobal,
    recent_wins: recentWinsGlobal,
    task_recent_uses: task ? recentUsesTask : null,
    task_recent_wins: task ? recentWinsTask : null,
    win_rate: Number(globalObservedWinRate.toFixed(4)),
    blended_win_rate: Number(globalBlendedWinRate.toFixed(4)),
    task_win_rate: task ? Number(taskObservedWinRate.toFixed(4)) : null,
    task_blended_win_rate: task ? Number(taskBlendedWinRate.toFixed(4)) : null,
    effective_win_rate: Number(effectiveWinRate.toFixed(4)),
    recent_win_rate: Number(recentWinRateGlobal.toFixed(4)),
    task_recent_win_rate: task ? Number(recentWinRateTask.toFixed(4)) : null,
    avg_latency: Number(avgLatencyGlobal.toFixed(4)),
    avg_cost: Number(avgCostGlobal.toFixed(8)),
    task_avg_latency: task ? Number(avgLatencyTask.toFixed(4)) : null,
    task_avg_cost: task ? Number(avgCostTask.toFixed(8)) : null,
    routing_score: Number(routingScore.toFixed(4)),
    exploration_bonus: Number(explorationBonus.toFixed(4)),
    freshness_bonus: Number(freshnessBonus.toFixed(4)),
    conflict_penalty_recent: Number(conflictPenaltyRecent.toFixed(4)),
    context_conflicts_recent: Number(contextConflictsRecent.toFixed(4)),
    provider_conflicts_recent: Number(providerConflictsRecent.toFixed(4)),
    conflict_type_recent: task ? ensureConflictTypeStats(taskRow?.conflict_type_recent) : ensureConflictTypeStats(params.row.conflict_type_recent),
    type_penalty: Number(typePenalty.toFixed(4)),
    conflict_penalty: Number(conflictPenalty.toFixed(4)),
    bandit_score: Number(Math.max(0, banditScore).toFixed(4)),
    routing_floor: Number(defaults.routing_floor.toFixed(4)),
    last_used_at: safeNumber(task ? taskRow?.last_used_at : params.row.last_used_at),
    last_conflict_at: safeNumber(task ? taskRow?.last_conflict_at : params.row.last_conflict_at)
  }
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
  const task = normalizeTask(record?.task)

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

    const taskRow = ensureTaskRow(item, task, provider)
    if (taskRow) {
      applyWeightedUpdate({
        row: taskRow,
        provider,
        latency_ms: latencyMs,
        estimated_cost_usd: estimatedCostUsd,
        selected_as_final: finalProvider === provider,
        weight: 1,
        effective: true
      })
    }
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
  task?: string
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

  const task = normalizeTask(result?.task)
  const taskRow = ensureTaskRow(item, task, provider)
  if (taskRow) {
    applyWeightedUpdate({
      row: taskRow,
      provider,
      latency_ms: Number(result?.latency_ms ?? 0),
      estimated_cost_usd: Number(result?.estimated_cost_usd ?? 0),
      selected_as_final: Boolean(result?.selected_as_final),
      effective: result?.effective !== false && !environmentFailure,
      weight: environmentFailure ? 0 : Number(result?.weight ?? 1)
    })
  }

  save(data)
  return data[provider]
}

export function recordProviderConflict(providerInput: any, payload: {
  context_conflicts?: number
  provider_conflicts?: number
  penalty?: number
  weight?: number
  task?: string
  conflict_types?: ConflictTypePayload[]
}) {
  const provider = normalizeProvider(providerInput)
  if (!provider) return null

  const data = load()
  const row = ensureRow(data, provider)

  applyConflictLearning({
    row,
    context_conflicts: Number(payload?.context_conflicts ?? 0),
    provider_conflicts: Number(payload?.provider_conflicts ?? 0),
    penalty: Number(payload?.penalty ?? 0),
    weight: Number(payload?.weight ?? 1),
    conflict_types: Array.isArray(payload?.conflict_types) ? payload.conflict_types : []
  })

  const task = normalizeTask(payload?.task)
  const taskRow = ensureTaskRow(row, task, provider)
  if (taskRow) {
    applyConflictLearning({
      row: taskRow,
      context_conflicts: Number(payload?.context_conflicts ?? 0),
      provider_conflicts: Number(payload?.provider_conflicts ?? 0),
      penalty: Number(payload?.penalty ?? 0),
      weight: Number(payload?.weight ?? 1),
      conflict_types: Array.isArray(payload?.conflict_types) ? payload.conflict_types : []
    })
  }

  save(data)
  return data[provider]
}

export function getProviderRoutingScore(providerInput: string, taskInput?: string) {
  const data = load()
  const provider = normalizeProvider(providerInput)
  const row = ensureRow(data, provider)
  return buildRoutingScore({
    provider,
    row,
    task: normalizeTask(taskInput)
  })
}

export function decayRecentBanditSignals() {
  const data = load()
  let changed = false

  for (const provider of Object.keys(data)) {
    const row = ensureRow(data, provider)

    const decayedRecentUses = Number((safeNumber(row.recent_uses) * 0.9).toFixed(4))
    const decayedRecentWins = Number((safeNumber(row.recent_wins) * 0.9).toFixed(4))
    const decayedConflictPenalty = Number((safeNumber(row.conflict_penalty_recent) * 0.88).toFixed(4))
    const decayedContextConflicts = Number((safeNumber(row.context_conflicts_recent) * 0.88).toFixed(4))
    const decayedProviderConflicts = Number((safeNumber(row.provider_conflicts_recent) * 0.88).toFixed(4))
    const decayedConflictType = applyConflictTypeLearning(row.conflict_type_recent, [], 0.88)

    if (
      decayedRecentUses !== safeNumber(row.recent_uses) ||
      decayedRecentWins !== safeNumber(row.recent_wins) ||
      decayedConflictPenalty !== safeNumber(row.conflict_penalty_recent) ||
      decayedContextConflicts !== safeNumber(row.context_conflicts_recent) ||
      decayedProviderConflicts !== safeNumber(row.provider_conflicts_recent) ||
      JSON.stringify(decayedConflictType) !== JSON.stringify(ensureConflictTypeStats(row.conflict_type_recent))
    ) {
      row.recent_uses = decayedRecentUses
      row.recent_wins = Math.min(decayedRecentWins, decayedRecentUses)
      row.conflict_penalty_recent = decayedConflictPenalty
      row.context_conflicts_recent = decayedContextConflicts
      row.provider_conflicts_recent = decayedProviderConflicts
      row.conflict_type_recent = decayedConflictType
      changed = true
    }

    const taskKeys = Object.keys(row.task_stats ?? {})
    for (const task of taskKeys) {
      const taskRow = ensureTaskRow(row, task, provider)
      if (!taskRow) continue

      const decayedTaskRecentUses = Number((safeNumber(taskRow.recent_uses) * 0.9).toFixed(4))
      const decayedTaskRecentWins = Number((safeNumber(taskRow.recent_wins) * 0.9).toFixed(4))
      const decayedTaskConflictPenalty = Number((safeNumber(taskRow.conflict_penalty_recent) * 0.88).toFixed(4))
      const decayedTaskContextConflicts = Number((safeNumber(taskRow.context_conflicts_recent) * 0.88).toFixed(4))
      const decayedTaskProviderConflicts = Number((safeNumber(taskRow.provider_conflicts_recent) * 0.88).toFixed(4))
      const decayedTaskConflictType = applyConflictTypeLearning(taskRow.conflict_type_recent, [], 0.88)

      if (
        decayedTaskRecentUses !== safeNumber(taskRow.recent_uses) ||
        decayedTaskRecentWins !== safeNumber(taskRow.recent_wins) ||
        decayedTaskConflictPenalty !== safeNumber(taskRow.conflict_penalty_recent) ||
        decayedTaskContextConflicts !== safeNumber(taskRow.context_conflicts_recent) ||
        decayedTaskProviderConflicts !== safeNumber(taskRow.provider_conflicts_recent) ||
        JSON.stringify(decayedTaskConflictType) !== JSON.stringify(ensureConflictTypeStats(taskRow.conflict_type_recent))
      ) {
        taskRow.recent_uses = decayedTaskRecentUses
        taskRow.recent_wins = Math.min(decayedTaskRecentWins, decayedTaskRecentUses)
        taskRow.conflict_penalty_recent = decayedTaskConflictPenalty
        taskRow.context_conflicts_recent = decayedTaskContextConflicts
        taskRow.provider_conflicts_recent = decayedTaskProviderConflicts
        taskRow.conflict_type_recent = decayedTaskConflictType
        changed = true
      }
    }
  }

  if (changed) {
    save(data)
  }

  return data
}

export function readRoutingScores(taskInput?: string) {
  const data = load()
  const providers = Object.keys(data)
  const baseProviders = ["openai", "claude", "gemini", "perplexity"]
  const allProviders = Array.from(new Set([...baseProviders, ...providers]))
  const task = normalizeTask(taskInput)

  return allProviders
    .map((provider) => getProviderRoutingScore(provider, task))
    .sort((a, b) => b.bandit_score - a.bandit_score)
}

export function readTaskRoutingScores() {
  const data = load()
  const providers = Object.keys(data)
  const baseProviders = ["openai", "claude", "gemini", "perplexity"]
  const allProviders = Array.from(new Set([...baseProviders, ...providers]))
  const tasks = ["dialogue", "reasoning", "research", "code"]

  return tasks.reduce((acc: Record<string, any[]>, task) => {
    acc[task] = allProviders
      .map((provider) => getProviderRoutingScore(provider, task))
      .sort((a, b) => b.bandit_score - a.bandit_score)
    return acc
  }, {})
}
