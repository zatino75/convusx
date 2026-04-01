export type DynamicRouterMetrics = {
  latency_ms: number
  success: number
  quality: number
  claims: number
  conflicts: number
  decisions: number
  fallback_rate: number
  runs: number
  cost_efficiency: number
  avg_cost_usd: number
  avg_cost_per_1k_tokens_usd: number
  avg_tokens: number

  recent_success_rate: number
  recent_win_rate: number
  recent_avg_latency: number
  recent_avg_cost_usd: number
  recent_avg_tokens: number
  recent_win_streak: number
  freshness_score: number
}

export type DynamicRouterBreakdown = {
  latency: number
  success: number
  quality: number
  claims: number
  conflicts: number
  decisions: number
  fallback: number
  confidence: number
  cost_efficiency: number
  cost_penalty: number
  freshness: number
  recent_winner_bonus: number
}

export type DynamicRouterScoredProvider = {
  provider: string
  score: number
  breakdown: DynamicRouterBreakdown
  metrics: DynamicRouterMetrics
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function normalizeMetrics(input: any): DynamicRouterMetrics {
  if (!input || typeof input !== "object") {
    return {
      latency_ms: 0,
      success: 0.5,
      quality: 0.5,
      claims: 0,
      conflicts: 0,
      decisions: 0,
      fallback_rate: 0.5,
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

  return {
    latency_ms: Math.max(0, Number(input?.latency_ms ?? 0)),
    success: clamp(Number(input?.success ?? 0), 0, 1),
    quality: clamp(Number(input?.quality ?? 0), 0, 1),
    claims: Math.max(0, Number(input?.claims ?? 0)),
    conflicts: Math.max(0, Number(input?.conflicts ?? 0)),
    decisions: Math.max(0, Number(input?.decisions ?? 0)),
    fallback_rate: clamp(Number(input?.fallback_rate ?? 0), 0, 1),
    runs: Math.max(0, Number(input?.runs ?? 0)),
    cost_efficiency: clamp(Number(input?.cost_efficiency ?? 0), 0, 1),
    avg_cost_usd: Math.max(0, Number(input?.avg_cost_usd ?? 0)),
    avg_cost_per_1k_tokens_usd: Math.max(0, Number(input?.avg_cost_per_1k_tokens_usd ?? 0)),
    avg_tokens: Math.max(0, Number(input?.avg_tokens ?? 0)),

    recent_success_rate: clamp(Number(input?.recent_success_rate ?? 0), 0, 1),
    recent_win_rate: clamp(Number(input?.recent_win_rate ?? 0), 0, 1),
    recent_avg_latency: Math.max(0, Number(input?.recent_avg_latency ?? 0)),
    recent_avg_cost_usd: Math.max(0, Number(input?.recent_avg_cost_usd ?? 0)),
    recent_avg_tokens: Math.max(0, Number(input?.recent_avg_tokens ?? 0)),
    recent_win_streak: Math.max(0, Number(input?.recent_win_streak ?? 0)),
    freshness_score: clamp(Number(input?.freshness_score ?? 0), 0, 1)
  }
}

function normalizeTask(task: any): "dialogue" | "reasoning" | "research" | "code" | "writing" | "long_doc" {
  const value = String(task ?? "").trim().toLowerCase()

  if (value.includes("code")) return "code"
  if (value.includes("long_doc") || value.includes("long_document")) return "long_doc"
  if (value.includes("writing") || value.includes("write")) return "writing"
  if (value.includes("research")) return "research"
  if (value.includes("reasoning")) return "reasoning"
  return "dialogue"
}

function latencyScore(ms: number) {
  if (ms <= 0) return 0.7
  return clamp(1 - ms / 20000, 0, 1)
}

function claimsScore(claims: number, task: string) {
  if (task === "research") return Math.min(1, claims / 18)
  if (task === "reasoning") return Math.min(1, claims / 12)
  if (task === "code") return Math.min(1, claims / 8)
  return Math.min(1, claims / 10)
}

function conflictsScore(conflicts: number, task: string) {
  if (task === "research" || task === "reasoning") {
    return 1 - Math.min(1, conflicts / 8)
  }
  if (task === "code") {
    return 1 - Math.min(1, conflicts / 6)
  }
  return 1 - Math.min(1, conflicts / 10)
}

function decisionsScore(decisions: number, task: string) {
  if (task === "reasoning") return Math.min(1, decisions / 10)
  if (task === "research") return Math.min(1, decisions / 9)
  if (task === "code") return Math.min(1, decisions / 8)
  return Math.min(1, decisions / 7)
}

function confidenceScore(runs: number) {
  if (runs >= 20) return 1
  if (runs <= 0) return 0.35
  return clamp(0.35 + runs / 30, 0.35, 1)
}

function costPenaltyScore(avgCostPer1kTokensUsd: number, avgCostUsd: number, task: string) {
  const per1kPenalty =
    avgCostPer1kTokensUsd > 0
      ? Math.min(1, avgCostPer1kTokensUsd / 0.08)
      : 0

  const perCallPenalty =
    avgCostUsd > 0
      ? Math.min(1, avgCostUsd / 0.02)
      : 0

  const basePenalty = Math.max(per1kPenalty, perCallPenalty)

  if (task === "dialogue") return basePenalty
  if (task === "research") return basePenalty * 0.65
  if (task === "reasoning") return basePenalty * 0.5
  return basePenalty * 0.35
}

function getTaskWeights(task: "dialogue" | "reasoning" | "research" | "code" | "writing" | "long_doc") {
  if (task === "dialogue") {
    return {
      latency: 0.15,
      success: 0.14,
      quality: 0.12,
      claims: 0.02,
      conflicts: 0.05,
      decisions: 0.02,
      fallback: 0.07,
      confidence: 0.08,
      cost_efficiency: 0.13,
      cost_penalty: 0.06,
      freshness: 0.10,
      recent_winner_bonus: 0.06
    }
  }

  if (task === "reasoning") {
    return {
      latency: 0.06,
      success: 0.15,
      quality: 0.24,
      claims: 0.07,
      conflicts: 0.08,
      decisions: 0.09,
      fallback: 0.05,
      confidence: 0.09,
      cost_efficiency: 0.05,
      cost_penalty: 0.02,
      freshness: 0.06,
      recent_winner_bonus: 0.04
    }
  }

  if (task === "research") {
    return {
      latency: 0.06,
      success: 0.14,
      quality: 0.20,
      claims: 0.12,
      conflicts: 0.08,
      decisions: 0.08,
      fallback: 0.05,
      confidence: 0.08,
      cost_efficiency: 0.05,
      cost_penalty: 0.02,
      freshness: 0.08,
      recent_winner_bonus: 0.04
    }
  }

  if (task === "writing") {
    return {
      latency: 0.06,
      success: 0.15,
      quality: 0.28,
      claims: 0.02,
      conflicts: 0.04,
      decisions: 0.03,
      fallback: 0.07,
      confidence: 0.09,
      cost_efficiency: 0.10,
      cost_penalty: 0.03,
      freshness: 0.07,
      recent_winner_bonus: 0.06
    }
  }

  if (task === "long_doc") {
    return {
      latency: 0.04,
      success: 0.16,
      quality: 0.24,
      claims: 0.04,
      conflicts: 0.06,
      decisions: 0.04,
      fallback: 0.07,
      confidence: 0.09,
      cost_efficiency: 0.12,
      cost_penalty: 0.02,
      freshness: 0.06,
      recent_winner_bonus: 0.06
    }
  }

  return {
    latency: 0.05,
    success: 0.20,
    quality: 0.26,
    claims: 0.03,
    conflicts: 0.06,
    decisions: 0.05,
    fallback: 0.09,
    confidence: 0.10,
    cost_efficiency: 0.05,
    cost_penalty: 0.02,
    freshness: 0.05,
    recent_winner_bonus: 0.04
  }
}

function blendedSuccess(m: DynamicRouterMetrics) {
  return clamp((m.success * 0.65) + (m.recent_success_rate * 0.35), 0, 1)
}

function blendedQuality(m: DynamicRouterMetrics) {
  return clamp((m.quality * 0.6) + (m.recent_win_rate * 0.4), 0, 1)
}

function blendedLatency(m: DynamicRouterMetrics) {
  const recent = m.recent_avg_latency > 0 ? m.recent_avg_latency : m.latency_ms
  const historic = m.latency_ms > 0 ? m.latency_ms : recent
  return (recent * 0.65) + (historic * 0.35)
}

function blendedCostEfficiency(m: DynamicRouterMetrics) {
  return clamp((m.cost_efficiency * 0.75) + (m.freshness_score * 0.25), 0, 1)
}

export function scoreDynamicRouterProviders(params: {
  task: string
  providers: { provider: string; metrics?: any }[]
}): DynamicRouterScoredProvider[] {
  const task = normalizeTask(params.task)
  const weights = getTaskWeights(task)

  const scored = (params.providers || []).map((p) => {
    const m = normalizeMetrics(p.metrics)

    const success = blendedSuccess(m)
    const quality = blendedQuality(m)
    const latency = blendedLatency(m)
    const costEfficiency = blendedCostEfficiency(m)
    const costPenalty = costPenaltyScore(m.avg_cost_per_1k_tokens_usd, m.avg_cost_usd, task)
    const recentWinnerBonus = Math.min(1, m.recent_win_streak / 3)

    const breakdown = {
      latency: latencyScore(latency) * weights.latency * 1000,
      success: success * weights.success * 1000,
      quality: quality * weights.quality * 1000,
      claims: claimsScore(m.claims, task) * weights.claims * 1000,
      conflicts: conflictsScore(m.conflicts, task) * weights.conflicts * 1000,
      decisions: decisionsScore(m.decisions, task) * weights.decisions * 1000,
      fallback: (1 - m.fallback_rate) * weights.fallback * 1000,
      confidence: confidenceScore(m.runs) * weights.confidence * 1000,
      cost_efficiency: costEfficiency * weights.cost_efficiency * 1000,
      cost_penalty: costPenalty * weights.cost_penalty * 1000,
      freshness: m.freshness_score * weights.freshness * 1000,
      recent_winner_bonus: recentWinnerBonus * weights.recent_winner_bonus * 1000
    }

    const score =
      breakdown.latency +
      breakdown.success +
      breakdown.quality +
      breakdown.claims +
      breakdown.conflicts +
      breakdown.decisions +
      breakdown.fallback +
      breakdown.confidence +
      breakdown.cost_efficiency +
      breakdown.freshness +
      breakdown.recent_winner_bonus -
      breakdown.cost_penalty

    return {
      provider: p.provider,
      score: Number(score.toFixed(2)),
      breakdown: Object.fromEntries(
        Object.entries(breakdown).map(([k, v]) => [k, Number(v.toFixed(2))])
      ) as DynamicRouterBreakdown,
      metrics: m
    }
  })

  scored.sort((a, b) => b.score - a.score)

  return scored
}
