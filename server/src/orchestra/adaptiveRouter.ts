import { decayRecentBanditSignals, readRoutingScores } from "./scoreboard.js"

export type AdaptiveTask = "dialogue" | "reasoning" | "research" | "code"

export type ExecutionStrategy =
  | "single_primary"
  | "parallel_primary"
  | "parallel_primary_verifier"

export type AdaptiveRouteDecision = {
  task: AdaptiveTask
  benchmark_mode: boolean
  selected_providers: string[]
  verifier_providers: string[]
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
  if (value.includes("research")) return "research"
  if (value.includes("reasoning")) return "reasoning"

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

function getRoutingRows() {
  decayRecentBanditSignals()
  return readRoutingScores()
}

function rankProviders(task: AdaptiveTask) {
  const ranked = getRoutingRows()
    .filter((x) => ["openai", "claude", "gemini", "perplexity"].includes(x.provider))

  if (task === "code") {
    ranked.sort((a, b) => {
      const weightA = a.provider === "claude" ? 0.08 : a.provider === "openai" ? 0.05 : 0
      const weightB = b.provider === "claude" ? 0.08 : b.provider === "openai" ? 0.05 : 0
      return (b.bandit_score + weightB) - (a.bandit_score + weightA)
    })
  }

  if (task === "research") {
    ranked.sort((a, b) => {
      const weightA = a.provider === "perplexity" ? 0.05 : a.provider === "openai" ? 0.04 : 0
      const weightB = b.provider === "perplexity" ? 0.05 : b.provider === "openai" ? 0.04 : 0
      return (b.bandit_score + weightB) - (a.bandit_score + weightA)
    })
  }

  return ranked
}

function shouldUsePro(task: AdaptiveTask, params: any): boolean {
  if (task !== "reasoning" && task !== "research") return false

  return Boolean(
    params?.force_pro ||
    params?.benchmark_mode ||
    params?.deep_analysis ||
    params?.deep_research
  )
}

function shouldWidenParallel(task: AdaptiveTask, params: any): boolean {
  if (task !== "reasoning" && task !== "research") return false

  return Boolean(
    params?.benchmark_mode ||
    params?.deep_analysis ||
    params?.deep_research ||
    params?.force_pro
  )
}

function buildExecutionPolicy(task: AdaptiveTask, params: any) {
  if (task === "dialogue") {
    return {
      max_parallel: 1,
      cost_gate_enabled: true,
      max_total_estimated_cost_usd: 0.03,
      prefer_fast_fallback: true
    }
  }

  if (task === "code") {
    return {
      max_parallel: 2,
      cost_gate_enabled: true,
      max_total_estimated_cost_usd: 0.06,
      prefer_fast_fallback: false
    }
  }

  if (Boolean(params?.benchmark_mode)) {
    return {
      max_parallel: 3,
      cost_gate_enabled: false,
      max_total_estimated_cost_usd: 0.12,
      prefer_fast_fallback: false
    }
  }

  if (Boolean(params?.deep_analysis || params?.deep_research || params?.force_pro)) {
    return {
      max_parallel: 3,
      cost_gate_enabled: true,
      max_total_estimated_cost_usd: 0.09,
      prefer_fast_fallback: false
    }
  }

  return {
    max_parallel: 2,
    cost_gate_enabled: true,
    max_total_estimated_cost_usd: task === "research" ? 0.07 : 0.06,
    prefer_fast_fallback: true
  }
}

function chooseOpenAIPrimaryOverride(task: AdaptiveTask, params: any, ranked: any[]) {
  if (task === "dialogue") return true
  if (task === "code") return true

  if (Boolean(params?.benchmark_mode || params?.deep_analysis || params?.deep_research || params?.force_pro)) {
    return false
  }

  const openai = ranked.find((x) => x.provider === "openai")
  const best = ranked[0]

  if (!openai || !best) return true
  if (best.provider === "openai") return true

  return (best.bandit_score - openai.bandit_score) < 0.08
}

function fallbackOrder(ranked: any[], excluded: string[], preferFast: boolean): string[] {
  const filtered = ranked.filter((x) => !excluded.includes(x.provider))

  const ordered = [...filtered].sort((a, b) => {
    if (preferFast) {
      if (a.avg_latency !== b.avg_latency) return a.avg_latency - b.avg_latency
      if (a.avg_cost !== b.avg_cost) return a.avg_cost - b.avg_cost
      return b.bandit_score - a.bandit_score
    }

    if (b.bandit_score !== a.bandit_score) return b.bandit_score - a.bandit_score
    if (a.avg_cost !== b.avg_cost) return a.avg_cost - b.avg_cost
    return a.avg_latency - b.avg_latency
  })

  return uniqueProviders(ordered.map((x) => x.provider))
}

export function resolveAdaptiveRoute(params: any): AdaptiveRouteDecision {
  const task = normalizeTask(params?.task)
  const ranked = rankProviders(task)
  const executionPolicy = buildExecutionPolicy(task, params)

  const keepOpenAIPrimary = chooseOpenAIPrimaryOverride(task, params, ranked)
  const bestProvider = ranked[0]?.provider ?? "openai"
  const primaryProvider = keepOpenAIPrimary ? "openai" : bestProvider

  const nonPrimary = ranked.filter((x) => x.provider !== primaryProvider).map((x) => x.provider)
  const widenParallel = shouldWidenParallel(task, params)

  let selectedProviders: string[] = [primaryProvider]
  let verifierProviders: string[] = []

  if (task === "dialogue") {
    verifierProviders = []
  } else if (task === "code") {
    verifierProviders = ["claude"].filter((x) => x !== primaryProvider)
  } else if (widenParallel) {
    selectedProviders = uniqueProviders([primaryProvider, nonPrimary[0]])
    verifierProviders = uniqueProviders([nonPrimary[1]])
  } else {
    verifierProviders = uniqueProviders([nonPrimary[0]])
  }

  const parallelProviders = uniqueProviders([...selectedProviders, ...verifierProviders]).slice(
    0,
    Math.max(1, Number(executionPolicy?.max_parallel ?? 2))
  )

  selectedProviders = selectedProviders.filter((x) => parallelProviders.includes(x))
  verifierProviders = verifierProviders.filter((x) => parallelProviders.includes(x))

  const fallbackProviders = fallbackOrder(
    ranked,
    uniqueProviders([...selectedProviders, ...verifierProviders]),
    executionPolicy.prefer_fast_fallback
  )

  const providerScores = ranked.reduce<Record<string, number>>((acc, row) => {
    acc[row.provider] = Number(row.routing_score.toFixed(4))
    return acc
  }, {})

  const providerCosts = ranked.reduce<Record<string, number>>((acc, row) => {
    acc[row.provider] = Number(row.avg_cost.toFixed(6))
    return acc
  }, {})

  const providerLatency = ranked.reduce<Record<string, number>>((acc, row) => {
    acc[row.provider] = Number(row.avg_latency)
    return acc
  }, {})

  const providerBandit = ranked.reduce<Record<string, {
    routing_score: number
    exploration_bonus: number
    freshness_bonus: number
    bandit_score: number
  }>>((acc, row) => {
    acc[row.provider] = {
      routing_score: Number(row.routing_score.toFixed(4)),
      exploration_bonus: Number(row.exploration_bonus.toFixed(4)),
      freshness_bonus: Number(row.freshness_bonus.toFixed(4)),
      bandit_score: Number(row.bandit_score.toFixed(4))
    }
    return acc
  }, {})

  const executionStrategy: ExecutionStrategy =
    parallelProviders.length <= 1
      ? "single_primary"
      : verifierProviders.length > 0
        ? "parallel_primary_verifier"
        : "parallel_primary"

  return {
    task,
    benchmark_mode: Boolean(params?.benchmark_mode),
    selected_providers: selectedProviders,
    verifier_providers: verifierProviders,
    fallback_providers: fallbackProviders,
    parallel_providers: parallelProviders,
    execution_strategy: executionStrategy,
    parallel_width: parallelProviders.length,
    router_policy: "openai_primary_light_bandit_router",
    provider_scores: providerScores,
    provider_costs: providerCosts,
    provider_latency: providerLatency,
    provider_bandit: providerBandit,
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
