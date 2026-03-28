import { decayRecentBanditSignals, readRoutingScores } from "./scoreboard.js"

export type AdaptiveTask = "dialogue" | "reasoning" | "research" | "code"

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

function getRoutingRows(task: AdaptiveTask) {
  decayRecentBanditSignals()
  return readRoutingScores(task)
}

function rankProviders(task: AdaptiveTask) {
  const ranked = getRoutingRows(task)
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
      const weightA =
        a.provider === "openai" ? 0.07 :
        a.provider === "claude" ? 0.04 :
        a.provider === "perplexity" ? 0.035 :
        a.provider === "gemini" ? 0.025 : 0

      const weightB =
        b.provider === "openai" ? 0.07 :
        b.provider === "claude" ? 0.04 :
        b.provider === "perplexity" ? 0.035 :
        b.provider === "gemini" ? 0.025 : 0

      return (b.bandit_score + weightB) - (a.bandit_score + weightA)
    })
  }

  if (task === "reasoning") {
    ranked.sort((a, b) => {
      const weightA =
        a.provider === "openai" ? 0.07 :
        a.provider === "claude" ? 0.04 :
        a.provider === "gemini" ? 0.02 : 0

      const weightB =
        b.provider === "openai" ? 0.07 :
        b.provider === "claude" ? 0.04 :
        b.provider === "gemini" ? 0.02 : 0

      return (b.bandit_score + weightB) - (a.bandit_score + weightA)
    })
  }

  return ranked
}

function shouldUsePro(task: AdaptiveTask, params: any): boolean {
  if (Boolean(params?.force_pro)) return true
  if (task !== "reasoning" && task !== "research") return false

  return Boolean(
    params?.benchmark_mode ||
    params?.deep_analysis ||
    params?.deep_research
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
    return {
      max_parallel: 3,
      cost_gate_enabled: true,
      max_total_estimated_cost_usd: 0.07,
      prefer_fast_fallback: true
    }
  }

  return {
    max_parallel: 2,
    cost_gate_enabled: true,
    max_total_estimated_cost_usd: 0.06,
    prefer_fast_fallback: true
  }
}

function chooseOpenAIPrimaryOverride(task: AdaptiveTask, params: any, ranked: any[]) {
  if (task === "dialogue") return true
  if (task === "code") return false  // Claude primary
  if (task === "reasoning") return true
  if (task === "research") return false  // Perplexity primary

  if (Boolean(params?.force_primary_provider) && String(params.force_primary_provider).trim().toLowerCase() !== "openai") {
    return false
  }

  const openai = ranked.find((x) => x.provider === "openai")
  const best = ranked[0]

  if (!openai || !best) return true
  if (best.provider === "openai") return true

  return (best.bandit_score - openai.bandit_score) < 0.15
}

function pickTopAvailable(ranked: any[], excluded: string[], preferredOrder: string[]) {
  for (const provider of preferredOrder) {
    const normalized = String(provider ?? "").trim().toLowerCase()
    if (!normalized) continue
    if (excluded.includes(normalized)) continue
    if (ranked.some((row) => row.provider === normalized)) return normalized
  }

  const next = ranked.find((row) => !excluded.includes(row.provider))
  return next?.provider ?? null
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

function chooseRoles(task: AdaptiveTask, ranked: any[], params: any) {
  // force_pro일 때 reasoning으로 강제 + verifier 보장
  if (Boolean(params?.force_pro) && task !== "code" && task !== "research") {
    const primaryProvider = "openai"
    const excluded = uniqueProviders([primaryProvider])
    const verifier = pickTopAvailable(ranked, excluded, ["claude", "gemini", "perplexity"])
    const optionalExcluded = uniqueProviders([...excluded, ...(verifier ? [verifier] : [])])
    const optional = pickTopAvailable(ranked, optionalExcluded, ["gemini", "claude", "perplexity"])
    return {
      selected_providers: [primaryProvider],
      verifier_providers: verifier ? [verifier] : [],
      optional_providers: optional ? [optional] : [],
      scout_providers: []
    }
  }

  const keepOpenAIPrimary = chooseOpenAIPrimaryOverride(task, params, ranked)
  const bestProvider = ranked[0]?.provider ?? "openai"
  const primaryProvider = keepOpenAIPrimary ? "openai" : bestProvider

  const excludedBase = uniqueProviders([primaryProvider])

  if (task === "dialogue") {
    return {
      selected_providers: [primaryProvider],
      verifier_providers: [],
      optional_providers: [],
      scout_providers: []
    }
  }

  if (task === "code") {
    // code는 Claude 강제 primary
    const codePrimary = "claude"
    const codeExcluded = uniqueProviders([codePrimary])
    const verifier = pickTopAvailable(ranked, codeExcluded, ["openai", "gemini", "perplexity"])
    return {
      selected_providers: [codePrimary],
      verifier_providers: verifier ? [verifier] : [],
      optional_providers: [],
      scout_providers: []
    }
  }

  if (task === "reasoning") {
    if (Boolean(params?.deep_analysis || params?.force_pro)) {
      const verifier = pickTopAvailable(ranked, excludedBase, ["claude", "gemini", "perplexity"])
      return {
        selected_providers: [primaryProvider],
        verifier_providers: verifier ? [verifier] : [],
        optional_providers: [],
        scout_providers: []
      }
    }
    return {
      selected_providers: [primaryProvider],
      verifier_providers: [],
      optional_providers: [],
      scout_providers: []
    }
  }

  // research: Perplexity primary + OpenAI synthesis verifier
  const researchPrimary = "perplexity"
  const researchExcluded = uniqueProviders([researchPrimary])
  const researchVerifier = "openai"

  return {
    selected_providers: [researchPrimary],
    verifier_providers: [researchVerifier],
    optional_providers: [],
    scout_providers: []
  }
}

export function resolveAdaptiveRoute(params: any): AdaptiveRouteDecision {
  const task = normalizeTask(params?.task)
  const ranked = rankProviders(task)
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
    uniqueProviders([
      ...selectedProviders,
      ...verifierProviders,
      ...optionalProviders,
      ...scoutProviders
    ]),
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
    router_policy: "openai_primary_role_aware_bandit_router",
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

