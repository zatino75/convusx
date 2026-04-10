import { runAdapter } from "./adapterDispatcher.js"
import { resolveAdaptiveRoute } from "./adaptiveRouter.js"
import { judge } from "./judge.js"
import { detectTaskType, planRequest } from "./planner.js"
import { routeWithLLM } from "./llmRouter.js"
import { extractClaims } from "./claims.js"
import { detectConflicts, resolveConflictDecisions } from "./conflicts.js"
import { readScoreboard, recordProviderExecution, recordProviderConflict, updateModelScoreboard } from "./scoreboard.js"
import { runJudgeStep, sanitizeProviderStreamSummary } from "./runtimePipeline.js"
import { applyFinalProviderPreview, buildInputWithRetrievalContext, buildOrchestrationMeta, buildOutcomeMeta, buildProviderInput, buildProviderStatusMap, buildRoleMap, buildSelectionTrace, buildWinnerReason, calculateConflictScore, clipText, createRecoveryMeta, emit, enforcePrimaryWinner, ensureProviderStreamSummary, extractInboundMessage, getJudgeScore, getProviderRole, hasText, normalizeChunkPreview, normalizePreviewText, normalizeProvider, pickText, shouldEscalateAfterEval, shouldKeepPrimaryWinner, summarizeConflictBuckets, summarizeProviderConflictLearning, summarizeProviderUsage, uniqueProviders } from "./runtimeHelpers.js"
import { upsertThreadMemory } from "../memory/threadMemory.js"

// ── Orchestra Event 타입 정의 ──
export type OrchestraEventType =
  | "route_decided"
  | "provider_start"
  | "provider_chunk"
  | "provider_event"
  | "provider_done"
  | "judge_start"
  | "judge_done"
  | "status"
  | "synthesis_start"
  | "synthesis_done"
  | "error"

export type OrchestraEvent = {
  type: OrchestraEventType
  provider?: string
  role?: string
  content?: string
  ok?: boolean
  latency_ms?: number
  model?: string | null
  task?: string
  selected_providers?: string[]
  event?: Record<string, any>
  [key: string]: any
}

export type OrchestraEmitFn = (event: OrchestraEvent) => Promise<void>

async function executeProvider(params: {
  provider: string
  role: string
  input: any
  task: string
  route: any
  plannerSignals: any
  usePro?: boolean
  emitEvent?: OrchestraEmitFn
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
    role: params.role,
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

function buildCandidates(results: any[]) {
  return results.map((item: any) => ({
    provider: item.provider,
    answer_text: item.text ?? "",
    role: item.role ?? "primary"
  }))
}

function shouldRecoverOpenAIPrimary(result: any, _route: any): boolean {
  if (!result) return false
  // error_code가 있는 명확한 실패만 복구 (짧은 답변은 복구 대상 아님)
  const errorCode = String(result.error_code ?? "").trim().toLowerCase()
  const text = String(result.text ?? "").trim()
  if (!text && errorCode) return true   // 텍스트 없고 에러 있을 때만 복구
  if (!text) return true                // 텍스트 완전히 없을 때
  return false                          // 텍스트가 있으면 복구 안 함
}

// Claude primary 실패 시 → Opus 4.6으로 에스컬레이션 재시도
function shouldRecoverClaudePrimary(result: any): boolean {
  if (!result) return false
  if (result.provider !== "claude") return false
  const text = String(result.text ?? "").trim()
  const errorCode = String(result.error_code ?? "").trim()
  // Sonnet 실패 시 Opus로 재시도 (이미 Opus였으면 재시도 안 함)
  const model = String(result.model ?? "").toLowerCase()
  if (model.includes("opus")) return false
  if (!text && errorCode) return true
  if (!text) return true
  return false
}


export async function executeOrchestra(input: any, stream?: OrchestraEmitFn) {
  const startedAt = Date.now()
  const rawInboundMessage = extractInboundMessage(input)

  // Claude Haiku로 의도 분류 — 실패 시 자동으로 heuristic 폴백
  const anthropicKey = String(process.env.ANTHROPIC_API_KEY ?? "").trim()
  const planner = await routeWithLLM(rawInboundMessage, anthropicKey)
  const plannerSignals = planner.signals
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
          row.preview_text = merged
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

  const rawTask =
    String(effectiveInput?.task ?? planner?.task ?? detectTaskType(rawInboundMessage))
      .trim()
      .toLowerCase() || "dialogue"

  // writing 서브태스크 자동 감지 — 메시지 내용 기반으로 creative/business 분류
  const task = (() => {
    if (rawTask !== "writing") return rawTask

    const msg = rawInboundMessage.toLowerCase()

    // creative 키워드: 소설, 시, 스크립트, 광고 카피, 스토리, 창작, 가사 등
    const creativePatterns = [
      "소설", "단편", "시 ", "시를", "스크립트", "대본", "광고 카피", "카피라이팅",
      "스토리", "창작", "가사", "동화", "판타지", "sf", "호러", "로맨스", "에피소드",
      "creative", "fiction", "story", "poem", "lyrics", "screenplay", "copywriting"
    ]

    // business 키워드: 보고서, 기획서, 이메일, 제안서, 계약서, 분석, 공문 등
    const businessPatterns = [
      "보고서", "기획서", "제안서", "계약서", "이메일", "메일", "공문", "분석", "정리",
      "요약", "발표", "프레젠테이션", "사업계획", "마케팅", "전략", "업무", "회의록",
      "report", "proposal", "email", "analysis", "summary", "business", "strategy", "memo"
    ]

    const creativeScore = creativePatterns.filter(p => msg.includes(p)).length
    const businessScore = businessPatterns.filter(p => msg.includes(p)).length

    if (creativeScore > businessScore) return "writing_creative"
    if (businessScore >= creativeScore) return "writing_business"
    return "writing_creative"
  })()

  const scoreboardBefore = readScoreboard()

  const route = resolveAdaptiveRoute({
    ...effectiveInput,
    task,
    benchmark_mode: Boolean(effectiveInput?.benchmark_mode || plannerSignals?.benchmark_mode),
    deep_analysis: Boolean(effectiveInput?.deep_analysis || plannerSignals?.deep_analysis),
    deep_research: Boolean(effectiveInput?.deep_research || plannerSignals?.deep_research),
    force_pro: Boolean(effectiveInput?.force_pro || plannerSignals?.force_pro),
    structured_output: Boolean(effectiveInput?.structured_output || plannerSignals?.structured_output)
  })

  const selectedProviders = Array.isArray(route?.selected_providers) ? route.selected_providers : []
  let verifierProviders = Array.isArray(route?.verifier_providers) ? route.verifier_providers : []
  const optionalProviders = Array.isArray(route?.optional_providers) ? route.optional_providers : []

  // D12: research 단순 질문 → verifier 조건부 스킵 (비용 절감)
  if (task === "research") {
    const msgLen = extractInboundMessage(effectiveInput).length
    const isSimple = msgLen < 120 && !effectiveInput?.deep_research
    if (isSimple) verifierProviders = []
  }
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

  // research: primary 완료 후 verifier에 추가 15초만 허용 (전체 대기 방지)
  let executed: Awaited<ReturnType<typeof executeProvider>>[]
  if (task === "research" && firstWaveProviders.length > 1) {
    const [primaryProvider, ...verifierProviders] = firstWaveProviders
    const primaryRes = await executeProvider({
      provider: primaryProvider,
      role: roleMap.get(normalizeProvider(primaryProvider)) ?? "primary",
      input: effectiveInput, task, route, plannerSignals,
      usePro: Boolean(route?.escalation?.use_pro) && (normalizeProvider(primaryProvider) === "openai" || normalizeProvider(primaryProvider) === "claude"),
      emitEvent: emitTracked
    })
    const verifierResults = await Promise.all(
      verifierProviders.map(async (provider: any) => {
        const timeoutMs = 15000
        let timeoutId: ReturnType<typeof setTimeout> | null = null
        const result = await Promise.race([
          executeProvider({
            provider,
            role: roleMap.get(normalizeProvider(provider)) ?? "verifier",
            input: effectiveInput, task, route, plannerSignals,
            usePro: false, emitEvent: emitTracked
          }).finally(() => { if (timeoutId) clearTimeout(timeoutId) }),
          new Promise<Awaited<ReturnType<typeof executeProvider>>>((resolve) => {
            timeoutId = setTimeout(() => resolve({ provider, ok: false, text: "", role: "verifier",
              latency_ms: timeoutMs, model: null, usage: null } as any), timeoutMs)
          })
        ])
        return result
      })
    )
    executed = [primaryRes, ...verifierResults]
  } else {
    executed = await Promise.all(
      firstWaveProviders.map((provider: any) =>
        executeProvider({
          provider,
          role: roleMap.get(normalizeProvider(provider)) ?? "optional",
          input: effectiveInput,
          task, route, plannerSignals,
          usePro: Boolean(route?.escalation?.use_pro) && (normalizeProvider(provider) === "openai" || normalizeProvider(provider) === "claude"),
          emitEvent: emitTracked
        })
      )
    )
  }

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
        model: "gpt-5.2",
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

    recoveryMeta.recovery_to_model = recoveredPrimary.model ?? "gpt-5.2"
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

  // ── Claude Primary Recovery: Sonnet 실패 → Opus 에스컬레이션 재시도 ──
  if (primaryResultInitial && shouldRecoverClaudePrimary(primaryResultInitial)) {
    transientFailures.push({
      ...primaryResultInitial,
      transient_failed_primary: true
    })

    recoveryMeta.primary_recovered = true
    recoveryMeta.recovery_reason = primaryResultInitial.error_code ?? "claude_sonnet_failed"
    recoveryMeta.recovery_from_model = primaryResultInitial.model ?? null
    recoveryMeta.recovery_from_cost_usd = Number(primaryResultInitial?.usage?.estimated_cost_usd ?? 0)

    await emitTracked({
      type: "primary_recovery_start",
      provider: "claude",
      role: "primary",
      reason: primaryResultInitial.error_code
    })

    const recoveredClaude = await executeProvider({
      provider: "claude",
      role: "primary",
      input: {
        ...effectiveInput,
        model: "claude-opus-4-6",
        force_pro: true,
        benchmark_mode: false,
        deep_analysis: false,
        deep_research: false,
        allow_auto_promote_pro: false,
        metadata: {
          ...(effectiveInput?.metadata ?? {}),
          claude_primary_recovery: true
        }
      },
      task,
      route: {
        ...route,
        escalation: {
          ...(route?.escalation ?? {}),
          use_pro: true
        }
      },
      plannerSignals: {
        ...plannerSignals,
        force_pro: true,
        benchmark_mode: false,
        deep_analysis: false,
        deep_research: false
      },
      usePro: true,
      emitEvent: emitTracked
    })

    recoveryMeta.recovery_to_model = recoveredClaude.model ?? "claude-opus-4-6"
    recoveryMeta.effective_primary_provider = recoveredClaude.ok ? "claude" : (selectedProviders[0] ?? "claude")

    executed = [
      ...executed.filter((item) => !(item.provider === "claude" && item.role === "primary")),
      recoveredClaude
    ]

    applyFinalProviderPreview(providerStreamSummary, recoveredClaude)

    primaryResultInitial = recoveredClaude

    await emitTracked({
      type: "primary_recovery_done",
      provider: "claude",
      role: "primary",
      ok: recoveredClaude.ok,
      model: recoveredClaude.model,
      error_code: recoveredClaude.error_code
    })
  }

  const primaryProvider = normalizeProvider(selectedProviders[0] ?? "openai")
  const successfulInitial = executed.filter((item) => item.ok && hasText(item.text))

  // research/dialogue 단순 질문은 fallback 차단 (불필요한 추가 호출 방지)
  const noFallbackTasks = ["research", "dialogue"]
  const shouldRunFallback =
    !noFallbackTasks.includes(task) && (
      !primaryResultInitial?.ok ||
      !hasText(primaryResultInitial?.text) ||
      (successfulInitial.length === 0 && fallbackProviders.length > 0)
    )

  if (shouldRunFallback && fallbackProviders.length > 0) {
    const additionalProviders = uniqueProviders(fallbackProviders).filter(
      (provider) => !executed.some((item) => item.provider === provider)
    ).slice(0, 1)  // 최대 1개로 제한

    if (additionalProviders.length > 0) {
      const fallbackResults = await Promise.all(
        additionalProviders.map((provider: any) =>
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

  // ── 최후 폴백: 모든 프로바이더 실패 시 단일 프로바이더 직접 재시도 ──
  const anySuccess = executed.some((item) => item.ok && hasText(item.text))
  if (!anySuccess) {
    const lastResortOrder = ["openai", "claude", "gemini"]
    const alreadyTriedProviders = new Set(executed.map((item) => normalizeProvider(item.provider)))

    for (const lastResortProvider of lastResortOrder) {
      // 이미 시도한 프로바이더도 한 번 더 시도 (네트워크 일시적 장애일 수 있음)
      await emitTracked({
        type: "last_resort_fallback_start",
        provider: lastResortProvider,
        role: "last_resort"
      })

      try {
        const lastResortResult = await executeProvider({
          provider: lastResortProvider,
          role: "last_resort",
          input: effectiveInput,
          task,
          route,
          plannerSignals,
          usePro: false,
          emitEvent: emitTracked
        })

        applyFinalProviderPreview(providerStreamSummary, lastResortResult)

        if (lastResortResult.ok && hasText(lastResortResult.text)) {
          executed = [...executed, lastResortResult]
          break
        }
      } catch {
        // 최후 폴백도 실패하면 다음 프로바이더 시도
      }
    }
  }

  const successfulResults = executed.filter((item) => item.ok && hasText(item.text))

  // conflict detection — reasoning/research 한정 활성화 (threshold 강화로 오탐 방지)
  // code/long_doc 포함: 구현 방식·분석 결론 이견도 claims/conflict 감지 대상
  const CONFLICT_TASKS = ["dialogue", "reasoning", "research", "code", "code_implement", "code_debug", "code_refactor_review", "writing_creative", "writing_business", "long_doc", "word", "pdf", "excel", "ppt", "legal_review", "data_analysis", "finance_analysis", "product_development"]
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

  if (candidates.length > 0) {
    try {
      const evaluation1 = await runJudgeStep({
        task, message: rawInboundMessage,
        candidates: candidates.map((c: any) => ({ provider: c.provider, answer_text: c.answer_text, raw: c.raw })),
        primaryProvider,
        executionStrategy: route?.execution_strategy,
      })
      candidateClaims = evaluation1.claims
      detectedConflicts = evaluation1.conflicts
      judged = evaluation1.judged ?? (evaluation1.winnerCandidate ? {
        ...evaluation1.winnerCandidate, ok: true,
        meta: { judge_selected_provider: evaluation1.winner, judge_scores: evaluation1.scoreRows,
                 judge_rationale: "evaluation_pipeline", conflict_count: evaluation1.conflicts.length }
      } : null)
    } catch {
      // Judge 실패 시 첫 번째 candidate를 winner로 fallback
      judged = {
        ...candidates[0], ok: true,
        meta: {
          judge_selected_provider: candidates[0].provider,
          judge_scores: candidates.map((c: any) => ({ provider: c.provider, score: c.provider === candidates[0].provider ? 1 : 0, reasons: ["judge_error_fallback"] })),
          judge_rationale: "judge_error_fallback",
          judge_confidence: 0.5,
          conflict_count: detectedConflicts.length,
          conflicts: detectedConflicts,
          claims: candidateClaims
        }
      }
    }
  } else if (false) {  // legacy branch preserved
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

      if (candidates.length > 0) {
        try {
          const evaluation2 = await runJudgeStep({
            task, message: rawInboundMessage,
            candidates: candidates.map((c: any) => ({ provider: c.provider, answer_text: c.answer_text, raw: c.raw })),
            primaryProvider
          })
          candidateClaims = [...candidateClaims, ...evaluation2.claims]
          nextDetectedConflicts = evaluation2.conflicts
          judged = evaluation2.judged ?? (evaluation2.winnerCandidate ? {
            ...evaluation2.winnerCandidate, ok: true,
            meta: { judge_selected_provider: evaluation2.winner, judge_scores: evaluation2.scoreRows,
                     judge_rationale: "evaluation_pipeline", conflict_count: evaluation2.conflicts.length }
          } : null)
        } catch {
          // Post-eval Judge 실패 시 첫 번째 candidate를 winner로 fallback
          judged = {
            ...candidates[0], ok: true,
            meta: {
              judge_selected_provider: candidates[0].provider,
              judge_scores: candidates.map((c: any) => ({ provider: c.provider, score: c.provider === candidates[0].provider ? 1 : 0, reasons: ["judge_error_fallback_after_escalation"] })),
              judge_rationale: "judge_error_fallback_after_escalation",
              judge_confidence: 0.5,
              conflict_count: nextDetectedConflicts.length,
              conflicts: nextDetectedConflicts,
              claims: nextCandidateClaims
            }
          }
        }
      } else if (false) {  // legacy branch
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

  // 최종 conflict/claims — post-eval escalation 이후 nextCandidateClaims/nextDetectedConflicts가
  // 존재하면 그것을 사용, 없으면 초기 값 fallback (stale 방지)
  let finalClaimMap: any[] = candidateClaims
  let finalDetectedConflicts: any[] = detectedConflicts

  if (postEvalTriggered) {
    // post-eval escalation이 실제 실행된 경우 — refreshedSuccessful 기준 재추출
    if (CONFLICT_TASKS.includes(task) && refreshedSuccessful.length >= 2) {
      try {
        const postEvalProviderClaims = refreshedSuccessful.map((item) => ({
          provider: item.provider,
          claims: extractClaims(item.text)
        }))
        finalClaimMap = postEvalProviderClaims.flatMap((pc) => pc.claims)
        finalDetectedConflicts = detectConflicts(postEvalProviderClaims, rawInboundMessage)
      } catch {
        // 재추출 실패 시 초기 값 유지
      }
    } else {
      // CONFLICT_TASKS 외 task이거나 provider 1개 — claims/conflicts 빈 배열이 맞음
      finalClaimMap = []
      finalDetectedConflicts = []
    }
  }

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
              content: `다음 코드를 리뷰하고 수정된 완성본을 반환하세요:\n\n${winnerCode.text}\n\n규칙:\n1. 버그·논리 오류·성능 문제가 있으면 수정된 전체 코드를 그대로 출력하세요 (설명이나 주석 최소화, 코드만).\n2. 코드가 완전히 정확하면 "LGTM" 한 줄만 출력하세요.\n3. 절대 리뷰 코멘트와 코드를 섞지 마세요.\n\n원래 질문: ${extractInboundMessage(effectiveInput)}`
            }]
          }
          const critiqueResult = await executeProvider({
            provider: critiqueBy, role: "verifier", input: critiqueInput,
            task, route, plannerSignals, usePro: false, emitEvent: emitTracked
          })
          if (critiqueResult.ok && hasText(critiqueResult.text)) {
            const isLgtm = /^lgtm\.?$/i.test(critiqueResult.text.trim())
            if (!isLgtm) {
              // critiqueResult가 수정된 전체 코드 — 원본을 교체
              finalResult = {
                ...winnerCode,
                text: critiqueResult.text,
                provider: normalizeProvider(judgeWinner),
                role: "patched"
              }
              executed = [...executed, { ...critiqueResult, role: "synthesis" }]
            }
          }
        }
      }
    }
  }
  // ===== END CODE CRITIQUE & PATCH =====

  // ===== WRITING EDITORIAL REVIEW =====
  // judge winner 글 → 다른 provider가 편집 검토 (routing 변경에 강건)
  if (task === "writing" || task === "writing_creative" || task === "writing_business") {
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
              content: `다음 글을 편집하여 완성본을 반환하세요:\n\n${winnerText.text}\n\n규칙:\n1. 구조·흐름·논리·문장이 완벽하면 "APPROVED" 한 줄만 출력하세요.\n2. 개선이 필요하면 수정이 반영된 글 전체를 출력하세요 (설명 없이 완성된 글만).\n3. 원본의 핵심 내용과 관점은 유지하고, 표현과 구조만 개선하세요.\n\n원래 요청: ${extractInboundMessage(effectiveInput)}`
            }]
          }
          const editResult = await executeProvider({
            provider: editBy, role: "synthesis", input: editInput,
            task, route, plannerSignals, usePro: false, emitEvent: emitTracked
          })
          if (editResult.ok && hasText(editResult.text)) {
            const isApproved = /^approved\.?$/i.test(editResult.text.trim())
            if (!isApproved && editResult.text.length >= winnerText.text.length * 0.5) {
              // 편집본이 원본의 50% 이상 길이일 때만 교체 (너무 짧으면 실패로 간주)
              finalResult = {
                ...winnerText,
                text: editResult.text,
                provider: normalizeProvider(judgeWinner),
                role: "edited"
              }
              executed = [...executed, { ...editResult, role: "synthesis" }]
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

  // ===== DIALOGUE SYNTHESIS =====
  // judge winner 대화 응답 + runner-up 핵심 보완 → 단일 모델 응답보다 완성도 높은 답변 생성
  if (task === "dialogue") {
    const winnerDialogue = executed.find(
      (item) => normalizeProvider(item.provider) === normalizeProvider(judgeWinner) && item.ok && hasText(item.text)
    )
    if (winnerDialogue) {
      // runner-up: winner 제외하고 응답 길이가 충분한 성공 결과 중 가장 풍부한 것
      const runnerUp = executed
        .filter(
          (item) =>
            normalizeProvider(item.provider) !== normalizeProvider(judgeWinner) &&
            item.ok &&
            hasText(item.text) &&
            item.text.length > 80
        )
        .sort((a, b) => b.text.length - a.text.length)[0] ?? null

      if (runnerUp) {
        // 합성: claude 우선 (대화 품질), 없으면 openai
        const blendBy = getSynthProvider(judgeWinner, ["claude", "openai", "gemini"])
        if (blendBy) {
          // 이미 실행된 provider 결과 재활용 우선 (추가 API 호출 최소화)
          const existingBlend = executed.find(
            (e) => normalizeProvider(e.provider) === blendBy && e.ok && hasText(e.text)
          )
          if (!existingBlend) {
            const blendInput = {
              ...effectiveInput,
              messages: [
                {
                  role: "user",
                  content: `두 AI의 응답을 참고해 더 완성도 높은 답변을 작성해주세요.\n\n[응답 A — ${judgeWinner.toUpperCase()}]:\n${winnerDialogue.text}\n\n[응답 B — ${runnerUp.provider.toUpperCase()}]:\n${runnerUp.text}\n\n지침: A를 중심으로 유지하되, B에서 A가 빠뜨린 실질적인 포인트가 있으면 자연스럽게 통합하세요. 중복·불필요한 반복은 제거하고 흐름을 자연스럽게 유지하세요. B가 특별히 추가할 내용이 없으면 A를 그대로 출력하세요. 별도 주석이나 설명 없이 최종 답변만 출력하세요.\n\n원래 질문: ${extractInboundMessage(effectiveInput)}`
                }
              ]
            }
            const blendResult = await executeProvider({
              provider: blendBy,
              role: "synthesis",
              input: blendInput,
              task,
              route,
              plannerSignals,
              usePro: false,
              emitEvent: emitTracked
            })
            if (blendResult.ok && hasText(blendResult.text)) {
              finalResult = {
                ...winnerDialogue,
                text: blendResult.text,
                provider: normalizeProvider(judgeWinner),
                role: "synthesis"
              }
              executed = [...executed, { ...blendResult, role: "synthesis" }]
            }
          }
          // 이미 실행된 결과가 있으면 runner-up과 비교해 winner 텍스트와 길이차가 클 때만 교체
          // (existingBlend가 이미 winner보다 충분히 다른 내용이면 합성 효과 있음)
        }
      }
    }
  }
  // ===== END DIALOGUE SYNTHESIS =====

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

  // 누적 per-model 통계 업데이트 (토큰/비용/승률 축적)
  updateModelScoreboard({
    task,
    final_provider: finalProvider,
    provider_usage: summarizeProviderUsage(executed)
  })

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

  // Conflict → Decision 레코드: 감지된 충돌에서 신뢰 provider 판단
  let conflictDecisions: ReturnType<typeof resolveConflictDecisions> = []
  if (finalConflicts.length > 0) {
    try {
      conflictDecisions = resolveConflictDecisions(
        finalConflicts,
        finalProvider,
        finalJudgeConfidence,
        task
      )
    } catch { conflictDecisions = [] }
  }

  // claims + decisions per-provider 트래킹 → dynamic_scoreboard_router_v4 피드백
  try {
    const providerClaimCounts: Record<string, number> = {}
    for (const item of executed) {
      if (item.ok && item.text) {
        try { providerClaimCounts[item.provider] = extractClaims(item.text).length } catch { providerClaimCounts[item.provider] = 0 }
      }
    }
    const providerDecisionWins: Record<string, number> = {}
    for (const d of conflictDecisions) {
      const wp = normalizeProvider(d?.winner_provider)
      if (wp) providerDecisionWins[wp] = (providerDecisionWins[wp] ?? 0) + 1
    }
    if (Object.keys(providerClaimCounts).length > 0 || Object.keys(providerDecisionWins).length > 0) {
      updateModelScoreboard({
        task,
        final_provider: finalProvider,
        provider_usage: summarizeProviderUsage(executed),
        provider_claims: providerClaimCounts,
        provider_decisions: providerDecisionWins,
        claims_only_update: true
      })
    }
  } catch { /* non-fatal */ }

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
    type: "orchestra_done",
    provider: finalProvider,
    role: finalRole,
    content: String(finalResult?.text ?? ""),
    meta: {
      task,
      conflict_count: finalConflictCount,
      judge_confidence: finalJudgeConfidence
    }
  })

  // post-eval — threadMemory 자동 저장 (fire & forget)
  const _threadId = String(input?.thread_id ?? input?.threadId ?? "").trim()
  const _projectId = String(input?.project_id ?? input?.projectId ?? "").trim()
  if (_threadId && _projectId && finalProvider && finalResult?.text) {
    try {
      const _summary = String(finalResult.text).slice(0, 300)
      const _facts = Object.values(finalClaimMap)
        .flat()
        .filter((c: any) => c?.type === "fact" || c?.type === "recommendation")
        .map((c: any) => String(c?.text ?? "").slice(0, 100))
        .filter(Boolean)
        .slice(0, 6)
      upsertThreadMemory({
        thread_id: _threadId,
        project_id: _projectId,
        messages: [],
        winner_provider: finalProvider,
        structured: {
          summary: _summary,
          facts: _facts,
          decisions: [],
          open_questions: [],
          entities: [],
          updated_at: Date.now()
        }
      })
    } catch { /* 저장 실패 시 무시 */ }
  }

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
      conflict_decisions: conflictDecisions,
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
