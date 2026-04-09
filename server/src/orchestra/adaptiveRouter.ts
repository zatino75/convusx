import { decayRecentBanditSignals, readRoutingScores } from "./scoreboard.js"
import type { CanonicalTask, CodeSubtask as _CodeSubtask } from "../types/tasks.js"
import { HIGH_STAKES_TASKS } from "../types/tasks.js"
import { logger } from "../observability/logger.js"

export type AdaptiveTask = CanonicalTask
export type CodeSubtask = _CodeSubtask | "code_review"

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
  dynamic_scores?: Record<string, number>
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
  const value = String(task ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")
  if (!value) return "dialogue"
  if (value === "code_refactor" || value === "code_review" || value === "code_refactor/review") return "code_refactor_review"
  if (value === "code_implement" || value === "code_debug" || value === "code_refactor_review") return value as AdaptiveTask
  if (value === "writing_creative" || value === "writing_business") return value as AdaptiveTask
  if (value === "word" || value === "document" || value === "doc") return "word"
  if (value === "sheet" || value === "spreadsheet") return "excel"
  if (value === "slides" || value === "presentation") return "ppt"
  if (["dialogue", "reasoning", "research", "code", "long_doc", "writing", "excel", "word", "ppt", "pdf", "legal_review", "data_analysis", "finance_analysis", "product_development"].includes(value)) {
    return value as AdaptiveTask
  }
  if (value.includes("long_doc")) return "long_doc"
  if (value.includes("writing_creative") || value.includes("creative")) return "writing_creative"
  if (value.includes("writing_business")) return "writing_business"
  if (value.startsWith("writing")) return "writing"
  if (value.includes("legal")) return "legal_review"
  if (value.includes("finance")) return "finance_analysis"
  if (value.includes("data")) return "data_analysis"
  if (value.includes("product")) return "product_development"
  if (value.includes("research") || value.includes("deep_research")) return "research"
  if (value.includes("reasoning")) return "reasoning"
  if (value.includes("code")) return "code"
  return "dialogue"
}

function normalizeCodeSubtask(value: any): CodeSubtask | null {
  const text = String(value ?? "").trim().toLowerCase()
  if (!text) return null
  if (text.includes("review")) return "code_review"
  if (text.includes("refactor")) return "code_refactor_review"
  if (text.includes("debug") || text.includes("fix")) return "code_debug"
  if (text.includes("implement")) return "code_implement"
  return null
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

// A안: Claude primary(대화/코드/글쓰기), Gemini Pro(추론), OpenAI(법률/재무/데이터), Gemini Flash(Judge)
// 벤치마크 근거: Arena Elo, GPQA, SWE-bench, 블라인드 라이팅 테스트 (2026.04)
const TASK_WEIGHTS: Record<AdaptiveTask, Record<string, number>> = {
  dialogue:             { claude: 0.14, openai: 0.10, gemini: 0.02, perplexity: 0.01 },
  reasoning:            { gemini: 0.16, openai: 0.10, claude: 0.08, perplexity: 0.00 },
  research:             { perplexity: 0.16, claude: 0.10, openai: 0.08, gemini: 0.03 },
  code:                 { claude: 0.16, openai: 0.10, gemini: 0.01, perplexity: 0.00 },
  code_implement:       { claude: 0.16, openai: 0.10, gemini: 0.01, perplexity: 0.00 },
  code_debug:           { claude: 0.16, openai: 0.10, gemini: 0.01, perplexity: 0.00 },
  code_refactor_review: { claude: 0.16, openai: 0.10, gemini: 0.02, perplexity: 0.00 },
  writing:              { claude: 0.15, openai: 0.10, gemini: 0.02, perplexity: 0.00 },
  writing_creative:     { claude: 0.16, openai: 0.09, gemini: 0.02, perplexity: 0.00 },
  writing_business:     { claude: 0.15, openai: 0.11, gemini: 0.03, perplexity: 0.00 },
  long_doc:             { claude: 0.16, openai: 0.08, gemini: 0.05, perplexity: 0.01 },
  excel:                { openai: 0.15, claude: 0.08, gemini: 0.07, perplexity: 0.00 },
  word:                 { claude: 0.14, openai: 0.10, gemini: 0.04, perplexity: 0.00 },
  ppt:                  { claude: 0.14, openai: 0.10, gemini: 0.08, perplexity: 0.00 },
  pdf:                  { claude: 0.14, openai: 0.08, gemini: 0.06, perplexity: 0.00 },
  legal_review:         { openai: 0.16, claude: 0.10, gemini: 0.02, perplexity: 0.02 },
  data_analysis:        { openai: 0.16, claude: 0.09, gemini: 0.03, perplexity: 0.02 },
  finance_analysis:     { openai: 0.16, claude: 0.09, gemini: 0.03, perplexity: 0.02 },
  product_development:  { claude: 0.15, openai: 0.10, gemini: 0.03, perplexity: 0.02 },
  generic:              { claude: 0.12, openai: 0.10, gemini: 0.04, perplexity: 0.01 },
  deep_research:        { perplexity: 0.18, claude: 0.10, openai: 0.08, gemini: 0.04 },
  evidence:             { perplexity: 0.14, openai: 0.10, claude: 0.08, gemini: 0.04 }
}

function rankProviders(task: AdaptiveTask) {
  const ranked = getRoutingRows(task)
    .filter((x) => ["openai", "claude", "gemini", "perplexity"].includes(x.provider))

  const weights = TASK_WEIGHTS[task] ?? TASK_WEIGHTS.dialogue

  ranked.sort((a, b) => {
    const wA = weights[a.provider] ?? 0
    const wB = weights[b.provider] ?? 0
    return (b.bandit_score + wB) - (a.bandit_score + wA)
  })

  return ranked
}

function shouldUsePro(task: AdaptiveTask, params: any): boolean {
  // 명시적 pro 요청
  if (params?.force_pro || params?.benchmark_mode || params?.deep_analysis || params?.deep_research) {
    return true
  }
  // HIGH_STAKES_TASKS에서 자동 에스컬레이션 (reasoning, code_implement, legal_review 등)
  if (HIGH_STAKES_TASKS.has(task as CanonicalTask)) {
    return true
  }
  return false
}

function buildExecutionPolicy(task: AdaptiveTask, params: any) {
  const allowOptional = Boolean(params?.benchmark_mode || params?.deep_analysis || params?.deep_research || params?.force_pro)

  if (task === "dialogue") {
    return { max_parallel: 2, cost_gate_enabled: true, max_total_estimated_cost_usd: 0.05, prefer_fast_fallback: true }
  }

  if (task === "writing" || task === "writing_creative" || task === "writing_business") {
    return { max_parallel: 2, cost_gate_enabled: true, max_total_estimated_cost_usd: 0.06, prefer_fast_fallback: false }
  }

  if (task === "long_doc") {
    return { max_parallel: 2, cost_gate_enabled: true, max_total_estimated_cost_usd: 0.10, prefer_fast_fallback: false }
  }

  if (task === "code") {
    return { max_parallel: 2, cost_gate_enabled: true, max_total_estimated_cost_usd: 0.07, prefer_fast_fallback: false }
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
      max_total_estimated_cost_usd: task === "research" ? 0.10 : 0.09,
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
      return b.bandit_score - a.bandit_score
    }

    if (b.bandit_score !== a.bandit_score) return b.bandit_score - a.bandit_score
    if (a.avg_cost !== b.avg_cost) return a.avg_cost - b.avg_cost
    return a.avg_latency - b.avg_latency
  })

  return uniqueProviders(ordered.map((x) => x.provider))
}

function findAvailable(available: string[], preferred: string[], excluded: string[] = []) {
  for (const provider of preferred) {
    const normalized = String(provider ?? "").trim().toLowerCase()
    if (!normalized) continue
    if (excluded.includes(normalized)) continue
    if (available.includes(normalized)) return normalized
  }
  return available.find((provider) => !excluded.includes(provider)) ?? null
}

function chooseRoles(task: AdaptiveTask, ranked: any[], params: any) {
  const allowOptional = Boolean(
    params?.benchmark_mode ||
    params?.deep_analysis ||
    params?.deep_research ||
    params?.force_pro
  )

  const available = ranked.map((r) => r.provider)
  const codeSubtask = normalizeCodeSubtask(params?.code_subtask)

  // ── Memory-based provider hint: 과거 승자 기반 soft preference ──
  const preferredProvider = params?.preferred_provider
    ? String(params.preferred_provider).trim().toLowerCase()
    : null
  const withHint = (providers: string[]) => {
    if (!preferredProvider) return providers
    const hinted = [preferredProvider, ...providers]
    // 힌트 provider가 available에 없으면 fallthrough 로깅
    if (!available.includes(preferredProvider)) {
      logger.info("[adaptiveRouter] preferred_provider not available, falling through", { preferred: preferredProvider, task, available })
    }
    return hinted
  }

  if (task === "research") {
    return {
      selected_providers: [findAvailable(available, withHint(["perplexity", "openai"])) ?? "perplexity"],
      verifier_providers: [findAvailable(available, ["claude"], ["perplexity"])].filter(Boolean),
      optional_providers: [],
      scout_providers: []
    }
  }

  // dialogue: Claude primary, OpenAI verifier — 항상 병렬
  if (task === "dialogue") {
    return {
      selected_providers: [findAvailable(available, withHint(["claude", "openai"])) ?? "claude"],
      verifier_providers: [findAvailable(available, ["openai", "claude"], ["claude"])].filter(Boolean),
      optional_providers: [],
      scout_providers: []
    }
  }

  // reasoning: Gemini Pro primary (GPQA 94.3% 1위), Claude verifier
  if (task === "reasoning") {
    return {
      selected_providers: [findAvailable(available, withHint(["gemini", "openai", "claude"])) ?? "gemini"],
      verifier_providers: [findAvailable(available, ["claude", "openai"], [findAvailable(available, withHint(["gemini", "openai", "claude"])) ?? "gemini"])].filter(Boolean),
      optional_providers: allowOptional ? [findAvailable(available, ["openai"], ["gemini", "claude"])].filter(Boolean) : [],
      scout_providers: []
    }
  }

  // writing_creative: Claude primary, OpenAI verifier
  if (task === "writing_creative" || task === "writing") {
    return {
      selected_providers: [findAvailable(available, withHint(["claude", "openai"])) ?? "claude"],
      verifier_providers: [findAvailable(available, ["openai", "claude"], ["claude"])].filter(Boolean),
      optional_providers: allowOptional ? [findAvailable(available, ["gemini"], ["claude", "openai"])].filter(Boolean) : [],
      scout_providers: []
    }
  }

  // writing_business: Claude primary, OpenAI verifier
  if (task === "writing_business") {
    return {
      selected_providers: [findAvailable(available, withHint(["claude", "openai"])) ?? "claude"],
      verifier_providers: [findAvailable(available, ["openai", "claude"], ["claude"])].filter(Boolean),
      optional_providers: allowOptional ? [findAvailable(available, ["gemini"], ["claude", "openai"])].filter(Boolean) : [],
      scout_providers: []
    }
  }

  // long_doc: Claude primary (128K 출력, 장문 1위), OpenAI verifier
  if (task === "long_doc") {
    return {
      selected_providers: [findAvailable(available, withHint(["claude", "openai"])) ?? "claude"],
      verifier_providers: [findAvailable(available, ["openai", "claude"], ["claude"])].filter(Boolean),
      optional_providers: [],
      scout_providers: []
    }
  }

  // code subtask 직접 처리 (planner가 code_implement/debug/refactor_review로 분류한 경우)
  if (task === "code_implement") {
    return {
      selected_providers: [findAvailable(available, withHint(["claude", "openai"])) ?? "claude"],
      verifier_providers: [findAvailable(available, ["openai", "claude"], ["claude"])].filter(Boolean),
      optional_providers: [],
      scout_providers: []
    }
  }

  // code_debug: Claude primary (SWE-bench 80.8% 1위), OpenAI verifier
  if (task === "code_debug") {
    return {
      selected_providers: [findAvailable(available, withHint(["claude", "openai"])) ?? "claude"],
      verifier_providers: [findAvailable(available, ["openai", "claude"], ["claude"])].filter(Boolean),
      optional_providers: [],
      scout_providers: []
    }
  }

  if (task === "code_refactor_review") {
    return {
      selected_providers: [findAvailable(available, withHint(["claude", "openai"])) ?? "claude"],
      verifier_providers: [findAvailable(available, ["openai", "claude"], ["claude"])].filter(Boolean),
      optional_providers: allowOptional ? [findAvailable(available, ["gemini"], ["claude", "openai"])].filter(Boolean) : [],
      scout_providers: []
    }
  }

  if (task === "code") {
    if (codeSubtask === "code_debug") {
      return {
        selected_providers: [findAvailable(available, withHint(["openai", "claude"])) ?? "openai"],
        verifier_providers: [findAvailable(available, ["claude", "openai"], ["openai"])].filter(Boolean),
        optional_providers: [],
        scout_providers: []
      }
    }

    if (codeSubtask === "code_refactor_review" || codeSubtask === "code_review") {
      return {
        selected_providers: [findAvailable(available, withHint(["claude", "openai"])) ?? "claude"],
        verifier_providers: [findAvailable(available, ["openai", "claude"], ["claude"])].filter(Boolean),
        optional_providers: allowOptional ? [findAvailable(available, ["gemini"], ["claude", "openai"])].filter(Boolean) : [],
        scout_providers: []
      }
    }

    // code 기본(implement): Claude primary, OpenAI verifier
    return {
      selected_providers: [findAvailable(available, withHint(["claude", "openai"])) ?? "claude"],
      verifier_providers: [findAvailable(available, ["openai", "claude"], ["claude"])].filter(Boolean),
      optional_providers: [],
      scout_providers: []
    }
  }

  if (task === "legal_review") {
    return {
      selected_providers: [findAvailable(available, withHint(["openai", "claude"])) ?? "openai"],
      verifier_providers: [findAvailable(available, ["claude", "openai"], ["openai"])].filter(Boolean),
      optional_providers: allowOptional ? [findAvailable(available, ["perplexity"], ["openai", "claude"])].filter(Boolean) : [],
      scout_providers: []
    }
  }

  if (task === "data_analysis" || task === "finance_analysis") {
    return {
      selected_providers: [findAvailable(available, withHint(["openai", "claude"])) ?? "openai"],
      verifier_providers: [findAvailable(available, ["claude", "openai"], ["openai"])].filter(Boolean),
      optional_providers: allowOptional ? [findAvailable(available, ["gemini"], ["openai", "claude"])].filter(Boolean) : [],
      scout_providers: []
    }
  }

  if (task === "product_development") {
    return {
      selected_providers: [findAvailable(available, withHint(["claude", "openai"])) ?? "claude"],
      verifier_providers: [findAvailable(available, ["openai", "claude"], ["claude"])].filter(Boolean),
      optional_providers: allowOptional ? [findAvailable(available, ["perplexity"], ["claude", "openai"])].filter(Boolean) : [],
      scout_providers: []
    }
  }

  // ── Office: OpenAI 생성 ──
  if (task === "excel") return { selected_providers: [findAvailable(available, withHint(["openai", "claude"])) ?? "openai"], verifier_providers: [findAvailable(available, ["claude", "gemini"], ["openai"])].filter(Boolean), optional_providers: [], scout_providers: [] }
  if (task === "word")  return { selected_providers: [findAvailable(available, withHint(["claude", "openai"])) ?? "claude"], verifier_providers: [findAvailable(available, ["openai", "claude"], ["claude"])].filter(Boolean), optional_providers: [], scout_providers: [] }
  if (task === "ppt")   return { selected_providers: [findAvailable(available, withHint(["claude", "openai"])) ?? "claude"], verifier_providers: [findAvailable(available, ["openai", "gemini"], ["claude"])].filter(Boolean), optional_providers: [], scout_providers: [] }
  if (task === "pdf")   return { selected_providers: [findAvailable(available, withHint(["claude", "openai"])) ?? "claude"], verifier_providers: [findAvailable(available, ["openai", "claude"], ["claude"])].filter(Boolean), optional_providers: [], scout_providers: [] }

  // fallback: Claude verifier 항상 포함
  return {
    selected_providers: [findAvailable(available, withHint(["openai", "claude", "gemini"])) ?? "openai"],
    verifier_providers: [findAvailable(available, ["claude", "openai"], [findAvailable(available, withHint(["openai", "claude", "gemini"])) ?? "openai"])].filter(Boolean),
    optional_providers: [],
    scout_providers: []
  }
}

export function resolveAdaptiveRoute(params: any): AdaptiveRouteDecision {
  const task = normalizeTask(params?.task)
  const ranked = rankProviders(task)

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
    const pBandit = ranked.reduce<Record<string, { routing_score: number; exploration_bonus: number; freshness_bonus: number; bandit_score: number }>>((acc, row) => {
      acc[row.provider] = {
        routing_score: Number(row.routing_score.toFixed(4)),
        exploration_bonus: Number(row.exploration_bonus.toFixed(4)),
        freshness_bonus: Number(row.freshness_bonus.toFixed(4)),
        bandit_score: Number(row.bandit_score.toFixed(4))
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
  ].filter((x): x is string => x !== null && x !== undefined)
  ).slice(0, Math.max(1, Number(executionPolicy?.max_parallel ?? 2)))

  const selectedProviders = roles.selected_providers.filter((x): x is string => x !== null && parallelProviders.includes(x))
  const verifierProviders = roles.verifier_providers.filter((x): x is string => x !== null && parallelProviders.includes(x))
  const optionalProviders = roles.optional_providers.filter((x): x is string => x !== null && parallelProviders.includes(x))
  const scoutProviders = (roles.scout_providers as string[]).filter((x) => x !== null && parallelProviders.includes(x))

  const fallbackProviders = fallbackOrder(
    ranked,
    uniqueProviders([
      ...selectedProviders,
      ...verifierProviders,
      ...optionalProviders,
      ...scoutProviders
    ].filter((x): x is string => x !== null && x !== undefined)),
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
    verifier_providers: (verifierProviders.filter(Boolean) as string[]),
    optional_providers: (optionalProviders.filter(Boolean) as string[]),
    scout_providers: scoutProviders,
    fallback_providers: fallbackProviders,
    parallel_providers: parallelProviders,
    execution_strategy: executionStrategy,
    parallel_width: parallelProviders.length,
    router_policy: "matrix_router_v2026_04",
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
