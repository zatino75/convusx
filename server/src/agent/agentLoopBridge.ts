// agentLoopBridge.ts — Agent Loop ↔ Orchestra Result Adapter (Phase 2.5)
//
// 기존 chat.ts 는 executeOrchestra(effectiveInput) 의 반환을 buildChatPayload() /
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
// orchestra 호환 shape 으로 감싸서 돌려준다. 기존 chat.ts 코드 경로 수정 없이
// feature flag 로만 switching 할 수 있다.

import { runAgentLoop, type AgentLoopInput, type AgentLoopResult } from "./agentLoop.js"
import { logger } from "../observability/logger.js"

function safeString(value: any): string {
  return String(value ?? "").trim()
}

/**
 * executeOrchestra 의 streaming callback 과 동일한 시그니처.
 * Phase 2.5 에선 최소 이벤트(route_decided / provider_start / final_answer) 만 발행.
 */
export type OrchestraEventCallback = (event: any) => Promise<void> | void

/**
 * Phase 5 — 고가치 경로 자동 감지 키워드.
 * 메시지에 아래 패턴이 포함되면 parallel_ensemble + adversarial_critique 가
 * 자동 발동하도록 high_value path 로 끌어올린다. 한국어·영어 혼용.
 */
const HIGH_VALUE_KEYWORDS: RegExp[] = [
  // 한국어 — 법률/계약/답변서/규제
  /답변서/, /준비서면/, /소장/, /계약(서|조항|검토)/, /약관\s*검토/, /법률\s*검토/,
  /규제\s*(검토|분석|확인)/, /컴플라이언스/, /인허가/, /고시\s*(검토|변경)/,
  // 한국어 — 비즈니스/전략/재무
  /사업\s*계획/, /비즈니스\s*플랜/, /IR\s*자료/, /투자\s*제안/, /M&A/, /IPO/,
  /리스크\s*(분석|평가|검토)/, /전략\s*(수립|분석|기획)/, /최종\s*검토/,
  /재무\s*(분석|모델|검토)/, /밸류에이션/, /DCF/,
  // 한국어 — 상품/브랜드 (사용자 도메인)
  /상품\s*(개발|기획|런칭)/, /브랜드\s*(전략|포지셔닝|런칭)/, /제품\s*개발/,
  // 영어
  /\blegal\s+(review|opinion|memo)\b/i, /\bcontract\s+review\b/i, /\bcompliance\b/i,
  /\bbusiness\s+plan\b/i, /\bpitch\s+deck\b/i, /\bdue\s+diligence\b/i,
  /\brisk\s+(analysis|assessment)\b/i, /\bfinal\s+review\b/i, /\bM&A\b/i,
  /\bvaluation\b/i, /\bproduct\s+(development|launch)\b/i,
]

function detectHighValueByKeywords(message: string): boolean {
  const m = safeString(message)
  if (!m) return false
  // 너무 짧은 질의는 제외 (잡음 방지)
  if (m.length < 15) return false
  return HIGH_VALUE_KEYWORDS.some((re) => re.test(m))
}

/**
 * 어떤 effectiveInput 을 받았을 때 agent loop 를 high-value path 로 띄울지 결정.
 * Phase 5 정책:
 *  1) effectiveInput.force_high_value === true (UI 토글) → 즉시 true
 *  2) task 기반 매핑 (legal_review / finance_analysis / ...)
 *  3) 메시지 키워드 자동 감지
 */
function decideHighValue(effectiveInput: any): boolean {
  // 1) 명시적 UI 토글 — 최우선
  if (effectiveInput?.force_high_value === true) return true

  // 2) task 기반 매핑
  const task = safeString(effectiveInput?.task)
  if (task && task !== "dialogue") {
    if (task === "code_debug" || task === "code_implement" || task === "code_refactor_review") return true
    if (task === "legal_review" || task === "finance_analysis" || task === "product_development") return true
    if (task === "writing_business" || task === "long_doc" || task === "deep_research") return true
    if (task === "data_analysis" || task === "research") return true
  }

  // 3) 메시지 키워드 자동 감지
  const msg =
    safeString(effectiveInput?.message) ||
    (() => {
      const msgs = Array.isArray(effectiveInput?.messages) ? effectiveInput.messages : []
      for (let i = msgs.length - 1; i >= 0; i -= 1) {
        const m = msgs[i]
        if (m?.role === "user" && typeof m.content === "string") return safeString(m.content)
      }
      return ""
    })()
  if (detectHighValueByKeywords(msg)) return true

  return false
}

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

function buildOrchestraCompatibleResult(effectiveInput: any, loop: AgentLoopResult) {
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
 * chat.ts 에서 executeOrchestra 대신 호출하는 진입점.
 * 기존 executeOrchestra 와 동일한 시그니처(effectiveInput, onEvent?) 를 유지한다.
 */
export async function runAgentLoopAsOrchestraResult(
  effectiveInput: any,
  onEvent?: OrchestraEventCallback,
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
    extra_system: safeString(effectiveInput?.system_prompt) || safeString(effectiveInput?.project_instructions),
    signal: effectiveInput?.__abort_signal,
    onToolCall: liveToolCall,
  }

  let loopResult: AgentLoopResult
  try {
    loopResult = await runAgentLoop(loopInput)
  } catch (error: any) {
    logger.warn("[agentLoopBridge] runAgentLoop threw", { error: String(error?.message ?? error) })
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

  return buildOrchestraCompatibleResult(effectiveInput, loopResult)
}

/** feature flag 체크 (환경변수 기반) */
export function isAgentLoopEnabled(): boolean {
  const raw = safeString(process.env.CORVUS_USE_AGENT_LOOP).toLowerCase()
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on"
}
