import { decayRecentBanditSignals, readRoutingScores } from "./scoreboard.js"
import { readModelScoreboard } from "./modelScoreboard.js"
import { scoreDynamicRouterProviders } from "./dynamicScoreboardRouter.js"

export type AdaptiveTask = "dialogue" | "reasoning" | "research" | "code" | "long_doc" | "writing"

export type ExecutionStrategy =
  | "single_primary"
  | "parallel_primary"
  | "parallel_primary_verifier"
  | "parallel_primary_verifier_optional"

export type AdaptiveRouteDecision = {
  task: AdaptiveTask
  benchmark_mode: boolean
  selected_providers: string[]
  verifier_providers: string[]
  optional_providers: string[]
  scout_providers: string[]
  fallback_providers: string[]
  parallel_providers: string[]
  execution_strategy: ExecutionStrategy
  parallel_width: number
  router_policy: string
  provider_scores: Record<string, number>
  provider_costs: Record<string, number>
  provider_latency: Record<string, number>
  provider_bandit: Record<string, {
    routing_score: number
    exploration_bonus: number
    freshness_bonus: number
    bandit_score: number
  }>
  dynamic_scores: Record<string, {
    score: number
    breakdown: Record<string, number>
  }>
  execution_policy: {
    max_parallel: number
    cost_gate_enabled: boolean
    max_total_estimated_cost_usd: number
    prefer_fast_fallback: boolean
  }
  escalation: {
    use_pro: boolean
    reason: {
      force_pro: boolean
      benchmark_mode: boolean
      deep_analysis: boolean
      deep_research: boolean
    }
  }
}

function normalizeTask(task: any): AdaptiveTask {
  const value = String(task ?? "").trim().toLowerCase()
  if (value.includes("code")) return "code"
  if (value.includes("long_doc") || value.includes("document")) return "long_doc"
  if (value.includes("writing") || value.includes("creative")) return "writing"
  if (value.includes("reasoning")) return "reasoning"
  if (
    value.includes("research") ||
    value.includes("legal_review") ||
    value.includes("data_analysis") ||
    value.includes("finance_analysis") ||
    value.includes("product_development") ||
    value.includes("deep_research")
  ) return "research"
  return "dialogue"
}

function uniqueProviders(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const normalized = String(value ?? "").trim().toLowerCase()
    if (!normalized) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

// 2026년 3월 벤치마크 기반 태스크별 provider 가중치 (cold-start bias)
// - Claude: SWE-bench 코딩 1위(80.8%), 글쓰기/문서 1위
// - Gemini: ARC-AGI-2 추론 1위(77.1%), 1M 컨텍스트
// - OpenAI: 올라운더, 에이전트 실행(Terminal-Bench 1위)
// - Perplexity: 실시간 리서치 1위, 팩트 정확도 93.9%
const TASK_WEIGHTS: Record<string, Record<string, number>> = {
  code:      { claude: 0.12, openai: 0.06, gemini: 0.01, perplexity: 0.00 },
  writing:   { claude: 0.14, openai: 0.04, gemini: 0.02, perplexity: 0.00 },
  dialogue:  { claude: 0.12, openai: 0.08, gemini: 0.02, perplexity: 0.01 },
  reasoning: { openai: 0.12, claude: 0.08, gemini: 0.06, perplexity: 0.00 },
  research:  { perplexity: 0.12, claude: 0.07, openai: 0.05, gemini: 0.03 },
  long_doc:  { claude: 0.14, gemini: 0.08, openai: 0.03, perplexity: 0.01 }
}

// modelScoreboard provider+task 노드 집계 → DynamicRouterMetrics 형식 변환
function buildDynamicMetrics(
  provider: string,
  task: AdaptiveTask,
  board: any,
  routingRow: any
): any {
  const taskBoard = board?.[provider]?.[task] ?? {}
  const modelNodes = Object.values(taskBoard) as any[]

  if (modelNodes.length === 0) {
    return {
      latency_ms: 0,
      success: 0.5,
      quality: 0.5,
      claims: 0,
      conflicts: (routingRow?.context_conflicts_recent ?? 0) + (routingRow?.provider_conflicts_recent ?? 0),
      decisions: 0,
      fallback_rate: routingRow?.recent_uses > 0
        ? Math.max(0, 1 - (routingRow.recent_wins ?? 0) / routingRow.recent_uses)
        : 0.1,
      runs: 0,
      cost_efficiency: 0.5,
      avg_cost_usd: 0,
      avg_cost_per_1k_tokens_usd: 0,
      avg_tokens: 0,
      recent_success_rate: 0.5,
      recent_win_rate: 0.5,
      recent_avg_latency: 0,
      recent_avg_cost_usd: 0,
      recent_avg_tokens: 0,
      recent_win_streak: 0,
      freshness_score: 0.5
    }
  }

  const totalRuns = modelNodes.reduce((s, n) => s + (n.runs ?? 0), 0)

  function wavg(field: string, fallback = 0) {
    if (totalRuns <= 0) return fallback
    return modelNodes.reduce((s, n) => s + ((n[field] ?? 0) * (n.runs ?? 0)), 0) / totalRuns
  }

  function wavgRecentRuns(field: string, fallback = 0) {
    const totalRecent = modelNodes.reduce((s, n) => s + (n.recent_runs ?? n.runs ?? 0), 0)
    if (totalRecent <= 0) return fallback
    return modelNodes.reduce((s, n) => {
      const w = n.recent_runs ?? n.runs ?? 0
      return s + ((n[field] ?? 0) * w)
    }, 0) / totalRecent
  }

  const maxRecentWinStreak = modelNodes.reduce((m, n) => Math.max(m, n.recent_win_streak ?? 0), 0)
  const maxFreshnessScore = modelNodes.reduce((m, n) => Math.max(m, n.freshness_score ?? 0), 0)

  return {
    latency_ms: wavg("avg_latency", 0),
    success: wavg("success_rate", 0.5),
    quality: wavg("win_rate", 0.5),
    claims: wavg("avg_claims", 0),
    conflicts: (routingRow?.context_conflicts_recent ?? 0) + (routingRow?.provider_conflicts_recent ?? 0),
    decisions: wavg("avg_decisions", 0),
    fallback_rate: routingRow?.recent_uses > 0
      ? Math.max(0, 1 - (routingRow.recent_wins ?? 0) / routingRow.recent_uses)
      : 0.1,
    runs: totalRuns,
    cost_efficiency: wavg("cost_efficiency", 0.5),
    avg_cost_usd: wavg("avg_cost_usd", 0),
    avg_cost_per_1k_tokens_usd: wavg("avg_cost_per_1k_tokens_usd", 0),
    avg_tokens: wavg("avg_tokens", 0),
    recent_success_rate: wavgRecentRuns("recent_success_rate", 0.5),
    recent_win_rate: wavgRecentRuns("recent_win_rate", 0.5),
    recent_avg_latency: wavgRecentRuns("recent_avg_latency", 0),
    recent_avg_cost_usd: wavgRecentRuns("recent_avg_cost_usd", 0),
    recent_avg_tokens: wavgRecentRuns("recent_avg_tokens", 0),
    recent_win_streak: maxRecentWinStreak,
    freshness_score: maxFreshnessScore
  }
}

// dynamic_scoreboard_router_v4
// 1. scoreDynamicRouterProviders (12개 지표 가중 합산) 기반 순위
// 2. TASK_WEIGHTS cold-start bias 가산 (data 없을 때 초기 순서 결정)
// 3. 데이터 쌓일수록 실적 기반으로 자연 수렴
function rankProviders(task: AdaptiveTask) {
  decayRecentBanditSignals()
  const routingRows = readRoutingScores(task)
    .filter((x) => ["openai", "claude", "gemini", "perplexity"].includes(x.provider))

  const modelBoard = readModelScoreboard()
  const weights = TASK_WEIGHTS[task] ?? TASK_WEIGHTS["dialogue"]

  const providerMetrics = routingRows.map((row) => ({
    provider: row.provider,
    metrics: buildDynamicMetrics(row.provider, task, modelBoard, row)
  }))

  const dynamicScored = scoreDynamicRouterProviders({ task, providers: providerMetrics })
  const dynamicMap = new Map(dynamicScored.map((d) => [d.provider, d]))

  const merged = routingRows.map((row) => {
    const dyn = dynamicMap.get(row.provider)
    const dynamicScore = dyn ? dyn.score : 0
    // cold-start bias: TASK_WEIGHTS * 100 (0~14 / 0~1000 scale)
    const taskBias = (weights[row.provider] ?? 0) * 100
    return {
      ...row,
      dynamic_score: dynamicScore,
      dynamic_breakdown: dyn?.breakdown ?? null,
      combined_score: dynamicScore + taskBias
    }
  })

  merged.sort((a, b) => b.combined_score - a.combined_score)
  return merged
}

function shouldUsePro(task: AdaptiveTask, params: any): boolean {
  if (params?.force_pro) return true
  if (task !== "reasoning" && task !== "research") return false
  return Boolean(params?.benchmark_mode || params?.deep_analysis || params?.deep_research)
}

function buildExecutionPolicy(task: AdaptiveTask, params: any) {
  if (task === "dialogue") {
    return { max_parallel: 2, cost_gate_enabled: true, max_total_estimated_cost_usd: 0.05, prefer_fast_fallback: true }
  }
  if (task === "writing") {
    return { max_parallel: 2, cost_gate_enabled: true, max_total_estimated_cost_usd: 0.06, prefer_fast_fallback: false }
  }
  if (task === "long_doc") {
    return { max_parallel: 2, cost_gate_enabled: true, max_total_estimated_cost_usd: 0.10, prefer_fast_fallback: false }
  }
  if (task === "code") {
    return { max_parallel: 2, cost_gate_enabled: true, max_total_estimated_cost_usd: 0.06, prefer_fast_fallback: false }
  }
  if (Boolean(params?.benchmark_mode)) {
    return {
      max_parallel: task === "research" ? 4 : 3,
      cost_gate_enabled: false,
      max_total_estimated_cost_usd: task === "research" ? 0.14 : 0.12,
      prefer_fast_fallback: false
    }
  }
  if (Boolean(params?.deep_analysis || params?.deep_research || params?.force_pro)) {
    return {
      max_parallel: task === "research" ? 4 : 3,
      cost_gate_enabled: true,
      max_total_estimated_cost_usd: task === "research" ? 0.1 : 0.09,
      prefer_fast_fallback: false
    }
  }
  if (task === "research") {
    return { max_parallel: 3, cost_gate_enabled: true, max_total_estimated_cost_usd: 0.07, prefer_fast_fallback: true }
  }
  return { max_parallel: 2, cost_gate_enabled: true, max_total_estimated_cost_usd: 0.06, prefer_fast_fallback: true }
}

function fallbackOrder(ranked: any[], excluded: string[], preferFast: boolean): string[] {
  const filtered = ranked.filter((x) => !excluded.includes(x.provider))
  const ordered = [...filtered].sort((a, b) => {
    if (preferFast) {
      if (a.avg_latency !== b.avg_latency) return a.avg_latency - b.avg_latency
      if (a.avg_cost !== b.avg_cost) return a.avg_cost - b.avg_cost
      return b.combined_score - a.combined_score
    }
    if (b.combined_score !== a.combined_score) return b.combined_score - a.combined_score
    if (a.avg_cost !== b.avg_cost) return a.avg_cost - b.avg_cost
    return a.avg_latency - b.avg_latency
  })
  return uniqueProviders(ordered.map((x) => x.provider))
}

// Dynamic chooseRoles — dynamic_scoreboard_router_v4
// combined_score(dynamic 12지표 + cold-start bias) 1위 provider 자동 배정
// 예외: research → perplexity 고정 primary (실시간 검색 전용)
function chooseRoles(task: AdaptiveTask, ranked: any[], params: any) {
  const allowOptional = Boolean(
    params?.benchmark_mode ||
    params?.deep_analysis ||
    params?.deep_research ||
    params?.force_pro ||
    params?.structured_output
  )

  if (task === "research") {
    return {
      selected_providers: ["perplexity"],
      verifier_providers: ["claude"],
      optional_providers: allowOptional ? ["openai"] : [],
      scout_providers: []
    }
  }

  const available = ranked.map((r) => r.provider)
  const primary = available[0] ?? "openai"
  const verifier = available.find((p) => p !== primary) ?? null
  const optionalCandidate = allowOptional
    ? available.find((p) => p !== primary && p !== verifier) ?? null
    : null

  return {
    selected_providers: [primary],
    verifier_providers: verifier ? [verifier] : [],
    optional_providers: optionalCandidate ? [optionalCandidate] : [],
    scout_providers: []
  }
}

export function resolveAdaptiveRoute(params: any): AdaptiveRouteDecision {
  const task = normalizeTask(params?.task)
  const ranked = rankProviders(task)

  // _single_provider_override: 벤치마크 단일 모델 비교 전용
  if (params?._single_provider_override) {
    const singleProvider = String(params._single_provider_override).trim().toLowerCase()
    const pScores = ranked.reduce<Record<string, number>>((acc, row) => {
      acc[row.provider] = Number(row.routing_score.toFixed(4)); return acc
    }, {})
    const pCosts = ranked.reduce<Record<string, number>>((acc, row) => {
      acc[row.provider] = Number(row.avg_cost.toFixed(6)); return acc
    }, {})
    const pLatency = ranked.reduce<Record<string, number>>((acc, row) => {
      acc[row.provider] = Number(row.avg_latency); return acc
    }, {})
    const pBandit = ranked.reduce<Record<string, {
      routing_score: number; exploration_bonus: number; freshness_bonus: number; bandit_score: number
    }>>((acc, row) => {
      acc[row.provider] = {
        routing_score: Number(row.routing_score.toFixed(4)),
        exploration_bonus: Number(row.exploration_bonus.toFixed(4)),
        freshness_bonus: Number(row.freshness_bonus.toFixed(4)),
        bandit_score: Number(row.bandit_score.toFixed(4))
      }; return acc
    }, {})
    const pDynamic = ranked.reduce<Record<string, { score: number; breakdown: Record<string, number> }>>((acc, row) => {
      acc[row.provider] = {
        score: Number((row.dynamic_score ?? 0).toFixed(2)),
        breakdown: row.dynamic_breakdown ?? {}
      }; return acc
    }, {})
    return {
      task,
      benchmark_mode: false,
      selected_providers: [singleProvider],
      verifier_providers: [],
      optional_providers: [],
      scout_providers: [],
      fallback_providers: [],
      parallel_providers: [singleProvider],
      execution_strategy: "single_primary",
      parallel_width: 1,
      router_policy: "single_provider_override",
      provider_scores: pScores,
      provider_costs: pCosts,
      provider_latency: pLatency,
      provider_bandit: pBandit,
      dynamic_scores: pDynamic,
      execution_policy: {
        max_parallel: 1,
        cost_gate_enabled: true,
        max_total_estimated_cost_usd: 0.05,
        prefer_fast_fallback: false
      },
      escalation: {
        use_pro: false,
        reason: { force_pro: false, benchmark_mode: false, deep_analysis: false, deep_research: false }
      }
    }
  }

  const executionPolicy = buildExecutionPolicy(task, params)
  const roles = chooseRoles(task, ranked, params)

  const parallelProviders = uniqueProviders([
    ...roles.selected_providers,
    ...roles.verifier_providers,
    ...roles.optional_providers,
    ...roles.scout_providers
  ]).slice(0, Math.max(1, Number(executionPolicy?.max_parallel ?? 2)))

  const selectedProviders = roles.selected_providers.filter((x) => parallelProviders.includes(x))
  const verifierProviders = roles.verifier_providers.filter((x) => parallelProviders.includes(x))
  const optionalProviders = roles.optional_providers.filter((x) => parallelProviders.includes(x))
  const scoutProviders = roles.scout_providers.filter((x) => parallelProviders.includes(x))

  const fallbackProviders = fallbackOrder(
    ranked,
    uniqueProviders([...selectedProviders, ...verifierProviders, ...optionalProviders, ...scoutProviders]),
    executionPolicy.prefer_fast_fallback
  )

  const providerScores = ranked.reduce<Record<string, number>>((acc, row) => {
    acc[row.provider] = Number(row.routing_score.toFixed(4)); return acc
  }, {})
  const providerCosts = ranked.reduce<Record<string, number>>((acc, row) => {
    acc[row.provider] = Number(row.avg_cost.toFixed(6)); return acc
  }, {})
  const providerLatency = ranked.reduce<Record<string, number>>((acc, row) => {
    acc[row.provider] = Number(row.avg_latency); return acc
  }, {})
  const providerBandit = ranked.reduce<Record<string, {
    routing_score: number; exploration_bonus: number; freshness_bonus: number; bandit_score: number
  }>>((acc, row) => {
    acc[row.provider] = {
      routing_score: Number(row.routing_score.toFixed(4)),
      exploration_bonus: Number(row.exploration_bonus.toFixed(4)),
      freshness_bonus: Number(row.freshness_bonus.toFixed(4)),
      bandit_score: Number(row.bandit_score.toFixed(4))
    }; return acc
  }, {})
  const dynamicScores = ranked.reduce<Record<string, { score: number; breakdown: Record<string, number> }>>((acc, row) => {
    acc[row.provider] = {
      score: Number((row.dynamic_score ?? 0).toFixed(2)),
      breakdown: row.dynamic_breakdown ?? {}
    }; return acc
  }, {})

  const hasVerifier = verifierProviders.length > 0
  const hasOptional = optionalProviders.length > 0 || scoutProviders.length > 0
  const executionStrategy: ExecutionStrategy =
    parallelProviders.length <= 1
      ? "single_primary"
      : hasVerifier && hasOptional
        ? "parallel_primary_verifier_optional"
        : hasVerifier
          ? "parallel_primary_verifier"
          : "parallel_primary"

  return {
    task,
    benchmark_mode: Boolean(params?.benchmark_mode),
    selected_providers: selectedProviders,
    verifier_providers: verifierProviders,
    optional_providers: optionalProviders,
    scout_providers: scoutProviders,
    fallback_providers: fallbackProviders,
    parallel_providers: parallelProviders,
    execution_strategy: executionStrategy,
    parallel_width: parallelProviders.length,
    router_policy: "dynamic_scoreboard_router_v4",
    provider_scores: providerScores,
    provider_costs: providerCosts,
    provider_latency: providerLatency,
    provider_bandit: providerBandit,
    dynamic_scores: dynamicScores,
    execution_policy: executionPolicy,
    escalation: {
      use_pro: shouldUsePro(task, params),
      reason: {
        force_pro: Boolean(params?.force_pro),
        benchmark_mode: Boolean(params?.benchmark_mode),
        deep_analysis: Boolean(params?.deep_analysis),
        deep_research: Boolean(params?.deep_research)
      }
    }
  }
}
