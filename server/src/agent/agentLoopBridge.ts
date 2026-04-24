// agentLoopBridge.ts — Agent Loop Runtime Result Adapter
//
// 기존 chat.ts 는 executeOrchestra(effectiveInput) 호환 shape 을 buildChatPayload() /
// persistRuntimeMemory() / logBenchmark() / Plugin hooks 등에서 소비한다.
// 이들은 모두 아래 shape 에 의존한다:
//
//   {
//     final_answer: { provider, text, ok },
//     response_meta: { orchestration: {...}, winner_reason, selection_trace },
//     internal_rationale: { task, route, judge, conflicts, executed_providers, ... }
//   }
//
// runAgentLoop() 는 이 shape 을 따르지 않으므로, 이 파일이 agent loop 결과를
// runtime 응답 호환 shape 으로 감싸서 돌려준다.

import { runAgentLoop, type AgentLoopInput, type AgentLoopResult } from "./agentLoop.js"
import { logger } from "../observability/logger.js"
import { decideHighValue, buildDomainHint } from "./triggerDetection.js"
import { callOpenAI, callGemini } from "../adapters/wrappers.js"

// ─── single_agent cross-provider fallback chain ─────────────────────────────
// 2026-04-24 (Session 4 Phase 1): Opus → Sonnet → GPT-5.4-pro → Gemini 2.5 Pro.
// Opus/Sonnet 는 full agent loop (tool use 유지), GPT/Gemini 는 tool 없는 단순
// 텍스트 호출 (emergency answer). Anthropic 전체 장애 시에도 응답 확보.
const SONNET_TIMEOUT_MS = 120_000
const GPT_FALLBACK_TIMEOUT_MS = 60_000
const GEMINI_FALLBACK_TIMEOUT_MS = 45_000

function loopFailureIsRetryable(result: AgentLoopResult): boolean {
  if (result.ok) return false
  const reason = String(result.stop_reason ?? "")
  return reason === "api_error" || reason === "timeout" || reason === "exception" || !result.text
}

async function callWithTimeout<T>(p: Promise<T>, ms: number, tag: string): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${tag}_timeout`)), ms)),
  ])
}

function buildEmergencySystemPrompt(extraSystem?: string): string {
  const base = [
    "You are CORVUS X in emergency fallback mode.",
    "Primary Anthropic Claude path failed; you are a simpler cross-provider fallback.",
    "Answer the user's latest message directly in Korean (unless they wrote in English).",
    "No tool use is available — rely only on your own knowledge.",
    "Be concise but correct. If you don't know, say so explicitly.",
  ].join("\n")
  return extraSystem ? `${base}\n\n${extraSystem}` : base
}

function buildFallbackLoopResult(args: {
  provider: string
  model: string
  text: string
  ok: boolean
  latencyMs: number
  error?: string
}): AgentLoopResult {
  return {
    ok: args.ok,
    text: args.text,
    provider: args.provider,
    model: args.model,
    iterations: 1,
    tool_calls: [],
    usage: {},
    latency_ms: args.latencyMs,
    stop_reason: args.ok ? "fallback_ok" : "fallback_failed",
    error: args.error,
  }
}

function safeString(value: any): string {
  return String(value ?? "").trim()
}

/**
 * 채팅 스트림 runtime 이벤트 콜백 시그니처.
 * 최소 이벤트(route_decided / provider_start / final_answer) 를 발행한다.
 */
export type AgentRuntimeEventCallback = (event: any) => Promise<void> | void

function safeParseJson(raw: string | undefined): any {
  if (!raw || typeof raw !== "string") return null
  try { return JSON.parse(raw) } catch { return null }
}

function extractEnsembleAndCritique(loop: AgentLoopResult) {
  // 마지막으로 호출된 parallel_ensemble / adversarial_critique 결과 추출
  let ensembleData: any = null
  let critiqueData: any = null
  for (let i = loop.tool_calls.length - 1; i >= 0; i -= 1) {
    const tc = loop.tool_calls[i]
    if (!ensembleData && tc.tool_name === "parallel_ensemble" && tc.ok) {
      const parsed = safeParseJson(tc.output_text)
      if (parsed && parsed.ok && Array.isArray(parsed.drafts)) {
        ensembleData = {
          drafts: parsed.drafts,
          total_latency_ms: parsed.total_latency_ms,
          instruction_preview: parsed.instruction_preview,
          // 통합본은 에이전트 루프 final text — 호출 쪽에서 주입
          synthesized: loop.text,
        }
      }
    }
    if (!critiqueData && tc.tool_name === "adversarial_critique" && tc.ok) {
      const parsed = safeParseJson(tc.output_text)
      if (parsed && parsed.ok) {
        critiqueData = {
          critic_provider: parsed.critic_provider,
          critic_model: parsed.critic_model,
          draft_provider: parsed.draft_provider,
          critique: parsed.critique,
          latency_ms: parsed.latency_ms,
        }
      }
    }
    if (ensembleData && critiqueData) break
  }
  // 비평이 있으면 ensembleData 에 붙여서 EnsembleCompareView 가 한 데이터로 처리
  if (ensembleData && critiqueData) ensembleData.critique = critiqueData
  return { ensembleData, critiqueData }
}

function buildToolTimeline(loop: AgentLoopResult) {
  return loop.tool_calls.map((t) => ({
    tool_name: t.tool_name,
    ok: t.ok,
    latency_ms: t.latency_ms,
    summary: t.output_summary,
    error: t.error ?? null,
    started_at: t.called_at,
  }))
}

function buildRuntimeCompatibleResult(effectiveInput: any, loop: AgentLoopResult) {
  // 2026-04-24 Phase 1: fallback chain 도입 이후 loop.provider 가 claude 가 아닐 수 있다.
  // anthropic(Opus/Sonnet) / openai(GPT) / gemini 중 실제 응답 provider 를 반영.
  const loopProvider = loop.provider === "anthropic" ? "claude" : loop.provider
  const provider = loop.ok ? loopProvider : null
  const task = safeString(effectiveInput?.task) || "dialogue"
  const toolNames = loop.tool_calls.map((t) => t.tool_name)
  const uniqueToolNames = [...new Set(toolNames)]
  const failedTools = loop.tool_calls.filter((t) => !t.ok).map((t) => t.tool_name)
  const { ensembleData, critiqueData } = extractEnsembleAndCritique(loop)
  const toolTimeline = buildToolTimeline(loop)

  return {
    // ── 최종 답변 ────────────────────────────────────────────────────────
    final_answer: {
      provider,
      text: loop.text,
      ok: loop.ok,
    },
    // ── response_meta — chat.ts 의 buildChatPayload / buildStructuredMemory 소비 ──
    response_meta: {
      orchestration: {
        final_provider: provider,
        selected_provider: provider,
        provider,
        latency_ms: loop.latency_ms,
        estimated_cost_usd: 0,
        execution_strategy: "agent_loop",
        iterations: loop.iterations,
        stop_reason: loop.stop_reason,
        tool_calls_count: loop.tool_calls.length,
        tools_used: uniqueToolNames,
        failed_tools: failedTools,
        input_tokens: loop.usage.input_tokens ?? 0,
        output_tokens: loop.usage.output_tokens ?? 0,
        model: loop.model,
        // Phase 3 — UI 렌더용 확장 필드
        tool_timeline: toolTimeline,
        ensemble_data: ensembleData,
        critique_data: critiqueData,
      },
      winner_reason: {
        provider,
        rationale: `agent_loop iterations=${loop.iterations} tools=${uniqueToolNames.join(",") || "none"}`,
      },
      selection_trace: {
        judge_rationale: `agent_loop stop_reason=${loop.stop_reason}`,
        selected_reasons: uniqueToolNames.map((n) => `tool:${n}`),
      },
    },
    // ── internal_rationale — chat.ts derived / bandit 소비 ────────────────
    internal_rationale: {
      task,
      route: {
        task,
        strategy: "agent_loop",
        primary_provider: loopProvider ?? "claude",
        verifier_providers: [],
        parallel_providers: [],
        fallback_providers: [],
      },
      judge: null,
      conflicts: [],
      conflict_count: 0,
      executed_providers: provider ? [provider] : [],
      execution_policy: {
        max_parallel: 1,
        cost_gate_enabled: false,
        max_total_estimated_cost_usd: 0,
        prefer_fast_fallback: false,
      },
      escalation: {
        pre_routing_use_pro: false,
        post_eval_triggered: false,
      },
      scoreboard: {},
      bandit: {},
      claims: [],
      // tool 호출 로그는 여기 남겨서 UI (Phase 3 ToolCallTimeline) 에서 읽을 수 있게
      tool_calls: loop.tool_calls,
    },
    // 원본 loop 결과도 첨부 (디버깅용)
    _agent_loop_raw: {
      iterations: loop.iterations,
      stop_reason: loop.stop_reason,
      usage: loop.usage,
      latency_ms: loop.latency_ms,
      error: loop.error ?? null,
    },
  }
}

/**
 * chat.ts 가 호출하는 agent-loop runtime 진입점.
 */
export async function runAgentLoopRuntimeResult(
  effectiveInput: any,
  onEvent?: AgentRuntimeEventCallback,
): Promise<any> {
  const task = safeString(effectiveInput?.task) || "dialogue"
  const highValue = decideHighValue(effectiveInput)

  // 이벤트: route_decided (단일 에이전트 루프, 항상 claude primary)
  if (onEvent) {
    try {
      await onEvent({
        type: "route_decided",
        task,
        provider: "claude",
        strategy: "agent_loop",
        high_value: highValue,
      })
    } catch { /* ignore */ }
  }

  if (onEvent) {
    try {
      await onEvent({
        type: "provider_start",
        provider: "claude",
        model: "claude-opus-4-6",
        task,
      })
    } catch { /* ignore */ }
  }

  // 메시지 추출 — effectiveInput.message 우선, 없으면 messages 마지막 user
  const message = (() => {
    const direct = safeString(effectiveInput?.message)
    if (direct) return direct
    const msgs = Array.isArray(effectiveInput?.messages) ? effectiveInput.messages : []
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const m = msgs[i]
      if (m?.role === "user") {
        if (typeof m.content === "string") return safeString(m.content)
        if (Array.isArray(m.content)) {
          return m.content
            .map((p: any) => (typeof p === "string" ? p : safeString(p?.text)))
            .filter(Boolean)
            .join("\n")
            .trim()
        }
      }
    }
    return ""
  })()

  // Phase 5 — 실시간 도구 호출 이벤트 발행 (onToolCall 콜백)
  // agentLoop 가 invokeTool() 직후 이 콜백을 호출 → chat.ts 의 streamEventHandler 로 포워드
  // parallel_ensemble / adversarial_critique 은 output_text 전체를 실어서 프론트 4탭 뷰가
  // 최종 answer 전에 이미 draft/비평을 렌더할 수 있게 한다.
  const liveToolCall = async (tc: any) => {
    if (!onEvent) return
    const carriesFullOutput =
      tc?.tool_name === "parallel_ensemble" || tc?.tool_name === "adversarial_critique"
    try {
      await onEvent({
        type: "tool_call",
        tool_name: tc?.tool_name,
        ok: tc?.ok !== false,
        latency_ms: tc?.latency_ms,
        summary: tc?.output_summary,
        error: tc?.error ?? null,
        ...(carriesFullOutput && tc?.output_text ? { output_text: tc.output_text } : {}),
      })
    } catch { /* ignore — fire-and-forget */ }
  }

  const loopInput: AgentLoopInput = {
    thread_id: safeString(effectiveInput?.thread_id),
    project_id: safeString(effectiveInput?.project_id) || "chat_project",
    user_id: effectiveInput?.user_id ?? null,
    message,
    normalizedInput: effectiveInput,
    high_value: highValue,
    extra_system: (() => {
      const base = safeString(effectiveInput?.system_prompt) || safeString(effectiveInput?.project_instructions)
      const domainProfile = safeString(effectiveInput?.domain_profile) || "general"
      const domainHint = buildDomainHint(domainProfile)
      if (domainHint) return domainHint + (base ? "\n\n" + base : "")
      return base
    })(),
    signal: effectiveInput?.__abort_signal,
    onToolCall: liveToolCall,
  }

  // ── Fallback chain: Opus → Sonnet → GPT-5.4-pro → Gemini 2.5 Pro ──────
  // 2026-04-23 인시던트: Anthropic 크레딧 소진 시 single_agent 전체 실패.
  // CLAUDE.md 규칙 #6 (MAX_DEPTS) 와 무관 — 이건 부서가 아닌 단일 에이전트 경로.
  const emitFallback = async (from: { provider: string; model: string }, to: { provider: string; model: string }, reason: string) => {
    if (!onEvent) return
    try {
      await onEvent({
        type: "single_agent_fallback",
        from_provider: from.provider,
        from_model: from.model,
        to_provider: to.provider,
        to_model: to.model,
        reason,
      })
    } catch { /* ignore */ }
  }

  const emergencyUserText = (() => {
    // 첨부/히스토리 힌트를 포함한 loopInput.message 가 사용자의 최신 발화
    return message || "사용자 메시지가 비어있습니다."
  })()

  const runAnthropicAttempt = async (model: string, timeoutMs: number): Promise<AgentLoopResult> => {
    try {
      return await runAgentLoop({
        ...loopInput,
        model_override: model,
        timeout_ms_override: timeoutMs,
      })
    } catch (error: any) {
      logger.warn("[agentLoopRuntime] runAgentLoop threw", { model, error: String(error?.message ?? error) })
      return {
        ok: false,
        text: "",
        provider: "anthropic",
        model,
        iterations: 0,
        tool_calls: [],
        usage: {},
        latency_ms: 0,
        stop_reason: "exception",
        error: String(error?.message ?? error),
      }
    }
  }

  // Primary: Claude Opus 4.6
  let loopResult: AgentLoopResult = await runAnthropicAttempt("claude-opus-4-6", 180_000)

  // Fallback 1: Claude Sonnet 4.6 (같은 agent loop, tool use 유지)
  if (loopFailureIsRetryable(loopResult)) {
    logger.warn("[agentLoopRuntime] Opus failed → Sonnet fallback", {
      stop_reason: loopResult.stop_reason, error: loopResult.error,
    })
    await emitFallback(
      { provider: "anthropic", model: "claude-opus-4-6" },
      { provider: "anthropic", model: "claude-sonnet-4-6" },
      String(loopResult.stop_reason || loopResult.error || "opus_failed"),
    )
    loopResult = await runAnthropicAttempt("claude-sonnet-4-6", SONNET_TIMEOUT_MS)
  }

  // Fallback 2: GPT-5.4-pro (도구 없는 단순 텍스트)
  if (loopFailureIsRetryable(loopResult)) {
    logger.warn("[agentLoopRuntime] Sonnet failed → GPT fallback", {
      stop_reason: loopResult.stop_reason, error: loopResult.error,
    })
    await emitFallback(
      { provider: "anthropic", model: "claude-sonnet-4-6" },
      { provider: "openai", model: "gpt-5.4-pro" },
      String(loopResult.stop_reason || loopResult.error || "sonnet_failed"),
    )
    const startedAt = Date.now()
    try {
      const text = await callWithTimeout(
        callOpenAI(buildEmergencySystemPrompt(loopInput.extra_system), emergencyUserText, 4096),
        GPT_FALLBACK_TIMEOUT_MS,
        "gpt_fallback",
      )
      loopResult = buildFallbackLoopResult({
        provider: "openai", model: "gpt-5.4-pro",
        text: (text || "").trim(), ok: Boolean((text || "").trim()),
        latencyMs: Date.now() - startedAt,
      })
    } catch (error: any) {
      loopResult = buildFallbackLoopResult({
        provider: "openai", model: "gpt-5.4-pro",
        text: "", ok: false,
        latencyMs: Date.now() - startedAt,
        error: String(error?.message ?? error),
      })
    }
  }

  // Fallback 3: Gemini 2.5 Pro
  if (loopFailureIsRetryable(loopResult)) {
    logger.warn("[agentLoopRuntime] GPT failed → Gemini fallback", {
      stop_reason: loopResult.stop_reason, error: loopResult.error,
    })
    await emitFallback(
      { provider: "openai", model: "gpt-5.4-pro" },
      { provider: "gemini", model: "gemini-2.5-pro" },
      String(loopResult.stop_reason || loopResult.error || "gpt_failed"),
    )
    const startedAt = Date.now()
    try {
      const text = await callWithTimeout(
        callGemini(buildEmergencySystemPrompt(loopInput.extra_system), emergencyUserText, 4096),
        GEMINI_FALLBACK_TIMEOUT_MS,
        "gemini_fallback",
      )
      loopResult = buildFallbackLoopResult({
        provider: "gemini", model: "gemini-2.5-pro",
        text: (text || "").trim(), ok: Boolean((text || "").trim()),
        latencyMs: Date.now() - startedAt,
      })
    } catch (error: any) {
      loopResult = buildFallbackLoopResult({
        provider: "gemini", model: "gemini-2.5-pro",
        text: "", ok: false,
        latencyMs: Date.now() - startedAt,
        error: String(error?.message ?? error),
      })
    }
  }

  if (!loopResult.ok) {
    logger.error("[agentLoopRuntime] all 4 providers failed", {
      stop_reason: loopResult.stop_reason, error: loopResult.error,
    })
  }

  // final_answer 이벤트
  if (onEvent) {
    try {
      await onEvent({
        type: "final_answer",
        provider: loopResult.provider,
        model: loopResult.model,
        text: loopResult.text,
        ok: loopResult.ok,
        latency_ms: loopResult.latency_ms,
      })
    } catch { /* ignore */ }
  }

  return buildRuntimeCompatibleResult(effectiveInput, loopResult)
}

/**
 * @deprecated legacy alias for backward compatibility.
 * Use `runAgentLoopRuntimeResult` instead.
 */
export async function runAgentLoopAsOrchestraResult(
  effectiveInput: any,
  onEvent?: AgentRuntimeEventCallback,
): Promise<any> {
  return runAgentLoopRuntimeResult(effectiveInput, onEvent)
}
