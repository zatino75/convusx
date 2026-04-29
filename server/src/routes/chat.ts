// chat.ts — 단일 에이전트 루프 진입점 (Phase 2.5: agent loop bridge swap)
import { TITLE_GEN_TIMEOUT_MS, OPENAI_BASE } from "../config/defaults.js"
import { logger } from "../observability/logger.js"
import { registerSseClient } from "../http/sseRegistry.js"
import { runAgentLoopRuntimeResult } from "../agent/agentLoopBridge.js"
import { logBenchmark } from "../benchmark/benchmarkLogger.js"
import { appendProjectMemory, getLatestProjectContext, findPastWinner } from "../memory/projectMemory.js"
import { upsertThreadMemory, findSimilarQuery, getThreadMemory } from "../memory/threadMemory.js"
import { saveThreadAttachments, getThreadAttachments, looksLikeContinuation } from "../memory/attachmentCache.js"
import { broadcast } from "../http/websocket.js"
import { executeHook } from "../plugins/pluginManager.js"
import { normalizeChatMode, normalizeChatRuntimeInput } from "./chatRuntime.js"
import { runDirector, runDirectorSync } from "../director/DirectorAgent.js"
import { runExecutiveGate } from "../director/ExecutiveGate.js"
import type { ExecutiveGateResult, GateDomain } from "../director/ExecutiveGate.js"
import { detectMissionDomain } from "../director/TaskDecomposer.js"

// ── 분리된 모듈 import ──
import {
  analyzeImageWithVision, analyzePdfWithGemini, analyzeOfficeFileWithClaude,
  analyzeOfficeFileWithGemini, analyzeDocumentWithGemini, analyzeDocumentWithClaude,
  analyzeVideoWithGemini, analyzePdfWithOpenAI,
  analyzePdfDirect, analyzePdfExtractOnly, analyzeFileWithGeminiNative
} from "./chatFileAnalysis.js"
import {
  detectGeminiImageCommand, detectImageCommand, handleImageCommand, handleGeminiImageCommand,
  detectMidjourneyCommand, handleMidjourneyCommand, detectRunwayCommand, handleRunwayCommand,
  detectVeoCommand, handleVeoCommand, detectNanoBananaCommand, handleNanoBananaCommand
} from "./chatMediaGen.js"
// chatSpecialPipelines 전면 삭제 — 모든 detect/run 함수가 stub(return false/null)이었음.
// webSearch / deepResearch / handoff / sourcePromote / slide 모두 에이전트 루프 + 도구로 처리.
import {
  buildMessagesWithAttachment, injectAttachmentIntoInput, extractUrlsFromMessage,
  enrichMessageWithUrls, normalizeMultipleAttachments
} from "./chatAttachmentHandler.js"
import { extractInboundQuery } from "./chatSupport.js"

type RouteRequest = {
  body?: any
  on?: (event: string, cb: () => void) => void
}

type RouteResponse = {
  json?: (payload: unknown) => unknown
  writeHead?: (statusCode: number, headers: Record<string, string>) => void
  write?: (chunk: string) => void
  end?: () => void
}

const REUSE_PAST_WINNER_MIN_CONFIDENCE = 0.7

function safeArray(value: any): any[] {
  return Array.isArray(value) ? value : []
}

function safeObject(value: any): Record<string, any> {
  return value && typeof value === "object" ? value : {}
}

function safeString(value: any): string {
  return String(value ?? "").trim()
}
function safeNumber(value: any, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

// ── 입력 검증 ────────────────────────────────────────────────────────────
const MAX_MESSAGE_LENGTH = 50_000    // ~50KB per message
const MAX_ATTACHMENTS = 10
const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024  // 20MB

function validateChatInput(input: any): string | null {
  const msg = safeString(input?.message)
  if (msg.length > MAX_MESSAGE_LENGTH) return `message_too_long (max ${MAX_MESSAGE_LENGTH} chars)`

  const files = Array.isArray(input?.attached_files) ? input.attached_files : []
  if (files.length > MAX_ATTACHMENTS) return `too_many_attachments (max ${MAX_ATTACHMENTS})`

  for (const f of files) {
    const b64 = f?.base64
    if (typeof b64 === "string" && b64.length * 0.75 > MAX_ATTACHMENT_SIZE_BYTES) {
      return `attachment_too_large: ${safeString(f?.name)} (max 20MB)`
    }
  }
  return null
}


function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values ?? []) {
    const normalized = safeString(value)
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(normalized)
  }
  return out
}

function splitSentences(text: string): string[] {
  return safeString(text)
    .split(/[.\n!?]/)
    .map((part) => safeString(part))
    .filter(Boolean)
}

function buildDerived(result: any) {
  const route = result?.internal_rationale?.route ?? result?.route ?? {}
  const finalAnswer = result?.final_answer ?? {}
  const judge = result?.internal_rationale?.judge ?? {}
  const conflicts = safeArray(result?.internal_rationale?.conflicts)
  const executedProviders = safeArray(result?.internal_rationale?.executed_providers)
  const orchestration = result?.response_meta?.orchestration ?? {}

  const winnerProvider =
    judge?.selected_provider ??
    finalAnswer?.provider ??
    orchestration?.final_provider ??
    null

  const runnerUpProvider =
    safeArray(judge?.scores).find((x: any) => String(x?.provider ?? "") !== String(winnerProvider ?? ""))?.provider ??
    null

  return {
    detected_task: route?.task ?? result?.internal_rationale?.task ?? null,
    execution_strategy: route?.execution_strategy ?? null,
    selected_providers: safeArray(route?.selected_providers),
    verifier_providers: safeArray(route?.verifier_providers),
    fallback_providers: safeArray(route?.fallback_providers),
    parallel_providers: safeArray(route?.parallel_providers),
    winner: winnerProvider,
    runner_up: runnerUpProvider,
    conflict_count: safeNumber(result?.internal_rationale?.conflict_count, conflicts.length),
    executed_provider_count: executedProviders.length,
    latency_ms: safeNumber(orchestration?.latency_ms),
    estimated_cost_usd: safeNumber(orchestration?.estimated_cost_usd),
    fallback_used: Boolean(orchestration?.fallback_used),
    judge_confidence: safeNumber(orchestration?.judge_confidence, safeNumber(judge?.confidence))
  }
}

function buildBenchmarkPayload(result: any, input: any) {
  const route = result?.internal_rationale?.route ?? result?.route ?? {}
  const finalAnswer = result?.final_answer ?? {}
  const judge = result?.internal_rationale?.judge ?? {}
  const conflicts = safeArray(result?.internal_rationale?.conflicts)
  const messages = safeArray(input?.messages)
  const orchestration = result?.response_meta?.orchestration ?? {}

  return {
    timestamp: new Date().toISOString(),
    mode: normalizeChatMode(input?.mode),
    thread_id: input?.thread_id ?? "chat_thread",
    project_id: input?.project_id ?? "chat_project",
    task: route?.task ?? result?.internal_rationale?.task ?? null,
    execution_strategy: route?.execution_strategy ?? null,
    provider_chain: safeArray(route?.parallel_providers),
    selected_providers: safeArray(route?.selected_providers),
    verifier_providers: safeArray(route?.verifier_providers),
    executed_providers: safeArray(orchestration?.executed_providers),
    primary_provider: orchestration?.primary_provider ?? null,
    verifier_provider: safeArray(orchestration?.verifier_providers)[0] ?? null,
    final_provider: orchestration?.final_provider ?? finalAnswer?.provider ?? judge?.selected_provider ?? null,
    primary_ok: safeArray(orchestration?.provider_usage).find((x: any) => x.provider === orchestration?.primary_provider)?.success ?? null,
    verifier_ok: safeArray(orchestration?.provider_usage).find((x: any) => x.provider === safeArray(orchestration?.verifier_providers)[0])?.success ?? null,
    final_ok: Boolean(finalAnswer?.ok),
    success: Boolean(finalAnswer?.ok),
    fallback_used: Boolean(orchestration?.fallback_used),
    judge_rationale: judge?.rationale ?? null,
    judge_scores: safeArray(judge?.scores),
    judge_confidence: safeNumber(orchestration?.judge_confidence, safeNumber(judge?.confidence)),
    conflict_count: safeNumber(orchestration?.conflict_count, safeNumber(result?.internal_rationale?.conflict_count)),
    conflicts,
    provider_usage: safeArray(orchestration?.provider_usage),
    latency_ms: safeNumber(orchestration?.latency_ms),
    estimated_cost_usd: safeNumber(orchestration?.estimated_cost_usd),
    input_message_count: messages.length,
    input_size: JSON.stringify(input ?? {}).length,
    output_size: JSON.stringify(finalAnswer ?? {}).length
  }
}

function buildErrorBenchmarkPayload(input: any, error: any, startedAt: number) {
  const messages = safeArray(input?.messages)
  return {
    timestamp: new Date().toISOString(),
    mode: normalizeChatMode(input?.mode),
    thread_id: input?.thread_id ?? "chat_thread",
    project_id: input?.project_id ?? "chat_project",
    task: null, execution_strategy: null,
    provider_chain: [], selected_providers: [], verifier_providers: [], executed_providers: [],
    primary_provider: null, verifier_provider: null, final_provider: null,
    primary_ok: false, verifier_ok: null, final_ok: false, success: false,
    fallback_used: false, judge_rationale: null, judge_scores: [], judge_confidence: 0,
    conflict_count: 0, conflicts: [], provider_usage: [],
    latency_ms: Date.now() - startedAt, estimated_cost_usd: 0,
    input_message_count: messages.length,
    input_size: JSON.stringify(input ?? {}).length,
    output_size: 0,
    error_message: String(error?.message ?? "unknown_error")
  }
}

function buildChatPayload(result: any) {
  const orchestration = safeObject(result?.response_meta?.orchestration)
  const bandit = safeObject(result?.internal_rationale?.bandit)

  const finalAnswer = result?.final_answer ?? { provider: null, text: "", ok: false }
  // preview_text 폴백 제거 — final_answer.text가 항상 완전한 텍스트

  // ── 에이전트 도구로 생성된 이미지/비디오 추출 ──
  // generate_image / generate_video tool call 결과에서 URL 꺼내 done payload에 주입.
  // 프론트엔드 useSendChat.ts 의 is_image / is_video 핸들러가 소비.
  const toolCalls: any[] = Array.isArray(result?.internal_rationale?.tool_calls)
    ? result.internal_rationale.tool_calls : []
  const mediaFields: Record<string, any> = {}
  for (let i = toolCalls.length - 1; i >= 0; i--) {
    const tc = toolCalls[i]
    if (!tc?.ok || !tc?.output_text) continue
    if (tc.tool_name === "generate_image" && !mediaFields.image_url) {
      try {
        const p = JSON.parse(tc.output_text)
        if (p?.ok && p?.image_url) {
          mediaFields.is_image = true
          mediaFields.image_url = p.image_url
          if (p.image_urls) mediaFields.image_urls = p.image_urls
        }
      } catch { /* JSON 파싱 실패 무시 */ }
    }
    if (tc.tool_name === "generate_video" && !mediaFields.video_url) {
      try {
        const p = JSON.parse(tc.output_text)
        if (p?.ok && p?.video_url) {
          mediaFields.is_video = true
          mediaFields.video_url = p.video_url
        }
      } catch { /* JSON 파싱 실패 무시 */ }
    }
    if (tc.tool_name === "generate_slides" && !mediaFields.slide_data) {
      try {
        const p = JSON.parse(tc.output_text)
        if (p?.ok && p?.slide_data) {
          mediaFields.is_slide = true
          mediaFields.slide_data = p.slide_data
        }
      } catch { /* JSON 파싱 실패 무시 */ }
    }
    if (mediaFields.image_url && mediaFields.video_url && mediaFields.slide_data) break
  }

  return {
    ok: true,
    ...mediaFields,
    answer: finalAnswer,
    meta: { orchestration },
    orchestration,
    bandit,
    derived: buildDerived(result),
    internal: result?.internal_rationale ?? {
      task: null, route: null, judge: null, conflicts: [], conflict_count: 0,
      executed_providers: [],
      execution_policy: { max_parallel: 0, cost_gate_enabled: false, max_total_estimated_cost_usd: 0, prefer_fast_fallback: false },
      escalation: { pre_routing_use_pro: false, post_eval_triggered: false },
      scoreboard: {}
    },
    result
  }
}

function buildReusedPayload(text: string, provider: string, source: "similar_query" | "past_winner", score: number) {
  const orchestration = {
    reused: true, reuse_source: source, reuse_score: score,
    final_provider: provider, selected_provider: provider, provider,
    confidence: score, latency_ms: 0, estimated_cost_usd: 0
  }
  return {
    ok: true,
    answer: { provider, text, ok: true },
    meta: { orchestration },
    orchestration,
    bandit: {},
    derived: {
      detected_task: null, execution_strategy: "reuse",
      selected_providers: [provider], verifier_providers: [], fallback_providers: [],
      parallel_providers: [], winner: provider, runner_up: null,
      conflict_count: 0, executed_provider_count: 0,
      latency_ms: 0, estimated_cost_usd: 0, fallback_used: false, judge_confidence: score
    },
    internal: {
      task: null, route: null, judge: null, conflicts: [], conflict_count: 0,
      executed_providers: [],
      execution_policy: { max_parallel: 0, cost_gate_enabled: false, max_total_estimated_cost_usd: 0, prefer_fast_fallback: false },
      escalation: { pre_routing_use_pro: false, post_eval_triggered: false },
      scoreboard: {}
    },
    result: null
  }
}

function writeSse(res: RouteResponse, payload: any) {
  res.write?.(`data: ${JSON.stringify(payload)}\n\n`)
}

// ─── 라우팅 결정 ──────────────────────────────────────────────────────────────
// 2026-04-17: 키워드 매칭 전면 제거. ExecutiveGate(상무 LLM) 가 단일 판정자.
// 규칙:
//   - force_single_agent === true → 강제 single agent (gate 스킵)
//   - force_director    === true → 강제 director (gate 여전히 호출해 departments 는 활용)
//   - attached_file 있으면 파일 처리 경로 우선 → gate 스킵
//   - 그 외 → ExecutiveGate(=Classifier+Planner) 호출 후 gate.action 에 따라 분기
//
// 2026-04-24 Session 5: 기존 `q.length >= 20` 컷 제거. Classifier (Gemini Flash, ~$0.001)
// 가 모든 길이의 질문을 빠르고 저렴하게 분류하므로 휴리스틱 길이 컷은 불필요.
// 이전엔 17자 한국어 분석 질문이 Gate 를 우회해 single_agent 로 직행 → 부서 2단계 누락 버그.
type RouteDecision =
  | { kind: 'single_agent'; gate?: ExecutiveGateResult }
  | { kind: 'director'; gate: ExecutiveGateResult }

async function decideRoute(input: any, query: string): Promise<RouteDecision> {
  if (input?.force_single_agent === true) return { kind: 'single_agent' }
  if (input?.attached_file) return { kind: 'single_agent' }

  const q = safeString(query)
  if (!q) return { kind: 'single_agent' }

  const isForceDirector = input?.force_director === true

  const domain = detectMissionDomain(q) as GateDomain
  let gate: ExecutiveGateResult
  try {
    gate = await runExecutiveGate(q, domain)
  } catch (err) {
    logger.warn("[chat] ExecutiveGate 호출 실패 → single agent", { err: err instanceof Error ? err.message : String(err) })
    return { kind: 'single_agent' }
  }

  if (isForceDirector) {
    // force_director 는 gate 판정과 무관하게 director 로 실행 (departments 는 gate 결과 활용)
    return { kind: 'director', gate }
  }
  return gate.action === 'director' ? { kind: 'director', gate } : { kind: 'single_agent', gate }
}

function directorStatusFromEvent(event: any): string {
  switch (String(event?.type ?? "")) {
    case "mission_start": return "CEO 지시 접수 · PMO가 업무를 분해합니다..."
    case "pmo_plan": return "PMO 체크리스트 확정 · 부서 배정을 시작합니다..."
    case "dept_start": return `${String(event?.deptId ?? "부서").toUpperCase()} 부서 실행 시작`
    case "dept_progress": return `${String(event?.deptId ?? "부서").toUpperCase()} ${Number(event?.percent ?? 0)}% 진행`
    case "dept_done": return `${String(event?.deptId ?? "부서").toUpperCase()} 결과 제출 완료`
    case "critic_review": return `Critic 검증 완료 · ${String(event?.review?.verdict ?? "pass")}`
    case "ceo_briefing": return "상무가 대표이사 보고서를 작성 중입니다..."
    case "all_done": return "최종 경영 보고서가 완료되었습니다."
    default: return ""
  }
}

function renderDirectorFinalText(
  directive: string,
  roundSummary: any,
  briefing: any,
  critic: any,
): string {
  const mission = safeObject(roundSummary?.mission)
  const topic = safeString(mission?.topic) || "Executive Mission"
  const deptResults = Object.values(safeObject(roundSummary?.deptResults))
  const doneCount = deptResults.filter((row: any) => String(row?.status) === "done").length
  const errorCount = deptResults.filter((row: any) => String(row?.status) === "error").length

  const opportunities = safeArray(briefing?.opportunities).slice(0, 4).map((item) => `- ${safeString(item)}`).join("\n") || "- 없음"
  const risks = safeArray(briefing?.risks).slice(0, 4).map((item) => `- ${safeString(item)}`).join("\n") || "- 없음"
  const recommendations = safeArray(briefing?.recommendations).slice(0, 4).map((item) => `- ${safeString(item)}`).join("\n") || "- 없음"
  const criticIssues = safeArray(critic?.keyIssues).slice(0, 4).map((item) => `- ${safeString(item)}`).join("\n") || "- 특별 이슈 없음"

  return [
    `## 상무 종합보고 · ${topic}`,
    "",
    "### 대표이사 지시",
    safeString(directive),
    "",
    "### 실행 현황",
    `- 완료 부서: ${doneCount}`,
    `- 오류 부서: ${errorCount}`,
    "",
    "### 핵심 요약",
    safeString(briefing?.summary) || "요약이 생성되지 않았습니다.",
    "",
    "### 핵심 기회",
    opportunities,
    "",
    "### 핵심 리스크",
    risks,
    "",
    "### 즉시 실행 권고",
    recommendations,
    "",
    "### Critic 검증",
    `- verdict: ${safeString(critic?.verdict) || "pass"}`,
    `- confidence: ${String(critic?.confidence ?? "") || "n/a"}`,
    criticIssues,
  ].join("\n")
}

function buildStructuredMemory(result: any) {
  const finalAnswerText = safeString(result?.final_answer?.text)
  const winnerReason = safeObject(result?.response_meta?.winner_reason)
  const selectionTrace = safeObject(result?.response_meta?.selection_trace)
  const claims = safeArray(result?.internal_rationale?.claims)
  const sentences = splitSentences(finalAnswerText)

  // judge score reasons("coverage:0.8432" 등 metric string)는 decisions에서 제외
  const isMetricString = (s: string) => /^[a-z_]+:\d+\.?\d*$/.test(s.trim())
  const INTERNAL_NOISE_PATTERNS = ["single_candidate", "primary_survival_bias", "override", "single_candidate_after_escalation"]
  const decisions = uniqueStrings([
    safeString(winnerReason?.rationale),
    safeString(selectionTrace?.judge_rationale),
    ...safeArray(selectionTrace?.selected_reasons)
  ]).filter((d) =>
    String(d).length >= 10 &&
    !isMetricString(String(d)) &&
    !INTERNAL_NOISE_PATTERNS.some((n) => String(d).toLowerCase().includes(n))
  )

  // facts: 숫자+단위 포함 또는 명확한 사실 진술 문장 (단순 숫자 포함이 아닌 의미 있는 문장 위주)
  const facts = uniqueStrings([
    ...sentences.filter((line) =>
      (/\d+[\.,]?\d*\s*(?:%|억|만|천|원|개|건|배|위|점|명|회|달러|\$|ms|px|KB|MB|GB|TB)/.test(line) ||
       /(이다|입니다|됩니다|했습니다|합니다|아닙니다|없습니다|있습니다)\s*$/.test(line.trim())) &&
      line.length >= 15
    ),
    ...claims.flatMap((row: any) =>
      safeArray(row?.claims)
        .filter((claim: any) => String(claim?.type ?? "") === "fact")
        .map((claim: any) => safeString(claim?.text))
        .filter((t: string) => t.length >= 15)
    )
  ])

  const openQuestions = uniqueStrings(
    sentences.filter((line) => /\?$|질문|확인 필요|미정|불명확/i.test(line))
  )

  // entities: 대문자 시작 영문, 한글 고유명사(2자 이상), 대문자 약어, 하이픈 포함 기술어 위주
  // stopwords 제거로 노이즈 감소
  const STOPWORDS = new Set([
    "이","가","을","를","은","는","의","에","로","으로","와","과","도","만","더","또","및","등","즉","그","이런","이와",
    "that","this","with","from","have","will","been","when","where","which","they","their","there","these","those",
    "about","would","could","should","after","before","other","also","into","such","than","then","just","very","much"
  ])
  const entities = uniqueStrings(
    finalAnswerText
      .split(/\s+/)
      .map((token) => token.replace(/[^\w가-힣-]/g, ""))
      .filter((token) =>
        token.length >= 2 &&
        !STOPWORDS.has(token.toLowerCase()) &&
        (
          /^[A-Z]/.test(token) ||          // 대문자 시작 영문 (고유명사)
          /^[A-Z]{2,}$/.test(token) ||     // 대문자 약어 (API, LLM 등)
          token.includes("-") ||            // 하이픈 기술어 (bandit-score 등)
          /^[가-힣]{2,4}$/.test(token)     // 짧은 한글 고유명사 후보
        )
      )
      .slice(0, 20)
  )

  // summary: 첫 3문장 또는 400자 이내 (전체 저장 시 retrieval 노이즈 증가 방지)
  const summarySentences = sentences.slice(0, 3).join(" ").trim()
  const summaryText = summarySentences.length > 0
    ? (summarySentences.length > 400 ? summarySentences.slice(0, 400).trim() + "…" : summarySentences)
    : finalAnswerText.slice(0, 400).trim()

  return { summary: summaryText, decisions, facts, open_questions: openQuestions, entities }
}

function buildThreadMessages(input: any, result: any) {
  const inputMessages = safeArray(input?.messages)
  if (inputMessages.length > 0) {
    return inputMessages
      .map((message: any, index: number) => {
        const role = safeString(message?.role) || "user"
        const content =
          typeof message?.content === "string" ? safeString(message.content)
          : Array.isArray(message?.content)
            ? safeArray(message.content).map((part: any) => {
                if (typeof part === "string") return safeString(part)
                if (typeof part?.text === "string") return safeString(part.text)
                return ""
              }).join("\n").trim()
          : ""
        return { id: safeString(message?.id) || `msg_${index + 1}`, role, content, created_at: Number(message?.created_at ?? Date.now()) }
      })
      .filter((message: any) => message.content.length > 0)
      .concat([{ id: `assistant_${Date.now()}`, role: "assistant", content: safeString(result?.final_answer?.text), created_at: Date.now() }])
  }
  return [
    { id: `user_${Date.now()}`, role: "user", content: safeString(input?.message), created_at: Date.now() - 1 },
    { id: `assistant_${Date.now()}`, role: "assistant", content: safeString(result?.final_answer?.text), created_at: Date.now() }
  ]
}

async function generateThreadTitle(query: string, answerText: string): Promise<string | null> {
  const openaiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  if (!openaiKey) return null
  const sample = answerText.slice(0, 400)
  try {
    const res = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiKey}` },
      signal: AbortSignal.timeout(TITLE_GEN_TIMEOUT_MS),
      body: JSON.stringify({
        model: "gpt-5.2",
        max_tokens: 20,
        messages: [
          { role: "system", content: "대화 내용을 보고 스레드 제목을 한국어로 15자 이내로 만드세요. 명사/동사 위주로. 마침표 없이 단어나 짧은 구문만 출력하세요." },
          { role: "user", content: `질문: ${query.slice(0, 200)}
답변 요약: ${sample}` }
        ]
      })
    })
    const d = await res.json() as any
    const title = String(d?.choices?.[0]?.message?.content ?? "").trim().slice(0, 32)
    return title || null
  } catch (e) {
    logger.warn("thread title generation failed", { error: e })
    return null
  }
}

function persistRuntimeMemory(input: any, result: any) {
  const projectId = safeString(input?.project_id) || "chat_project"
  const threadId = safeString(input?.thread_id) || "chat_thread"
  const structured = buildStructuredMemory(result)

  appendProjectMemory({
    project_id: projectId, thread_id: threadId, timestamp: Date.now(),
    goal: input?.goal ?? null,
    task: result?.internal_rationale?.task ?? input?.task ?? null,
    winner_provider: result?.final_answer?.provider ?? null,
    claims: result?.internal_rationale?.claims ?? {},
    provider_health: result?.internal_rationale?.provider_status_map ?? {},
    provider_latency: result?.response_meta?.orchestration?.provider_usage ?? [],
    scoreboard: result?.internal_rationale?.scoreboard_after ?? [],
    output: result?.final_answer ?? null,
    summary: structured.summary, decisions: structured.decisions,
    facts: structured.facts, open_questions: structured.open_questions, entities: structured.entities
  })

  const projectContext = getLatestProjectContext(projectId)
  upsertThreadMemory({
    thread_id: threadId, project_id: projectId,
    title: safeString(input?.title) || null,
    messages: buildThreadMessages(input, result),
    structured: { summary: structured.summary, decisions: structured.decisions, facts: structured.facts, open_questions: structured.open_questions, entities: structured.entities, updated_at: Date.now() },
    retrieval_preview: projectContext?.retrieval_context ?? { summary: [], decisions: [], facts: [], sources: [] },
    winner_provider: result?.final_answer?.provider ??
      result?.internal_rationale?.final_provider ??
      result?.response_meta?.orchestration?.final_provider ?? null
  })
}

/**
 * 과거 우승 provider를 힌트로 반환 (캐시 답변 아님, 라우팅 힌트만).
 * 엉뚱한 답변 직접 반환 위험 없이 routing만 최적화.
 */
function tryMemoryProviderHint(input: any): { hint_provider: string; confidence: number } | null {
  try {
    const projectId = String(input?.project_id ?? input?.projectId ?? "").trim()
    const task = String(input?.task ?? "").trim()
    if (!projectId || !task) return null
    const past = findPastWinner(projectId, task, { minCount: 3, windowMs: 5 * 24 * 3600_000 })
    if (!past || (past.confidence ?? 0) < REUSE_PAST_WINNER_MIN_CONFIDENCE) return null
    return { hint_provider: past.winner_provider, confidence: past.confidence }
  } catch {
    return null
  }
}


/**
 * 연속 턴 첨부파일 복원·저장.
 *
 * 동작:
 *  A) 이번 턴에 첨부파일이 있으면 → thread 캐시에 저장 (다음 턴이 연속되면 재사용)
 *  B) 이번 턴에 첨부파일이 없고 메시지가 연속 턴 패턴이면 → 캐시에서 복원
 *
 * 주의: normalizedInput 을 in-place 로 mutate 한다. 후속 흐름(파일 분기,
 * injectAttachmentIntoInput, haiku 라우팅 등)이 attached_file / pending_analysis_files 를
 * 그대로 읽기 때문에 일반 업로드와 구별 없이 동작한다.
 */
function reconcileThreadAttachments(normalizedInput: any) {
  try {
    const threadId = safeString(normalizedInput?.thread_id)
    if (!threadId) return
    const projectId = safeString(normalizedInput?.project_id) || "chat_project"

    if (normalizedInput?.attached_file?.base64) {
      // A) 현재 턴 첨부 → 캐시에 저장
      const pending = Array.isArray(normalizedInput?.pending_analysis_files)
        ? normalizedInput.pending_analysis_files
        : []
      saveThreadAttachments(threadId, projectId, normalizedInput.attached_file, pending)
      return
    }

    // B) 첨부 없음 → 연속 턴 여부 판별 후 캐시에서 복원
    const cached = getThreadAttachments(threadId)
    if (!cached || (!cached.primary && cached.pending.length === 0)) return

    // 메시지 추출 — messages 배열도 고려
    const lastMessage = (() => {
      const direct = safeString(normalizedInput?.message)
      if (direct) return direct
      const msgs = safeArray(normalizedInput?.messages)
      const lastUser = [...msgs].reverse().find((m: any) => safeString(m?.role) === "user")
      if (!lastUser) return ""
      if (typeof lastUser.content === "string") return safeString(lastUser.content)
      if (Array.isArray(lastUser.content)) {
        return lastUser.content
          .map((part: any) => (typeof part === "string" ? part : safeString(part?.text)))
          .filter(Boolean)
          .join("\n")
          .trim()
      }
      return ""
    })()

    if (!looksLikeContinuation(lastMessage)) return

    // 복원
    if (cached.primary) {
      normalizedInput.attached_file = cached.primary
    }
    if (cached.pending.length > 0) {
      normalizedInput.pending_analysis_files = cached.pending
    }
    ;(normalizedInput as any).__attachment_restored_from_cache = true

    logger.info("[chat] attachments restored from cache", {
      thread_id: threadId,
      primary: cached.primary?.name ?? null,
      pending_count: cached.pending.length,
      trigger: lastMessage.slice(0, 80),
    })
  } catch (e) {
    logger.warn("reconcileThreadAttachments failed", { error: e })
  }
}

function makeDonePayload(provider: string, text: string, ok: boolean, strategy: string, task: string, providers: string[], extra?: any) {
  return {
    ok,
    answer: { provider, text, ok },
    meta: { orchestration: { final_provider: provider, latency_ms: 0 } },
    orchestration: { final_provider: provider },
    bandit: {},
    derived: { detected_task: task, execution_strategy: strategy, selected_providers: providers, verifier_providers: [], fallback_providers: [], parallel_providers: [], winner: provider, runner_up: providers[1] ?? null, conflict_count: 0, executed_provider_count: providers.length, latency_ms: 0, estimated_cost_usd: 0, fallback_used: false, judge_confidence: 1 },
    internal: { task, route: null, judge: null, conflicts: [], conflict_count: 0, executed_providers: [], execution_policy: { max_parallel: providers.length, cost_gate_enabled: false, max_total_estimated_cost_usd: 0, prefer_fast_fallback: false }, escalation: { pre_routing_use_pro: providers.length > 1, post_eval_triggered: false }, scoreboard: {} },
    result: null,
    ...extra
  }
}

export async function runChatRoute(req: RouteRequest, res: RouteResponse) {
  const validationError = validateChatInput(req?.body ?? {})
  if (validationError) return res.json?.({ ok: false, error: validationError })

  // ── 비용 가드 — dailyBlock / monthlyLimit 도달 시 모든 LLM 호출 차단 ──
  {
    const { evaluateGuard } = await import("../creditGuard.js")
    const guard = evaluateGuard("any")
    if (guard.level === "block") {
      return res.json?.({ ok: false, error: "cost_guard_blocked", level: "block",
        reason: guard.reason, dailyTotal: guard.dailyTotal, monthlyTotal: guard.monthlyTotal })
    }
  }

  const rawInput = normalizeMultipleAttachments(req?.body ?? {})
  const normalizedInput = normalizeChatRuntimeInput(rawInput)
  const startedAt = Date.now()
  // ── 연속 턴 첨부파일 캐시 (Phase 1 복원) ────────────────────────────────
  reconcileThreadAttachments(normalizedInput)
  const effectiveInput = normalizedInput?.attached_file ? injectAttachmentIntoInput(normalizedInput) : normalizedInput
  const inboundQuery = extractInboundQuery(effectiveInput)

  if (detectGeminiImageCommand(inboundQuery)) {
    const r = await handleGeminiImageCommand(inboundQuery)
    return res.json?.(makeDonePayload("gemini", r.message, r.ok, "image_generate", "dialogue", ["gemini"], { is_image: r.ok, image_url: r.url ?? null, image_revised_prompt: null }))
  }
  if (detectNanoBananaCommand(inboundQuery)) {
    const r = await handleNanoBananaCommand(inboundQuery)
    const firstImage = r.images?.[0]
    const imageUrl = firstImage ? `data:${firstImage.mimeType};base64,${firstImage.base64}` : null
    return res.json?.(makeDonePayload("gemini", r.message, r.ok, "image_generate", "dialogue", ["gemini"], { is_image: r.ok, image_url: imageUrl, image_revised_prompt: null, nano_banana: true }))
  }
  if (detectImageCommand(inboundQuery)) {
    const r = await handleImageCommand(inboundQuery)
    return res.json?.(makeDonePayload("openai", r.message, r.ok, "image_generate", "dialogue", ["openai"], { is_image: r.ok, image_url: r.url ?? null, image_revised_prompt: r.revised_prompt ?? null }))
  }
  const _attached = normalizedInput?.attached_file
  const _attachedType = String(_attached?.type ?? "")
  // 동영상 파일 (non-streaming)
  if (_attached && _attachedType.startsWith("video/")) {
    try {
      const userText = safeString(normalizedInput?.message) || "이 동영상을 분석해줘"
      const videoText = await analyzeVideoWithGemini(_attached, userText)
      return res.json?.(makeDonePayload("gemini", videoText, true, "video_analyze", "dialogue", ["gemini"]))
    } catch (e: any) {
      return res.json?.({ ok: false, error: String(e?.message ?? "video_error") })
    }
  }
  if (_attached && (_attachedType.startsWith("image/") || _attachedType === "application/pdf")) {
    try {
      const userText = safeString(normalizedInput?.message) || (_attachedType === "application/pdf" ? "이 PDF를 분석해줘" : "이 이미지를 분석해줘")
      const visionText = _attachedType === "application/pdf" ? await analyzePdfWithGemini(_attached, userText) : await analyzeImageWithVision(_attached, userText)
      return res.json?.(makeDonePayload("openai", visionText, true, "vision_analyze", "dialogue", ["openai"]))
    } catch (e: any) {
      return res.json?.({ ok: false, error: String(e?.message ?? "vision_error") })
    }
  }

  // ── 요청 라우팅: ExecutiveGate 가 단일 판정자 ──
  const routeDecision = await decideRoute(effectiveInput, inboundQuery)
  if (routeDecision.kind === 'director') {
    try {
      const routed = await runDirectorSync(inboundQuery, {
        projectName: "CONVUS X Autonomous Mission",
        userId: "chat-user",
        preloadedGate: routeDecision.gate,
      })
      // gate 가 도중에 single_agent 로 뒤집혔을 가능성 (force_director 없는 경로)
      if (routed.redirectedToSingleAgent) {
        // agent loop 경로로 fallthrough — 아래 try 블록에서 처리
      } else {
        const finalText = renderDirectorFinalText(
          inboundQuery,
          routed.round,
          routed.briefing,
          routed.critic,
        )
        let threadTitle: string | null = null
        try { threadTitle = await generateThreadTitle(inboundQuery, finalText) } catch {}
        return res.json?.({
          ...makeDonePayload("director", finalText, true, "executive_workflow", "director", ["director", "claude"]),
          thread_title: threadTitle,
          director: {
            session_id: routed.sessionId,
            round_number: routed.roundNumber,
            critic: routed.critic ?? null,
            briefing: routed.briefing ?? null,
            round: routed.round ?? null,
            gate: routed.gate ?? null,
          }
        })
      }
    } catch (e: any) {
      return res.json?.({ ok: false, error: String(e?.message ?? "director_route_error") })
    }
  }

  try {
    // 과거 우승 provider 힌트 (캐시 답변 아님, routing 최적화만)
    const providerHint = tryMemoryProviderHint(normalizedInput)
    if (providerHint) {
      effectiveInput.preferred_provider = providerHint.hint_provider
      logger.info("[chat] provider hint from memory", { provider: providerHint.hint_provider, confidence: providerHint.confidence })
    }
    // URL 자동 크롤링: 메시지에 URL이 있으면 내용을 가져와 enrichment
    if (effectiveInput?.message && extractUrlsFromMessage(String(effectiveInput.message)).length > 0) {
      effectiveInput.message = await enrichMessageWithUrls(String(effectiveInput.message))
    }
    // ── Token budget warning ──
    const inputSize = JSON.stringify(effectiveInput?.messages ?? effectiveInput?.message ?? "").length
    const estimatedTokens = Math.ceil(inputSize / 3.5)
    const MODEL_CONTEXT_LIMIT = 128_000
    if (estimatedTokens > MODEL_CONTEXT_LIMIT * 0.7) {
      logger.warn("[chat] input approaching context window limit", {
        estimated_tokens: estimatedTokens,
        context_limit: MODEL_CONTEXT_LIMIT,
        usage_ratio: +(estimatedTokens / MODEL_CONTEXT_LIMIT).toFixed(3),
        input_bytes: inputSize
      })
    }
    // Phase 4 complete: agent loop is always used (orchestra fallback removed)
    const result = await runAgentLoopRuntimeResult(effectiveInput)
    const _saveTxt = String(result?.final_answer?.text ?? ""); if (_saveTxt && _saveTxt.length > 20 && !_saveTxt.includes("final_answer를 찾지")) { try { persistRuntimeMemory(normalizedInput, result) } catch (e) { logger.warn("persistRuntimeMemory failed", { error: e }) } }
    try { await logBenchmark(buildBenchmarkPayload(result, normalizedInput)) } catch (e) { logger.warn("logBenchmark failed", { error: e }) }
    // 스레드 제목 자동 생성
    let threadTitle: string | null = null
    try {
      const answerText = safeString(result?.final_answer?.text)
      if (inboundQuery && answerText) threadTitle = await generateThreadTitle(inboundQuery, answerText)
    } catch (e) { logger.warn("thread title generation failed", { error: e }) }
    return res.json?.({ ...buildChatPayload(result), thread_title: threadTitle })
  } catch (error: any) {
    try { await logBenchmark(buildErrorBenchmarkPayload(normalizedInput, error, startedAt)) } catch (e) { logger.warn("logBenchmark failed", { error: e }) }
    return res.json?.({ ok: false, error: String(error?.message ?? "unknown_error") })
  }
}

// ── 다중 파일 병렬 분석 (pending_analysis_files) ──
// 기존: for...await 직렬 → 파일 수 × 40초
// 변경: Promise.allSettled 병렬 → ~20초 고정
async function processPendingFiles(
  pendingFiles: any[] | undefined,
  userText: string,
  res: RouteResponse,
  signal: AbortSignal
): Promise<string> {
  if (!pendingFiles || pendingFiles.length === 0) return ""

  const tasks = pendingFiles.map(async (file) => {
    if (signal.aborted) return { name: String(file.name ?? "unknown"), text: "" }
    const name = String(file.name ?? "unknown")
    const type = String(file.type ?? "")
    const q = `${name} 파일을 분석해줘. 사용자 질문: ${userText}`
    try {
      if (type === "application/pdf") {
        return { name, text: await analyzePdfDirect(file, q) }
      }
      if (type.startsWith("image/")) {
        return { name, text: await analyzeImageWithVision(file, q) }
      }
      if (type.startsWith("video/")) {
        return { name, text: await analyzeVideoWithGemini(file, q) }
      }
      // Excel / Word / PPT — Gemini 네이티브 우선, 실패 시 Claude 폴백
      const geminiResult = await analyzeFileWithGeminiNative(file, q)
      if (geminiResult) return { name, text: geminiResult }
      return { name, text: await analyzeOfficeFileWithClaude(file, q) }
    } catch (e: any) {
      return { name, text: `분석 실패: ${e?.message ?? "unknown error"}` }
    }
  })

  const settled = await Promise.allSettled(tasks)
  const parts: string[] = []
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value.text) {
      parts.push(`\n\n---\n**[${r.value.name}]**\n${r.value.text}`)
    }
  }

  const combined = parts.join("")
  if (combined) {
    for (const chunk of combined.split(/(\s+)/).filter((p: string) => p.length > 0)) {
      if (signal.aborted) break
      writeSse(res, { type: "chunk", content: chunk })
      await sleep(6)
    }
  }
  return combined
}

export async function runChatStreamRoute(req: RouteRequest, res: RouteResponse) {
  const validationError = validateChatInput(req?.body ?? {})
  if (validationError) { res.write?.(JSON.stringify({ ok: false, error: validationError })); res.end?.(); return }

  // ── 비용 가드 — dailyBlock / monthlyLimit 도달 시 SSE 시작 전 차단 ──
  {
    const { evaluateGuard } = await import("../creditGuard.js")
    const guard = evaluateGuard("any")
    if (guard.level === "block") {
      res.writeHead?.(503, { "Content-Type": "application/json" })
      res.write?.(JSON.stringify({ ok: false, error: "cost_guard_blocked", level: "block",
        reason: guard.reason, dailyTotal: guard.dailyTotal, monthlyTotal: guard.monthlyTotal }))
      res.end?.()
      return
    }
  }

  const rawInput = normalizeMultipleAttachments(req?.body ?? {})
  const abortController = new AbortController()
  const { signal } = abortController
  ;(req as any)?.on?.("close", () => { abortController.abort() })

  const normalizedInput = normalizeChatRuntimeInput(rawInput, { abort_signal: signal })
  const startedAt = Date.now()

  // ── 연속 턴 첨부파일 캐시 (Phase 1 복원) ────────────────────────────────
  reconcileThreadAttachments(normalizedInput)

  res.writeHead?.(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" })

  // ── SSE 레지스트리 등록 (스레드별 독립 연결, 좀비 자동 정리) ───────────
  // threadId 가 있으면 같은 키 신규 연결 시 기존 연결을 자동으로 종료한다.
  // threadId 가 없으면 임시 키 (요청별 고유) 로 등록.
  const sseKey = String(normalizedInput?.thread_id ?? `anon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const sseHandle = registerSseClient("chat", sseKey, res as any, req as any, abortController)
  // 라우트 종료 시 자동 정리
  ;(res as any)?.on?.("finish", () => sseHandle.close())

  try {
    writeSse(res, { type: "start", thread_id: normalizedInput.thread_id, project_id: normalizedInput.project_id })
    writeSse(res, { type: "status", content: "요청 분석 중..." })
    if ((normalizedInput as any)?.__attachment_restored_from_cache) {
      writeSse(res, { type: "status", content: "이전 턴 첨부파일을 복원했습니다..." })
    }

    const effectiveInput = normalizedInput?.attached_file ? injectAttachmentIntoInput(normalizedInput) : normalizedInput
    const inboundQuery = extractInboundQuery(effectiveInput)

    // ── Haiku LLM 라우팅 — 키워드 분류 완전 제거, LLM이 의도 파악 ──
    // haikuRoute: llmRouter 폐기 → 에이전트 루프가 task 자체 판단
    const haikuRoute: any = {}

    // ── Gemini 이미지 ──
    if (detectGeminiImageCommand(inboundQuery)) {
      const r = await handleGeminiImageCommand(inboundQuery)
      for (const chunk of r.message.split(/(\s+)/).filter((p: string) => p.length > 0)) { writeSse(res, { type: "chunk", content: chunk }); await sleep(12) }
      writeSse(res, { type: "done", payload: makeDonePayload("gemini", r.message, r.ok, "image_generate", "dialogue", ["gemini"], { is_image: r.ok, image_url: r.url ?? null, image_revised_prompt: null }) })
      res.end?.(); return
    }

    // ── Midjourney 이미지 ──
    if (detectMidjourneyCommand(inboundQuery)) {
      writeSse(res, { type: "chunk", content: "🎨 Midjourney로 이미지를 생성하고 있습니다...\n\n" })
      const r = await handleMidjourneyCommand(inboundQuery)
      for (const chunk of r.message.split(/(\s+)/).filter((p: string) => p.length > 0)) { writeSse(res, { type: "chunk", content: chunk }); await sleep(12) }
      writeSse(res, { type: "done", payload: makeDonePayload("midjourney", r.message, r.ok, "image_generate", "dialogue", ["midjourney"], { is_image: r.ok, image_url: r.url ?? null, image_urls: r.image_urls ?? null }) })
      res.end?.(); return
    }

    // ── Runway Gen4 Turbo 비디오 ──
    if (detectRunwayCommand(inboundQuery)) {
      writeSse(res, { type: "chunk", content: "🎬 Runway Gen4 Turbo로 비디오를 생성하고 있습니다... (최대 3분 소요)\n\n" })
      const r = await handleRunwayCommand(inboundQuery)
      for (const chunk of r.message.split(/(\s+)/).filter((p: string) => p.length > 0)) { writeSse(res, { type: "chunk", content: chunk }); await sleep(12) }
      writeSse(res, { type: "done", payload: makeDonePayload("runway", r.message, r.ok, "video_generate", "dialogue", ["runway"], { is_video: r.ok, video_url: r.video_url ?? null }) })
      res.end?.(); return
    }

    // ── Gemini Veo 3.1 비디오 ──
    if (detectVeoCommand(inboundQuery)) {
      writeSse(res, { type: "chunk", content: "🎬 Gemini Veo 3.1로 비디오를 생성하고 있습니다... (최대 2분 소요)\n\n" })
      const r = await handleVeoCommand(inboundQuery)
      for (const chunk of r.message.split(/(\s+)/).filter((p: string) => p.length > 0)) { writeSse(res, { type: "chunk", content: chunk }); await sleep(12) }
      writeSse(res, { type: "done", payload: makeDonePayload("gemini", r.message, r.ok, "video_generate", "dialogue", ["gemini"], { is_video: r.ok, video_url: r.video_url ?? null }) })
      res.end?.(); return
    }

    // ── Nano Banana 2 (Gemini Flash 이미지 생성) ──
    if (detectNanoBananaCommand(inboundQuery)) {
      writeSse(res, { type: "chunk", content: "🎨 Nano Banana 2 (Gemini Flash)로 이미지를 생성하고 있습니다...\n\n" })
      const r = await handleNanoBananaCommand(inboundQuery)
      for (const chunk of r.message.split(/(\s+)/).filter((p: string) => p.length > 0)) { writeSse(res, { type: "chunk", content: chunk }); await sleep(12) }
      const firstImage = r.images?.[0]
      const imageUrl = firstImage ? `data:${firstImage.mimeType};base64,${firstImage.base64}` : null
      writeSse(res, { type: "done", payload: makeDonePayload("gemini", r.message, r.ok, "image_generate", "dialogue", ["gemini"], { is_image: r.ok, image_url: imageUrl, image_revised_prompt: null, nano_banana: true }) })
      res.end?.(); return
    }

    // ── OpenAI 이미지 ──
    if (detectImageCommand(inboundQuery)) {
      const r = await handleImageCommand(inboundQuery)
      for (const chunk of r.message.split(/(\s+)/).filter((p: string) => p.length > 0)) { writeSse(res, { type: "chunk", content: chunk }); await sleep(12) }
      writeSse(res, { type: "done", payload: makeDonePayload("openai", r.message, r.ok, "image_generate", "dialogue", ["openai"], { is_image: r.ok, image_url: r.url ?? null, image_revised_prompt: (r as any).revised_prompt ?? null }) })
      res.end?.(); return
    }

    // ── 요청 라우팅: ExecutiveGate 가 단일 판정자 ──
    const streamRouteDecision = await decideRoute(effectiveInput, inboundQuery)
    if (streamRouteDecision.kind === 'director') {
      writeSse(res, { type: "status", content: "상무 배분으로 라우팅했습니다..." })

      let capturedSummary: any = null
      let capturedBriefing: any = null
      let capturedCritic: any = null
      let capturedSessionId = ""
      let capturedRoundNumber = 0
      let redirected = false

      const runResult = await runDirector(inboundQuery, {
        projectName: "CONVUS X Autonomous Mission",
        userId: "chat-user",
        preloadedGate: streamRouteDecision.gate,
        onEvent: (event: any) => {
          const status = directorStatusFromEvent(event)
          if (status) writeSse(res, { type: "status", content: status })
          writeSse(res, { type: "director_event", event })

          if (event?.type === "all_done") {
            capturedSummary = event?.summary ?? capturedSummary
            capturedBriefing = event?.briefing ?? capturedBriefing
            capturedCritic = event?.critic ?? capturedCritic
            capturedSessionId = safeString(event?.sessionId) || capturedSessionId
            capturedRoundNumber = Number(event?.roundNumber ?? capturedRoundNumber)
          }
          if (event?.type === "ceo_briefing") {
            capturedBriefing = event?.briefing ?? capturedBriefing
          }
          if (event?.type === "critic_review") {
            capturedCritic = event?.review ?? capturedCritic
          }
          if (event?.type === "executive_gate_redirect") {
            redirected = true
          }
        }
      })

      if (runResult.redirectedToSingleAgent || redirected) {
        // gate 가 도중에 single_agent 로 뒤집혔으면 agent loop 경로로 fallthrough
        writeSse(res, { type: "status", content: "단일 에이전트 루프로 전환합니다..." })
        // 아래 agent loop 블록으로 내려감
      } else {
        const finalText = renderDirectorFinalText(
          inboundQuery,
          capturedSummary,
          capturedBriefing,
          capturedCritic,
        )
        let threadTitle: string | null = null
        try { threadTitle = await generateThreadTitle(inboundQuery, finalText) } catch {}

        writeSse(res, {
          type: "done",
          payload: {
            ...makeDonePayload("director", finalText, true, "executive_workflow", "director", ["director", "claude"]),
            thread_title: threadTitle,
            director: {
              session_id: capturedSessionId || null,
              round_number: capturedRoundNumber || null,
              critic: capturedCritic ?? null,
              briefing: capturedBriefing ?? null,
              round: capturedSummary ?? null,
              gate: runResult.gate ?? null,
            }
          }
        })
        res.end?.(); return
      }
    }

    // ── 첨부 파일 처리 (파일 있으면 REUSE 스킵) ──
    // webSearch / deepResearch / handoff / sourcePromote → 에이전트 루프 + 도구(perplexitySearch, promoteToSource 등)가 처리
    const _attached = normalizedInput?.attached_file
    const _attachedType = String(_attached?.type ?? "")
    const _attachedName = String(_attached?.name ?? "").toLowerCase()
    const _isExcel = _attachedName.endsWith(".xlsx") || _attachedName.endsWith(".xls") || _attachedName.endsWith(".csv") || _attachedType.includes("spreadsheet") || _attachedType.includes("excel")
    const _isWord = _attachedName.endsWith(".docx") || _attachedName.endsWith(".doc") || _attachedType.includes("wordprocessingml") || _attachedType.includes("msword")
    const _isPpt = _attachedName.endsWith(".pptx") || _attachedName.endsWith(".ppt") || _attachedType.includes("presentationml") || _attachedType.includes("powerpoint")

    if (_attached && _isExcel) {
      const userText = safeString(normalizedInput?.message) || "이 엑셀 파일을 분석해줘"
      writeSse(res, { type: "status", content: "📊 Excel 파일 분석 중 (Gemini)..." })
      writeSse(res, { type: "provider_chunk", provider: "gemini", content: "Excel 파일 분석 중...\n\n" })
      // Gemini 네이티브 — 셀 위치·수식·시트 구조 그대로 읽음, 실패 시 Claude 폴백
      let result = await analyzeFileWithGeminiNative(_attached, userText)
      if (!result) { writeSse(res, { type: "provider_chunk", provider: "claude", content: "" }); result = await analyzeOfficeFileWithClaude(_attached, userText) }
      writeSse(res, { type: "final", provider: "gemini", content: result })
      const pendingExtra = await processPendingFiles(normalizedInput?.pending_analysis_files, userText, res, signal)
      writeSse(res, { type: "done", payload: makeDonePayload("gemini", result + pendingExtra, true, "excel_analyze", "excel", ["gemini"]) })
      res.end?.(); return
    }
    if (_attached && _isWord) {
      const userText = safeString(normalizedInput?.message) || "이 Word 문서를 분석해줘"
      writeSse(res, { type: "status", content: "📝 Word 문서 분석 중 (Gemini)..." })
      writeSse(res, { type: "provider_chunk", provider: "gemini", content: "Word 문서 분석 중...\n\n" })
      // Gemini 네이티브 — 표·헤딩·전체 텍스트 구조 보존, 실패 시 Claude 폴백
      let result = await analyzeFileWithGeminiNative(_attached, userText)
      if (!result) { writeSse(res, { type: "provider_chunk", provider: "claude", content: "" }); result = await analyzeOfficeFileWithClaude(_attached, userText) }
      writeSse(res, { type: "final", provider: "gemini", content: result })
      const pendingExtra = await processPendingFiles(normalizedInput?.pending_analysis_files, userText, res, signal)
      writeSse(res, { type: "done", payload: makeDonePayload("gemini", result + pendingExtra, true, "word_analyze", "word", ["gemini"]) })
      res.end?.(); return
    }
    if (_attached && _isPpt) {
      const userText = safeString(normalizedInput?.message) || "이 PPT 파일을 분석해줘"
      writeSse(res, { type: "status", content: "📑 PowerPoint 분석 중 (Gemini)..." })
      writeSse(res, { type: "provider_chunk", provider: "gemini", content: "PowerPoint 분석 중...\n\n" })
      // Gemini 네이티브 — 이미지 슬라이드·도표·레이아웃 포함, 실패 시 기존 방식 폴백
      let result = await analyzeFileWithGeminiNative(_attached, userText)
      if (!result) result = await analyzeOfficeFileWithGemini(_attached, userText)
      writeSse(res, { type: "final", provider: "gemini", content: result })
      const pendingExtra = await processPendingFiles(normalizedInput?.pending_analysis_files, userText, res, signal)
      writeSse(res, { type: "done", payload: makeDonePayload("gemini", result + pendingExtra, true, "ppt_analyze", "ppt", ["gemini"]) })
      res.end?.(); return
    }

    // ── 동영상 파일 ──
    if (_attached && _attachedType.startsWith("video/")) {
      const userText = safeString(normalizedInput?.message) || "이 동영상을 분석해줘"
      writeSse(res, { type: "status", content: "🎬 동영상 분석 중 (최대 2분)..." })
      writeSse(res, { type: "provider_chunk", provider: "gemini", content: "🎬 동영상 분석 중... (최대 2분 소요)\n\n" })
      const result = await analyzeVideoWithGemini(_attached, userText)
      writeSse(res, { type: "final", provider: "gemini", content: result })
      const pendingExtra = await processPendingFiles(normalizedInput?.pending_analysis_files, userText, res, signal)
      writeSse(res, { type: "done", payload: makeDonePayload("gemini", result + pendingExtra, true, "video_analyze", "dialogue", ["gemini"]) })
      res.end?.(); return
    }

    // ── ZIP 파일 (내부 PDF 자동 추출) ──
    if (_attached && (_attachedType === "application/zip" || _attachedType === "application/x-zip-compressed" || _attachedName.endsWith(".zip"))) {
      const userText = safeString(normalizedInput?.message) || "이 ZIP 파일의 내용을 분석해줘"
      writeSse(res, { type: "status", content: "📦 ZIP 파일 내부 추출 중..." })
      writeSse(res, { type: "provider_chunk", provider: "gemini", content: "📦 ZIP 파일 분석 중... 내부 파일을 추출합니다.\n\n" })
      try {
        const { inflateRawSync } = await import("node:zlib")
        const buf = Buffer.from(_attached.base64, "base64")
        const extractedPdfs: { name: string; base64: string }[] = []
        const extractedTexts: string[] = []
        let offset = 0
        while (offset < buf.length - 4) {
          if (buf.readUInt32LE(offset) !== 0x04034b50) break
          const fnLen = buf.readUInt16LE(offset + 26)
          const extraLen = buf.readUInt16LE(offset + 28)
          const entryName = buf.slice(offset + 30, offset + 30 + fnLen).toString("utf-8")
          const compMethod = buf.readUInt16LE(offset + 8)
          const compSize = buf.readUInt32LE(offset + 18)
          const dataStart = offset + 30 + fnLen + extraLen
          const compData = buf.slice(dataStart, dataStart + compSize)
          try {
            let entryData: Buffer
            if (compMethod === 8) {
              try { entryData = inflateRawSync(compData) } catch { entryData = compData }
            } else { entryData = compData }
            if (/\.pdf$/i.test(entryName)) {
              extractedPdfs.push({ name: entryName, base64: entryData.toString("base64") })
            } else if (/\.(txt|md|json|csv|xml|html|css|js|ts|py)$/i.test(entryName)) {
              extractedTexts.push(`=== ${entryName} ===\n${entryData.toString("utf-8")}`)
            }
          } catch {}
          offset = dataStart + compSize
        }

        // PDF 병렬 분석 — 기존 직렬(N × 40초) → 병렬(~20초 고정)
        const allResults: string[] = []
        if (extractedPdfs.length > 0) {
          writeSse(res, { type: "provider_chunk", provider: "claude", content: `📄 PDF ${extractedPdfs.length}개 병렬 분석 중...\n\n` })
          // 병렬 분석 — 에이전트 루프가 법률/재무/데이터 특화 분석 처리
          const analysisResults = await Promise.allSettled(
            extractedPdfs.map(pdf => analyzePdfDirect({ base64: pdf.base64, name: pdf.name, type: "application/pdf" }, userText))
          )
          for (let i = 0; i < extractedPdfs.length; i++) {
            const r = analysisResults[i]
            allResults.push(r.status === "fulfilled" ? r.value : `${extractedPdfs[i].name} 분석 실패`)
          }
        }
        if (extractedTexts.length > 0) allResults.push(extractedTexts.join("\n\n"))

        const finalText = allResults.join("\n\n---\n\n") || "ZIP 파일에서 분석 가능한 내용을 찾지 못했습니다."
        for (const chunk of finalText.split(/(\s+)/).filter((p: string) => p.length > 0)) {
          if (signal.aborted) break
          writeSse(res, { type: "chunk", content: chunk }); await sleep(6)
        }
        const titleText = await generateThreadTitle(userText, finalText.slice(0, 300)) ?? null
        writeSse(res, { type: "done", payload: { ...makeDonePayload("claude", finalText, true, "zip_analyze", "pdf", ["gemini", "claude"]), thread_title: titleText } })
      } catch (e: any) {
        writeSse(res, { type: "chunk", content: `ZIP 파일 처리 오류: ${e?.message ?? "unknown"}` })
        writeSse(res, { type: "done", payload: makeDonePayload("system", `ZIP 오류: ${e?.message}`, false, "zip_analyze", "dialogue", []) })
      }
      res.end?.(); return
    }

    if (_attached && (_attachedType.startsWith("image/") || _attachedType === "application/pdf")) {
      const userText = safeString(normalizedInput?.message) || (_attachedType === "application/pdf" ? "이 PDF를 분석해줘" : "이 이미지를 분석해줘")
      const startMs = Date.now()

      if (_attachedType === "application/pdf") {
        // PDF 분석 — 추출+분석 1번에 처리. 법률/재무/데이터 특화 분석은 에이전트 루프 + 도메인 도구가 처리.
        writeSse(res, { type: "status", content: "PDF 분석 중 (Claude)..." })
        writeSse(res, { type: "provider_chunk", provider: "claude", content: "📄 PDF 분석 중...\n\n" })
        const pdfFinalResult = await analyzePdfDirect(_attached, userText)
        writeSse(res, { type: "final", provider: "claude", content: pdfFinalResult })
        const pdfPendingExtra = await processPendingFiles(normalizedInput?.pending_analysis_files, userText, res, signal)
        writeSse(res, { type: "done", payload: makeDonePayload("claude", pdfFinalResult + pdfPendingExtra, true, "pdf_analyze", "pdf", ["claude"]) })
        res.end?.(); return
      }

      // 이미지 → Vision
      writeSse(res, { type: "provider_chunk", provider: "openai", content: "🖼️ 이미지 분석 중...\n\n" })
      const visionText = await analyzeImageWithVision(_attached, userText)
      for (const chunk of visionText.split(/(\s+)/).filter((p: string) => p.length > 0)) {
        if (signal.aborted) break
        writeSse(res, { type: "provider_chunk", provider: "openai", content: chunk }); await sleep(14)
      }
      writeSse(res, { type: "final", provider: "openai", content: visionText })
      const imgPendingExtra = await processPendingFiles(normalizedInput?.pending_analysis_files, userText, res, signal)
      writeSse(res, { type: "done", payload: makeDonePayload("openai", visionText + imgPendingExtra, true, "vision_analyze", "dialogue", ["openai"]) })
      res.end?.(); return
    }

    // ── 메모리 재사용 ──
    // 과거 우승 provider 힌트 (routing 최적화만)
    const providerHint = tryMemoryProviderHint(normalizedInput)
    if (providerHint) {
      effectiveInput.preferred_provider = providerHint.hint_provider
      logger.info("[chat/stream] provider hint from memory", { provider: providerHint.hint_provider, confidence: providerHint.confidence })
    }

    // ── URL 자동 크롤링 ──
    if (effectiveInput?.message && extractUrlsFromMessage(String(effectiveInput.message)).length > 0) {
      effectiveInput.message = await enrichMessageWithUrls(String(effectiveInput.message))
    }

    // ── Token budget warning ──
    const inputSize = JSON.stringify(effectiveInput?.messages ?? effectiveInput?.message ?? "").length
    const estimatedTokens = Math.ceil(inputSize / 3.5)
    const MODEL_CONTEXT_LIMIT = 128_000
    if (estimatedTokens > MODEL_CONTEXT_LIMIT * 0.7) {
      logger.warn("[chat/stream] input approaching context window limit", {
        estimated_tokens: estimatedTokens,
        context_limit: MODEL_CONTEXT_LIMIT,
        usage_ratio: +(estimatedTokens / MODEL_CONTEXT_LIMIT).toFixed(3),
        input_bytes: inputSize
      })
    }
    // ── Plugin: beforeChat ──
    try {
      const hookCtx = await executeHook("beforeChat", {
        message: String(effectiveInput?.message ?? "").slice(0, 500),
        provider: String(effectiveInput?.preferred_provider ?? ""),
        thread_id: String(effectiveInput?.thread_id ?? ""),
        project_id: String(effectiveInput?.project_id ?? ""),
      })
      if (hookCtx.abort) {
        writeSse(res, { type: "done", payload: { ok: false, reason: "plugin_abort", error_message: hookCtx.abortReason ?? "plugin aborted" } })
        res.end?.(); return
      }
    } catch (e) { logger.warn("[chat/stream] beforeChat hook failed", { error: e }) }

    // ── Haiku 라우팅 결과를 effectiveInput에 주입 (runtime에서 이중 Haiku 호출 방지) ──
    if (haikuRoute.task && haikuRoute.task !== "dialogue") {
      (effectiveInput as any).task = haikuRoute.task
    }

    // ── Agent Loop Runtime ──
    writeSse(res, { type: "status", content: "에이전트 루프 실행 중..." })
    const streamEventHandler = async (event: any) => {
      if (signal.aborted) return
      // provider_start 이벤트에서 진행 상태 업데이트
      if (event.type === "provider_start" || event.type === "route_decided") {
        const provider = event.provider ?? event.selected_providers?.[0] ?? ""
        const task = event.task ?? event.detected_task ?? ""
        if (provider || task) {
          writeSse(res, { type: "status", content: `${provider ? provider + " " : ""}${task ? "(" + task + ") " : ""}응답 생성 중...` })
        }
      }
      // tool_call 이벤트 → 상태줄에 도구 호출 표시 (Phase 3 ToolCallTimeline 으로 대체 예정)
      if (event.type === "tool_call") {
        writeSse(res, { type: "status", content: `🔧 ${event.tool_name} 실행 중...` })
      }
      writeSse(res, event)
    }
    // Phase 4 complete: agent loop is always used (orchestra fallback removed)
    const result = await runAgentLoopRuntimeResult({ ...effectiveInput, __abort_signal: signal }, streamEventHandler)

    if (signal.aborted) {
      writeSse(res, { type: "done", payload: { ok: false, reason: "aborted", answer: { provider: null, text: "", ok: false }, meta: { orchestration: {} }, orchestration: {}, bandit: {}, derived: {}, internal: {}, result: null } })
      res.end?.()
      return
    }

    try { persistRuntimeMemory(normalizedInput, result) } catch (e) { logger.warn("persistRuntimeMemory failed", { error: e }) }
    // 스레드 제목 자동 생성 (첫 메시지에서만 — 프론트에서 isGenericThreadTitle로 판단)
    let threadTitle: string | null = null
    try {
      const inboundMsg = extractInboundQuery(effectiveInput)
      const answerText = safeString(result?.final_answer?.text)
      if (inboundMsg && answerText) {
        threadTitle = await generateThreadTitle(inboundMsg, answerText)
      }
    } catch (e) { logger.warn("thread title generation failed", { error: e }) }
    const chatPayload = buildChatPayload(result)
    writeSse(res, { type: "done", payload: { ...chatPayload, thread_title: threadTitle } })
    res.end?.()
    try { await logBenchmark(buildBenchmarkPayload(result, normalizedInput)) } catch (e) { logger.warn("logBenchmark failed", { error: e }) }

    // ── Plugin: afterChat ──
    const winnerProvider = safeString(result?.final_answer?.provider)
    const answerLen = safeString(result?.final_answer?.text).length
    const chatElapsedMs = Date.now() - startedAt
    try {
      await executeHook("afterChat", {
        provider: winnerProvider,
        model: winnerProvider,
        latency_ms: chatElapsedMs,
        answer: safeString(result?.final_answer?.text).slice(0, 200),
        answer_length: answerLen,
        thread_id: String(normalizedInput?.thread_id ?? ""),
      })
    } catch (e) { logger.warn("[chat/stream] afterChat hook failed", { error: e }) }

    // ── WebSocket broadcast: provider 상태 알림 ──
    try {
      broadcast("provider:health", {
        provider: winnerProvider,
        latency_ms: chatElapsedMs,
        success: true,
        answer_length: answerLen,
      })
    } catch { /* broadcast 실패 무시 */ }

  } catch (error: any) {
    if (signal.aborted) {
      writeSse(res, { type: "done", payload: { ok: false, reason: "aborted", answer: { provider: null, text: "", ok: false }, meta: { orchestration: {} }, orchestration: {}, bandit: {}, derived: {}, internal: {}, result: null } })
      res.end?.()
      return
    }
    writeSse(res, { type: "error", error: String(error?.message ?? "unknown_error") })
    writeSse(res, { type: "done", payload: { ok: false, reason: "error", error_message: String(error?.message ?? "unknown_error"), answer: { provider: null, text: "", ok: false }, meta: { orchestration: {} }, orchestration: {}, bandit: {}, derived: {}, internal: {}, result: null } })
    res.end?.()
    try { await logBenchmark(buildErrorBenchmarkPayload(normalizedInput, error, startedAt)) } catch (e) { logger.warn("logBenchmark failed", { error: e }) }

    // ── Plugin: onError ──
    try {
      await executeHook("onError", {
        error_code: String(error?.code ?? "unknown"),
        error_message: String(error?.message ?? "unknown_error").slice(0, 300),
        provider: String(normalizedInput?.preferred_provider ?? ""),
        thread_id: String(normalizedInput?.thread_id ?? ""),
      })
    } catch { /* hook 실패 무시 */ }

    // ── WebSocket broadcast: 에러 알림 ──
    try {
      broadcast("provider:health", {
        provider: String(normalizedInput?.preferred_provider ?? "unknown"),
        success: false,
        error: String(error?.message ?? "unknown_error").slice(0, 200),
      })
    } catch { /* broadcast 실패 무시 */ }
  }
}

export const chatRoute = {
  path: "/api/chat",
  handler: runChatRoute
}

export const chatStreamRoute = {
  path: "/api/chat/stream",
  handler: runChatStreamRoute,
}
