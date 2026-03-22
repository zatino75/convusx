import { runAdapter } from "./adapterDispatcher.js"
import { resolveAdaptiveRoute } from "./adaptiveRouter.js"
import { judge } from "./judge.js"
import { detectTaskType, extractPlanningSignals, planRequest } from "./planner.js"
import { extractClaims } from "./claims.js"
import { detectConflicts } from "./conflicts.js"
import { readScoreboard, recordProviderExecution } from "./scoreboard.js"

function hasText(value: any) {
  return typeof value === "string" && value.trim().length > 0
}

function normalizeProvider(value: any) {
  return String(value ?? "").trim().toLowerCase()
}

function uniqueProviders(values: any[]) {
  const seen = new Set<string>()
  const out: string[] = []

  for (const value of values ?? []) {
    const normalized = normalizeProvider(value)
    if (!normalized) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }

  return out
}

function extractInboundMessage(input: any) {
  if (hasText(input?.message)) {
    return String(input.message).trim()
  }

  if (Array.isArray(input?.messages)) {
    return input.messages
      .filter((item: any) => String(item?.role ?? "user").trim().toLowerCase() === "user")
      .map((item: any) => {
        if (typeof item?.content === "string") return item.content
        if (Array.isArray(item?.content)) {
          return item.content
            .map((part: any) => {
              if (typeof part === "string") return part
              if (typeof part?.text === "string") return part.text
              return ""
            })
            .join("\n")
        }
        return ""
      })
      .join("\n\n")
      .trim()
  }

  return ""
}

function pickText(result: any, partialText: string) {
  if (hasText(partialText)) return String(partialText)
  if (hasText(result?.answer_text)) return String(result.answer_text)
  if (hasText(result?.text)) return String(result.text)
  if (hasText(result?.answer)) return String(result.answer)
  if (hasText(result?.output_text)) return String(result.output_text)
  return ""
}

function buildProviderInput(params: any, task: string, route: any, provider: string, plannerSignals: any, usePro: boolean) {
  const explicitModel =
    typeof params?.model === "string" && params.model.trim().length > 0
      ? params.model
      : provider === "openai" && usePro
        ? "gpt-5.4-pro"
        : undefined

  return {
    ...params,
    task,
    model: explicitModel,
    benchmark_mode: Boolean(params?.benchmark_mode || plannerSignals?.benchmark_mode),
    deep_analysis: Boolean(params?.deep_analysis || plannerSignals?.deep_analysis),
    deep_research: Boolean(params?.deep_research || plannerSignals?.deep_research),
    force_pro: Boolean(params?.force_pro || plannerSignals?.force_pro || usePro),
    metadata: {
      ...(params?.metadata ?? {}),
      routing: route,
      planner_signals: plannerSignals
    }
  }
}

function buildCandidates(results: any[]) {
  return results
    .filter((item) => Boolean(item?.ok) && hasText(item?.text))
    .map((item) => ({
      provider: item.provider,
      answer_text: item.text,
      raw: item.raw_result ?? item.raw ?? null
    }))
}

function getConflictWeight(type: string) {
  const normalized = String(type ?? "").trim().toLowerCase()

  if (normalized === "numeric_conflict") return 1
  if (normalized === "feasibility_conflict") return 0.9
  if (normalized === "risk_conflict") return 0.85
  if (normalized === "direction_conflict") return 0.8
  if (normalized === "recommendation_conflict") return 0.6
  if (normalized === "recommendation_mismatch") return 0.6
  if (normalized === "risk_mismatch") return 0.5
  if (normalized === "comparison_mismatch") return 0.35
  return 0.4
}

function getSeverityMultiplier(severity: string) {
  const normalized = String(severity ?? "").trim().toLowerCase()
  if (normalized === "high") return 1.15
  if (normalized === "medium") return 1
  return 0.85
}

function calculateConflictScore(conflicts: any[]) {
  let total = 0

  for (const conflict of conflicts ?? []) {
    const explicitWeight = Number(conflict?.weight)
    const weight = Number.isFinite(explicitWeight)
      ? explicitWeight
      : getConflictWeight(String(conflict?.type ?? ""))

    const severityMultiplier = getSeverityMultiplier(String(conflict?.severity ?? "medium"))
    total += weight * severityMultiplier
  }

  return Number(total.toFixed(4))
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
  const task = String(params?.task ?? "").trim().toLowerCase()
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

function summarizeProviderUsage(results: any[]) {
  return results.map((item) => ({
    provider: item.provider,
    role: item.role ?? "optional",
    success: Boolean(item?.ok),
    latency_ms: Number(item?.latency_ms ?? 0),
    model: item?.model ?? null,
    usage: {
      input_tokens: Number(item?.usage?.input_tokens ?? 0),
      output_tokens: Number(item?.usage?.output_tokens ?? 0),
      total_tokens: Number(item?.usage?.total_tokens ?? 0),
      estimated_cost_usd: Number(item?.usage?.estimated_cost_usd ?? 0)
    },
    error_code: item?.error_code ?? null
  }))
}

function buildProviderStatusMap(results: any[], finalProvider: string) {
  const map: Record<string, {
    provider: string
    role: string
    status: "winner" | "survived" | "failed"
    ok: boolean
    latency_ms: number
    model: string | null
    error_code: string | null
    estimated_cost_usd: number
  }> = {}

  for (const item of results ?? []) {
    const provider = normalizeProvider(item?.provider)
    if (!provider) continue

    map[provider] = {
      provider,
      role: String(item?.role ?? "optional"),
      status:
        provider === finalProvider
          ? "winner"
          : Boolean(item?.ok) && hasText(item?.text)
            ? "survived"
            : "failed",
      ok: Boolean(item?.ok),
      latency_ms: Number(item?.latency_ms ?? 0),
      model: item?.model ?? null,
      error_code: item?.error_code ?? null,
      estimated_cost_usd: Number(item?.usage?.estimated_cost_usd ?? 0)
    }
  }

  return map
}

function buildOutcomeMeta(results: any[], finalProvider: string) {
  const winner = results.find((item) => normalizeProvider(item?.provider) === finalProvider) ?? null
  const survivedCandidates = results
    .filter((item) => Boolean(item?.ok) && hasText(item?.text))
    .map((item) => ({
      provider: item.provider,
      role: item.role,
      ok: item.ok
    }))

  const failedCandidates = results
    .filter((item) => !Boolean(item?.ok) || !hasText(item?.text))
    .map((item) => ({
      provider: item.provider,
      role: item.role,
      ok: item.ok,
      error_code: item?.error_code ?? null
    }))

  const loserProviders = survivedCandidates
    .map((item) => normalizeProvider(item.provider))
    .filter((provider) => provider && provider !== finalProvider)

  const collapsedProviders = results
    .map((item) => normalizeProvider(item?.provider))
    .filter((provider) => provider && provider !== finalProvider)

  return {
    winner_provider: finalProvider,
    winner_role: winner?.role ?? null,
    loser_providers: loserProviders,
    collapsed_providers: collapsedProviders,
    survived_candidates: survivedCandidates,
    failed_candidates: failedCandidates
  }
}

function buildOrchestrationMeta(params: {
  startedAt: number
  route: any
  executed: any[]
  judged: any
  finalProvider: string
  conflictCount: number
  postEvalTriggered: boolean
  recoveryMeta: any
  transientFailures: any[]
  timelineEvents: any[]
  providerStreamSummary: Record<string, any>
}) {
  const providerUsage = summarizeProviderUsage(params.executed)
  const estimatedCostUsd = providerUsage.reduce(
    (sum, row) => sum + Number(row?.usage?.estimated_cost_usd ?? 0),
    0
  )

  const outcome = buildOutcomeMeta(params.executed, params.finalProvider)
  const providerStatusMap = buildProviderStatusMap(params.executed, params.finalProvider)
  const hiddenFailedProviders = Array.from(
    new Set(
      (params.transientFailures ?? [])
        .map((item: any) => normalizeProvider(item?.provider))
        .filter(Boolean)
    )
  )

  return {
    primary_provider: Array.isArray(params?.route?.selected_providers) ? params.route.selected_providers[0] ?? null : null,
    effective_primary_provider: params.recoveryMeta?.effective_primary_provider ?? (Array.isArray(params?.route?.selected_providers) ? params.route.selected_providers[0] ?? null : null),
    verifier_providers: Array.isArray(params?.route?.verifier_providers) ? params.route.verifier_providers : [],
    optional_providers: Array.isArray(params?.route?.optional_providers) ? params.route.optional_providers : [],
    scout_providers: Array.isArray(params?.route?.scout_providers) ? params.route.scout_providers : [],
    selected_providers: Array.isArray(params?.route?.selected_providers) ? params.route.selected_providers : [],
    fallback_providers: Array.isArray(params?.route?.fallback_providers) ? params.route.fallback_providers : [],
    parallel_providers: Array.isArray(params?.route?.parallel_providers) ? params.route.parallel_providers : [],
    executed_providers: providerUsage.map((row) => row.provider),
    selected_models: providerUsage
      .filter((row) => hasText(row?.model))
      .map((row) => ({
        provider: row.provider,
        model: row.model
      })),
    latency_ms: Date.now() - params.startedAt,
    estimated_cost_usd: Number(estimatedCostUsd.toFixed(8)),
    raw_cost_usd: Number((estimatedCostUsd + (params.recoveryMeta?.recovery_from_cost_usd ?? 0)).toFixed(8)),
    conflict_count: Number(params.conflictCount ?? 0),
    judge_confidence: Number(
      params?.judged?.meta?.judge_confidence ??
      params?.judged?.meta?.judge_scores?.[0]?.score ??
      1
    ),
    final_provider: params.finalProvider,
    post_eval_triggered: Boolean(params.postEvalTriggered),
    execution_policy: params?.route?.execution_policy ?? null,
    provider_usage: providerUsage,
    provider_status_map: providerStatusMap,
    provider_stream_summary: params.providerStreamSummary,
    hidden_failed_providers: hiddenFailedProviders,
    router_policy: params?.route?.router_policy ?? null,
    parallel_width: Number(params?.route?.parallel_width ?? providerUsage.length),
    primary_recovered: Boolean(params.recoveryMeta?.primary_recovered),
    recovery_from_model: params.recoveryMeta?.recovery_from_model ?? null,
    recovery_to_model: params.recoveryMeta?.recovery_to_model ?? null,
    recovery_reason: params.recoveryMeta?.recovery_reason ?? null,
    display_winner: {
      provider: outcome.winner_provider,
      role: outcome.winner_role
    },
    display_losers: outcome.loser_providers,
    timeline_events: params.timelineEvents ?? [],
    ...outcome
  }
}

function createRecoveryMeta() {
  return {
    primary_recovered: false,
    recovery_reason: null as string | null,
    recovery_from_model: null as string | null,
    recovery_to_model: null as string | null,
    recovery_from_cost_usd: 0,
    effective_primary_provider: "openai"
  }
}

function normalizeChunkPreview(value: any) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizePreviewText(value: any) {
  return String(value ?? "")
    .replace(/\r/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/([가-힣])\s+([가-힣])/g, "$1$2")
    .replace(/([0-9])\s+([0-9])/g, "$1$2")
    .replace(/\s+([,.:;!?%])/g, "$1")
    .replace(/([(])\s+/g, "$1")
    .replace(/\s+([)\]])/g, "$1")
    .trim()
}

function clipText(value: string, max = 220) {
  const normalized = String(value ?? "").trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max)}...`
}

function ensureProviderStreamSummary(
  providerStreamSummary: Record<string, any>,
  provider: string,
  role: string | null | undefined
) {
  if (!providerStreamSummary[provider]) {
    providerStreamSummary[provider] = {
      provider,
      role: role ?? null,
      chunk_count: 0,
      preview_text: "",
      preview_excerpt: "",
      last_non_empty_chunk: "",
      total_chars: 0
    }
  }

  providerStreamSummary[provider].role = role ?? providerStreamSummary[provider].role
  return providerStreamSummary[provider]
}

function applyFinalProviderPreview(
  providerStreamSummary: Record<string, any>,
  item: {
    provider: string
    role?: string | null
    text?: string
  }
) {
  const provider = normalizeProvider(item?.provider)
  if (!provider) return

  const row = ensureProviderStreamSummary(providerStreamSummary, provider, item?.role ?? null)
  const finalPreview = normalizePreviewText(item?.text ?? "")

  if (!finalPreview) return

  row.preview_text = clipText(finalPreview, 420)
  row.preview_excerpt = clipText(finalPreview, 160)
  row.last_non_empty_chunk = clipText(finalPreview.slice(-120), 120)
  row.total_chars = Math.max(Number(row.total_chars ?? 0), finalPreview.length)
}

async function emit(stream: any, event: any) {
  if (typeof stream !== "function") return
  await stream(event)
}

function buildRoleMap(route: any) {
  const roleMap = new Map<string, string>()

  for (const provider of route?.selected_providers ?? []) {
    roleMap.set(normalizeProvider(provider), "primary")
  }

  for (const provider of route?.verifier_providers ?? []) {
    roleMap.set(normalizeProvider(provider), "verifier")
  }

  for (const provider of route?.optional_providers ?? []) {
    roleMap.set(normalizeProvider(provider), "optional")
  }

  for (const provider of route?.scout_providers ?? []) {
    roleMap.set(normalizeProvider(provider), "scout")
  }

  return roleMap
}

function shouldRecoverOpenAIPrimary(result: any, route: any) {
  if (normalizeProvider(result?.provider) !== "openai") return false
  if (String(result?.role ?? "") !== "primary") return false
  if (!Boolean(route?.escalation?.use_pro)) return false

  const errorCode = String(result?.error_code ?? "").trim().toLowerCase()
  if (errorCode === "timeout") return true
  if (errorCode === "empty_response") return true

  return false
}

async function executeProvider(params: {
  provider: string
  role: string
  input: any
  task: string
  route: any
  plannerSignals: any
  usePro?: boolean
  emitEvent?: (event: any) => Promise<void>
}) {
  const provider = normalizeProvider(params.provider)
  let partialText = ""

  await params.emitEvent?.({
    type: "provider_start",
    provider,
    role: params.role
  })

  const result = await runAdapter({
    provider,
    task: params.task,
    message: extractInboundMessage(params.input),
    messages: params.input?.messages,
    input: buildProviderInput(
      params.input,
      params.task,
      params.route,
      provider,
      params.plannerSignals,
      Boolean(params.usePro)
    ),
    onToken: async (chunk: string) => {
      const safeChunk = typeof chunk === "string" ? chunk : String(chunk ?? "")
      if (!safeChunk) return

      partialText += safeChunk

      await params.emitEvent?.({
        type: "provider_chunk",
        provider,
        role: params.role,
        content: safeChunk
      })
    },
    onEvent: async (event: any) => {
      if (!event || typeof event !== "object") return
      if (event?.type === "provider_chunk") return

      await params.emitEvent?.({
        type: "provider_event",
        provider,
        role: params.role,
        event
      })
    }
  })

  const finalText = pickText(result, partialText)

  const normalizedResult = {
    provider,
    role: params.role,
    ok: Boolean(result?.ok) && hasText(finalText),
    text: finalText,
    raw_result: result,
    model: result?.model ?? null,
    latency_ms: Number(result?.latency_ms ?? 0),
    usage: result?.usage ?? {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      estimated_cost_usd: 0
    },
    error_code: result?.error_code ?? null
  }

  await params.emitEvent?.({
    type: "provider_done",
    provider,
    role: params.role,
    ok: normalizedResult.ok,
    latency_ms: normalizedResult.latency_ms,
    model: normalizedResult.model
  })

  return normalizedResult
}

export async function executeOrchestra(input: any, stream?: any) {
  const startedAt = Date.now()
  const inboundMessage = extractInboundMessage(input)
  const planner = planRequest(inboundMessage)
  const plannerSignals = extractPlanningSignals(inboundMessage)
  const transientFailures: any[] = []
  const recoveryMeta = createRecoveryMeta()
  const timelineEvents: any[] = []
  const providerStreamSummary: Record<string, {
    provider: string
    role: string | null
    chunk_count: number
    preview_text: string
    preview_excerpt: string
    last_non_empty_chunk: string
    total_chars: number
  }> = {}

  const emitTracked = async (event: any) => {
    if (event && typeof event === "object") {
      const provider = normalizeProvider(event.provider)
      const eventType = String(event.type ?? "")

      if (eventType === "provider_chunk" && provider) {
        const cleanChunk = normalizeChunkPreview(event.content)
        const row = ensureProviderStreamSummary(providerStreamSummary, provider, event.role ?? null)

        row.chunk_count += 1

        if (cleanChunk) {
          row.last_non_empty_chunk = cleanChunk
          row.total_chars += cleanChunk.length

          const merged = normalizePreviewText(`${row.preview_text} ${cleanChunk}`.trim())
          row.preview_text = clipText(merged, 420)
          row.preview_excerpt = clipText(row.preview_text, 160)
        }
      } else {
        timelineEvents.push({
          type: eventType,
          provider: event.provider ?? null,
          role: event.role ?? null,
          ok: typeof event.ok === "boolean" ? event.ok : null,
          model: event.model ?? null,
          reason: event.reason ?? null
        })
      }
    }

    await emit(stream, event)
  }

  const task =
    String(input?.task ?? planner?.task ?? detectTaskType(inboundMessage))
      .trim()
      .toLowerCase() || "dialogue"

  const scoreboardBefore = readScoreboard()

  const route = resolveAdaptiveRoute({
    ...input,
    task,
    benchmark_mode: Boolean(input?.benchmark_mode || plannerSignals?.benchmark_mode),
    deep_analysis: Boolean(input?.deep_analysis || plannerSignals?.deep_analysis),
    deep_research: Boolean(input?.deep_research || plannerSignals?.deep_research),
    force_pro: Boolean(input?.force_pro || plannerSignals?.force_pro)
  })

  const selectedProviders = Array.isArray(route?.selected_providers) ? route.selected_providers : []
  const verifierProviders = Array.isArray(route?.verifier_providers) ? route.verifier_providers : []
  const optionalProviders = Array.isArray(route?.optional_providers) ? route.optional_providers : []
  const scoutProviders = Array.isArray(route?.scout_providers) ? route.scout_providers : []
  const fallbackProviders = Array.isArray(route?.fallback_providers) ? route.fallback_providers : []

  const firstWaveProviders = uniqueProviders(
    Array.isArray(route?.parallel_providers) && route.parallel_providers.length > 0
      ? route.parallel_providers
      : [...selectedProviders, ...verifierProviders, ...optionalProviders, ...scoutProviders]
  )

  const roleMap = buildRoleMap(route)

  await emitTracked({
    type: "start",
    task,
    route: {
      selected_providers: selectedProviders,
      verifier_providers: verifierProviders,
      optional_providers: optionalProviders,
      scout_providers: scoutProviders,
      fallback_providers: fallbackProviders,
      parallel_providers: firstWaveProviders,
      router_policy: route?.router_policy ?? null
    }
  })

  let executed = await Promise.all(
    firstWaveProviders.map((provider) =>
      executeProvider({
        provider,
        role: roleMap.get(normalizeProvider(provider)) ?? "optional",
        input,
        task,
        route,
        plannerSignals,
        usePro: Boolean(route?.escalation?.use_pro) && normalizeProvider(provider) === "openai",
        emitEvent: emitTracked
      })
    )
  )

  for (const item of executed) {
    applyFinalProviderPreview(providerStreamSummary, item)
  }

  let primaryResultInitial =
    executed.find((item) => item.provider === normalizeProvider(selectedProviders[0] ?? "openai")) ??
    executed.find((item) => item.provider === "openai") ??
    null

  if (primaryResultInitial && shouldRecoverOpenAIPrimary(primaryResultInitial, route)) {
    transientFailures.push({
      ...primaryResultInitial,
      transient_failed_primary: true
    })

    recoveryMeta.primary_recovered = true
    recoveryMeta.recovery_reason = primaryResultInitial.error_code ?? null
    recoveryMeta.recovery_from_model = primaryResultInitial.model ?? null
    recoveryMeta.recovery_from_cost_usd = Number(primaryResultInitial?.usage?.estimated_cost_usd ?? 0)

    await emitTracked({
      type: "primary_recovery_start",
      provider: "openai",
      role: "primary",
      reason: primaryResultInitial.error_code
    })

    const recoveredPrimary = await executeProvider({
      provider: "openai",
      role: "primary",
      input: {
        ...input,
        model: "gpt-5.4",
        force_pro: false,
        use_pro: false,
        benchmark_mode: false,
        deep_analysis: false,
        deep_research: false,
        allow_auto_promote_pro: false,
        metadata: {
          ...(input?.metadata ?? {}),
          openai_primary_recovery: true
        }
      },
      task,
      route: {
        ...route,
        escalation: {
          ...(route?.escalation ?? {}),
          use_pro: false
        }
      },
      plannerSignals: {
        ...plannerSignals,
        force_pro: false,
        benchmark_mode: false,
        deep_analysis: false,
        deep_research: false
      },
      usePro: false,
      emitEvent: emitTracked
    })

    recoveryMeta.recovery_to_model = recoveredPrimary.model ?? "gpt-5.4"
    recoveryMeta.effective_primary_provider = recoveredPrimary.ok ? "openai" : (selectedProviders[0] ?? "openai")

    executed = [
      ...executed.filter((item) => !(item.provider === "openai" && item.role === "primary")),
      recoveredPrimary
    ]

    applyFinalProviderPreview(providerStreamSummary, recoveredPrimary)

    primaryResultInitial = recoveredPrimary

    await emitTracked({
      type: "primary_recovery_done",
      provider: "openai",
      role: "primary",
      ok: recoveredPrimary.ok,
      model: recoveredPrimary.model,
      error_code: recoveredPrimary.error_code
    })
  }

  const primaryProvider = normalizeProvider(selectedProviders[0] ?? "openai")
  const successfulInitial = executed.filter((item) => item.ok && hasText(item.text))

  const shouldRunFallback =
    !primaryResultInitial?.ok ||
    !hasText(primaryResultInitial?.text) ||
    (successfulInitial.length === 0 && fallbackProviders.length > 0)

  if (shouldRunFallback && fallbackProviders.length > 0) {
    const additionalProviders = uniqueProviders(fallbackProviders).filter(
      (provider) => !executed.some((item) => item.provider === provider)
    ).slice(0, 2)

    if (additionalProviders.length > 0) {
      const fallbackResults = await Promise.all(
        additionalProviders.map((provider) =>
          executeProvider({
            provider,
            role: "fallback",
            input,
            task,
            route,
            plannerSignals,
            usePro: false,
            emitEvent: emitTracked
          })
        )
      )

      for (const item of fallbackResults) {
        applyFinalProviderPreview(providerStreamSummary, item)
      }

      executed = [...executed, ...fallbackResults]
    }
  }

  const successfulResults = executed.filter((item) => item.ok && hasText(item.text))
  const candidateClaims = successfulResults.map((item) => ({
    provider: item.provider,
    claims: extractClaims(item.text)
  }))
  const detectedConflicts = detectConflicts(candidateClaims)
  let weightedConflictScore = calculateConflictScore(detectedConflicts)

  let candidates = buildCandidates(successfulResults)
  let judged: any = null

  if (candidates.length > 1) {
    judged = await judge({
      candidates,
      task
    })
  } else if (candidates.length === 1) {
    judged = {
      ...candidates[0],
      ok: true,
      meta: {
        judge_selected_provider: candidates[0].provider,
        judge_scores: [
          {
            provider: candidates[0].provider,
            score: 1,
            reasons: ["single_candidate"]
          }
        ],
        judge_rationale: "single_candidate",
        judge_confidence: 1,
        conflict_count: detectedConflicts.length,
        conflicts: detectedConflicts,
        claims: candidateClaims
      }
    }
  }

  const verifierProvider = normalizeProvider(verifierProviders[0] ?? "")
  const verifierResult = executed.find((item) => item.provider === verifierProvider) ?? null
  const primaryResult = executed.find((item) => item.provider === primaryProvider) ?? primaryResultInitial ?? null

  const verifierDisagreement =
    Boolean(primaryResult?.ok) &&
    Boolean(verifierResult?.ok) &&
    hasText(primaryResult?.text) &&
    hasText(verifierResult?.text) &&
    String(primaryResult?.text).trim() !== String(verifierResult?.text).trim()

  const judgeConfidence = Number(
    judged?.meta?.judge_confidence ??
    judged?.meta?.judge_scores?.[0]?.score ??
    1
  )

  const conflictCount = Number(
    judged?.meta?.conflict_count ??
    detectedConflicts.length ??
    0
  )

  const needPostEvalPro =
    !Boolean(route?.escalation?.use_pro) &&
    primaryProvider === "openai" &&
    shouldEscalateAfterEval({
      task,
      weighted_conflict_score: weightedConflictScore,
      verifier_disagreement: verifierDisagreement,
      judge_confidence: judgeConfidence,
      conflict_count: conflictCount,
      planner_signals: plannerSignals
    })

  let postEvalTriggered = false

  if (needPostEvalPro) {
    const proResult = await executeProvider({
      provider: "openai",
      role: "primary",
      input,
      task,
      route,
      plannerSignals,
      usePro: true,
      emitEvent: emitTracked
    })

    executed = [
      ...executed.filter((item) => !(item.provider === "openai" && item.role === "primary")),
      proResult
    ]

    applyFinalProviderPreview(providerStreamSummary, proResult)

    if (proResult.ok && hasText(proResult.text)) {
      postEvalTriggered = true

      const nextSuccessful = executed.filter((item) => item.ok && hasText(item.text))
      const nextCandidateClaims = nextSuccessful.map((item) => ({
        provider: item.provider,
        claims: extractClaims(item.text)
      }))
      const nextDetectedConflicts = detectConflicts(nextCandidateClaims)
      weightedConflictScore = calculateConflictScore(nextDetectedConflicts)

      candidates = buildCandidates(nextSuccessful)

      if (candidates.length > 1) {
        judged = await judge({
          candidates,
          task
        })
      } else if (candidates.length === 1) {
        judged = {
          ...candidates[0],
          ok: true,
          meta: {
            judge_selected_provider: candidates[0].provider,
            judge_scores: [
              {
                provider: candidates[0].provider,
                score: 1,
                reasons: ["single_candidate_after_escalation"]
              }
            ],
            judge_rationale: "single_candidate_after_escalation",
            judge_confidence: 1,
            conflict_count: nextDetectedConflicts.length,
            conflicts: nextDetectedConflicts,
            claims: nextCandidateClaims
          }
        }
      }
    }
  }

  const refreshedSuccessful = executed.filter((item) => item.ok && hasText(item.text))
  const finalClaimMap = refreshedSuccessful.map((item) => ({
    provider: item.provider,
    claims: extractClaims(item.text)
  }))
  const finalDetectedConflicts = detectConflicts(finalClaimMap)

  const finalResult =
    (judged?.provider
      ? refreshedSuccessful.find((item) => item.provider === normalizeProvider(judged.provider))
      : null) ??
    refreshedSuccessful.find((item) => item.provider === primaryProvider) ??
    refreshedSuccessful.find((item) => item.provider === "openai") ??
    refreshedSuccessful[0] ??
    executed.find((item) => item.provider === primaryProvider) ??
    executed.find((item) => item.provider === "openai") ??
    executed[0] ?? {
      provider: "openai",
      role: "primary",
      ok: false,
      text: "",
      raw_result: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0
      }
    }

  applyFinalProviderPreview(providerStreamSummary, finalResult)

  const finalProvider = normalizeProvider(
    judged?.meta?.judge_selected_provider ??
    judged?.provider ??
    finalResult?.provider ??
    "openai"
  )

  const finalRole =
    executed.find((item) => item.provider === finalProvider)?.role ??
    (selectedProviders.includes(finalProvider)
      ? "primary"
      : verifierProviders.includes(finalProvider)
        ? "verifier"
        : optionalProviders.includes(finalProvider)
          ? "optional"
          : scoutProviders.includes(finalProvider)
            ? "scout"
            : "fallback")

  const finalConflicts =
    Array.isArray(judged?.meta?.conflicts) && judged.meta.conflicts.length > 0
      ? judged.meta.conflicts
      : finalDetectedConflicts

  const finalConflictCount = Number(
    judged?.meta?.conflict_count ??
    finalConflicts.length ??
    0
  )

  const finalJudgeConfidence = Number(
    judged?.meta?.judge_confidence ??
    judged?.meta?.judge_scores?.[0]?.score ??
    1
  )

  for (const row of executed) {
    recordProviderExecution(row.provider, {
      success: Boolean(row?.ok),
      latency_ms: Number(row?.latency_ms ?? 0),
      estimated_cost_usd: Number(row?.usage?.estimated_cost_usd ?? 0),
      selected_as_final: row.provider === finalProvider,
      effective: true,
      weight: 1,
      error_code: row?.error_code ?? null
    })
  }

  for (const row of transientFailures) {
    recordProviderExecution(row.provider, {
      success: false,
      latency_ms: Number(row?.latency_ms ?? 0),
      estimated_cost_usd: Number(row?.usage?.estimated_cost_usd ?? 0),
      selected_as_final: false,
      effective: false,
      weight: 0,
      error_code: row?.error_code ?? null
    })
  }

  const scoreboardAfter = readScoreboard()
  const orchestrationMeta = buildOrchestrationMeta({
    startedAt,
    route,
    executed,
    judged,
    finalProvider,
    conflictCount: finalConflictCount,
    postEvalTriggered,
    recoveryMeta,
    transientFailures,
    timelineEvents,
    providerStreamSummary
  })

  const outcome = buildOutcomeMeta(executed, finalProvider)
  const providerStatusMap = buildProviderStatusMap(executed, finalProvider)
  const hiddenFailedProviders = Array.from(new Set(transientFailures.map((item) => normalizeProvider(item?.provider)).filter(Boolean)))

  await emitTracked({
    type: "judge",
    provider: finalProvider,
    role: finalRole,
    confidence: finalJudgeConfidence,
    conflict_count: finalConflictCount
  })

  await emitTracked({
    type: "final",
    provider: finalProvider,
    role: finalRole,
    content: String(finalResult?.text ?? "")
  })

  await emitTracked({
    type: "done",
    provider: finalProvider,
    role: finalRole,
    content: String(finalResult?.text ?? ""),
    meta: {
      task,
      conflict_count: finalConflictCount,
      judge_confidence: finalJudgeConfidence
    }
  })

  return {
    final_answer: {
      provider: finalProvider,
      role: finalRole,
      text: String(finalResult?.text ?? ""),
      ok: Boolean(finalResult?.ok)
    },
    response_meta: {
      orchestration: orchestrationMeta
    },
    route,
    primary: primaryResult
      ? {
          provider: primaryResult.provider,
          role: primaryResult.role,
          text: primaryResult.text,
          ok: primaryResult.ok,
          raw: primaryResult.raw_result ?? null
        }
      : null,
    verifier: verifierResult
      ? {
          provider: verifierResult.provider,
          role: verifierResult.role,
          text: verifierResult.text,
          ok: verifierResult.ok,
          raw: verifierResult.raw_result ?? null
        }
      : null,
    optional_results: executed
      .filter((item) => String(item?.role ?? "") === "optional")
      .map((item) => ({
        provider: item.provider,
        role: item.role,
        text: item.text,
        ok: item.ok,
        raw: item.raw_result ?? null
      })),
    scout_results: executed
      .filter((item) => String(item?.role ?? "") === "scout")
      .map((item) => ({
        provider: item.provider,
        role: item.role,
        text: item.text,
        ok: item.ok,
        raw: item.raw_result ?? null
      })),
    fallback_results: executed
      .filter((item) => String(item?.role ?? "") === "fallback")
      .map((item) => ({
        provider: item.provider,
        role: item.role,
        text: item.text,
        ok: item.ok,
        raw: item.raw_result ?? null
      })),
    winner: {
      provider: outcome.winner_provider,
      role: outcome.winner_role
    },
    loser_providers: outcome.loser_providers,
    collapsed_providers: outcome.collapsed_providers,
    survived_candidates: outcome.survived_candidates,
    failed_candidates: outcome.failed_candidates,
    hidden_failed_providers: hiddenFailedProviders,
    display_winner: {
      provider: outcome.winner_provider,
      role: outcome.winner_role
    },
    display_losers: outcome.loser_providers,
    effective_primary_provider: recoveryMeta.effective_primary_provider,
    primary_recovered: recoveryMeta.primary_recovered,
    recovery_from_model: recoveryMeta.recovery_from_model,
    recovery_to_model: recoveryMeta.recovery_to_model,
    provider_status_map: providerStatusMap,
    provider_stream_summary: providerStreamSummary,
    timeline_events: timelineEvents,
    transient_failures: transientFailures.map((item) => ({
      provider: item.provider,
      role: item.role,
      model: item.model,
      error_code: item.error_code,
      latency_ms: item.latency_ms,
      estimated_cost_usd: Number(item?.usage?.estimated_cost_usd ?? 0)
    })),
    raw: executed.map((item) => ({
      provider: item.provider,
      role: item.role,
      ok: item.ok,
      text: item.text,
      raw: item.raw_result ?? null
    })),
    internal_rationale: {
      task,
      planner: planner ?? {
        task,
        signals: plannerSignals
      },
      planner_signals: plannerSignals,
      route,
      executed_providers: summarizeProviderUsage(executed),
      claims: finalClaimMap,
      conflicts: finalConflicts,
      conflict_score: calculateConflictScore(finalConflicts),
      conflict_count: finalConflictCount,
      judge: {
        selected_provider: finalProvider,
        selected_role: finalRole,
        confidence: finalJudgeConfidence,
        scores: Array.isArray(judged?.meta?.judge_scores) ? judged.meta.judge_scores : [],
        rationale: judged?.meta?.judge_rationale ?? null
      },
      outcome,
      provider_status_map: providerStatusMap,
      provider_stream_summary: providerStreamSummary,
      hidden_failed_providers: hiddenFailedProviders,
      transient_failures: transientFailures,
      recovery: recoveryMeta,
      escalation: {
        pre_routing_use_pro: Boolean(route?.escalation?.use_pro),
        post_eval_triggered: postEvalTriggered
      },
      verifier_disagreement: verifierDisagreement,
      scoreboard_before: scoreboardBefore,
      scoreboard_after: scoreboardAfter,
      timeline_events: timelineEvents
    }
  }
}
