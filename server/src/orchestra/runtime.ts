import { runAdapter } from "./adapterDispatcher.js"
import { resolveAdaptiveRoute } from "./adaptiveRouter.js"
import { judge } from "./judge.js"
import { detectTaskType, extractPlanningSignals, planRequest } from "./planner.js"
import { extractClaims } from "./claims.js"
import { detectConflicts } from "./conflicts.js"
import { readScoreboard, recordProviderExecution, recordProviderConflict } from "./scoreboard.js"
import { getLatestProjectContext } from "../memory/projectMemory.js"
import { getProjectThreadMemories, findSimilarQuery } from "../memory/threadMemory.js"

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

function buildThreadFusionBlock(
  projectId: string,
  currentThreadId: string,
  query: string
): string {
  if (!projectId || !query || query.length < 10) return ""

  // 같은 프로젝트의 다른 스레드 전체 로드
  const allThreads = getProjectThreadMemories(projectId)
    .filter((t) => t.thread_id !== currentThreadId)

  if (allThreads.length === 0) return ""

  // 1. 유사 쿼리 검색 (threshold 낮춰서 더 많이 잡기)
  const similarResults = findSimilarQuery(query, projectId, {
    threshold: 0.20,
    limit: 5
  })

  const relevantThreads = similarResults.filter(
    (r) => r.thread_id !== currentThreadId && r.matched_answer?.trim()
  )

  // 2. 엔티티 기반 추가 매칭 — 고유명사/핵심어 겹치는 스레드 찾기
  const queryEntities = query
    .split(/[\s,./!?:;]+/)
    .filter((w) => w.length >= 2 && /[A-Z가-힣]/.test(w))
    .map((w) => w.toLowerCase())

  const entityMatchThreads = allThreads.filter((t) => {
    if (relevantThreads.some((r) => r.thread_id === t.thread_id)) return false
    const threadText = [
      t.title ?? "",
      ...(t.structured?.decisions ?? []),
      ...(t.structured?.facts ?? []),
      ...(t.structured?.entities ?? [])
    ].join(" ").toLowerCase()
    return queryEntities.filter((e) => threadText.includes(e)).length >= 2
  }).slice(0, 2)

  // 3. 최신 스레드 structured memory (항상 주입 — 유사도 무관)
  const recentThreads = allThreads.slice(0, 5)

  const threadDecisions: string[] = []
  const threadFacts: string[] = []
  const threadEntities: string[] = []

  for (const thread of recentThreads) {
    threadDecisions.push(...(thread.structured?.decisions ?? []).slice(0, 3))
    threadFacts.push(...(thread.structured?.facts ?? []).slice(0, 3))
    threadEntities.push(...(thread.structured?.entities ?? []).slice(0, 5))
  }

  const uniqueDecisions = [...new Set(threadDecisions)].slice(0, 6)
  const uniqueFacts = [...new Set(threadFacts)].slice(0, 6)

  // 아무것도 없으면 빈 문자열
  const hasContent =
    relevantThreads.length > 0 ||
    entityMatchThreads.length > 0 ||
    uniqueDecisions.length > 0 ||
    uniqueFacts.length > 0

  if (!hasContent) return ""

  const lines: string[] = ["[THREAD MEMORY]", ""]

  // 유사 쿼리 매칭 결과
  for (const result of relevantThreads.slice(0, 3)) {
    const title = allThreads.find((t) => t.thread_id === result.thread_id)?.title
    lines.push(`[관련 스레드${title ? ` — ${title}` : ""}]`)
    lines.push(result.matched_answer.slice(0, 500))
    lines.push("")
  }

  // 엔티티 매칭 스레드
  for (const thread of entityMatchThreads) {
    const summary = thread.structured?.summary?.slice(0, 300) ?? ""
    if (summary) {
      lines.push(`[관련 스레드${thread.title ? ` — ${thread.title}` : ""}]`)
      lines.push(summary)
      lines.push("")
    }
  }

  // 프로젝트 전체 결정사항/사실 (항상 주입)
  if (uniqueDecisions.length > 0) {
    lines.push("[프로젝트 주요 결정사항]")
    lines.push(...uniqueDecisions)
    lines.push("")
  }

  if (uniqueFacts.length > 0) {
    lines.push("[프로젝트 핵심 사실]")
    lines.push(...uniqueFacts)
    lines.push("")
  }

  return lines.join("\n").trim()
}

function buildProjectContextBlock(projectContext: any) {
  const retrieval = projectContext?.retrieval_context ?? {}

  const summary = Array.isArray(retrieval?.summary) ? retrieval.summary : []
  const decisions = Array.isArray(retrieval?.decisions) ? retrieval.decisions : []
  const facts = Array.isArray(retrieval?.facts) ? retrieval.facts : []
  const sources = Array.isArray(retrieval?.sources) ? retrieval.sources : []

  const hasAny =
    summary.length > 0 ||
    decisions.length > 0 ||
    facts.length > 0 ||
    sources.length > 0

  if (!hasAny) return ""

  return [
    "[PROJECT CONTEXT]",
    "",
    "[SUMMARY]",
    ...summary,
    "",
    "[DECISIONS]",
    ...decisions,
    "",
    "[FACTS]",
    ...facts,
    "",
    "[SOURCES]",
    ...sources
  ].join("\n").trim()
}

function buildInputWithRetrievalContext(input: any, rawInboundMessage: string) {
  const projectId = String(input?.project_id ?? "").trim()
  if (!projectId) {
    return {
      effectiveInput: input,
      retrievalContext: null,
      enrichedInboundMessage: rawInboundMessage
    }
  }

  const rawText = String(rawInboundMessage ?? "").trim()

  const skipContextPatterns = [
    "안녕", "hi", "hello", "반가워", "잘 부탁",
    "감사합니다", "고마워", "thanks"
  ]
  const shouldSkipContext =
    rawText.length < 20 ||
    skipContextPatterns.some((p) => rawText.toLowerCase().includes(p))

  // query-aware: rawText를 전달해 관련 소스만 검색
  const projectContext = getLatestProjectContext(projectId, shouldSkipContext ? undefined : rawText)
  const contextBlock = buildProjectContextBlock(projectContext)

  if (!contextBlock) {
    return {
      effectiveInput: input,
      retrievalContext: projectContext,
      enrichedInboundMessage: rawInboundMessage
    }
  }

  if (shouldSkipContext) {
    return {
      effectiveInput: input,
      retrievalContext: projectContext,
      enrichedInboundMessage: rawText
    }
  }

  if (rawText.includes("[PROJECT CONTEXT]")) {
    return {
      effectiveInput: {
        ...input,
        metadata: {
          ...(input?.metadata ?? {}),
          retrieval_context: projectContext?.retrieval_context ?? null
        }
      },
      retrievalContext: projectContext,
      enrichedInboundMessage: rawText
    }
  }

  // Thread fusion: 같은 프로젝트의 다른 스레드 자동 검색/주입
  const currentThreadId = String(input?.thread_id ?? "").trim()
  const threadFusionBlock = buildThreadFusionBlock(projectId, currentThreadId, rawText)

  const fullContextBlock = threadFusionBlock
    ? `${contextBlock}\n\n${threadFusionBlock}`
    : contextBlock

  const enrichedInboundMessage = `${fullContextBlock}

[USER INPUT]
${rawText}`.trim()

  // messages 배열이 있을 경우 마지막 user 메시지를 enrichedInboundMessage로 교체
  // 그렇지 않으면 adapterDispatcher가 messages 배열을 우선 사용하여 PROJECT CONTEXT가 무시됨
  const inputMessages = Array.isArray(input?.messages) ? input.messages : []
  let updatedMessages: typeof inputMessages | undefined = undefined

  if (inputMessages.length > 0) {
    // 마지막 user 메시지 인덱스 찾기
    let lastUserIdx = -1
    for (let i = inputMessages.length - 1; i >= 0; i--) {
      if (String(inputMessages[i]?.role ?? "").trim().toLowerCase() === "user") {
        lastUserIdx = i
        break
      }
    }

    if (lastUserIdx >= 0) {
      updatedMessages = inputMessages.map((msg: any, idx: number) => {
        if (idx !== lastUserIdx) return msg
        return {
          ...msg,
          content: enrichedInboundMessage
        }
      })
    }
  }

  const retrievalMeta = {
    project_facts: (projectContext?.retrieval_context?.facts?.length ?? 0),
    project_decisions: (projectContext?.retrieval_context?.decisions?.length ?? 0),
    matched_sources: Number(projectContext?.matched_source_count ?? 0),
    thread_fusions: threadFusionBlock.length > 0 ? 1 : 0,
    query_matched: rawText.length >= 10
  }

  return {
    effectiveInput: {
      ...input,
      message: enrichedInboundMessage,
      ...(updatedMessages ? { messages: updatedMessages } : {}),
      metadata: {
        ...(input?.metadata ?? {}),
        retrieval_context: projectContext?.retrieval_context ?? null,
        retrieval_meta: retrievalMeta,
        thread_fusion_applied: threadFusionBlock.length > 0
      }
    },
    retrievalContext: projectContext,
    retrievalMeta,
    enrichedInboundMessage
  }
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
      raw: {
        role: item.role,
        model: item.model ?? null,
        latency_ms: Number(item?.latency_ms ?? 0),
        usage: item?.usage ?? null
      }
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

function summarizeConflictBuckets(conflicts: any[]) {
  const rows = Array.isArray(conflicts) ? conflicts : []

  const contextConflicts = rows.filter((item) =>
    Array.isArray(item?.providers) && item.providers.includes("context")
  )

  const providerConflicts = rows.filter((item) =>
    !(Array.isArray(item?.providers) && item.providers.includes("context"))
  )

  return {
    total: rows.length,
    context_conflicts: contextConflicts.length,
    provider_conflicts: providerConflicts.length,
    high: rows.filter((item) => String(item?.severity ?? "") === "high").length,
    medium: rows.filter((item) => String(item?.severity ?? "") === "medium").length,
    low: rows.filter((item) => String(item?.severity ?? "") === "low").length
  }
}

function buildSelectionTrace(judged: any, finalProvider: string, finalRole: string, finalConflicts: any[]) {
  const scores = Array.isArray(judged?.meta?.judge_scores) ? judged.meta.judge_scores : []
  const selected = scores.find((row: any) => normalizeProvider(row?.provider) === normalizeProvider(finalProvider)) ?? null
  const buckets = summarizeConflictBuckets(finalConflicts)

  return {
    selected_provider: finalProvider,
    selected_role: finalRole,
    judge_rationale: judged?.meta?.judge_rationale ?? null,
    judge_confidence: Number(
      judged?.meta?.judge_confidence ??
      judged?.meta?.judge_scores?.[0]?.score ??
      1
    ),
    selected_score: Number(selected?.score ?? 0),
    selected_reasons: Array.isArray(selected?.reasons) ? selected.reasons : [],
    conflict_buckets: buckets
  }
}

function buildWinnerReason(trace: any) {
  const reasons = Array.isArray(trace?.selected_reasons) ? trace.selected_reasons : []
  const topReasons = reasons.slice(0, 6)

  return {
    provider: trace?.selected_provider ?? null,
    role: trace?.selected_role ?? null,
    rationale: trace?.judge_rationale ?? null,
    confidence: Number(trace?.judge_confidence ?? 0),
    top_reasons: topReasons,
    context_conflicts: Number(trace?.conflict_buckets?.context_conflicts ?? 0),
    provider_conflicts: Number(trace?.conflict_buckets?.provider_conflicts ?? 0)
  }
}

function summarizeProviderConflictLearning(conflicts: any[], providerInput: string) {
  const provider = normalizeProvider(providerInput)
  if (!provider) {
    return {
      context_conflicts: 0,
      provider_conflicts: 0,
      penalty: 0,
      conflict_types: []
    }
  }

  const rows = Array.isArray(conflicts) ? conflicts : []
  const related = rows.filter((row) =>
    Array.isArray(row?.providers) && row.providers.map(normalizeProvider).includes(provider)
  )

  const contextConflicts = related.filter((row) =>
    Array.isArray(row?.providers) && row.providers.map(normalizeProvider).includes("context")
  )

  const providerOnlyConflicts = related.filter((row) =>
    !(Array.isArray(row?.providers) && row.providers.map(normalizeProvider).includes("context"))
  )

  const penalty = related.reduce((sum, row) => {
    const weight = Number(row?.weight)
    return sum + (Number.isFinite(weight) ? weight : 0)
  }, 0)

  const typeMap = new Map<string, { type: string; count: number; weight: number }>()

  for (const row of related) {
    const rawType = String(row?.type ?? "").trim().toLowerCase() || "other"
    const existing = typeMap.get(rawType)

    const nextCount = (existing?.count ?? 0) + 1
    const nextWeight = (existing?.weight ?? 0) + (Number.isFinite(Number(row?.weight)) ? Number(row?.weight) : 0)

    typeMap.set(rawType, {
      type: rawType,
      count: nextCount,
      weight: Number(nextWeight.toFixed(4))
    })
  }

  return {
    context_conflicts: contextConflicts.length,
    provider_conflicts: providerOnlyConflicts.length,
    penalty: Number(penalty.toFixed(4)),
    conflict_types: Array.from(typeMap.values())
  }
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
  finalConflicts: any[]
  postEvalTriggered: boolean
  recoveryMeta: any
  transientFailures: any[]
  timelineEvents: any[]
  providerStreamSummary: Record<string, any>
  retrievalContext: any
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

  const conflictBuckets = summarizeConflictBuckets(params.finalConflicts)
  const selectionTrace = buildSelectionTrace(
    params.judged,
    params.finalProvider,
    outcome.winner_role ?? null,
    params.finalConflicts
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
    conflict_buckets: conflictBuckets,
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
    selection_trace: selectionTrace,
    winner_reason: buildWinnerReason(selectionTrace),
    retrieval_context: params.retrievalContext?.retrieval_context ?? null,
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

function getProviderRole(route: any, provider: string) {
  const normalized = normalizeProvider(provider)
  if (Array.isArray(route?.selected_providers) && route.selected_providers.map(normalizeProvider).includes(normalized)) return "primary"
  if (Array.isArray(route?.verifier_providers) && route.verifier_providers.map(normalizeProvider).includes(normalized)) return "verifier"
  if (Array.isArray(route?.optional_providers) && route.optional_providers.map(normalizeProvider).includes(normalized)) return "optional"
  if (Array.isArray(route?.scout_providers) && route.scout_providers.map(normalizeProvider).includes(normalized)) return "scout"
  return "fallback"
}

function getJudgeScore(judged: any, provider: string) {
  const scores = Array.isArray(judged?.meta?.judge_scores) ? judged.meta.judge_scores : []
  const row = scores.find((item: any) => normalizeProvider(item?.provider) === normalizeProvider(provider))
  return Number(row?.score ?? 0)
}

function shouldKeepPrimaryWinner(params: {
  route: any
  judged: any
  executed: any[]
  primaryProvider: string
}) {
  const primaryProvider = normalizeProvider(params.primaryProvider)
  if (!primaryProvider) return false

  const selectedByJudge = normalizeProvider(
    params?.judged?.meta?.judge_selected_provider ??
    params?.judged?.provider ??
    ""
  )

  if (!selectedByJudge) return false
  if (selectedByJudge === primaryProvider) return false

  const primaryRow = params.executed.find((item) => normalizeProvider(item?.provider) === primaryProvider)
  const selectedRow = params.executed.find((item) => normalizeProvider(item?.provider) === selectedByJudge)

  if (!primaryRow?.ok || !hasText(primaryRow?.text)) return false
  if (!selectedRow?.ok || !hasText(selectedRow?.text)) return false

  const selectedRole = getProviderRole(params.route, selectedByJudge)
  if (selectedRole !== "verifier" && selectedRole !== "optional") return false

  const primaryScore = getJudgeScore(params.judged, primaryProvider)
  const selectedScore = getJudgeScore(params.judged, selectedByJudge)
  const gap = selectedScore - primaryScore
  const confidence = Number(params?.judged?.meta?.judge_confidence ?? 0)

  if (selectedRole === "optional") {
    return gap < 0.08 || confidence < 0.72
  }

  if (selectedRole === "verifier") {
    return false  // verifier가 더 좋으면 verifier 선택
  }

  return false
}

function enforcePrimaryWinner(params: {
  judged: any
  primaryProvider: string
}) {
  const primaryProvider = normalizeProvider(params.primaryProvider)
  if (!primaryProvider) return params.judged

  const scores = Array.isArray(params?.judged?.meta?.judge_scores)
    ? params.judged.meta.judge_scores
    : []

  return {
    ...params.judged,
    provider: primaryProvider,
    meta: {
      ...(params?.judged?.meta ?? {}),
      judge_selected_provider: primaryProvider,
      judge_rationale: `primary_survival_bias:${params?.judged?.meta?.judge_rationale ?? "override"}`,
      judge_scores: scores.map((row: any) =>
        normalizeProvider(row?.provider) === primaryProvider
          ? {
              ...row,
              reasons: Array.isArray(row?.reasons)
                ? [...row.reasons, "primary_survival_bias"]
                : ["primary_survival_bias"]
            }
          : row
      )
    }
  }
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
  const rawInboundMessage = extractInboundMessage(input)
  const planner = planRequest(rawInboundMessage)
  const plannerSignals = extractPlanningSignals(rawInboundMessage)
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

  const { effectiveInput, retrievalContext, retrievalMeta, enrichedInboundMessage } =
    buildInputWithRetrievalContext(input, rawInboundMessage)

  const inboundMessage = enrichedInboundMessage

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
    String(effectiveInput?.task ?? planner?.task ?? detectTaskType(rawInboundMessage))
      .trim()
      .toLowerCase() || "dialogue"

  const scoreboardBefore = readScoreboard()

  const route = resolveAdaptiveRoute({
    ...effectiveInput,
    task,
    benchmark_mode: Boolean(effectiveInput?.benchmark_mode || plannerSignals?.benchmark_mode),
    deep_analysis: Boolean(effectiveInput?.deep_analysis || plannerSignals?.deep_analysis),
    deep_research: Boolean(effectiveInput?.deep_research || plannerSignals?.deep_research),
    force_pro: Boolean(effectiveInput?.force_pro || plannerSignals?.force_pro)
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
        input: effectiveInput,
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
        ...effectiveInput,
        model: "gpt-5.4",
        force_pro: false,
        use_pro: false,
        benchmark_mode: false,
        deep_analysis: false,
        deep_research: false,
        allow_auto_promote_pro: false,
        metadata: {
          ...(effectiveInput?.metadata ?? {}),
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
            input: effectiveInput,
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

  // conflict detection — reasoning/research 한정 활성화 (threshold 강화로 오탐 방지)
  const CONFLICT_TASKS = ["reasoning", "research"]
  let candidateClaims: any[] = []
  let detectedConflicts: any[] = []

  if (CONFLICT_TASKS.includes(task) && successfulResults.length >= 2) {
    try {
      const providerClaims = successfulResults.map((item) => ({
        provider: item.provider,
        claims: extractClaims(item.text)
      }))
      candidateClaims = providerClaims.flatMap((pc) => pc.claims)
      detectedConflicts = detectConflicts(providerClaims, rawInboundMessage)
    } catch {
      candidateClaims = []
      detectedConflicts = []
    }
  }

  let weightedConflictScore = calculateConflictScore(detectedConflicts)

  let candidates = buildCandidates(successfulResults)
  let judged: any = null

  if (candidates.length > 1) {
    judged = await judge({
      candidates,
      task,
      conflicts: detectedConflicts,
      question: rawInboundMessage
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

  if (judged && shouldKeepPrimaryWinner({
    route,
    judged,
    executed,
    primaryProvider
  })) {
    judged = enforcePrimaryWinner({
      judged,
      primaryProvider
    })
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
      input: effectiveInput,
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
      // escalation 후 재판정 — reasoning/research만 conflict 재감지
      let nextCandidateClaims: any[] = []
      let nextDetectedConflicts: any[] = []
      if (CONFLICT_TASKS.includes(task) && nextSuccessful.length >= 2) {
        try {
          const nextProviderClaims = nextSuccessful.map((item) => ({
            provider: item.provider,
            claims: extractClaims(item.text)
          }))
          nextCandidateClaims = nextProviderClaims.flatMap((pc) => pc.claims)
          nextDetectedConflicts = detectConflicts(nextProviderClaims, rawInboundMessage)
        } catch {
          nextCandidateClaims = []
          nextDetectedConflicts = []
        }
      }
      weightedConflictScore = calculateConflictScore(nextDetectedConflicts)

      candidates = buildCandidates(nextSuccessful)

      if (candidates.length > 1) {
        judged = await judge({
          candidates,
          task,
          conflicts: nextDetectedConflicts,
          question: rawInboundMessage
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

      if (judged && shouldKeepPrimaryWinner({
        route,
        judged,
        executed,
        primaryProvider
      })) {
        judged = enforcePrimaryWinner({
          judged,
          primaryProvider
        })
      }
    }
  }

  const refreshedSuccessful = executed.filter((item) => item.ok && hasText(item.text))
  // 최종 conflict — detectedConflicts 재사용 (reasoning/research에서만 유효)
  const finalClaimMap: any[] = candidateClaims
  const finalDetectedConflicts: any[] = detectedConflicts

  let finalResult =
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

  // ===== SYNTHESIS HELPERS =====
  // judgeWinner: judge가 선택한 provider (finalProvider 선언 전에 사용)
  const judgeWinner = normalizeProvider(
    judged?.meta?.judge_selected_provider ?? judged?.provider ?? primaryProvider
  )
  function getSynthProvider(excludeProvider: string, preferList: string[]): string | null {
    for (const p of preferList) {
      if (normalizeProvider(p) !== normalizeProvider(excludeProvider) &&
          executed.some((e) => normalizeProvider(e.provider) === normalizeProvider(p) && e.ok && hasText(e.text))) {
        return normalizeProvider(p)
      }
    }
    const fallback = executed.find((e) =>
      normalizeProvider(e.provider) !== normalizeProvider(excludeProvider) && e.ok && hasText(e.text)
    )
    return fallback?.provider ?? null
  }
  // ===== END SYNTHESIS HELPERS =====

  // ===== RESEARCH SYNTHESIS =====
  // Perplexity 검색 결과 → 합성 provider(openai 우선)가 구조화
  if (task === "research" && normalizeProvider(primaryProvider) === "perplexity") {
    const perplexityResult = executed.find((item) => normalizeProvider(item.provider) === "perplexity" && item.ok && hasText(item.text))
    const synthBy = getSynthProvider("perplexity", ["openai", "claude", "gemini"])
    const synthResult = synthBy ? executed.find((item) => normalizeProvider(item.provider) === synthBy && item.ok && hasText(item.text)) : null

    if (perplexityResult && !synthResult) {
      // verifier 결과 없으면 새로 호출
      const synthProvider = synthBy ?? "openai"
      const synthesisInput = {
        ...effectiveInput,
        messages: [{
          role: "user",
          content: `다음은 실시간 검색으로 수집한 정보입니다:\n\n${perplexityResult.text}\n\n위 정보를 바탕으로 질문에 대해 명확하고 구조화된 답변을 한국어로 작성해주세요. 핵심 내용을 요약하고 중요한 인사이트를 강조해주세요.\n\n원래 질문: ${extractInboundMessage(effectiveInput)}`
        }]
      }
      const synthesisResult = await executeProvider({
        provider: synthProvider, role: "synthesis",
        input: synthesisInput, task, route, plannerSignals, usePro: false, emitEvent: emitTracked
      })
      if (synthesisResult.ok && hasText(synthesisResult.text)) {
        finalResult = { ...synthesisResult, provider: synthProvider, role: "synthesis" }
        executed = [...executed, { ...synthesisResult, role: "synthesis" }]
      }
    } else if (perplexityResult && synthResult) {
      // verifier 결과 있으면 추가 API 호출 없이 합성
      finalResult = {
        ...synthResult,
        text: synthResult.text,
        provider: synthBy!, role: "synthesis"
      }
    }
  }
  // ===== END RESEARCH SYNTHESIS =====

  // ===== REASONING LOGIC VERIFICATION =====
  // judge winner 논리 → verifier가 전제/결론 유효성 검증 + 반론 보완
  if (task === "reasoning") {
    const winnerReasoning = executed.find((item) => normalizeProvider(item.provider) === judgeWinner && item.ok && hasText(item.text))
    if (winnerReasoning) {
      const verifyBy = getSynthProvider(judgeWinner, ["openai", "claude", "gemini"])
      if (verifyBy) {
        // 이미 실행된 verifier 결과 재활용 우선 (추가 API 호출 최소화)
        const existingVerify = executed.find((e) => normalizeProvider(e.provider) === verifyBy && e.ok && hasText(e.text))
        if (!existingVerify) {
          const verifyInput = {
            ...effectiveInput,
            messages: [{
              role: "user",
              content: `다음 추론/분석 결과를 검증해주세요:\n\n${winnerReasoning.text}\n\n1) 전제나 사실 오류가 있으면 지적해주세요.\n2) 논리적 비약이 있으면 지적해주세요.\n3) 빠진 반론이나 중요한 반대 관점이 있으면 추가해주세요.\n문제가 없으면 "VERIFIED" 한 줄만 출력하세요.\n\n원래 질문: ${extractInboundMessage(effectiveInput)}`
            }]
          }
          const verifyResult = await executeProvider({
            provider: verifyBy, role: "verifier", input: verifyInput,
            task, route, plannerSignals, usePro: false, emitEvent: emitTracked
          })
          if (verifyResult.ok && hasText(verifyResult.text)) {
            const isVerified = /^verified\.?$/i.test(verifyResult.text.trim())
            if (!isVerified) {
              finalResult = {
                ...winnerReasoning,
                text: winnerReasoning.text + `\n\n---\n**🔎 논리 검증 (${verifyBy.toUpperCase()}):**\n` + verifyResult.text,
                provider: judgeWinner, role: "verified"
              }
            }
          }
        }
      }
    }
  }
  // ===== END REASONING LOGIC VERIFICATION =====

  // ===== CODE CRITIQUE & PATCH =====
  // judge winner 코드 → 다른 provider가 리뷰 (routing 변경에 강건)
  if (task === "code") {
    const winnerCode = executed.find((item) => normalizeProvider(item.provider) === normalizeProvider(judgeWinner) && item.ok && hasText(item.text))
    if (winnerCode) {
      const critiqueBy = getSynthProvider(judgeWinner, ["openai", "claude", "gemini"])
      if (critiqueBy) {
        // 이미 실행된 verifier 결과 재활용 우선
        const existingCritique = executed.find((e) => normalizeProvider(e.provider) === critiqueBy && e.ok && hasText(e.text))
        if (!existingCritique) {
          const critiqueInput = {
            ...effectiveInput,
            messages: [{
              role: "user",
              content: `다음 코드를 리뷰해주세요:\n\n${winnerCode.text}\n\n버그나 개선점이 있으면 수정된 코드를 제시하세요. 코드가 올바르면 "LGTM" 한 줄만 출력하세요.\n\n원래 질문: ${extractInboundMessage(effectiveInput)}`
            }]
          }
          const critiqueResult = await executeProvider({
            provider: critiqueBy, role: "verifier", input: critiqueInput,
            task, route, plannerSignals, usePro: false, emitEvent: emitTracked
          })
          if (critiqueResult.ok && hasText(critiqueResult.text)) {
            const isLgtm = /^lgtm\.?$/i.test(critiqueResult.text.trim())
            if (!isLgtm) {
              finalResult = {
                ...winnerCode,
                text: winnerCode.text + `\n\n---\n**🔍 코드 리뷰 (${critiqueBy.toUpperCase()}):**\n` + critiqueResult.text,
                provider: normalizeProvider(judgeWinner), role: "patched"
              }
            }
          }
        }
      }
    }
  }
  // ===== END CODE CRITIQUE & PATCH =====

  // ===== WRITING EDITORIAL REVIEW =====
  // judge winner 글 → 다른 provider가 편집 검토 (routing 변경에 강건)
  if (task === "writing") {
    const winnerText = executed.find((item) => normalizeProvider(item.provider) === normalizeProvider(judgeWinner) && item.ok && hasText(item.text))
    if (winnerText) {
      const editBy = getSynthProvider(judgeWinner, ["openai", "claude", "gemini"])
      if (editBy) {
        const existingEdit = executed.find((e) => normalizeProvider(e.provider) === editBy && e.ok && hasText(e.text))
        if (!existingEdit) {
          const editInput = {
            ...effectiveInput,
            messages: [{
              role: "user",
              content: `다음 작성된 글을 편집 검토해주세요:\n\n${winnerText.text}\n\n구조, 흐름, 논리적 일관성 관점에서 구체적인 개선 제안을 1~3줄로 요약해주세요. 내용이 충분히 좋으면 "APPROVED" 한 줄만 출력하세요.\n\n원래 요청: ${extractInboundMessage(effectiveInput)}`
            }]
          }
          const editResult = await executeProvider({
            provider: editBy, role: "verifier", input: editInput,
            task, route, plannerSignals, usePro: false, emitEvent: emitTracked
          })
          if (editResult.ok && hasText(editResult.text)) {
            const isApproved = /^approved\.?$/i.test(editResult.text.trim())
            if (!isApproved) {
              finalResult = {
                ...winnerText,
                text: winnerText.text + `\n\n---\n**✏️ 편집 검토 (${editBy.toUpperCase()}):**\n` + editResult.text,
                provider: normalizeProvider(judgeWinner), role: "edited"
              }
            }
          }
        }
      }
    }
  }
  // ===== END WRITING EDITORIAL REVIEW =====

  // ===== LONG DOC KEY EXTRACTION =====
  // judge winner 문서 분석 → verifier가 핵심 의사결정 추출 (routing 변경에 강건)
  if (task === "long_doc") {
    const winnerDoc = executed.find((item) => normalizeProvider(item.provider) === normalizeProvider(judgeWinner) && item.ok && hasText(item.text))
    if (winnerDoc) {
      const extractBy = getSynthProvider(judgeWinner, ["claude", "openai", "gemini"])
      if (extractBy) {
        const existingExtract = executed.find((e) => normalizeProvider(e.provider) === extractBy && e.ok && hasText(e.text))
        const extractSource = existingExtract ?? null
        if (!extractSource) {
          const extractInput = {
            ...effectiveInput,
            messages: [{
              role: "user",
              content: `다음은 장문 문서를 분석한 결과입니다:\n\n${winnerDoc.text}\n\n이 내용에서 핵심 의사결정 포인트, 실행 가능한 항목, 리스크/주의사항, 중요 결론을 구조화하여 정리해주세요.\n\n원래 요청: ${extractInboundMessage(effectiveInput)}`
            }]
          }
          const extractResult = await executeProvider({
            provider: extractBy, role: "verifier", input: extractInput,
            task, route, plannerSignals, usePro: false, emitEvent: emitTracked
          })
          if (extractResult.ok && hasText(extractResult.text)) {
            finalResult = {
              ...winnerDoc,
              text: winnerDoc.text + `\n\n---\n**🔑 핵심 추출 (${extractBy.toUpperCase()}):**\n` + extractResult.text,
              provider: normalizeProvider(judgeWinner), role: "extracted"
            }
            executed = [...executed, { ...extractResult, role: "extracted" }]
          }
        } else {
          // 이미 실행된 verifier 결과가 있으면 재활용
          finalResult = {
            ...winnerDoc,
            text: winnerDoc.text + `\n\n---\n**🔑 핵심 추출 (${extractBy.toUpperCase()}):**\n` + extractSource.text,
            provider: normalizeProvider(judgeWinner), role: "extracted"
          }
        }
      }
    }
  }
  // ===== END LONG DOC KEY EXTRACTION =====

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
      error_code: row?.error_code ?? null,
      task
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
      error_code: row?.error_code ?? null,
      task
    })
  }

  for (const row of executed) {
    const learning = summarizeProviderConflictLearning(finalConflicts, row.provider)

    recordProviderConflict(row.provider, {
      context_conflicts: learning.context_conflicts,
      provider_conflicts: learning.provider_conflicts,
      penalty: learning.penalty,
      weight: row.provider === finalProvider ? 1 : 0.7,
      task,
      conflict_types: learning.conflict_types
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
    finalConflicts,
    postEvalTriggered,
    recoveryMeta,
    transientFailures,
    timelineEvents,
    providerStreamSummary,
    retrievalContext
  })

  const outcome = buildOutcomeMeta(executed, finalProvider)
  const providerStatusMap = buildProviderStatusMap(executed, finalProvider)
  const hiddenFailedProviders = Array.from(new Set(transientFailures.map((item) => normalizeProvider(item?.provider)).filter(Boolean)))
  const conflictBuckets = summarizeConflictBuckets(finalConflicts)
  const selectionTrace = buildSelectionTrace(judged, finalProvider, finalRole, finalConflicts)
  const winnerReason = buildWinnerReason(selectionTrace)

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
      orchestration: orchestrationMeta,
      selection_trace: selectionTrace,
      winner_reason: winnerReason
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
      retrieval_context: retrievalContext?.retrieval_context ?? null,
      retrieval_meta: retrievalMeta ?? null,
      executed_providers: summarizeProviderUsage(executed),
      claims: finalClaimMap,
      conflicts: finalConflicts,
      conflict_score: calculateConflictScore(finalConflicts),
      conflict_count: finalConflictCount,
      conflict_buckets: conflictBuckets,
      judge: {
        selected_provider: finalProvider,
        selected_role: finalRole,
        confidence: finalJudgeConfidence,
        scores: Array.isArray(judged?.meta?.judge_scores) ? judged.meta.judge_scores : [],
        rationale: judged?.meta?.judge_rationale ?? null
      },
      selection_trace: selectionTrace,
      winner_reason: winnerReason,
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
