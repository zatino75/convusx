import { decayRecentBanditSignals, readRoutingScores } from "./scoreboard.js"

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
  // 전용 파이프라인 task → research 라우팅
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

function getRoutingRows(task: AdaptiveTask) {
  decayRecentBanditSignals()
  return readRoutingScores(task)
}

// 2026년 3월 벤치마크 기반 태스크별 provider 가중치 (초기값 / 데이터 없을 때 fallback)
// - Claude: SWE-bench 코딩 1위(80.8%), 글쓰기/문서 1위(128K 출력)
// - Gemini: ARC-AGI-2 추론 1위(77.1%), 1M 컨텍스트, 최저가
// - OpenAI: 올라운더, 에이전트 실행(Terminal-Bench 1위), 사실확인
// - Perplexity: 실시간 리서치 1위, 팩트 정확도 93.9%
const TASK_WEIGHTS: Record<string, Record<string, number>> = {
  code:     { claude: 0.12, openai: 0.06, gemini: 0.01, perplexity: 0.00 },
  writing:  { claude: 0.14, openai: 0.04, gemini: 0.02, perplexity: 0.00 },
  dialogue: { openai: 0.10, claude: 0.06, gemini: 0.02, perplexity: 0.01 },
  reasoning:{ gemini: 0.12, openai: 0.08, claude: 0.06, perplexity: 0.00 },
  research: { perplexity: 0.12, claude: 0.07, openai: 0.05, gemini: 0.03 },
  long_doc: { gemini: 0.14, claude: 0.08, openai: 0.03, perplexity: 0.01 }
}

function rankProviders(task: AdaptiveTask) {
  const ranked = getRoutingRows(task)
    .filter((x) => ["openai", "claude", "gemini", "perplexity"].includes(x.provider))

  const weights = TASK_WEIGHTS[task] ?? TASK_WEIGHTS["dialogue"]

  ranked.sort((a, b) => {
    const wA = weights[a.provider] ?? 0
    const wB = weights[b.provider] ?? 0
    return (b.bandit_score + wB) - (a.bandit_score + wA)
  })

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

function buildExecutionPolicy(task: AdaptiveTask, params: any) {
  const allowOptional = Boolean(params?.benchmark_mode || params?.deep_analysis || params?.deep_research || params?.force_pro)

  if (task === "dialogue") {
    return {
      max_parallel: 2,
      cost_gate_enabled: true,
      max_total_estimated_cost_usd: 0.05,
      prefer_fast_fallback: true
    }
  }

  if (task === "writing") {
    return {
      max_parallel: allowOptional ? 2 : 1,
      cost_gate_enabled: true,
      max_total_estimated_cost_usd: 0.06,
      prefer_fast_fallback: false
    }
  }

  if (task === "long_doc") {
    return {
      max_parallel: 2,
      cost_gate_enabled: true,
      max_total_estimated_cost_usd: 0.10,
      prefer_fast_fallback: false
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

// Dynamic chooseRoles — task별 bandit_score 1위 provider 자동 배정
//
// ranked[]는 이미 bandit_score + TASK_WEIGHTS 합산 기준 내림차순 정렬됨.
// 데이터 없을 때 → TASK_WEIGHTS가 초기 순위를 결정 (hardcoded fallback 불필요).
// 데이터 쌓일수록 → 실제 성능 기반으로 순위가 자연스럽게 갱신됨.
//
// 예외 (능력 특성상 고정):
//   research  → perplexity 항상 primary (실시간 검색 전용, bandit으로 대체 불가)
//   long_doc  → gemini 항상 primary (1M context, bandit으로 대체 불가)
function chooseRoles(task: AdaptiveTask, ranked: any[], params: any) {
  const allowOptional = Boolean(
    params?.benchmark_mode ||
    params?.deep_analysis ||
    params?.deep_research ||
    params?.force_pro
  )

  // ── research: perplexity 고정 primary (실시간 검색) ─────────────────────────
  if (task === "research") {
    return {
      selected_providers: ["perplexity"],
      verifier_providers: ["claude"],
      optional_providers: allowOptional ? ["openai"] : [],
      scout_providers: []
    }
  }

  // ── long_doc: gemini 고정 primary (1M context) ─────────────────────────────
  if (task === "long_doc") {
    return {
      selected_providers: ["gemini"],
      verifier_providers: ["claude"],
      optional_providers: [],
      scout_providers: []
    }
  }

  // ── Dynamic: bandit_score + TASK_WEIGHTS 기준 자동 배정 ────────────────────
  // ranked[]는 이미 정렬 완료 → 순서대로 primary / verifier / optional 배정
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
  // primary 1개만 실행, verifier/optional 없음 → 진짜 단일 모델 비교
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
    router_policy: "dynamic_bandit_task_router_v3",
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
