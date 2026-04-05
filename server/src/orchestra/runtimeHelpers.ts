import { getLatestProjectContext } from "../memory/projectMemory.js";
import { getProjectThreadMemories, findSimilarQuery } from "../memory/threadMemory.js";

export function hasText(value: any) {
  return typeof value === "string" && value.trim().length > 0
}

export function normalizeProvider(value: any) {
  return String(value ?? "").trim().toLowerCase()
}

export function uniqueProviders(values: any[]) {
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

export function extractInboundMessage(input: any) {
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

// 문장 경계에서 트런케이션 (하드 잘라내기 방지)
function smartTruncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  const lastBreak = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf(".\n"),
    cut.lastIndexOf("다. "),
    cut.lastIndexOf("다.\n"),
    cut.lastIndexOf("\n\n")
  )
  return lastBreak > maxChars * 0.5
    ? cut.slice(0, lastBreak + 1).trim() + "…"
    : cut.trim() + "…"
}

function buildThreadFusionBlock(
  projectId: string,
  currentThreadId: string,
  query: string
): { block: string; matchedCount: number } {
  if (!projectId || !query || query.length < 10) return { block: "", matchedCount: 0 }

  const FUSION_TOTAL_CAP = 3000 // 스레드 융합 컨텍스트 캡 확대

  // 같은 프로젝트의 다른 스레드 전체 로드
  const allThreads = getProjectThreadMemories(projectId)
    .filter((t) => t.thread_id !== currentThreadId)

  if (allThreads.length === 0) return { block: "", matchedCount: 0 }

  // 1. 유사 쿼리 검색 (BM25-lite + 한국어 바이그램 scoring)
  const similarResults = findSimilarQuery(query, projectId, {
    threshold: 0.35,  // 무관한 스레드 오염 방지 — 임계값 상향
    limit: 5
  })

  const relevantThreads = similarResults.filter(
    (r) => r.thread_id !== currentThreadId && r.matched_answer?.trim()
  )

  // 2. 엔티티 기반 추가 매칭 — 고유명사/핵심어 겹치는 스레드 찾기
  //    임계값: >= 2 (단어 2개 이상 겹쳐야 관련 스레드로 판단 — 오염 방지)
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
    // 엔티티 2개 이상 겹쳐야 관련 스레드로 인정 — 스레드 융합 오염 방지
    return queryEntities.filter((e) => threadText.includes(e)).length >= 2
  }).slice(0, 2)  // 최대 2개로 제한

  // 3. 최신 스레드 decisions/facts — hasRelevance일 때만 주입 (무관 컨텍스트 오염 방지)
  const hasRelevance = relevantThreads.length > 0 || entityMatchThreads.length > 0
  const recentThreads = hasRelevance ? allThreads.slice(0, 2) : []

  const threadDecisions: string[] = []
  const threadFacts: string[] = []

  for (const thread of recentThreads) {
    threadDecisions.push(...(thread.structured?.decisions ?? []).slice(0, 2))
    threadFacts.push(...(thread.structured?.facts ?? []).slice(0, 2))
  }

  const uniqueDecisions = [...new Set(threadDecisions)].slice(0, 4)
  const uniqueFacts = [...new Set(threadFacts)].slice(0, 4)

  if (!hasRelevance && uniqueDecisions.length === 0 && uniqueFacts.length === 0) return { block: "", matchedCount: 0 }

  const matchedCount = relevantThreads.length + entityMatchThreads.length
  const lines: string[] = ["[THREAD MEMORY]", ""]
  let charBudget = FUSION_TOTAL_CAP

  // 유사 쿼리 매칭 결과 (스레드당 500자 캡 — 1400→2000으로 확대에 맞게 상향)
  for (const result of relevantThreads.slice(0, 3)) {
    if (charBudget <= 0) break
    const thread = allThreads.find((t) => t.thread_id === result.thread_id)
    const title = thread?.title
    const winnerTag = result.winner_provider ? ` [${result.winner_provider.toUpperCase()}]` : ""
    const header = `[관련 스레드${title ? ` — ${title}` : ""}${winnerTag}]`
    const body = smartTruncate(result.matched_answer, Math.min(500, charBudget))
    lines.push(header)
    lines.push(body)
    lines.push("")
    charBudget -= header.length + body.length
  }

  // 엔티티 매칭 스레드 (400자 캡)
  for (const thread of entityMatchThreads) {
    if (charBudget <= 0) break
    const summary = thread.structured?.summary ?? ""
    if (!summary) continue
    const winnerTag = (thread as any).winner_provider ? ` [${(thread as any).winner_provider.toUpperCase()}]` : ""
    const header = `[관련 스레드${thread.title ? ` — ${thread.title}` : ""}${winnerTag}]`
    const body = smartTruncate(summary, Math.min(400, charBudget))
    lines.push(header)
    lines.push(body)
    lines.push("")
    charBudget -= header.length + body.length
  }

  // 프로젝트 결정사항/사실 (유사 쿼리 있을 때만)
  if (charBudget > 100 && uniqueDecisions.length > 0) {
    lines.push("[프로젝트 주요 결정사항]")
    lines.push(...uniqueDecisions)
    lines.push("")
    charBudget -= uniqueDecisions.join("\n").length
  }

  if (charBudget > 100 && uniqueFacts.length > 0) {
    lines.push("[프로젝트 핵심 사실]")
    lines.push(...uniqueFacts)
    lines.push("")
  }

  return { block: lines.join("\n").trim(), matchedCount }
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

export function buildInputWithRetrievalContext(input: any, rawInboundMessage: string) {
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
  const { block: threadFusionBlock, matchedCount: fusionMatchedCount } = buildThreadFusionBlock(projectId, currentThreadId, rawText)

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
        // 마지막 user 메시지: enrichedInboundMessage로 교체
        if (idx === lastUserIdx) {
          return { ...msg, content: enrichedInboundMessage }
        }
        // 이전 assistant 메시지: 코드블록 포함 시 truncate (오염 방지)
        const role = String(msg?.role ?? "").toLowerCase()
        if (role === "assistant") {
          const content = String(msg?.content ?? "")
          const hasCode = (content.match(/```/g) ?? []).length >= 2
          if (hasCode && content.length > 6000) {
            return { ...msg, content: content.slice(0, 6000) + "..." }
          }
          if (content.length > 8000) {
            return { ...msg, content: content.slice(0, 8000) + "..." }
          }
        }
        return msg
      })
    }
  }

  const retrievalMeta = {
    project_facts: (projectContext?.retrieval_context?.facts?.length ?? 0),
    project_decisions: (projectContext?.retrieval_context?.decisions?.length ?? 0),
    matched_sources: Number(projectContext?.matched_source_count ?? 0),
    thread_fusions: fusionMatchedCount,
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

export function pickText(result: any, partialText: string) {
  if (hasText(partialText)) return String(partialText)
  if (hasText(result?.answer_text)) return String(result.answer_text)
  if (hasText(result?.text)) return String(result.text)
  if (hasText(result?.answer)) return String(result.answer)
  if (hasText(result?.output_text)) return String(result.output_text)
  return ""
}

export function buildProviderInput(params: any, task: string, route: any, provider: string, plannerSignals: any, usePro: boolean) {
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

export function calculateConflictScore(conflicts: any[]) {
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

export function summarizeConflictBuckets(conflicts: any[]) {
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

export function buildSelectionTrace(judged: any, finalProvider: string, finalRole: string, finalConflicts: any[]) {
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

export function buildWinnerReason(trace: any) {
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

export function summarizeProviderConflictLearning(conflicts: any[], providerInput: string) {
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

export function shouldEscalateAfterEval(params: {
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
  const highStakesTasks = new Set([
    "reasoning",
    "research",
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
    "code",
    "code_implement",
    "code_debug",
    "code_refactor_review"
  ])
  if (!highStakesTasks.has(task)) return false

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

export function summarizeProviderUsage(results: any[]) {
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

export function buildProviderStatusMap(results: any[], finalProvider: string) {
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

export function buildOutcomeMeta(results: any[], finalProvider: string) {
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

export function buildOrchestrationMeta(params: {
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

export function createRecoveryMeta() {
  return {
    primary_recovered: false,
    recovery_reason: null as string | null,
    recovery_from_model: null as string | null,
    recovery_to_model: null as string | null,
    recovery_from_cost_usd: 0,
    effective_primary_provider: "openai"
  }
}

export function normalizeChunkPreview(value: any) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
}

export function normalizePreviewText(value: any) {
  return String(value ?? "")
    .replace(/\r/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.:;!?%])/g, "$1")
    .replace(/([(])\s+/g, "$1")
    .replace(/\s+([)\]])/g, "$1")
    .trim()
}

export function clipText(value: string, max = 220) {
  const normalized = String(value ?? "").trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max)}...`
}

export function ensureProviderStreamSummary(
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

export function applyFinalProviderPreview(
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

  row.preview_text = finalPreview
  row.preview_excerpt = clipText(finalPreview, 160)
  row.last_non_empty_chunk = clipText(finalPreview.slice(-120), 120)
  row.total_chars = Math.max(Number(row.total_chars ?? 0), finalPreview.length)
}

export function getProviderRole(route: any, provider: string) {
  const normalized = normalizeProvider(provider)
  if (Array.isArray(route?.selected_providers) && route.selected_providers.map(normalizeProvider).includes(normalized)) return "primary"
  if (Array.isArray(route?.verifier_providers) && route.verifier_providers.map(normalizeProvider).includes(normalized)) return "verifier"
  if (Array.isArray(route?.optional_providers) && route.optional_providers.map(normalizeProvider).includes(normalized)) return "optional"
  if (Array.isArray(route?.scout_providers) && route.scout_providers.map(normalizeProvider).includes(normalized)) return "scout"
  return "fallback"
}

export function getJudgeScore(judged: any, provider: string) {
  const scores = Array.isArray(judged?.meta?.judge_scores) ? judged.meta.judge_scores : []
  const row = scores.find((item: any) => normalizeProvider(item?.provider) === normalizeProvider(provider))
  return Number(row?.score ?? 0)
}

export function shouldKeepPrimaryWinner(params: {
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
    // verifier가 이기더라도 점수 차이가 작으면 primary(Claude) 유지
    // 점수 차이가 0.12 미만 또는 신뢰도 0.75 미만이면 primary 유지
    return gap < 0.12 || confidence < 0.75
  }

  return false
}

export function enforcePrimaryWinner(params: {
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

export async function emit(stream: any, event: any) {
  if (typeof stream !== "function") return
  await stream(event)
}

export function buildRoleMap(route: any) {
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
