// agentLoop.ts — CORVUS X Agent Loop (Phase 2)
//
// Claude Opus 4.6 native tool use + extended thinking 기반 단일 에이전트 루프.
// Planner/Judge/Scoreboard 폐기 대체. chat.ts 가 executeOrchestra 대신 이 함수를
// 호출하도록 Phase 2.5 에서 스위칭할 예정.
//
// 동작:
//  1) toolRegistry 에서 도구 목록 로드 → Anthropic tool 포맷으로 직렬화
//  2) messages 에 시스템 프롬프트 + 사용자 입력 + (있으면) 첨부파일 메타 주입
//  3) /v1/messages 호출 (thinking enabled on high-value path, tool_choice=auto)
//  4) 응답에 tool_use 블록이 있으면 invokeTool 실행 → tool_result 로 messages 에 append → 재호출
//  5) tool_use 가 없으면 최종 텍스트 추출 → 반환
//  6) 최대 MAX_ITER 반복. 초과 시 강제 종료.

import { ANTHROPIC_BASE, ADAPTER_TIMEOUT_MS } from "../config/defaults.js"
import { logger } from "../observability/logger.js"
import {
  invokeTool,
  listTools,
  toAnthropicTools,
  type ToolCallRecord,
  type ToolContext,
} from "./toolRegistry.js"
import { buildFusionSystemBlock } from "../fusion/threadFusion.js"
import { buildProjectFusionBlock } from "../fusion/projectFusion.js"
import { getSnapshotsByCategory } from "../regulation/regulationCache.js"
import type { RegulationCategory } from "../regulation/regulationSources.js"

// ── 상수 ──────────────────────────────────────────────────────────────────
const DEFAULT_MODEL = "claude-opus-4-6"  // CLAUDE.md 기준 최상위 모델 고정
const DEFAULT_MAX_TOKENS = 8000
const DEFAULT_THINKING_BUDGET = 16000
const MAX_ITER = 6
const AGENT_LOOP_TIMEOUT_MS = 180_000 // 3분

// ── 타입 ──────────────────────────────────────────────────────────────────
export type AgentLoopInput = {
  thread_id: string
  project_id: string
  user_id?: string | null
  message: string
  /** chat.ts 의 normalizedInput 전체 (첨부·messages 포함) */
  normalizedInput: any
  /** high-value path 는 thinking enabled + more tokens */
  high_value?: boolean
  /** 도구 사용 비활성화 (pure chat 모드) */
  disable_tools?: boolean
  /** system prompt 보강 — 프로젝트 지침, 도메인 프로파일 등 */
  extra_system?: string
  /** 외부 abort signal */
  signal?: AbortSignal
  /** 스트리밍 토큰 콜백 — 최종 텍스트 블록에 한해 호출 */
  onToken?: (chunk: string) => void | Promise<void>
  /**
   * Phase 5 — 실시간 도구 호출 콜백. 각 invokeTool() 완료 직후 1회 호출된다.
   * parallel_ensemble / adversarial_critique 은 output_text 전체가 실려 있어
   * 프론트가 라이브 4탭 비교 뷰를 즉시 렌더할 수 있다.
   */
  onToolCall?: (entry: ToolCallRecord) => void | Promise<void>
}

export type AgentLoopResult = {
  ok: boolean
  text: string
  provider: string
  model: string
  iterations: number
  tool_calls: ToolCallRecord[]
  usage: {
    input_tokens?: number
    output_tokens?: number
  }
  latency_ms: number
  stop_reason: string
  error?: string
}

// ── 유틸 ──────────────────────────────────────────────────────────────────
function safeString(value: any): string {
  return String(value ?? "").trim()
}

function buildSystemPrompt(input: AgentLoopInput): string {
  const base = [
    "You are CORVUS X, a True Multi-AI workspace powered by Claude Opus 4.6 as primary agent.",
    "You run as a single autonomous agent loop. No planner, no router, no judge.",
    "You may call tools at will. Each tool has a clear description — read it before using.",
    "Follow this policy strictly:",
    "- ATTACHMENT RULE (MANDATORY): When ANY files are attached — PDF, image, Excel, Word, etc. —",
    "  you MUST call read_attachment FIRST before forming any opinion about the content.",
    "  NEVER judge, refuse, or summarize an attachment based on its filename alone.",
    "  Only after reading the actual content may you decide how to respond.",
    "- If the user references past turns ('그거', '아까', '이전', '저번에') call recall_thread_history first.",
    "- If the query needs fresh info (news, prices, regulations, competitors, recent events) call perplexity_search.",
    "- LEGAL DOCUMENTS: 소송장, 계약서, 법원문서, 증거자료, 이혼소송, 민사/형사 서류 분석은",
    "  CORVUS X의 핵심 기능입니다. 법률 문서가 첨부되면 반드시 내용을 읽고 법적 분석을 제공하세요.",
    "  개인정보가 포함된 법률 문서도 사용자가 직접 업로드한 자신의 사건 자료이므로 분석 대상입니다.",
    "- For HIGH-VALUE tasks (legal drafting, business plan, risk analysis, contract review, product development,",
    "  regulation check, deep strategy, final review): call parallel_ensemble to get GPT-5.4-pro + Claude Opus 4.6 +",
    "  Gemini 3.1 Pro Ultra drafts simultaneously, then synthesize. Pass the ORIGINAL attachment text verbatim,",
    "  not a summary. After synthesizing, call adversarial_critique on your synthesized draft (critic model MUST",
    "  differ from the draft's provider) to surface errors before final delivery.",
    "- For everyday conversation, simple questions, or low-stakes tasks: do NOT call parallel_ensemble — the cost",
    "  and latency are too high. Handle it with your own reasoning + minimal tool use.",
    "- Prefer calling fewer, targeted tools over many redundant ones.",
    "- After gathering enough context, produce your final answer in Korean (존댓말) unless the user writes in another language.",
    "- Be direct and substantive. Do not hedge. Do not pad with boilerplate.",
    "- When uncertain, state it explicitly rather than guessing confidently.",
    "- RESPONSE FORMAT RULES (MANDATORY):",
    "  · Match format to the question type. Casual question → conversational prose. Analysis → structured sections.",
    "  · AVOID excessive tables. Use a table ONLY when comparing 3+ items across multiple identical attributes.",
    "    Simple lists, recommendations, or summaries MUST use numbered/bulleted lists, NOT tables.",
    "  · NEVER use code fences (``` ```) for NON-CODE content. This covers:",
    "    - Workflow diagrams or process flows with arrows (→ ↓ ↑ →), ASCII art",
    "    - Checklists, to-do lists, step sequences",
    "    - Plain text summaries, case descriptions, recommendations",
    "    - Names, dates, labels, or any descriptive text",
    "    Code fences are STRICTLY for actual executable source code (Python, JS, TypeScript, SQL, Shell, etc.)",
    "    or terminal commands ONLY. For workflow/process diagrams, use plain markdown bullet lists.",
    "- For LEGAL document analysis: go deep. Cite specific Korean law articles (민법, 형법, 가사소송법 등),",
    "  reference relevant precedents (판례), analyze each claim's legal merit, assess evidence strength,",
    "  and provide concrete strategic recommendations — not just 'hire a lawyer'.",
  ].join("\n")

  const extra = safeString(input.extra_system)

  // Phase 4-C — 스레드 융합 + 프로젝트 메모리 자동 주입 (query 가 있을 때만)
  const fusionParts: string[] = []
  const query = safeString(input.message)
  const projectId = safeString(input.project_id) || "chat_project"
  if (query.length > 10 && projectId) {
    try {
      const threadBlock = buildFusionSystemBlock({ project_id: projectId, query, max_threads: 4 })
      if (threadBlock) fusionParts.push(threadBlock)
    } catch { /* fusion 실패는 무시 — 메인 루프를 막으면 안 됨 */ }
    try {
      const projBlock = buildProjectFusionBlock({ project_id: projectId, query })
      if (projBlock) fusionParts.push(projBlock)
    } catch { /* ignore */ }
  }

  // Phase 5 — domain_profile 기반 법규 캐시 현황 힌트 주입
  // extra_system 에서 도메인 프로파일 파악 → 해당 카테고리 스냅샷 캐시 요약을 주입
  // 에이전트가 캐시 현황을 인지하면 stale 시 *_regulation_check 도구를 능동적으로 호출
  let regulationBlock = ""
  try {
    const domainHintMatch = extra.match(/도메인 프로파일:\s*(식품|액상전자담배|화장품|범용)/)
    let domCat: RegulationCategory | null = null
    if (domainHintMatch) {
      const label = domainHintMatch[1]
      if (label === "식품") domCat = "food"
      else if (label === "액상전자담배") domCat = "ecig"
      else if (label === "화장품") domCat = "cosmetic"
    }
    if (domCat) {
      const snaps = getSnapshotsByCategory(domCat)
      if (snaps.length > 0) {
        const now = Date.now()
        const lines = snaps.slice(0, 5).map((s) => {
          const ageHours = Math.round((now - (s.fetched_at ?? 0)) / 3_600_000)
          const stale = ageHours > 24 ? " ⚠️ stale" : ""
          return `  - [${s.source_id}] 마지막조회 ${ageHours}시간 전${stale}${s.ok ? "" : " (오류)"}`
        })
        regulationBlock = [
          "[법규 캐시 현황 — 자동 주입]",
          `${domCat} 도메인 캐시 ${snaps.length}건 확인됨. stale(>24h) 항목은 *_regulation_check 도구 호출을 권장:`,
          ...lines,
        ].join("\n")
      }
    }
  } catch { /* ignore — regulation cache 실패가 루프를 막으면 안 됨 */ }

  const fusionBlock = fusionParts.join("\n\n")
  const parts = [base]
  if (extra) parts.push(`=== Extra Instructions ===\n${extra}`)
  if (regulationBlock) parts.push(regulationBlock)
  if (fusionBlock) parts.push(fusionBlock)
  return parts.join("\n\n")
}

function buildInitialMessages(input: AgentLoopInput) {
  // chat.ts 가 normalizedInput.messages 에 과거 턴을 유지하면 그걸 그대로 사용
  const priorMessages: any[] = Array.isArray(input.normalizedInput?.messages)
    ? input.normalizedInput.messages.filter((m: any) => m?.role === "user" || m?.role === "assistant")
    : []

  const msgs: any[] = priorMessages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: typeof m.content === "string" ? m.content : safeString(m.content),
  }))

  // 현재 턴 사용자 메시지 — 첨부파일 힌트 추가
  const userContent = safeString(input.message)
  const attach = input.normalizedInput?.attached_file
  const pending = Array.isArray(input.normalizedInput?.pending_analysis_files)
    ? input.normalizedInput.pending_analysis_files
    : []
  const restored = Boolean(input.normalizedInput?.__attachment_restored_from_cache)

  let userBlock = userContent
  if (attach?.name || pending.length > 0) {
    const lines: string[] = []
    if (attach?.name) {
      lines.push(`[attachment] ${attach.name} (${safeString(attach.type)} / ${Number(attach.size ?? 0)} bytes)`)
    }
    for (const f of pending) {
      if (f?.name) lines.push(`[attachment] ${f.name} (${safeString(f.type)} / ${Number(f.size ?? 0)} bytes)`)
    }
    if (restored) {
      lines.push("(이 첨부는 이전 턴에서 복원되었습니다 — 필요하면 read_attachment 로 내용을 가져오세요)")
    } else {
      lines.push("(필요하면 read_attachment 로 내용을 가져오세요)")
    }
    userBlock = `${userContent}\n\n${lines.join("\n")}`
  }

  // 마지막 메시지가 user 가 아니면 새로 추가. user 면 병합.
  if (msgs.length > 0 && msgs[msgs.length - 1].role === "user" && safeString(msgs[msgs.length - 1].content) === userContent) {
    // chat.ts 가 이미 현재 메시지를 messages 에 추가했을 수 있음 — 중복 방지 차원에서 병합
    msgs[msgs.length - 1] = { role: "user", content: userBlock }
  } else {
    msgs.push({ role: "user", content: userBlock })
  }

  return msgs
}

async function callAnthropicRaw(params: {
  apiKey: string
  payload: any
  timeoutMs: number
  signal?: AbortSignal
}): Promise<{ ok: boolean; data: any; status: number; errorMessage?: string; timedOut: boolean }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), params.timeoutMs)
  const onAbort = () => controller.abort()
  params.signal?.addEventListener("abort", onAbort)

  try {
    const response = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": params.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(params.payload),
      signal: controller.signal,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      return {
        ok: false,
        data,
        status: response.status,
        errorMessage: safeString((data as any)?.error?.message) || `http_${response.status}`,
        timedOut: false,
      }
    }
    return { ok: true, data, status: response.status, timedOut: false }
  } catch (error: any) {
    const timedOut =
      error?.name === "AbortError" ||
      safeString(error?.message).toLowerCase().includes("aborted")
    return {
      ok: false,
      data: null,
      status: 0,
      errorMessage: timedOut ? "timeout" : safeString(error?.message) || "network_error",
      timedOut,
    }
  } finally {
    clearTimeout(timer)
    params.signal?.removeEventListener("abort", onAbort)
  }
}

// ── 메인 루프 ─────────────────────────────────────────────────────────────
export async function runAgentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  const startedAt = Date.now()
  const apiKey = process.env.ANTHROPIC_API_KEY

  const toolCallLog: ToolCallRecord[] = []

  const result: AgentLoopResult = {
    ok: false,
    text: "",
    provider: "anthropic",
    model: DEFAULT_MODEL,
    iterations: 0,
    tool_calls: toolCallLog,
    usage: {},
    latency_ms: 0,
    stop_reason: "unknown",
  }

  if (!apiKey) {
    result.error = "missing_anthropic_api_key"
    result.stop_reason = "error"
    result.latency_ms = Date.now() - startedAt
    return result
  }

  const ctx: ToolContext = {
    thread_id: safeString(input.thread_id),
    project_id: safeString(input.project_id) || "chat_project",
    user_id: input.user_id ?? null,
    normalizedInput: input.normalizedInput,
    startedAt,
    toolCallLog,
  }

  const system = buildSystemPrompt(input)
  const messages: any[] = buildInitialMessages(input)

  const tools = input.disable_tools ? [] : toAnthropicTools(listTools())

  const payloadBase: any = {
    model: DEFAULT_MODEL,
    max_tokens: DEFAULT_MAX_TOKENS,
    system,
  }

  if (input.high_value) {
    payloadBase.thinking = { type: "enabled", budget_tokens: DEFAULT_THINKING_BUDGET }
    payloadBase.max_tokens = Math.max(DEFAULT_MAX_TOKENS, DEFAULT_THINKING_BUDGET + 4000)
  }

  if (tools.length > 0) {
    payloadBase.tools = tools
    payloadBase.tool_choice = { type: "auto" }
  }

  let finalText = ""
  let stopReason = "unknown"
  let iter = 0
  const usage: { input_tokens?: number; output_tokens?: number } = {}

  // ── 루프 ────────────────────────────────────────────────────────────────
  for (iter = 0; iter < MAX_ITER; iter += 1) {
    if (input.signal?.aborted) {
      stopReason = "aborted"
      break
    }

    const elapsed = Date.now() - startedAt
    const remaining = Math.max(10_000, AGENT_LOOP_TIMEOUT_MS - elapsed)

    const payload = { ...payloadBase, messages }

    const { ok, data, errorMessage, timedOut } = await callAnthropicRaw({
      apiKey,
      payload,
      timeoutMs: Math.min(remaining, ADAPTER_TIMEOUT_MS),
      signal: input.signal,
    })

    if (!ok) {
      stopReason = timedOut ? "timeout" : "api_error"
      result.error = errorMessage
      logger.warn("[agentLoop] anthropic call failed", { iter, error: errorMessage })
      break
    }

    // usage 누적
    if (typeof data?.usage?.input_tokens === "number") {
      usage.input_tokens = (usage.input_tokens ?? 0) + data.usage.input_tokens
    }
    if (typeof data?.usage?.output_tokens === "number") {
      usage.output_tokens = (usage.output_tokens ?? 0) + data.usage.output_tokens
    }

    stopReason = safeString(data?.stop_reason) || "unknown"
    const contentBlocks: any[] = Array.isArray(data?.content) ? data.content : []

    // 모델 turn 을 assistant 메시지로 누적
    messages.push({ role: "assistant", content: contentBlocks })

    // tool_use 블록 수집
    const toolUses: Array<{ id: string; name: string; input: any }> = []
    const textChunks: string[] = []

    for (const block of contentBlocks) {
      if (block?.type === "tool_use") {
        toolUses.push({
          id: safeString(block.id),
          name: safeString(block.name),
          input: block.input ?? {},
        })
      } else if (block?.type === "text" && typeof block?.text === "string") {
        textChunks.push(block.text)
      }
      // thinking 블록은 UI 쪽에서 별도 처리 — 여기서는 무시
    }

    // tool_use 없음 → 종료
    if (toolUses.length === 0) {
      finalText = textChunks.join("\n").trim()
      // 스트리밍 콜백 (non-streaming 응답이라 청크 단위 분해는 x, 전체 전달)
      if (input.onToken && finalText) {
        try { await input.onToken(finalText) } catch { /* ignore */ }
      }
      break
    }

    // tool_use 있음 → 각 도구 실행 후 tool_result 를 user 메시지로 append
    const toolResults: any[] = []
    for (const tu of toolUses) {
      if (input.signal?.aborted) {
        stopReason = "aborted"
        break
      }
      const toolRes = await invokeTool(tu.name, tu.input, ctx)
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: toolRes.output_text,
        is_error: !toolRes.ok,
      })

      // Phase 5 — 실시간 도구 호출 이벤트 발행 (라이브 ToolCallTimeline / EnsembleCompareView 용)
      if (input.onToolCall) {
        // toolCallLog 맨 뒤에 방금 기록됐음을 전제로 마지막 엔트리를 전달
        const lastRecord = toolCallLog[toolCallLog.length - 1]
        if (lastRecord) {
          try { await input.onToolCall(lastRecord) } catch { /* ignore — fire-and-forget */ }
        }
      }
    }

    if (input.signal?.aborted) {
      stopReason = "aborted"
      break
    }

    messages.push({ role: "user", content: toolResults })

    // 루프 계속
  }

  if (iter >= MAX_ITER && !finalText) {
    stopReason = stopReason === "unknown" ? "max_iterations" : stopReason
    // 마지막 assistant 텍스트 블록이라도 추출
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]
      if (m?.role === "assistant" && Array.isArray(m.content)) {
        const txt = m.content
          .filter((b: any) => b?.type === "text" && typeof b?.text === "string")
          .map((b: any) => b.text)
          .join("\n")
          .trim()
        if (txt) {
          finalText = txt
          break
        }
      }
    }
  }

  result.ok = Boolean(finalText) && stopReason !== "api_error" && stopReason !== "timeout" && stopReason !== "aborted"
  result.text = finalText
  result.iterations = iter + (finalText ? 1 : 0)
  result.stop_reason = stopReason
  result.usage = usage
  result.latency_ms = Date.now() - startedAt
  return result
}
