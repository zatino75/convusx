import fs from "fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SCORE_PATH = resolve(__dirname, "../../../data/corvus-data.json")
const SCORE_DIR = resolve(__dirname, "../../../data")

type ConflictBucket =
  | "numeric"
  | "fact"
  | "risk"
  | "recommendation"
  | "comparison"
  | "implementation"
  | "context"
  | "other"

type ConflictTypeStats = Partial<Record<ConflictBucket, number>>

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

type ScoreStore = {
  scoreboard: Record<string, ProviderBoardRow>
  model_scoreboard: Record<string, unknown>
}

type WeightedRow = {
  wins: number
  uses: number
  avg_latency?: number
  avg_cost?: number
  recent_uses?: number
  recent_wins?: number
  last_used_at?: number
}

type ConflictLearningRow = {
  conflict_penalty_recent?: number
  context_conflicts_recent?: number
  provider_conflicts_recent?: number
  conflict_type_recent?: ConflictTypeStats
  last_conflict_at?: number
}

const PROVIDER_DEFAULTS: Record<string, ProviderDefaults> = {
  openai: {
    prior_win_rate: 0.62,
    routing_floor: 0.38,
    avg_latency: 14000,
    avg_cost: 0.028,
  },
  claude: {
    prior_win_rate: 0.6,
    routing_floor: 0.36,
    avg_latency: 13000,
    avg_cost: 0.022,
  },
  gemini: {
    prior_win_rate: 0.53,
    routing_floor: 0.28,
    avg_latency: 9000,
    avg_cost: 0.012,
  },
  perplexity: {
    prior_win_rate: 0.56,
    routing_floor: 0.3,
    avg_latency: 7000,
    avg_cost: 0.01,
  },
}

const TASK_PRIOR_WIN_RATE: Record<string, number> = {
  dialogue: 0.55,
  reasoning: 0.6,
  research: 0.58,
  code: 0.57,
  code_implement: 0.58,
  code_debug: 0.59,
  code_refactor_review: 0.57,
  writing: 0.6,
  writing_creative: 0.58,
  writing_business: 0.62,
  long_doc: 0.58,
  word: 0.6,
  pdf: 0.57,
  excel: 0.56,
  ppt: 0.57,
  legal_review: 0.61,
  data_analysis: 0.59,
  finance_analysis: 0.59,
  product_development: 0.58,
  generic: 0.55,
}

const CONFLICT_TYPE_WEIGHTS: Record<ConflictBucket, number> = {
  numeric: 0.22,
  fact: 0.16,
  risk: 0.12,
  recommendation: 0.06,
  comparison: 0.08,
  implementation: 0.1,
  context: 0.18,
  other: 0.07,
}

function ensureDir() {
  try {
    fs.mkdirSync(SCORE_DIR, { recursive: true })
  } catch {
    // noop
  }
}

function defaultStore(): ScoreStore {
  return {
    scoreboard: {},
    model_scoreboard: {},
  }
}

function loadAll(): ScoreStore {
  try {
    const raw = JSON.parse(fs.readFileSync(SCORE_PATH, "utf-8")) as Partial<ScoreStore> | Record<string, unknown>
    if (raw && typeof raw === "object" && "scoreboard" in raw) {
      return {
        scoreboard: (raw as Partial<ScoreStore>).scoreboard ?? {},
        model_scoreboard: (raw as Partial<ScoreStore>).model_scoreboard ?? {},
      }
    }
    return {
      scoreboard: (raw as Record<string, ProviderBoardRow>) ?? {},
      model_scoreboard: {},
    }
  } catch {
    return defaultStore()
  }
}

function load(): Record<string, ProviderBoardRow> {
  return loadAll().scoreboard
}

function save(data: Record<string, ProviderBoardRow>) {
  ensureDir()
  const current = loadAll()
  fs.writeFileSync(
    SCORE_PATH,
    JSON.stringify(
      {
        scoreboard: data,
        model_scoreboard: current.model_scoreboard ?? {},
      },
      null,
      2,
    ),
    "utf-8",
  )
}

export function saveModelScoreboard(modelBoard: Record<string, unknown>) {
  ensureDir()
  const current = loadAll()
  fs.writeFileSync(
    SCORE_PATH,
    JSON.stringify(
      {
        scoreboard: current.scoreboard,
        model_scoreboard: modelBoard,
      },
      null,
      2,
    ),
    "utf-8",
  )
}

export function loadModelScoreboard(): Record<string, unknown> {
  return loadAll().model_scoreboard
}

function safeNumber(value: unknown, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function nowSec() {
  return Math.floor(Date.now() / 1000)
}

function normalizeProvider(provider: unknown) {
  return String(provider ?? "").trim().toLowerCase()
}

function normalizeTask(task: unknown) {
  const value = String(task ?? "").trim().toLowerCase()
  if (!value) return ""

  if (value === "code_review" || value === "code_refactor/review" || value === "code_refactor") {
    return "code_refactor_review"
  }
  if (value.startsWith("code_implement")) return "code_implement"
  if (value.startsWith("code_debug")) return "code_debug"
  if (value.startsWith("code")) return "code"

  if (value.startsWith("writing_creative")) return "writing_creative"
  if (value.startsWith("writing_business")) return "writing_business"
  if (value.startsWith("writing")) return "writing"

  if (value.includes("legal")) return "legal_review"
  if (value.includes("finance")) return "finance_analysis"
  if (value.includes("data")) return "data_analysis"
  if (value.includes("product")) return "product_development"

  return value
}

function normalizeConflictBucket(typeInput: unknown): ConflictBucket {
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

function getConflictTypeWeight(typeInput: unknown) {
  const bucket = normalizeConflictBucket(typeInput)
  return CONFLICT_TYPE_WEIGHTS[bucket] ?? CONFLICT_TYPE_WEIGHTS.other
}

function getDefaults(providerInput: unknown): ProviderDefaults {
  const provider = normalizeProvider(providerInput)
  return (
    PROVIDER_DEFAULTS[provider] ?? {
      prior_win_rate: 0.55,
      routing_floor: 0.3,
      avg_latency: 12000,
      avg_cost: 0.02,
    }
  )
}

function getTaskPrior(taskInput: unknown) {
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
    other: 0,
  }
}

function ensureConflictTypeStats(stats: ConflictTypeStats | undefined): ConflictTypeStats {
  const merged = {
    ...emptyConflictTypeStats(),
    ...(stats ?? {}),
  }

  return {
    numeric: safeNumber(merged.numeric),
    fact: safeNumber(merged.fact),
    risk: safeNumber(merged.risk),
    recommendation: safeNumber(merged.recommendation),
    comparison: safeNumber(merged.comparison),
    implementation: safeNumber(merged.implementation),
    context: safeNumber(merged.context),
    other: safeNumber(merged.other),
  }
}

function sameConflictStats(a: ConflictTypeStats | undefined, b: ConflictTypeStats | undefined) {
  const left = ensureConflictTypeStats(a)
  const right = ensureConflictTypeStats(b)
  return (
    left.numeric === right.numeric &&
    left.fact === right.fact &&
    left.risk === right.risk &&
    left.recommendation === right.recommendation &&
    left.comparison === right.comparison &&
    left.implementation === right.implementation &&
    left.context === right.context &&
    left.other === right.other
  )
}

function ensureTaskRow(row: ProviderBoardRow, taskInput: unknown, providerInput: unknown): TaskStatsRow | null {
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
      last_conflict_at: 0,
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

function getTaskRow(row: ProviderBoardRow, taskInput: unknown): TaskStatsRow | null {
  const task = normalizeTask(taskInput)
  if (!task) return null
  const taskRow = row.task_stats?.[task]
  if (!taskRow) return null

  return {
    ...taskRow,
    conflict_type_recent: ensureConflictTypeStats(taskRow.conflict_type_recent),
    recent_uses: safeNumber(taskRow.recent_uses),
    recent_wins: safeNumber(taskRow.recent_wins),
    avg_latency: safeNumber(taskRow.avg_latency),
    avg_cost: safeNumber(taskRow.avg_cost),
    conflict_penalty_recent: safeNumber(taskRow.conflict_penalty_recent),
    context_conflicts_recent: safeNumber(taskRow.context_conflicts_recent),
    provider_conflicts_recent: safeNumber(taskRow.provider_conflicts_recent),
    last_used_at: safeNumber(taskRow.last_used_at),
    last_conflict_at: safeNumber(taskRow.last_conflict_at),
  }
}

function ensureRow(data: Record<string, ProviderBoardRow>, providerInput: unknown) {
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
      task_stats: {},
    }
  }

  const row = data[provider]
  row.recent_uses = safeNumber(row.recent_uses)
  row.recent_wins = safeNumber(row.recent_wins)
  row.last_used_at = safeNumber(row.last_used_at)
  row.conflict_penalty_recent = safeNumber(row.conflict_penalty_recent)
  row.context_conflicts_recent = safeNumber(row.context_conflicts_recent)
  row.provider_conflicts_recent = safeNumber(row.provider_conflicts_recent)
  row.last_conflict_at = safeNumber(row.last_conflict_at)
  row.conflict_type_recent = ensureConflictTypeStats(row.conflict_type_recent)
  if (!row.task_stats || typeof row.task_stats !== "object") row.task_stats = {}
  if (!Number.isFinite(row.avg_latency)) row.avg_latency = defaults.avg_latency
  if (!Number.isFinite(row.avg_cost)) row.avg_cost = defaults.avg_cost

  return row
}

function applyWeightedUpdate(params: {
  row: WeightedRow
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

  if (weight <= 0) return

  const prevUses = safeNumber(params.row.uses)
  const nextUses = Number((prevUses + weight).toFixed(4))

  params.row.uses = nextUses
  params.row.recent_uses = Number((safeNumber(params.row.recent_uses) + weight).toFixed(4))
  params.row.last_used_at = nowSec()

  if (params.selected_as_final) {
    params.row.wins = Number((safeNumber(params.row.wins) + weight).toFixed(4))
    params.row.recent_wins = Number((safeNumber(params.row.recent_wins) + weight).toFixed(4))
  }

  if (!effective) return

  const normalizedLatency =
    safeNumber(params.latency_ms, defaults.avg_latency) > 0
      ? safeNumber(params.latency_ms, defaults.avg_latency)
      : defaults.avg_latency

  const normalizedCost =
    safeNumber(params.estimated_cost_usd, defaults.avg_cost) > 0
      ? safeNumber(params.estimated_cost_usd, defaults.avg_cost)
      : defaults.avg_cost

  params.row.avg_latency =
    prevUses <= 0
      ? normalizedLatency
      : Number(
          (
            ((safeNumber(params.row.avg_latency, defaults.avg_latency) * prevUses) + normalizedLatency * weight) /
            nextUses
          ).toFixed(4),
        )

  params.row.avg_cost =
    prevUses <= 0
      ? normalizedCost
      : Number(
          (
            ((safeNumber(params.row.avg_cost, defaults.avg_cost) * prevUses) + normalizedCost * weight) /
            nextUses
          ).toFixed(8),
        )
}

function applyConflictTypeLearning(stats: ConflictTypeStats | undefined, conflictTypes: ConflictTypePayload[] | undefined, decay = 0.84) {
  const next = ensureConflictTypeStats(stats)
  const typed = Array.isArray(conflictTypes) ? conflictTypes : []

  for (const key of Object.keys(next) as ConflictBucket[]) {
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
  row: ConflictLearningRow
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
    params.conflict_types,
  )

  const typedPenalty = sumConflictTypePenalty(params.row.conflict_type_recent)
  const inferredPenalty = contextConflicts * 0.12 + providerConflicts * 0.06
  const penalty = Math.max(explicitPenalty, inferredPenalty, typedPenalty * 0.35)

  params.row.context_conflicts_recent = Number(
    ((safeNumber(params.row.context_conflicts_recent) * 0.85) + contextConflicts * weight).toFixed(4),
  )
  params.row.provider_conflicts_recent = Number(
    ((safeNumber(params.row.provider_conflicts_recent) * 0.85) + providerConflicts * weight).toFixed(4),
  )
  params.row.conflict_penalty_recent = Number(
    ((safeNumber(params.row.conflict_penalty_recent) * 0.82) + penalty * weight).toFixed(4),
  )
  params.row.last_conflict_at = nowSec()
}

function buildRoutingScore(params: { provider: string; row: ProviderBoardRow; task?: string }) {
  const provider = normalizeProvider(params.provider)
  const defaults = getDefaults(provider)
  const task = normalizeTask(params.task)
  const taskRow = task ? getTaskRow(params.row, task) : null

  const globalUses = safeNumber(params.row.uses)
  const globalWins = safeNumber(params.row.wins)
  const globalObservedWinRate = globalUses > 0 ? globalWins / globalUses : defaults.prior_win_rate
  const globalPriorWeight = 20
  const globalBlendedWinRate =
    ((globalObservedWinRate * globalUses) + defaults.prior_win_rate * globalPriorWeight) /
    Math.max(1, globalUses + globalPriorWeight)

  const taskUses = safeNumber(taskRow?.uses)
  const taskWins = safeNumber(taskRow?.wins)
  const taskPrior = getTaskPrior(task)
  const taskObservedWinRate = taskUses > 0 ? taskWins / taskUses : taskPrior
  const taskPriorWeight = 15
  const taskBlendedWinRate = task
    ? ((taskObservedWinRate * taskUses) + taskPrior * taskPriorWeight) / Math.max(1, taskUses + taskPriorWeight)
    : globalBlendedWinRate

  const sampleConfidence = clamp(globalUses / 50, 0, 1)
  const globalSampleGate = clamp(globalUses / 30, 0, 1)
  const taskSampleGate = task ? clamp(taskUses / 12, 0, 1) : globalSampleGate
  const dynamicSampleGate = task ? globalSampleGate * 0.4 + taskSampleGate * 0.6 : globalSampleGate
  const taskConfidence = task ? clamp(taskUses / 12, 0, 1) : 0

  const avgLatencyGlobal = safeNumber(params.row.avg_latency, defaults.avg_latency)
  const avgCostGlobal = safeNumber(params.row.avg_cost, defaults.avg_cost)
  const avgLatencyTask = safeNumber(taskRow?.avg_latency, avgLatencyGlobal)
  const avgCostTask = safeNumber(taskRow?.avg_cost, avgCostGlobal)

  const blendedLatency = task ? avgLatencyGlobal * 0.55 + avgLatencyTask * 0.45 : avgLatencyGlobal
  const blendedCost = task ? avgCostGlobal * 0.55 + avgCostTask * 0.45 : avgCostGlobal

  const latencyPenalty = clamp(blendedLatency / 180000, 0, 0.7)
  const costPenalty = clamp(blendedCost / 0.12, 0, 0.7)
  const latencyScore = clamp(0.9 - latencyPenalty, 0.15, 1)
  const costScore = clamp(0.9 - costPenalty, 0.15, 1)

  const effectiveWinRate = task ? globalBlendedWinRate * 0.45 + taskBlendedWinRate * 0.55 : globalBlendedWinRate
  const effectiveConfidence = task ? sampleConfidence * 0.5 + taskConfidence * 0.5 : sampleConfidence

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

  const effectiveRecentUses = task ? recentUsesGlobal * 0.5 + recentUsesTask * 0.5 : recentUsesGlobal
  const effectiveRecentWinRate = task ? recentWinRateGlobal * 0.45 + recentWinRateTask * 0.55 : recentWinRateGlobal

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
    ? conflictPenaltyRecentGlobal * 0.4 + conflictPenaltyRecentTask * 0.6
    : conflictPenaltyRecentGlobal

  const contextConflictsRecent = task
    ? contextConflictsRecentGlobal * 0.4 + contextConflictsRecentTask * 0.6
    : contextConflictsRecentGlobal

  const providerConflictsRecent = task
    ? providerConflictsRecentGlobal * 0.4 + providerConflictsRecentTask * 0.6
    : providerConflictsRecentGlobal

  const typePenalty = task ? typePenaltyGlobal * 0.35 + typePenaltyTask * 0.65 : typePenaltyGlobal

  const conflictPenalty =
    clamp(conflictPenaltyRecent, 0, 0.22) +
    clamp(contextConflictsRecent * 0.015, 0, 0.12) +
    clamp(providerConflictsRecent * 0.008, 0, 0.08) +
    clamp(typePenalty * 0.12, 0, 0.18)

  const banditScore = clamp(routingScore + explorationBonus + freshnessBonus - conflictPenalty, 0, 1)

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
    dynamic_sample_gate: Number(dynamicSampleGate.toFixed(4)),
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
    bandit_score: Number(banditScore.toFixed(4)),
    routing_floor: Number(defaults.routing_floor.toFixed(4)),
    last_used_at: safeNumber(task ? taskRow?.last_used_at : params.row.last_used_at),
    last_conflict_at: safeNumber(task ? taskRow?.last_conflict_at : params.row.last_conflict_at),
  }
}

export function readScoreboard() {
  return load()
}

export function resetScoreboard() {
  save({})
  return {}
}

export function updateScoreboardFromBenchmark(record: {
  executed_providers?: unknown[]
  final_provider?: unknown
  latency_ms?: number
  estimated_cost_usd?: number
  task?: unknown
}) {
  const data = load()

  const executedProviders = Array.isArray(record?.executed_providers) ? record.executed_providers : []
  const finalProvider = normalizeProvider(record?.final_provider)
  const latencyMs = safeNumber(record?.latency_ms)
  const estimatedCostUsd = safeNumber(record?.estimated_cost_usd)
  const task = normalizeTask(record?.task)

  for (const rawProvider of executedProviders) {
    const provider = normalizeProvider(rawProvider)
    if (!provider) continue

    const row = ensureRow(data, provider)
    applyWeightedUpdate({
      row,
      provider,
      latency_ms: latencyMs,
      estimated_cost_usd: estimatedCostUsd,
      selected_as_final: finalProvider === provider,
      weight: 1,
      effective: true,
    })

    const taskRow = ensureTaskRow(row, task, provider)
    if (taskRow) {
      applyWeightedUpdate({
        row: taskRow,
        provider,
        latency_ms: latencyMs,
        estimated_cost_usd: estimatedCostUsd,
        selected_as_final: finalProvider === provider,
        weight: 1,
        effective: true,
      })
    }
  }

  save(data)
  return data
}

export function recordProviderExecution(
  providerInput: unknown,
  result: {
    success?: boolean
    latency_ms?: number
    estimated_cost_usd?: number
    selected_as_final?: boolean
    effective?: boolean
    weight?: number
    error_code?: string | null
    task?: unknown
  },
) {
  const provider = normalizeProvider(providerInput)
  if (!provider) return null

  const errorCode = String(result?.error_code ?? "").trim().toLowerCase()
  const environmentFailure =
    errorCode === "missing_api_key" ||
    errorCode === "invalid_api_key" ||
    errorCode === "forbidden" ||
    errorCode === "unauthorized"

  const data = load()
  const row = ensureRow(data, provider)

  applyWeightedUpdate({
    row,
    provider,
    latency_ms: safeNumber(result?.latency_ms),
    estimated_cost_usd: safeNumber(result?.estimated_cost_usd),
    selected_as_final: Boolean(result?.selected_as_final),
    effective: result?.effective !== false && !environmentFailure,
    weight: environmentFailure ? 0 : safeNumber(result?.weight, 1),
  })

  const task = normalizeTask(result?.task)
  const taskRow = ensureTaskRow(row, task, provider)
  if (taskRow) {
    applyWeightedUpdate({
      row: taskRow,
      provider,
      latency_ms: safeNumber(result?.latency_ms),
      estimated_cost_usd: safeNumber(result?.estimated_cost_usd),
      selected_as_final: Boolean(result?.selected_as_final),
      effective: result?.effective !== false && !environmentFailure,
      weight: environmentFailure ? 0 : safeNumber(result?.weight, 1),
    })
  }

  save(data)
  return data[provider]
}

export function recordProviderConflict(
  providerInput: unknown,
  payload: {
    context_conflicts?: number
    provider_conflicts?: number
    penalty?: number
    weight?: number
    task?: unknown
    conflict_types?: ConflictTypePayload[]
  },
) {
  const provider = normalizeProvider(providerInput)
  if (!provider) return null

  const data = load()
  const row = ensureRow(data, provider)

  applyConflictLearning({
    row,
    context_conflicts: safeNumber(payload?.context_conflicts),
    provider_conflicts: safeNumber(payload?.provider_conflicts),
    penalty: safeNumber(payload?.penalty),
    weight: safeNumber(payload?.weight, 1),
    conflict_types: Array.isArray(payload?.conflict_types) ? payload.conflict_types : [],
  })

  const task = normalizeTask(payload?.task)
  const taskRow = ensureTaskRow(row, task, provider)
  if (taskRow) {
    applyConflictLearning({
      row: taskRow,
      context_conflicts: safeNumber(payload?.context_conflicts),
      provider_conflicts: safeNumber(payload?.provider_conflicts),
      penalty: safeNumber(payload?.penalty),
      weight: safeNumber(payload?.weight, 1),
      conflict_types: Array.isArray(payload?.conflict_types) ? payload.conflict_types : [],
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
    task: normalizeTask(taskInput),
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
      !sameConflictStats(decayedConflictType, row.conflict_type_recent)
    ) {
      row.recent_uses = decayedRecentUses
      row.recent_wins = Math.min(decayedRecentWins, decayedRecentUses)
      row.conflict_penalty_recent = decayedConflictPenalty
      row.context_conflicts_recent = decayedContextConflicts
      row.provider_conflicts_recent = decayedProviderConflicts
      row.conflict_type_recent = decayedConflictType
      changed = true
    }

    for (const task of Object.keys(row.task_stats ?? {})) {
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
        !sameConflictStats(decayedTaskConflictType, taskRow.conflict_type_recent)
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

  if (changed) save(data)
  return data
}

export function readRoutingScores(taskInput?: string) {
  const data = load()
  const allProviders = Array.from(new Set(["openai", "claude", "gemini", "perplexity", ...Object.keys(data)]))
  const task = normalizeTask(taskInput)

  return allProviders
    .map((provider) => getProviderRoutingScore(provider, task))
    .sort((a, b) => b.bandit_score - a.bandit_score)
}

export function readTaskRoutingScores() {
  const data = load()
  const allProviders = Array.from(new Set(["openai", "claude", "gemini", "perplexity", ...Object.keys(data)]))
  const tasks = [
    "dialogue",
    "reasoning",
    "research",
    "code",
    "code_implement",
    "code_debug",
    "code_refactor_review",
    "writing",
    "writing_creative",
    "writing_business",
    "long_doc",
    "word",
    "pdf",
    "excel",
    "ppt",
    "legal_review",
    "data_analysis",
    "finance_analysis",
    "product_development",
  ]

  return tasks.reduce((acc: Record<string, ReturnType<typeof getProviderRoutingScore>[]>, task) => {
    acc[task] = allProviders
      .map((provider) => getProviderRoutingScore(provider, task))
      .sort((a, b) => b.bandit_score - a.bandit_score)
    return acc
  }, {})
}

export function recordJudgeOutcome(params: {
  winner: string
  losers: string[]
  task: string
  judge_confidence?: number
  source?: string
}) {
  const winner = normalizeProvider(params.winner)
  const losers = (params.losers ?? []).map(normalizeProvider).filter((p) => p && p !== winner)
  const task = normalizeTask(params.task)
  if (!winner || !task) return null

  const confidence = clamp(safeNumber(params.judge_confidence, 0.65), 0.5, 1.0)
  const winnerWeight = Number((0.55 + (confidence - 0.5) * 0.5).toFixed(4))
  const loserWeight = Number((winnerWeight * 0.55).toFixed(4))

  const data = load()

  const winnerRow = ensureRow(data, winner)
  applyWeightedUpdate({
    row: winnerRow,
    provider: winner,
    latency_ms: 0,
    estimated_cost_usd: 0,
    selected_as_final: true,
    weight: winnerWeight,
    effective: false,
  })

  const winnerTaskRow = ensureTaskRow(winnerRow, task, winner)
  if (winnerTaskRow) {
    applyWeightedUpdate({
      row: winnerTaskRow,
      provider: winner,
      latency_ms: 0,
      estimated_cost_usd: 0,
      selected_as_final: true,
      weight: winnerWeight,
      effective: false,
    })
  }

  for (const loser of losers) {
    const loserRow = ensureRow(data, loser)
    applyWeightedUpdate({
      row: loserRow,
      provider: loser,
      latency_ms: 0,
      estimated_cost_usd: 0,
      selected_as_final: false,
      weight: loserWeight,
      effective: false,
    })

    const loserTaskRow = ensureTaskRow(loserRow, task, loser)
    if (loserTaskRow) {
      applyWeightedUpdate({
        row: loserTaskRow,
        provider: loser,
        latency_ms: 0,
        estimated_cost_usd: 0,
        selected_as_final: false,
        weight: loserWeight,
        effective: false,
      })
    }
  }

  save(data)
  return { winner, losers, task, winner_weight: winnerWeight, loser_weight: loserWeight }
}


// ─── ModelScoreboard — modelScoreboard.ts 통합 ───────────────────────────────

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

  avg_claims: number
  avg_decisions: number
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

// model-scoreboard 데이터는 corvus-data.json의 model_scoreboard 섹션으로 통합
const RECENT_ALPHA = 0.35

// clamp: 상단 함수 사용

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
    freshness_score: 0,

    avg_claims: 0,
    avg_decisions: 0
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
    freshness_score: Number(freshnessScore.toFixed(4)),

    avg_claims: Number((node?.avg_claims ?? 0).toFixed(4)),
    avg_decisions: Number((node?.avg_decisions ?? 0).toFixed(4))
  }
}

// normalizeProvider: 상단 함수 사용

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
    return normalizeBoard(loadModelScoreboard() as ModelScoreboard)
  } catch {
    return {}
  }
}

function saveBoard(board: ModelScoreboard) {
  saveModelScoreboard(normalizeBoard(board))
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
  // claims_only_update: run 카운트 없이 claims/decisions만 업데이트
  const claimsOnlyUpdate = Boolean(payload?.claims_only_update)

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

    if (!claimsOnlyUpdate) {
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
    }

    // claims: provider가 이번 응답에서 추출된 근거 수 (블렌드 평균)
    const providerClaims = payload?.provider_claims
    if (providerClaims && typeof providerClaims === "object") {
      const claimCount = Math.max(0, Number(providerClaims[provider] ?? -1))
      if (claimCount >= 0) {
        node.avg_claims = node.avg_claims <= 0 ? claimCount : blend(node.avg_claims, claimCount)
      }
    }

    // decisions: provider가 conflict 해소에서 승자로 선택된 횟수 (블렌드 평균)
    const providerDecisions = payload?.provider_decisions
    if (providerDecisions && typeof providerDecisions === "object") {
      const decisionWins = Math.max(0, Number(providerDecisions[provider] ?? -1))
      if (decisionWins >= 0) {
        node.avg_decisions = node.avg_decisions <= 0 ? decisionWins : blend(node.avg_decisions, decisionWins)
      }
    }

    board[provider][task][model] = recalcNode(node)
  }

  saveBoard(board)
  return board
}