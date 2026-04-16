import { getLatestProjectContext, appendProjectMemory, findPastWinner, addProjectSourceAsset } from "../memory/projectMemory.js"
import { getThreadMemory, upsertThreadMemory, findSimilarQuery } from "../memory/threadMemory.js"
// NOTE (2026-04-11): logBenchmark import 제거 — orchestra/benchmark 로 직접 필요 시 chat.ts 에서 호출
import { logger } from "../observability/logger.js"
import { OPENAI_BASE } from "../config/defaults.js"
import { normalizeChatMode } from "./chatRuntime.js"

const SOURCE_PROMOTE_PATTERNS = ["소스로 등록", "출처로 저장", "프로젝트에 추가", "자료로 저장"]

export type RouteResponse = {
  json?: (payload: unknown) => unknown
  writeHead?: (statusCode: number, headers: Record<string, string>) => void
  write?: (chunk: string) => void
  end?: () => void
}


const REUSE_SIMILARITY_THRESHOLD = 999
const REUSE_PAST_WINNER_CONFIDENCE = 999

export function safeArray(value: any): any[] {
  return Array.isArray(value) ? value : []
}

function safeObject(value: any): Record<string, any> {
  return value && typeof value === "object" ? value : {}
}

export function safeString(value: any): string {
  return String(value ?? "").trim()
}
function safeNumber(value: any, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}


export function sleep(ms: number) {
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

export function buildBenchmarkPayload(result: any, input: any) {
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

export function buildErrorBenchmarkPayload(input: any, error: any, startedAt: number) {
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

export function buildChatPayload(result: any) {
  const orchestration = safeObject(result?.response_meta?.orchestration)
  const bandit = safeObject(result?.internal_rationale?.bandit)

  const finalAnswer = result?.final_answer ?? { provider: null, text: "", ok: false }
  // preview_text 폴백 제거 — final_answer.text가 항상 완전한 텍스트
  // (preview_text는 420자로 잘려있어 답이 중간에 끊기는 원인이었음)

  return {
    ok: true,
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

export function writeSse(res: RouteResponse, payload: any) {
  res.write?.(`data: ${JSON.stringify(payload)}\n\n`)
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
      signal: AbortSignal.timeout(8000),
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

export function persistRuntimeMemory(input: any, result: any) {
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

const SLIDE_PATTERNS = ["슬라이드로 만들어줘","슬라이드로 정리해줘","ppt로 만들어줘","ppt로 정리해줘","프레젠테이션으로 만들어줘","발표자료로 만들어줘","슬라이드 만들어줘","슬라이드로 변환해줘","pptx로 만들어줘"]
function detectSourcePromoteCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return SOURCE_PROMOTE_PATTERNS.some((p: any) => lower.includes(p))
}

function buildSourceAssetFromThread(input: any): any | null {
  const threadId = safeString(input?.thread_id) || "chat_thread"
  const threadMemory = getThreadMemory(threadId)
  if (!threadMemory) return null
  const structured = threadMemory.structured
  const summary = safeString(structured?.summary)
  const INTERNAL_NOISE = ["single_candidate","single_candidate_after_escalation","primary_survival_bias","override"]
  const decisions = safeArray(structured?.decisions).filter((d: string) => !INTERNAL_NOISE.some((n) => String(d).toLowerCase().includes(n)))
  const facts = safeArray(structured?.facts)
  const entities = safeArray(structured?.entities)
  if (!summary && decisions.length === 0 && facts.length === 0) return null
  const lines: string[] = []
  if (summary) { lines.push("[요약]"); lines.push(summary); lines.push("") }
  if (decisions.length > 0) { lines.push("[결정사항]"); lines.push(...decisions); lines.push("") }
  if (facts.length > 0) { lines.push("[핵심 사실]"); lines.push(...facts); lines.push("") }
  if (entities.length > 0) { lines.push("[주요 키워드]"); lines.push(entities.join(", ")) }
  const content = lines.join("\n").trim()
  if (!content) return null
  const title = threadMemory.title ?? `스레드 요약 — ${new Date().toLocaleDateString("ko-KR")}`
  return { id: `source_${threadId}_${Date.now()}`, thread_id: threadId, type: "thread_summary", title, content, status: "confirmed", created_at: Date.now(), updated_at: Date.now() }
}

async function runSourcePromote(
  threadMessages: any[],
  projectId: string,
  _query: string
): Promise<{ ok: boolean; title: string; content: string; error?: string }> {
  const openaiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  if (!openaiKey) return { ok: false, title: "", content: "", error: "OPENAI_API_KEY 없음" }

  const relevant = threadMessages
    .filter((m: any) => m.role === "user" || m.role === "assistant")
    .slice(-20)
    .map((m: any) => `[${m.role.toUpperCase()}] ${String(m.content ?? "").slice(0, 800)}`)
    .join("\n\n")

  if (!relevant.trim()) return { ok: false, title: "", content: "", error: "저장할 내용 없음" }

  try {
    const res = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: "gpt-5.2",
        max_tokens: 16384,
        messages: [
          {
            role: "system",
            content: "당신은 대화 내용을 구조화된 지식 자산으로 변환하는 AI입니다. 다음 대화를 분석해서 JSON으로만 응답하세요 (마크다운 코드블록 없이): { \"title\": \"한 줄 제목 (20자 이내)\", \"content\": \"핵심 내용, 결론, 결정사항, 중요 사실을 구조화한 마크다운 (500자 이내)\" } 내용은 미래에 다른 대화에서 참고할 수 있도록 자기완결적으로 작성하세요. 불필요한 인사, 메타 발언은 제거하고 핵심 정보만 남기세요."
          },
          { role: "user", content: `다음 대화를 지식 자산으로 변환해주세요:\n\n${relevant}` }
        ]
      })
    })
    const data = await res.json() as any
    const raw = String(data?.choices?.[0]?.message?.content ?? "").trim()
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim()
    const parsed = JSON.parse(cleaned)
    return {
      ok: true,
      title: String(parsed?.title ?? "스레드 지식 자산").slice(0, 60),
      content: String(parsed?.content ?? relevant.slice(0, 500))
    }
  } catch (e: any) {
    return { ok: false, title: "", content: "", error: e?.message ?? "파싱 실패" }
  }
}

export function extractInboundQuery(input: any): string {
  const msg = String(input?.message ?? "").trim()
  if (msg) return msg
  const messages = Array.isArray(input?.messages) ? input.messages : []
  const last = [...messages].reverse().find((m: any) => m?.role === "user")
  return String(last?.content ?? "").trim()
}


export function makeDonePayload(provider: string, text: string, ok: boolean, strategy: string, task: string, providers: string[], extra?: any) {
  return {
    ok,
    answer: { provider, text, ok },
    meta: { orchestration: { final_provider: provider, latency_ms: 0 } },
    orchestration: { final_provider: provider },
    bandit: {},
    derived: { detected_task: task, execution_strategy: strategy, selected_providers: providers, verifier_providers: [], fallback_providers: [], parallel_providers: [], winner: provider, runner_up: providers[1] ?? null, conflict_count: 0, executed_provider_count: providers.length, latency_ms: 0, estimated_cost_usd: 0, fallback_used: false, judge_confidence: 1 },
    internal: { task, route: null, judge: null, conflicts: [], conflict_count: 0, executed_providers: [], execution_policy: { max_parallel: providers.length, cost_gate_enabled: false, max_total_estimated_cost_usd: 0, prefer_fast_fallback: false }, escalation: { pre_routing_use_pro: providers.length > 1, post_eval_triggered: false }, scoreboard: {} },
    ...extra
  }
}
