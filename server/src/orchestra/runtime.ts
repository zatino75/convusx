import fs from "fs"

import { resolveAdaptiveRoute } from "./adaptiveRouter.js"
import * as adapterDispatcher from "./adapterDispatcher.js"
import { judge } from "./judge.js"
import { detectTaskType, extractPlanningSignals } from "./planner.js"
import { recordProviderExecution } from "./scoreboard.js"

const runAdapter = adapterDispatcher.runAdapter
const SCORE_PATH = "server/data/scoreboard.json"

function now() {
  return Math.floor(Date.now() / 1000)
}

function loadScoreboard(): any {
  try {
    return JSON.parse(fs.readFileSync(SCORE_PATH, "utf-8"))
  } catch {
    return {}
  }
}

function saveScoreboard(scoreboard: any) {
  fs.writeFileSync(SCORE_PATH, JSON.stringify(scoreboard, null, 2))
}

function applyDecay(scoreboard: any) {
  const baseline = 0.85
  const current = now()

  for (const provider of Object.keys(scoreboard ?? {})) {
    for (const task of Object.keys(scoreboard?.[provider] ?? {})) {
      const item = scoreboard?.[provider]?.[task]
      const ageSec = Math.max(0, current - Number(item?.updated_at ?? current))

      if (ageSec < 3600) continue

      const ageHours = Math.min(72, ageSec / 3600)
      const decayFactor = Math.min(0.25, ageHours * 0.01)
      const currentScore = Number(item?.score ?? baseline)
      const decayed = currentScore * (1 - decayFactor) + baseline * decayFactor

      scoreboard[provider][task] = {
        score: Number(decayed.toFixed(4)),
        updated_at: current
      }
    }
  }

  return scoreboard
}

function getScore(provider: string, task: string, scoreboard: any): number {
  const raw = Number(scoreboard?.[provider]?.[task]?.score ?? 0.85)
  return Number.isFinite(raw) ? raw : 0.85
}

function setScore(scoreboard: any, provider: string, task: string, score: number) {
  if (!scoreboard[provider]) scoreboard[provider] = {}

  scoreboard[provider][task] = {
    score: Number(Math.max(0.7, Math.min(1.05, score)).toFixed(4)),
    updated_at: now()
  }
}

function updateScoreboard(scoreboard: any, judged: any, task: string, conflictScore: number) {
  const judgeScores = Array.isArray(judged?.meta?.judge_scores) ? judged.meta.judge_scores : []
  if (judgeScores.length < 2) return scoreboard

  const sorted = [...judgeScores].sort((a, b) => b.score - a.score)
  const winner = String(sorted[0]?.provider ?? "").trim().toLowerCase()
  const loser = String(sorted[1]?.provider ?? "").trim().toLowerCase()

  if (!winner || !loser) return scoreboard

  const winnerCurrent = getScore(winner, task, scoreboard)
  const loserCurrent = getScore(loser, task, scoreboard)

  const winnerBoost = conflictScore >= 1 ? 0.025 : 0.02
  const loserPenalty = conflictScore >= 1 ? 0.02 : 0.015

  setScore(scoreboard, winner, task, winnerCurrent + winnerBoost)
  setScore(scoreboard, loser, task, loserCurrent - loserPenalty)

  return scoreboard
}

function getConflictWeight(type: string): number {
  if (type === "numeric_conflict") return 1.0
  if (type === "direction_conflict") return 0.8
  if (type === "feasibility_conflict") return 0.9
  if (type === "risk_conflict") return 0.85
  if (type === "recommendation_conflict") return 0.6
  if (type === "option_conflict") return 0.5
  return 0.5
}

function getSeverityMultiplier(severity: string): number {
  const normalized = String(severity ?? "").trim().toLowerCase()
  if (normalized === "high") return 1.15
  if (normalized === "medium") return 1
  return 0.85
}

function calculateConflictScore(conflicts: any[], scoreboard: any, task: string): number {
  let score = 0

  for (const c of conflicts ?? []) {
    const explicitWeight = Number(c?.weight)
    const base = Number.isFinite(explicitWeight)
      ? explicitWeight
      : getConflictWeight(String(c?.type ?? ""))

    const severityMultiplier = getSeverityMultiplier(String(c?.severity ?? "medium"))
    const relA = getScore(String(c?.provider_a ?? "unknown"), task, scoreboard)
    const relB = getScore(String(c?.provider_b ?? "unknown"), task, scoreboard)

    score += base * severityMultiplier * ((relA + relB) / 2)
  }

  return Number(score.toFixed(4))
}

function extractInboundMessage(params: any): string {
  if (typeof params?.message === "string" && params.message.trim().length > 0) {
    return params.message.trim()
  }

  if (Array.isArray(params?.messages)) {
    return params.messages
      .filter((m: any) => String(m?.role ?? "user") === "user")
      .map((m: any) => String(m?.content ?? ""))
      .join("\n\n")
      .trim()
  }

  return ""
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

function hasUsableAnswer(result: any): boolean {
  if (!result) return false
  if (result.ok !== true) return false

  const text = String(result?.answer_text ?? result?.text ?? "").trim()
  return text.length > 0
}

function buildCandidates(results: Array<{ provider: string; result: any }>) {
  return results
    .filter((item) => hasUsableAnswer(item.result))
    .map((item) => ({
      provider: item.provider,
      answer_text: String(item.result?.answer_text ?? item.result?.text ?? "").trim(),
      raw: item.result
    }))
}

function buildProviderInput(
  params: any,
  route: any,
  scoreboard: any,
  task: string,
  provider: string,
  usePro: boolean,
  signals: {
    benchmark_mode: boolean
    deep_analysis: boolean
    deep_research: boolean
    force_pro: boolean
  }
) {
  const normalizedProvider = String(provider ?? "").trim().toLowerCase()
  const explicitModel =
    normalizedProvider === "openai" && usePro
      ? "gpt-5.4-pro"
      : undefined

  return {
    ...params,
    task,
    model: explicitModel,
    scoreboard,
    benchmark_mode: Boolean(signals.benchmark_mode || params?.benchmark_mode),
    deep_analysis: Boolean(signals.deep_analysis || params?.deep_analysis),
    deep_research: Boolean(signals.deep_research || params?.deep_research),
    force_pro: Boolean(signals.force_pro || params?.force_pro),
    metadata: {
      ...(params?.metadata ?? {}),
      routing: route,
      scoreboard,
      planner_signals: signals
    }
  }
}

function pickPrimaryResult(results: Array<{ provider: string; result: any }>, route: any) {
  const primaryProvider = Array.isArray(route?.selected_providers) ? route.selected_providers[0] : null
  return results.find((item) => item.provider === primaryProvider)?.result ?? null
}

function pickVerifierResult(results: Array<{ provider: string; result: any }>, route: any) {
  const verifierProvider = Array.isArray(route?.verifier_providers) ? route.verifier_providers[0] : null
  return results.find((item) => item.provider === verifierProvider)?.result ?? null
}

function shouldEscalateAfterEval(params: {
  task: string
  weighted_conflict_score: number
  verifier_disagreement: boolean
  judge_confidence: number
  conflict_count: number
  planner_signals: {
    benchmark_mode: boolean
    deep_analysis: boolean
    deep_research: boolean
    force_pro: boolean
  }
}) {
  const task = String(params?.task ?? "").toLowerCase()
  if (task !== "reasoning" && task !== "research") return false

  if (Boolean(params?.planner_signals?.force_pro)) return true
  if (Boolean(params?.planner_signals?.benchmark_mode)) return true
  if (Boolean(params?.planner_signals?.deep_analysis)) return true
  if (Boolean(params?.planner_signals?.deep_research)) return true

  if (params.conflict_count >= 2) return true
  if (params.weighted_conflict_score >= 1.05) return true
  if (params.verifier_disagreement) return true
  if (params.judge_confidence < 0.55) return true

  return false
}

function buildOrchestrationMeta(params: {
  startedAt: number
  route: any
  executedAll: Array<{ provider: string; result: any }>
  primaryProviders: string[]
  verifierProviders: string[]
  finalResult: any
  judged: any
  finalConflictCount: number
  executionPolicy: any
  postEvalTriggered: boolean
}) {
  const executedProviders = params.executedAll.map((item) => ({
    provider: item.provider,
    success: Boolean(item?.result?.ok),
    latency_ms: Number(item?.result?.latency_ms ?? 0),
    error_code: item?.result?.error_code ?? null,
    model: item?.result?.model ?? null,
    usage: {
      estimated_cost_usd: Number(item?.result?.usage?.estimated_cost_usd ?? 0)
    }
  }))

  const estimatedCostUsd = executedProviders.reduce(
    (sum, row) => sum + Number(row?.usage?.estimated_cost_usd ?? 0),
    0
  )

  const fallbackUsed =
    params.postEvalTriggered ||
    params.executedAll.some(
      (item) =>
        Array.isArray(params.route?.fallback_providers) &&
        params.route.fallback_providers.includes(item.provider) &&
        Boolean(item?.result?.ok)
    )

  return {
    primary_provider: params.primaryProviders[0] ?? null,
    verifier_providers: params.verifierProviders,
    optional_providers: params.executedAll
      .filter((item) => !params.primaryProviders.includes(item.provider) && !params.verifierProviders.includes(item.provider))
      .map((item) => item.provider),
    selected_providers: Array.isArray(params.route?.selected_providers) ? params.route.selected_providers : [],
    fallback_providers: Array.isArray(params.route?.fallback_providers) ? params.route.fallback_providers : [],
    parallel_providers: Array.isArray(params.route?.parallel_providers) ? params.route.parallel_providers : [],
    executed_providers: executedProviders.map((row) => row.provider),
    selected_models: executedProviders
      .filter((row) => typeof row?.model === "string" && row.model.trim().length > 0)
      .map((row) => ({
        provider: row.provider,
        model: row.model
      })),
    latency_ms: Date.now() - params.startedAt,
    estimated_cost_usd: Number(estimatedCostUsd.toFixed(8)),
    fallback_used: fallbackUsed,
    judge_confidence: Number(
      params.judged?.meta?.judge_confidence ??
      params.judged?.meta?.judge_scores?.[0]?.score ??
      1
    ),
    conflict_count: params.finalConflictCount,
    execution_policy: {
      max_parallel: Number(params.executionPolicy?.max_parallel ?? 0),
      cost_gate_enabled: Boolean(params.executionPolicy?.cost_gate_enabled),
      max_total_estimated_cost_usd: Number(params.executionPolicy?.max_total_estimated_cost_usd ?? 0),
      prefer_fast_fallback: Boolean(params.executionPolicy?.prefer_fast_fallback)
    },
    provider_usage: executedProviders,
    final_provider: String(
      params.judged?.meta?.judge_selected_provider ??
      params.judged?.provider ??
      params.finalResult?.provider ??
      ""
    ) || null
  }
}

export async function executeOrchestra(params: any) {
  const startedAt = Date.now()
  const inboundMessage = extractInboundMessage(params)
  const plannerSignals = extractPlanningSignals(inboundMessage)

  const task = String(params?.task ?? detectTaskType(inboundMessage)).trim().toLowerCase()

  let scoreboard = applyDecay(loadScoreboard())

  const route = resolveAdaptiveRoute({
    ...params,
    task,
    scoreboard,
    benchmark_mode: Boolean(params?.benchmark_mode || plannerSignals.benchmark_mode),
    deep_analysis: Boolean(params?.deep_analysis || plannerSignals.deep_analysis),
    deep_research: Boolean(params?.deep_research || plannerSignals.deep_research),
    force_pro: Boolean(params?.force_pro || plannerSignals.force_pro)
  })

  const primaryProviders = Array.isArray(route?.selected_providers) ? route.selected_providers : []
  const verifierProviders = Array.isArray(route?.verifier_providers) ? route.verifier_providers : []
  const fallbackProviders = Array.isArray(route?.fallback_providers) ? route.fallback_providers : []
  const executionPolicy = route?.execution_policy ?? {
    max_parallel: 2,
    cost_gate_enabled: true,
    max_total_estimated_cost_usd: 0.06,
    prefer_fast_fallback: true
  }

  const firstWaveProviders = uniqueProviders(
    Array.isArray(route?.parallel_providers) && route.parallel_providers.length > 0
      ? route.parallel_providers
      : [...primaryProviders, ...verifierProviders]
  ).slice(0, Math.max(1, Number(executionPolicy?.max_parallel ?? 2)))

  const executed = await Promise.all(
    firstWaveProviders.map(async (provider) => {
      const result = await runAdapter({
        provider,
        task,
        input: buildProviderInput(
          params,
          route,
          scoreboard,
          task,
          provider,
          Boolean(route?.escalation?.use_pro) && provider === "openai",
          plannerSignals
        ),
        message: inboundMessage,
        messages: params?.messages
      })

      return { provider, result }
    })
  )

  let executedAll = [...executed]
  let successfulResults = executedAll.filter((item) => hasUsableAnswer(item.result))

  const primaryResultInitial = pickPrimaryResult(executedAll, route)

  const shouldRunFallback =
    !hasUsableAnswer(primaryResultInitial) ||
    (successfulResults.length === 0 && fallbackProviders.length > 0)

  if (shouldRunFallback && fallbackProviders.length > 0) {
    const fallbackExecuted = await Promise.all(
      fallbackProviders.slice(0, 2).map(async (provider) => {
        const result = await runAdapter({
          provider,
          task,
          input: buildProviderInput(
            params,
            route,
            scoreboard,
            task,
            provider,
            false,
            plannerSignals
          ),
          message: inboundMessage,
          messages: params?.messages
        })

        return { provider, result }
      })
    )

    executedAll = [...executedAll, ...fallbackExecuted]
    successfulResults = executedAll.filter((item) => hasUsableAnswer(item.result))
  }

  let candidates = buildCandidates(successfulResults)
  let judged: any = null

  if (candidates.length > 1) {
    judged = await judge({
      candidates,
      task
    })
  }

  const initialConflicts = judged?.meta?.conflicts ?? []
  const initialConflictScore = calculateConflictScore(initialConflicts, scoreboard, task)

  const verifierProvider = verifierProviders[0] ?? null
  const verifierResult = verifierProvider
    ? successfulResults.find((item) => item.provider === verifierProvider)?.result ?? null
    : null

  const primaryResult = pickPrimaryResult(executedAll, route)

  const verifierDisagreement =
    Boolean(primaryResult) &&
    Boolean(verifierResult) &&
    String(primaryResult?.answer_text ?? "").trim() !== String(verifierResult?.answer_text ?? "").trim()

  const judgeConfidence = Number(
    judged?.meta?.judge_confidence ??
    judged?.meta?.judge_scores?.[0]?.score ??
    1
  )

  const conflictCount = Number(
    judged?.meta?.conflict_count ??
    initialConflicts.length ??
    0
  )

  const needPostEvalPro =
    !Boolean(route?.escalation?.use_pro) &&
    primaryProviders[0] === "openai" &&
    shouldEscalateAfterEval({
      task,
      weighted_conflict_score: initialConflictScore,
      verifier_disagreement: verifierDisagreement,
      judge_confidence: judgeConfidence,
      conflict_count: conflictCount,
      planner_signals: plannerSignals
    })

  let postEvalTriggered = false

  if (needPostEvalPro) {
    const proResult = await runAdapter({
      provider: "openai",
      task,
      input: buildProviderInput(
        params,
        route,
        scoreboard,
        task,
        "openai",
        true,
        plannerSignals
      ),
      message: inboundMessage,
      messages: params?.messages
    })

    executedAll.push({ provider: "openai", result: proResult })

    if (hasUsableAnswer(proResult)) {
      postEvalTriggered = true

      candidates = [
        ...candidates.filter((c) => c.provider !== "openai"),
        {
          provider: "openai",
          answer_text: String(proResult?.answer_text ?? "").trim(),
          raw: proResult
        }
      ]

      if (candidates.length > 1) {
        judged = await judge({
          candidates,
          task
        })
      } else {
        judged = {
          provider: "openai",
          answer_text: String(proResult?.answer_text ?? "").trim(),
          raw: proResult,
          ok: true,
          meta: {
            judge_selected_provider: "openai",
            judge_scores: [],
            judge_rationale: "post_eval_openai_pro_only",
            judge_confidence: 1,
            conflict_count: 0,
            conflicts: [],
            claims: []
          }
        }
      }
    }
  }

  const finalResult =
    judged ??
    candidates[0] ??
    successfulResults[0]?.result ??
    primaryResult ??
    executedAll[0]?.result ?? {
      provider: primaryProviders[0] ?? "openai",
      answer_text: "",
      ok: false
    }

  const finalConflicts = judged?.meta?.conflicts ?? initialConflicts
  const finalConflictScore = calculateConflictScore(finalConflicts, scoreboard, task)
  const finalConflictCount = Number(judged?.meta?.conflict_count ?? finalConflicts.length ?? 0)
  const finalJudgeConfidence = Number(
    judged?.meta?.judge_confidence ??
    judged?.meta?.judge_scores?.[0]?.score ??
    1
  )

  const primaryFinal = pickPrimaryResult(executedAll, route)
  const verifierFinal = pickVerifierResult(executedAll, route)

  const orchestrationMeta = buildOrchestrationMeta({
    startedAt,
    route,
    executedAll,
    primaryProviders,
    verifierProviders,
    finalResult,
    judged,
    finalConflictCount,
    executionPolicy,
    postEvalTriggered
  })

  if (judged) {
    scoreboard = updateScoreboard(scoreboard, judged, task, finalConflictScore)

    const usageRows = orchestrationMeta.provider_usage ?? []

    for (const row of usageRows) {
      const provider = String(row?.provider ?? "").trim().toLowerCase()
      if (!provider) continue

      const success = Boolean(row?.success)
      const latency = Number(row?.latency_ms ?? 0)
      const cost = Number(row?.usage?.estimated_cost_usd ?? 0)

      const current = getScore(provider, task, scoreboard)

      let delta = 0

      if (success) {
        delta += 0.01
      } else {
        delta -= 0.02
      }

      if (provider === orchestrationMeta.final_provider) {
        delta += 0.02
      }

      if (latency > 15000) {
        delta -= 0.01
      } else if (latency < 6000) {
        delta += 0.005
      }

      if (cost > 0.04) {
        delta -= 0.01
      } else if (cost < 0.015) {
        delta += 0.005
      }

      if (orchestrationMeta.fallback_used && provider === orchestrationMeta.primary_provider) {
        delta -= 0.015
      }

      setScore(scoreboard, provider, task, current + delta)

      try {
        recordProviderExecution(provider, {
          success,
          latency_ms: latency,
          estimated_cost_usd: cost,
          selected_as_final: provider === orchestrationMeta.final_provider
        })
      } catch {}
    }

    saveScoreboard(scoreboard)
  }

  return {
    final_answer: {
      provider: String(finalResult?.provider ?? "openai"),
      text: String(finalResult?.answer_text ?? finalResult?.text ?? ""),
      ok: Boolean(finalResult?.ok ?? true)
    },
    response_meta: {
      orchestration: orchestrationMeta
    },
    route,
    primary: primaryFinal,
    verifier: verifierFinal,
    optional_results: executedAll
      .filter((item) => !primaryProviders.includes(item.provider) && !verifierProviders.includes(item.provider))
      .map((item) => item.result),
    internal_rationale: {
      task,
      route,
      planner_signals: plannerSignals,
      bandit: {
        router_policy: route?.router_policy ?? null,
        provider_bandit: route?.provider_bandit ?? {},
        selected_primary: primaryProviders[0] ?? null,
        selected_verifier: verifierProviders[0] ?? null
      },
      executed_providers: orchestrationMeta.provider_usage,
      execution_policy: executionPolicy,
      escalation: {
        pre_routing_use_pro: Boolean(route?.escalation?.use_pro),
        post_eval_triggered: postEvalTriggered
      },
      conflict_score: finalConflictScore,
      conflict_count: finalConflictCount,
      conflicts: finalConflicts,
      judge: {
        selected_provider: judged?.meta?.judge_selected_provider ?? judged?.provider ?? finalResult?.provider ?? null,
        confidence: finalJudgeConfidence,
        scores: Array.isArray(judged?.meta?.judge_scores) ? judged.meta.judge_scores : [],
        rationale: judged?.meta?.judge_rationale ?? null
      },
      scoreboard
    }
  }
}
