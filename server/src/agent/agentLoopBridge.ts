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
  const provider = loop.ok ? "claude" : null
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
        primary_provider: "claude",
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

  let loopResult: AgentLoopResult
  try {
    loopResult = await runAgentLoop(loopInput)
  } catch (error: any) {
    logger.warn("[agentLoopRuntime] runAgentLoop threw", { error: String(error?.message ?? error) })
    loopResult = {
      ok: false,
      text: "",
      provider: "anthropic",
      model: "claude-opus-4-6",
      iterations: 0,
      tool_calls: [],
      usage: {},
      latency_ms: 0,
      stop_reason: "exception",
      error: String(error?.message ?? error),
    }
  }

  // final_answer 이벤트
  if (onEvent) {
    try {
      await onEvent({
        type: "final_answer",
        provider: "claude",
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
