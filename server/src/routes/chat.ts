import { executeOrchestra } from "../orchestra/runtime.js"
import { runAdapter } from "../orchestra/adapterDispatcher.js"
import { generateImage } from "../adapters/openai.js"
import { generateImageImagen } from "../adapters/gemini.js"
import { logBenchmark } from "../orchestra/benchmark.js"
import { appendProjectMemory, getLatestProjectContext, findPastWinner, addProjectSourceAsset } from "../memory/projectMemory.js"
import { upsertThreadMemory, findSimilarQuery, getThreadMemory } from "../memory/threadMemory.js"

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

const REUSE_SIMILARITY_THRESHOLD = 1.1
const REUSE_PAST_WINNER_CONFIDENCE = 1.1

function safeArray(value: any): any[] {
  return Array.isArray(value) ? value : []
}

function safeObject(value: any): Record<string, any> {
  return value && typeof value === "object" ? value : {}
}

function safeString(value: any): string {
  return String(value ?? "").trim()
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
    conflict_count: Number(result?.internal_rationale?.conflict_count ?? conflicts.length ?? 0),
    executed_provider_count: executedProviders.length,
    latency_ms: Number(orchestration?.latency_ms ?? 0),
    estimated_cost_usd: Number(orchestration?.estimated_cost_usd ?? 0),
    fallback_used: Boolean(orchestration?.fallback_used),
    judge_confidence: Number(orchestration?.judge_confidence ?? judge?.confidence ?? 0)
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
    mode: input?.mode ?? "runtime_orchestra",
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
    judge_confidence: Number(orchestration?.judge_confidence ?? judge?.confidence ?? 0),

    conflict_count: Number(orchestration?.conflict_count ?? result?.internal_rationale?.conflict_count ?? 0),
    conflicts,

    provider_usage: safeArray(orchestration?.provider_usage),

    latency_ms: Number(orchestration?.latency_ms ?? 0),
    estimated_cost_usd: Number(orchestration?.estimated_cost_usd ?? 0),
    input_message_count: messages.length,
    input_size: JSON.stringify(input ?? {}).length,
    output_size: JSON.stringify(finalAnswer ?? {}).length
  }
}

function buildErrorBenchmarkPayload(input: any, error: any, startedAt: number) {
  const messages = safeArray(input?.messages)

  return {
    timestamp: new Date().toISOString(),
    mode: input?.mode ?? "runtime_orchestra",
    thread_id: input?.thread_id ?? "chat_thread",
    project_id: input?.project_id ?? "chat_project",

    task: null,
    execution_strategy: null,

    provider_chain: [],
    selected_providers: [],
    verifier_providers: [],
    executed_providers: [],

    primary_provider: null,
    verifier_provider: null,
    final_provider: null,

    primary_ok: false,
    verifier_ok: null,
    final_ok: false,
    success: false,

    fallback_used: false,

    judge_rationale: null,
    judge_scores: [],
    judge_confidence: 0,

    conflict_count: 0,
    conflicts: [],

    provider_usage: [],

    latency_ms: Date.now() - startedAt,
    estimated_cost_usd: 0,
    input_message_count: messages.length,
    input_size: JSON.stringify(input ?? {}).length,
    output_size: 0,

    error_message: String(error?.message ?? "unknown_error")
  }
}

function buildChatPayload(result: any) {
  const orchestration = safeObject(result?.response_meta?.orchestration)
  const bandit = safeObject(result?.internal_rationale?.bandit)

  // final_answer.text가 비어있으면 provider_stream_summary에서 fallback
  const finalAnswer = result?.final_answer ?? { provider: null, text: "", ok: false }
  if (!safeString(finalAnswer?.text)) {
    const streamSummary = safeObject(result?.response_meta?.orchestration?.provider_stream_summary)
    const finalProvider = safeString(finalAnswer?.provider) || safeString(orchestration?.final_provider)
    const summaryText = safeString(streamSummary?.[finalProvider]?.preview_text) ||
      Object.values(streamSummary).map((s: any) => safeString(s?.preview_text)).filter(Boolean)[0] || ""
    if (summaryText) {
      finalAnswer.text = summaryText
    }
  }

  return {
    ok: true,
    answer: finalAnswer,
    meta: {
      orchestration
    },
    orchestration,
    bandit,
    derived: buildDerived(result),
    internal: result?.internal_rationale ?? {
      task: null,
      route: null,
      judge: null,
      conflicts: [],
      conflict_count: 0,
      executed_providers: [],
      execution_policy: {
        max_parallel: 0,
        cost_gate_enabled: false,
        max_total_estimated_cost_usd: 0,
        prefer_fast_fallback: false
      },
      escalation: {
        pre_routing_use_pro: false,
        post_eval_triggered: false
      },
      scoreboard: {}
    },
    result
  }
}

function buildReusedPayload(text: string, provider: string, source: "similar_query" | "past_winner", score: number) {
  const orchestration = {
    reused: true,
    reuse_source: source,
    reuse_score: score,
    final_provider: provider,
    selected_provider: provider,
    provider: provider,
    confidence: score,
    latency_ms: 0,
    estimated_cost_usd: 0
  }

  return {
    ok: true,
    answer: {
      provider,
      text,
      ok: true
    },
    meta: { orchestration },
    orchestration,
    bandit: {},
    derived: {
      detected_task: null,
      execution_strategy: "reuse",
      selected_providers: [provider],
      verifier_providers: [],
      fallback_providers: [],
      parallel_providers: [],
      winner: provider,
      runner_up: null,
      conflict_count: 0,
      executed_provider_count: 0,
      latency_ms: 0,
      estimated_cost_usd: 0,
      fallback_used: false,
      judge_confidence: score
    },
    internal: {
      task: null,
      route: null,
      judge: null,
      conflicts: [],
      conflict_count: 0,
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

function buildStructuredMemory(result: any) {
  const finalAnswerText = safeString(result?.final_answer?.text)
  const winnerReason = safeObject(result?.response_meta?.winner_reason)
  const selectionTrace = safeObject(result?.response_meta?.selection_trace)
  const judgeScores = safeArray(result?.internal_rationale?.judge?.scores)
  const claims = safeArray(result?.internal_rationale?.claims)

  const sentences = splitSentences(finalAnswerText)

  const INTERNAL_NOISE_PATTERNS = ["single_candidate", "primary_survival_bias", "override", "single_candidate_after_escalation"]
  const decisions = uniqueStrings([
    safeString(winnerReason?.rationale),
    safeString(selectionTrace?.judge_rationale),
    ...safeArray(selectionTrace?.selected_reasons),
    ...judgeScores.flatMap((row: any) => safeArray(row?.reasons))
  ]).filter((d) => !INTERNAL_NOISE_PATTERNS.some((n) => String(d).toLowerCase().includes(n)))

  const facts = uniqueStrings([
    ...sentences.filter((line) => /\d/.test(line)),
    ...claims.flatMap((row: any) =>
      safeArray(row?.claims)
        .filter((claim: any) => String(claim?.type ?? "") === "fact")
        .map((claim: any) => safeString(claim?.text))
    )
  ])

  const openQuestions = uniqueStrings(
    sentences.filter((line) => /\?$|질문|확인 필요|미정|불명확/i.test(line))
  )

  const entities = uniqueStrings(
    finalAnswerText
      .split(/\s+/)
      .map((token) => token.replace(/[^\w가-힣-]/g, ""))
      .filter((token) => token.length >= 2)
      .filter((token) => /[A-Za-z가-힣]/.test(token))
      .slice(0, 20)
  )

  return {
    summary: finalAnswerText,
    decisions,
    facts,
    open_questions: openQuestions,
    entities
  }
}

function buildThreadMessages(input: any, result: any) {
  const inputMessages = safeArray(input?.messages)

  if (inputMessages.length > 0) {
    return inputMessages
      .map((message: any, index: number) => {
        const role = safeString(message?.role) || "user"
        const content =
          typeof message?.content === "string"
            ? safeString(message.content)
            : Array.isArray(message?.content)
              ? safeArray(message.content)
                  .map((part: any) => {
                    if (typeof part === "string") return safeString(part)
                    if (typeof part?.text === "string") return safeString(part.text)
                    return ""
                  })
                  .join("\n")
                  .trim()
              : ""

        return {
          id: safeString(message?.id) || `msg_${index + 1}`,
          role,
          content,
          created_at: Number(message?.created_at ?? Date.now())
        }
      })
      .filter((message: any) => message.content.length > 0)
      .concat([
        {
          id: `assistant_${Date.now()}`,
          role: "assistant",
          content: safeString(result?.final_answer?.text),
          created_at: Date.now()
        }
      ])
  }

  return [
    {
      id: `user_${Date.now()}`,
      role: "user",
      content: safeString(input?.message),
      created_at: Date.now() - 1
    },
    {
      id: `assistant_${Date.now()}`,
      role: "assistant",
      content: safeString(result?.final_answer?.text),
      created_at: Date.now()
    }
  ]
}

function persistRuntimeMemory(input: any, result: any) {
  const projectId = safeString(input?.project_id) || "chat_project"
  const threadId = safeString(input?.thread_id) || "chat_thread"
  const structured = buildStructuredMemory(result)

  appendProjectMemory({
    project_id: projectId,
    thread_id: threadId,
    timestamp: Date.now(),
    goal: input?.goal ?? null,
    task: result?.internal_rationale?.task ?? input?.task ?? null,
    winner_provider: result?.final_answer?.provider ?? null,
    claims: result?.internal_rationale?.claims ?? {},
    provider_health: result?.internal_rationale?.provider_status_map ?? {},
    provider_latency: result?.response_meta?.orchestration?.provider_usage ?? [],
    scoreboard: result?.internal_rationale?.scoreboard_after ?? [],
    output: result?.final_answer ?? null,
    summary: structured.summary,
    decisions: structured.decisions,
    facts: structured.facts,
    open_questions: structured.open_questions,
    entities: structured.entities
  })

  const projectContext = getLatestProjectContext(projectId)

  upsertThreadMemory({
    thread_id: threadId,
    project_id: projectId,
    title: safeString(input?.title) || null,
    messages: buildThreadMessages(input, result),
    structured: {
      summary: structured.summary,
      decisions: structured.decisions,
      facts: structured.facts,
      open_questions: structured.open_questions,
      entities: structured.entities,
      updated_at: Date.now()
    },
    retrieval_preview: projectContext?.retrieval_context ?? {
      summary: [],
      decisions: [],
      facts: [],
      sources: []
    }
  })
}

// 슬라이드 생성 명령 감지 패턴
const SLIDE_PATTERNS = [
  "슬라이드로 만들어줘",
  "슬라이드로 정리해줘",
  "ppt로 만들어줘",
  "ppt로 정리해줘",
  "프레젠테이션으로 만들어줘",
  "발표자료로 만들어줘",
  "슬라이드 만들어줘",
  "슬라이드로 변환해줘",
  "pptx로 만들어줘"
]

function detectSlideCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return SLIDE_PATTERNS.some((p) => lower.includes(p))
}

async function handleSlideCommand(input: any, rawMessage: string): Promise<{ ok: boolean; slide_data?: any; message: string }> {
  const SLIDE_SYSTEM_PROMPT = `You are a presentation designer. Based on the user's request, generate a slide deck as JSON.

Return ONLY valid JSON with this exact structure (no markdown, no explanation):
{
  "title": "presentation title",
  "theme": "midnight_executive",
  "slides": [
    {
      "type": "title",
      "title": "Main Title",
      "subtitle": "Subtitle text"
    },
    {
      "type": "content",
      "title": "Slide Title",
      "bullets": ["Point 1", "Point 2", "Point 3"],
      "note": "optional speaker note"
    },
    {
      "type": "two_column",
      "title": "Slide Title",
      "left": { "heading": "Left heading", "bullets": ["item 1", "item 2"] },
      "right": { "heading": "Right heading", "bullets": ["item 1", "item 2"] }
    },
    {
      "type": "closing",
      "title": "Thank You",
      "subtitle": "closing message"
    }
  ]
}

Rules:
- 5-10 slides total
- Always start with type "title" and end with type "closing"
- Use Korean if the user writes in Korean
- Return ONLY the JSON object, nothing else`

  try {
    console.log("[SLIDE] handleSlideCommand called, rawMessage:", rawMessage.slice(0, 100))
    const result = await runAdapter({
      provider: "claude",
      task: "code",
      messages: [
        { role: "system", content: SLIDE_SYSTEM_PROMPT },
        { role: "user", content: rawMessage }
      ],
      input: { model: "claude-sonnet-4-6", max_tokens: 2000, temperature: 0.3 }
    })

    const text = safeString(result?.text ?? result?.answer_text ?? result?.output?.text)
    console.log("[SLIDE] Claude response text:", text.slice(0, 200))
    if (!text) throw new Error("empty response")

    // JSON 추출 — 코드블록 제거 후 첫 번째 유효한 JSON 파싱
    let clean = text.replace(/```json|```/g, "").trim()

    // { ... } 구간만 추출
    const firstBrace = clean.indexOf("{")
    const lastBrace = clean.lastIndexOf("}")
    if (firstBrace !== -1 && lastBrace !== -1) {
      clean = clean.slice(firstBrace, lastBrace + 1)
    }

    const slideData = JSON.parse(clean)

    if (!slideData?.slides || !Array.isArray(slideData.slides)) {
      throw new Error("invalid slide structure")
    }

    console.log("[SLIDE] Parsed OK, slides:", slideData.slides.length)
    return {
      ok: true,
      slide_data: slideData,
      message: `✅ 슬라이드 ${slideData.slides.length}장을 생성했습니다.

**제목:** ${slideData.title}

아래 다운로드 버튼을 클릭하면 PPTX 파일로 저장됩니다.`
    }
  } catch (e: any) {
    console.error("[SLIDE] Error:", e?.message, e?.stack)
    return {
      ok: false,
      message: `슬라이드 생성 중 오류가 발생했습니다: ${e?.message ?? "unknown error"}`
    }
  }
}

// 이미지 생성 명령 감지 패턴
const IMAGE_PATTERNS = [
  "이미지 만들어줘", "이미지 그려줘", "그림 그려줘", "그림 만들어줘",
  "이미지 생성해줘", "사진 만들어줘", "이미지로 만들어줘",
  "그려줘", "일러스트 만들어줘", "generate image", "create image",
  "draw", "make an image", "make a picture"
]

const GEMINI_IMAGE_PATTERNS = [
  "gemini로 그려줘", "gemini로 이미지", "imagen으로", "gemini 이미지",
  "구글로 그려줘", "imagen 그려줘"
]

function detectGeminiImageCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return GEMINI_IMAGE_PATTERNS.some((p) => lower.includes(p))
}

function detectImageCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return IMAGE_PATTERNS.some((p) => lower.includes(p))
}

async function handleImageCommand(rawMessage: string): Promise<{ ok: boolean; url?: string; revised_prompt?: string; message: string }> {
  // 프롬프트 정제 — 명령어 제거하고 순수 묘사만 추출
  const cleaned = rawMessage
    .replace(/이미지\s*(만들어줘|그려줘|생성해줘|으로\s*만들어줘)/g, "")
    .replace(/그림\s*(그려줘|만들어줘)/g, "")
    .replace(/사진\s*만들어줘/g, "")
    .replace(/일러스트\s*만들어줘/g, "")
    .replace(/(generate|create|make|draw)\s*(an?\s*)?(image|picture|photo|illustration)/gi, "")
    .trim()

  const prompt = cleaned || rawMessage

  const result = await generateImage({
    prompt,
    size: "1024x1024",
    quality: "standard",
    style: "vivid"
  })

  if (!result.ok || !result.url) {
    return {
      ok: false,
      message: `이미지 생성 실패: ${result.error ?? "알 수 없는 오류"}`
    }
  }

  const caption = result.revised_prompt
    ? `🎨 이미지가 생성됐습니다.`
    : `🎨 이미지가 생성됐습니다.`

  return {
    ok: true,
    url: result.url,
    revised_prompt: result.revised_prompt,
    message: caption
  }
}

async function handleGeminiImageCommand(rawMessage: string): Promise<{ ok: boolean; url?: string; message: string; provider: string }> {
  const cleaned = rawMessage
    .replace(/gemini(로|로\s*이미지)?/gi, "")
    .replace(/imagen(으로|으로\s*이미지)?/gi, "")
    .replace(/구글로\s*(그려줘)?/gi, "")
    .replace(/이미지\s*(만들어줘|그려줘|생성해줘)/g, "")
    .replace(/그려줘/g, "")
    .trim()

  const prompt = cleaned || rawMessage

  const result = await generateImageImagen({ prompt, aspectRatio: "1:1" })

  if (!result.ok || !result.url) {
    return { ok: false, message: `Gemini 이미지 생성 실패: ${result.error ?? "알 수 없는 오류"}`, provider: "gemini" }
  }

  return { ok: true, url: result.url, message: "🎨 Gemini Imagen으로 이미지가 생성됐습니다.", provider: "gemini" }
}

// Deep Research 명령 감지 패턴
// 핸드오프/세션 요약 명령 감지
const HANDOFF_PATTERNS = [
  "세션 정리해줘", "핸드오프 파일", "대화 요약해줘", "세션 요약",
  "다음 세션에 넘겨줘", "컨텍스트 정리", "지금까지 정리해줘",
  "handoff", "session summary", "summarize session"
]

function detectHandoffCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return HANDOFF_PATTERNS.some((p) => lower.includes(p))
}

async function runHandoffSummary(
  threadMessages: any[],
  query: string
): Promise<{ ok: boolean; summary: string; error?: string }> {
  const openaiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  if (!openaiKey) return { ok: false, summary: "", error: "OPENAI_API_KEY 없음" }

  // 대화 내용 추출 (최근 30개 메시지)
  const allMessages = Array.isArray(threadMessages) ? threadMessages : []
  const recentMessages = allMessages
    .filter((m: any) => m.content?.trim() && !m.isHidden)
    .slice(-30)
    .map((m: any) => `[${String(m.role ?? "user") === "user" ? "USER" : "AI"}] ${String(m.content ?? "").slice(0, 500)}`)
    .join("\n\n")

  const contentToSummarize = recentMessages || `사용자 요청: ${query}`

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `당신은 AI 세션 요약 전문가입니다. 대화 내용을 다음 구조로 요약하세요:

## 세션 요약
### 1. 핵심 작업 목록
### 2. 완료된 항목
### 3. 미완료/진행 중 항목
### 4. 주요 결정사항
### 5. 다음 세션 시작 시 참고사항

간결하고 구조적으로 작성하세요.`
          },
          {
            role: "user",
            content: `다음 대화를 요약해줘:\n\n${contentToSummarize}`
          }
        ],
        max_tokens: 2000
      }),
      signal: AbortSignal.timeout(30000)
    })

    const data = await resp.json().catch(() => ({}))

    // 에러 응답 확인
    if (!resp.ok) {
      const errMsg = String(data?.error?.message ?? `HTTP ${resp.status}`)
      console.error("[HANDOFF] OpenAI error:", errMsg)
      throw new Error(errMsg)
    }

    const summary = String(data?.choices?.[0]?.message?.content ?? "")
    console.log("[HANDOFF] summary length:", summary.length, "messages count:", recentMessages.length)

    if (!summary) {
      // OpenAI가 빈 응답 — content 직접 확인
      console.error("[HANDOFF] empty response:", JSON.stringify(data).slice(0, 300))
      throw new Error("empty summary")
    }
    return { ok: true, summary }
  } catch (e: any) {
    console.error("[HANDOFF] error:", e?.message)
    return { ok: false, summary: "", error: e?.message ?? "요약 실패" }
  }
}

// 웹 검색 명령 감지
const WEB_SEARCH_PATTERNS = [
  "검색해줘", "찾아줘", "웹에서", "최신 정보", "지금 검색",
  "인터넷에서", "실시간으로", "최근 뉴스", "오늘 뉴스",
  "search", "find me", "look up", "latest news", "current"
]

function detectWebSearchCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return WEB_SEARCH_PATTERNS.some((p) => lower.includes(p))
}

async function runWebSearch(
  query: string
): Promise<{ ok: boolean; answer: string; citations: { url: string; title: string }[]; error?: string }> {
  const perplexityKey = String((globalThis as any)?.process?.env?.PERPLEXITY_API_KEY ?? "").trim()
  const openaiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()

  let searchResult = ""
  let citations: { url: string; title: string }[] = []

  // Step 1: Perplexity 실시간 검색
  if (perplexityKey) {
    try {
      const resp = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${perplexityKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "sonar-pro",
          messages: [
            { role: "system", content: "You are a search assistant. Provide accurate, up-to-date information with sources. Respond in the same language as the user's query." },
            { role: "user", content: query }
          ],
          max_tokens: 2000,
          return_citations: true,
          return_related_questions: false
        }),
        signal: AbortSignal.timeout(20000)
      })

      const data = await resp.json().catch(() => ({}))
      searchResult = String(data?.choices?.[0]?.message?.content ?? "")

      // 출처 추출
      const rawCitations = data?.citations ?? []
      citations = Array.isArray(rawCitations)
        ? rawCitations.slice(0, 5).map((c: any) => ({
            url: String(c?.url ?? c ?? ""),
            title: String(c?.title ?? c?.url ?? c ?? "")
          })).filter(c => c.url)
        : []
    } catch (e: any) {
      console.error("[WEB_SEARCH] Perplexity error:", e?.message)
    }
  }

  // Step 2: Perplexity 결과가 없으면 OpenAI로 fallback
  if (!searchResult && openaiKey) {
    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.2",
          messages: [
            { role: "system", content: "Provide current information about the topic. Be factual and concise." },
            { role: "user", content: query }
          ],
          max_tokens: 1500
        }),
        signal: AbortSignal.timeout(20000)
      })
      const data = await resp.json().catch(() => ({}))
      searchResult = String(data?.choices?.[0]?.message?.content ?? "")
    } catch {}
  }

  if (!searchResult) {
    return { ok: false, answer: "", citations: [], error: "검색 결과를 가져오지 못했습니다." }
  }

  // Step 3: 출처 정리해서 결과에 붙이기
  let finalAnswer = searchResult
  if (citations.length > 0) {
    finalAnswer += "\n\n---\n**출처**\n"
    citations.forEach((c, i) => {
      const title = c.title && c.title !== c.url ? c.title : c.url
      finalAnswer += `${i + 1}. [${title}](${c.url})\n`
    })
  }

  return { ok: true, answer: finalAnswer, citations }
}

const DEEP_RESEARCH_PATTERNS = [
  "심층 분석", "심층 리서치", "심층 조사", "deep research",
  "깊게 조사해줘", "자세히 조사해줘", "심층적으로 분석",
  "심층 연구", "종합 분석해줘", "심층 보고서", "리서치 리포트 만들어줘"
]

function detectDeepResearchCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return DEEP_RESEARCH_PATTERNS.some((p) => lower.includes(p))
}

async function runDeepResearch(
  query: string,
  onProgress: (step: string, text: string) => void
): Promise<{ ok: boolean; report: string; error?: string }> {
  const openaiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  const perplexityKey = String((globalThis as any)?.process?.env?.PERPLEXITY_API_KEY ?? "").trim()

  // Step 1a: Perplexity 1차 검색 — 최신 현황
  onProgress("search", "🔍 최신 정보 수집 중...")
  let searchResult1 = ""
  if (perplexityKey) {
    try {
      const pData = await (await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${perplexityKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "sonar-pro",
          messages: [
            { role: "system", content: "최신 데이터와 통계를 포함한 포괄적인 정보를 한국어로 제공하세요. 출처를 명시하세요." },
            { role: "user", content: `${query} — 최신 현황, 주요 데이터, 트렌드를 조사해줘` }
          ],
          max_tokens: 2500,
          return_citations: true
        }),
        signal: AbortSignal.timeout(30000)
      })).json().catch(() => ({}))
      searchResult1 = String(pData?.choices?.[0]?.message?.content ?? "")
    } catch {}
  }

  // Step 1b: Perplexity 2차 검색 — 심층 분석 각도
  onProgress("search2", "🔎 심층 분석 데이터 수집 중...")
  let searchResult2 = ""
  if (perplexityKey && searchResult1) {
    try {
      const pData2 = await (await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${perplexityKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "sonar-pro",
          messages: [
            { role: "system", content: "전문가 관점에서 리스크, 기회, 미래 전망을 한국어로 분석하세요." },
            { role: "user", content: `${query} — 핵심 리스크, 기회 요인, 향후 전망, 전문가 의견을 조사해줘` }
          ],
          max_tokens: 2000,
          return_citations: true
        }),
        signal: AbortSignal.timeout(25000)
      })).json().catch(() => ({}))
      searchResult2 = String(pData2?.choices?.[0]?.message?.content ?? "")
    } catch {}
  }

  // Step 2: OpenAI 구조적 분석 — 핵심 주장/반론/데이터 분리
  onProgress("analyze", "🧠 핵심 인사이트 분석 중...")
  let analysisResult = ""
  if (openaiKey) {
    try {
      const combinedSearch = [searchResult1, searchResult2].filter(Boolean).join("\n\n---\n\n")
      const oData = await (await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.2",
          messages: [
            { role: "system", content: `심층 리서치 분석가로서 다음 형식으로 분석하세요:
1. 핵심 주장 3-5개 (구체적 수치/근거 포함)
2. 반론 또는 리스크 요인 2-3개
3. 핵심 데이터 포인트 (표 형식 권장)
4. 단기/중기/장기 전망
5. 실행 가능한 결론` },
            { role: "user", content: `"${query}"에 대한 구조적 분석:\n\n${combinedSearch.slice(0, 4000) || "직접 분석 수행"}` }
          ],
          max_tokens: 2000
        }),
        signal: AbortSignal.timeout(60000)
      })).json().catch(() => ({}))
      analysisResult = String(oData?.choices?.[0]?.message?.content ?? "")
    } catch {}
  }

  // Step 3: Claude 최종 리포트 — 구조화 + 표 포함
  onProgress("report", "📝 최종 리포트 작성 중...")
  try {
    const reportResult = await runAdapter({
      provider: "claude",
      task: "research",
      messages: [
        {
          role: "system",
          content: `당신은 McKinsey 수준의 리서치 작가입니다. 다음 형식으로 한국어 심층 리포트를 작성하세요:

## 📋 Executive Summary (3-5줄)
## 1. 현황 분석
## 2. 핵심 발견사항 (구체적 수치 포함)
## 3. 기회 요인 vs 리스크 요인 (표 형식)
## 4. 심층 분석
## 5. 전망 및 시나리오
## 6. 결론 및 권고사항

규칙: 마크다운 적극 활용, 핵심 수치는 **볼드**, 비교는 표로, 최소 1,500자 이상`
        },
        {
          role: "user",
          content: `"${query}"에 대한 심층 리포트를 작성해줘.

[1차 검색]
${searchResult1.slice(0, 2000) || "없음"}

[2차 검색]
${searchResult2.slice(0, 1500) || "없음"}

[OpenAI 분석]
${analysisResult.slice(0, 2000) || "없음"}`
        }
      ],
      input: { model: "claude-sonnet-4-6", max_tokens: 4000, temperature: 0.2 }
    })

    const reportText = String(reportResult?.text ?? reportResult?.answer_text ?? "").trim()
    if (!reportText) throw new Error("empty report")
    return { ok: true, report: reportText }
  } catch (e: any) {
    const fallback = analysisResult || searchResult1
    if (fallback) return { ok: true, report: `## 📋 ${query} 분석 결과\n\n${fallback}` }
    return { ok: false, report: "", error: e?.message ?? "리포트 생성 실패" }
  }
}

// ─── 법률 검토 파이프라인 ────────────────────────────────────────────────────
const LEGAL_REVIEW_PATTERNS = [
  "법률 검토", "계약서 검토", "법적 검토", "법적 위험", "법률 분석",
  "계약서 분석", "약관 검토", "약관 분석", "법률 리뷰", "법적 리스크",
  "계약 위험", "법적 문제", "계약 검토해줘", "법률적으로 검토",
  "legal review", "contract review", "legal risk", "legal analysis"
]
function detectLegalReviewCommand(message: string): boolean {
  return LEGAL_REVIEW_PATTERNS.some((p) => String(message ?? "").toLowerCase().includes(p))
}
async function runLegalReview(query: string, attachedText: string, onProgress: (step: string, text: string) => void): Promise<{ ok: boolean; report: string; error?: string }> {
  const openaiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  const perplexityKey = String((globalThis as any)?.process?.env?.PERPLEXITY_API_KEY ?? "").trim()
  const docContext = attachedText ? `\n\n[첨부 문서 내용]\n${attachedText.slice(0, 4000)}` : ""
  onProgress("search", "⚖️ 관련 법령 및 판례 검색 중...")
  let legalSearchResult = ""
  if (perplexityKey) {
    try {
      const pResp = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST", headers: { "Authorization": `Bearer ${perplexityKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "sonar-pro", messages: [{ role: "system", content: "한국 법률 전문가로서 관련 법령, 판례, 규정을 검색하여 제공하세요." }, { role: "user", content: `다음 법률 검토 요청과 관련된 법령, 판례를 검색해줘:\n\n${query}${docContext}` }], max_tokens: 2000 }),
        signal: AbortSignal.timeout(30000)
      })
      legalSearchResult = String((await pResp.json().catch(() => ({})))?.choices?.[0]?.message?.content ?? "")
    } catch {}
  }
  onProgress("analyze", "📋 Claude가 핵심 조항 및 위험 요소 분석 중...")
  let clauseAnalysis = ""
  try {
    const cr = await runAdapter({ provider: "claude", task: "research", messages: [{ role: "system", content: "계약법 전문 법률 분석가입니다. 불리한 조항, 위험 요소를 HIGH/MEDIUM/LOW로 분류하고 수정 권고안을 제시하세요." }, { role: "user", content: `다음 내용을 법률적으로 분석해줘:\n\n${query}${docContext}\n\n[참고 법령]\n${legalSearchResult.slice(0, 2000) || "없음"}` }], input: { model: "claude-sonnet-4-6", max_tokens: 2500, temperature: 0.1 } })
    clauseAnalysis = String(cr?.text ?? cr?.answer_text ?? "")
  } catch {}
  onProgress("report", "🔍 OpenAI가 최종 법률 검토 보고서 작성 중...")
  try {
    const oData = await (await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-5.2", messages: [{ role: "system", content: "기업법무 전문가로서 구조화된 법률 검토 보고서를 작성하세요. 형식: ## ⚖️ 법률 검토 보고서 / ### 1.검토개요 / ### 2.핵심위험항목(HIGH/MEDIUM/LOW) / ### 3.조항별분석 / ### 4.관련법령 / ### 5.수정권고사항 / ### 6.종합의견 / ※참고용이며 법적구속력없음" }, { role: "user", content: `법률 검토 대상: ${query}${docContext}\n\n[Claude 분석]\n${clauseAnalysis.slice(0, 2000) || "없음"}\n\n[관련 법령]\n${legalSearchResult.slice(0, 1500) || "없음"}\n\n최종 보고서 작성해줘.` }], max_tokens: 3000 }), signal: AbortSignal.timeout(60000) })).json().catch(() => ({}))
    const report = String(oData?.choices?.[0]?.message?.content ?? "").trim()
    if (!report) throw new Error("empty")
    return { ok: true, report }
  } catch (e: any) {
    const fallback = clauseAnalysis || legalSearchResult
    return fallback ? { ok: true, report: `## ⚖️ 법률 검토\n\n${fallback}` } : { ok: false, report: "", error: e?.message }
  }
}

// ─── 데이터 분석 파이프라인 ──────────────────────────────────────────────────
const DATA_ANALYSIS_PATTERNS = [
  "데이터 분석", "통계 분석", "수치 분석", "트렌드 분석", "패턴 분석",
  "상관관계", "데이터 시각화", "csv 분석", "엑셀 분석", "지표 분석", "kpi 분석",
  "data analysis", "analyze data", "statistical analysis"
]
function detectDataAnalysisCommand(message: string): boolean {
  return DATA_ANALYSIS_PATTERNS.some((p) => String(message ?? "").toLowerCase().includes(p))
}
async function runDataAnalysis(query: string, attachedText: string, onProgress: (step: string, text: string) => void): Promise<{ ok: boolean; report: string; error?: string }> {
  const openaiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  const perplexityKey = String((globalThis as any)?.process?.env?.PERPLEXITY_API_KEY ?? "").trim()
  const dataContext = attachedText ? `\n\n[데이터]\n${attachedText.slice(0, 5000)}` : ""
  onProgress("search", "📊 관련 업계 기준 및 벤치마크 검색 중...")
  let benchmarkResult = ""
  if (perplexityKey && !attachedText) {
    try {
      const pResp = await fetch("https://api.perplexity.ai/chat/completions", { method: "POST", headers: { "Authorization": `Bearer ${perplexityKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "sonar-pro", messages: [{ role: "system", content: "데이터 분석 전문가로서 관련 업계 기준, 벤치마크, 평균 지표를 제공하세요." }, { role: "user", content: `다음 데이터 분석 요청과 관련된 업계 기준을 검색해줘:\n\n${query}` }], max_tokens: 1500 }), signal: AbortSignal.timeout(25000) })
      benchmarkResult = String((await pResp.json().catch(() => ({})))?.choices?.[0]?.message?.content ?? "")
    } catch {}
  }
  onProgress("analyze", "🔢 OpenAI가 데이터 패턴 및 인사이트 분석 중...")
  let analysisResult = ""
  if (openaiKey) {
    try {
      const oData = await (await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-5.2", messages: [{ role: "system", content: "데이터 사이언티스트로서 핵심지표요약, 트렌드/패턴식별, 상관관계분석, 이상치, 비즈니스해석을 제공하세요." }, { role: "user", content: `다음 데이터를 분석해줘:\n\n${query}${dataContext}\n\n${benchmarkResult ? `[벤치마크]\n${benchmarkResult.slice(0, 1000)}` : ""}` }], max_tokens: 2500 }), signal: AbortSignal.timeout(60000) })).json().catch(() => ({}))
      analysisResult = String(oData?.choices?.[0]?.message?.content ?? "").trim()
    } catch {}
  }
  onProgress("report", "📝 Claude가 분석 보고서 작성 중...")
  try {
    const cr = await runAdapter({ provider: "claude", task: "research", messages: [{ role: "system", content: "데이터 분석 보고서 전문가입니다. 형식: ## 📊 데이터 분석 보고서 / ###1.분석개요 / ###2.핵심지표요약 / ###3.주요발견사항 / ###4.트렌드및패턴 / ###5.인사이트 / ###6.시각화제안 / ###7.권고사항" }, { role: "user", content: `보고서 작성:\n[요청] ${query}${dataContext}\n[OpenAI분석]\n${analysisResult.slice(0, 2000) || "없음"}\n[벤치마크]\n${benchmarkResult.slice(0, 800) || "없음"}` }], input: { model: "claude-sonnet-4-6", max_tokens: 3000, temperature: 0.2 } })
    const report = String(cr?.text ?? cr?.answer_text ?? "").trim()
    if (!report) throw new Error("empty")
    return { ok: true, report }
  } catch (e: any) {
    const fallback = analysisResult || benchmarkResult
    return fallback ? { ok: true, report: `## 📊 데이터 분석\n\n${fallback}` } : { ok: false, report: "", error: e?.message }
  }
}

// ─── 기업 재무정보 파이프라인 ────────────────────────────────────────────────
const FINANCE_PATTERNS = [
  "재무정보", "재무분석", "재무제표", "재무 분석", "손익계산서", "대차대조표",
  "영업이익", "순이익", "부채비율", "roe", "roa", "per", "pbr", "ebitda",
  "기업가치", "밸류에이션", "투자분석", "공시 분석", "사업보고서",
  "financial analysis", "financial statement", "valuation"
]
function detectFinanceCommand(message: string): boolean {
  return FINANCE_PATTERNS.some((p) => String(message ?? "").toLowerCase().includes(p))
}
async function runFinanceAnalysis(query: string, attachedText: string, onProgress: (step: string, text: string) => void): Promise<{ ok: boolean; report: string; error?: string }> {
  const openaiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  const perplexityKey = String((globalThis as any)?.process?.env?.PERPLEXITY_API_KEY ?? "").trim()
  const docContext = attachedText ? `\n\n[첨부 재무 문서]\n${attachedText.slice(0, 5000)}` : ""
  onProgress("search", "📈 최신 재무 데이터 및 업계 비교 검색 중...")
  let financeSearch = ""
  if (perplexityKey) {
    try {
      const pResp = await fetch("https://api.perplexity.ai/chat/completions", { method: "POST", headers: { "Authorization": `Bearer ${perplexityKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "sonar-pro", messages: [{ role: "system", content: "기업 재무 분석 전문가로서 최신 재무 데이터, 공시, 업계 평균 지표를 제공하세요." }, { role: "user", content: `다음 재무 분석 요청 관련 최신 데이터를 검색해줘:\n\n${query}` }], max_tokens: 2000 }), signal: AbortSignal.timeout(30000) })
      financeSearch = String((await pResp.json().catch(() => ({})))?.choices?.[0]?.message?.content ?? "")
    } catch {}
  }
  onProgress("analyze", "💹 OpenAI가 재무 지표 및 투자 관점 분석 중...")
  let financeAnalysis = ""
  if (openaiKey) {
    try {
      const oData = await (await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-5.2", messages: [{ role: "system", content: "CFA 수준의 재무 분석가로서 PER/PBR/ROE/EBITDA 계산, 수익성/안정성/성장성 분석, 업계 비교, 리스크 요인을 분석하세요. ※투자 권유 아님" }, { role: "user", content: `재무 정보 분석:\n\n${query}${docContext}\n\n[검색 데이터]\n${financeSearch.slice(0, 2000) || "없음"}` }], max_tokens: 2500 }), signal: AbortSignal.timeout(60000) })).json().catch(() => ({}))
      financeAnalysis = String(oData?.choices?.[0]?.message?.content ?? "").trim()
    } catch {}
  }
  onProgress("report", "📋 Claude가 재무 분석 보고서 작성 중...")
  try {
    const cr = await runAdapter({ provider: "claude", task: "research", messages: [{ role: "system", content: "기업 재무 보고서 전문가입니다. 형식: ## 💹 기업 재무 분석 보고서 / ###1.분석개요 / ###2.핵심재무지표요약(표) / ###3.수익성분석 / ###4.안정성분석 / ###5.성장성분석 / ###6.주요리스크 / ###7.종합평가 / ※참고용, 투자권유아님" }, { role: "user", content: `재무 보고서 작성:\n[대상] ${query}${docContext}\n[OpenAI분석]\n${financeAnalysis.slice(0, 2000) || "없음"}\n[시장데이터]\n${financeSearch.slice(0, 1500) || "없음"}` }], input: { model: "claude-sonnet-4-6", max_tokens: 3000, temperature: 0.15 } })
    const report = String(cr?.text ?? cr?.answer_text ?? "").trim()
    if (!report) throw new Error("empty")
    return { ok: true, report }
  } catch (e: any) {
    const fallback = financeAnalysis || financeSearch
    return fallback ? { ok: true, report: `## 💹 재무 분석\n\n${fallback}` } : { ok: false, report: "", error: e?.message }
  }
}

// ─── 상품 개발 파이프라인 ────────────────────────────────────────────────────
const PRODUCT_DEV_PATTERNS = [
  "상품 개발", "제품 개발", "상품 기획", "제품 기획", "신제품",
  "브랜딩 전략", "브랜드 전략", "포지셔닝", "경쟁사 분석", "swot 분석",
  "시장조사", "고객 분석", "페르소나", "mvp", "gtm 전략", "go-to-market",
  "상품화 전략", "런칭 전략", "product development", "brand strategy"
]
function detectProductDevCommand(message: string): boolean {
  return PRODUCT_DEV_PATTERNS.some((p) => String(message ?? "").toLowerCase().includes(p))
}
async function runProductDevelopment(query: string, attachedText: string, onProgress: (step: string, text: string) => void): Promise<{ ok: boolean; report: string; error?: string }> {
  const openaiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  const perplexityKey = String((globalThis as any)?.process?.env?.PERPLEXITY_API_KEY ?? "").trim()
  const docContext = attachedText ? `\n\n[첨부 문서]\n${attachedText.slice(0, 4000)}` : ""
  onProgress("search", "🔍 시장 트렌드 및 경쟁사 현황 검색 중...")
  let marketSearch = ""
  if (perplexityKey) {
    try {
      const pResp = await fetch("https://api.perplexity.ai/chat/completions", { method: "POST", headers: { "Authorization": `Bearer ${perplexityKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "sonar-pro", messages: [{ role: "system", content: "시장 조사 전문가로서 최신 시장 트렌드, 경쟁사 동향, 소비자 인사이트를 제공하세요." }, { role: "user", content: `다음 상품/브랜드 기획 관련 시장 동향을 검색해줘:\n\n${query}${docContext}` }], max_tokens: 2000 }), signal: AbortSignal.timeout(30000) })
      marketSearch = String((await pResp.json().catch(() => ({})))?.choices?.[0]?.message?.content ?? "")
    } catch {}
  }
  onProgress("strategy", "💡 OpenAI가 전략 및 포지셔닝 분석 중...")
  let strategyResult = ""
  if (openaiKey) {
    try {
      const oData = await (await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-5.2", messages: [{ role: "system", content: "브랜딩 및 상품 전략 전문가로서 SWOT분석, 타겟고객페르소나(2-3개), 포지셔닝전략, USP, GTM전략, 리스크를 분석하세요." }, { role: "user", content: `상품/브랜드 기획 분석:\n\n${query}${docContext}\n\n[시장조사]\n${marketSearch.slice(0, 2000) || "없음"}` }], max_tokens: 2500 }), signal: AbortSignal.timeout(60000) })).json().catch(() => ({}))
      strategyResult = String(oData?.choices?.[0]?.message?.content ?? "").trim()
    } catch {}
  }
  onProgress("report", "📦 Claude가 상품 기획서 작성 중...")
  try {
    const cr = await runAdapter({ provider: "claude", task: "research", messages: [{ role: "system", content: "상품 기획 전문가입니다. 형식: ## 📦 상품 개발 기획서 / ###1.상품개요 / ###2.시장분석(표) / ###3.타겟고객페르소나 / ###4.SWOT분석 / ###5.포지셔닝전략및USP / ###6.GTM전략 / ###7.마일스톤및실행계획 / ###8.예상리스크및대응" }, { role: "user", content: `기획서 작성:\n[기획] ${query}${docContext}\n[전략분석]\n${strategyResult.slice(0, 2000) || "없음"}\n[시장데이터]\n${marketSearch.slice(0, 1500) || "없음"}` }], input: { model: "claude-sonnet-4-6", max_tokens: 3000, temperature: 0.3 } })
    const report = String(cr?.text ?? cr?.answer_text ?? "").trim()
    if (!report) throw new Error("empty")
    return { ok: true, report }
  } catch (e: any) {
    const fallback = strategyResult || marketSearch
    return fallback ? { ok: true, report: `## 📦 상품 기획\n\n${fallback}` } : { ok: false, report: "", error: e?.message }
  }
}

// 소스 승격 명령 감지 패턴
const SOURCE_PROMOTE_PATTERNS = [
  "내용 정리해서 소스로",
  "소스로 저장",
  "소스로 넘겨줘",
  "프로젝트 소스에 추가",
  "소스로 올려줘",
  "소스로 승격",
  "지식 소스로",
  "프로젝트 지식으로",
  "소스 등록"
]

function detectSourcePromoteCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return SOURCE_PROMOTE_PATTERNS.some((p) => lower.includes(p))
}

function buildSourceAssetFromThread(input: any): {
  id: string
  thread_id: string
  type: "thread_summary"
  title: string
  content: string
  status: "confirmed"
  created_at: number
  updated_at: number
} | null {
  const threadId = safeString(input?.thread_id) || "chat_thread"
  const threadMemory = getThreadMemory(threadId)

  if (!threadMemory) return null

  const structured = threadMemory.structured
  const summary = safeString(structured?.summary)
  // 내부 judge 값 필터링 (single_candidate 등 노출 방지)
  const INTERNAL_NOISE = ["single_candidate", "single_candidate_after_escalation", "primary_survival_bias", "override"]
  const decisions = safeArray(structured?.decisions).filter(
    (d: string) => !INTERNAL_NOISE.some((n) => String(d).toLowerCase().includes(n))
  )
  const facts = safeArray(structured?.facts)
  const entities = safeArray(structured?.entities)

  if (!summary && decisions.length === 0 && facts.length === 0) return null

  const lines: string[] = []

  if (summary) {
    lines.push("[요약]")
    lines.push(summary)
    lines.push("")
  }

  if (decisions.length > 0) {
    lines.push("[결정사항]")
    lines.push(...decisions)
    lines.push("")
  }

  if (facts.length > 0) {
    lines.push("[핵심 사실]")
    lines.push(...facts)
    lines.push("")
  }

  if (entities.length > 0) {
    lines.push("[주요 키워드]")
    lines.push(entities.join(", "))
  }

  const content = lines.join("\n").trim()
  if (!content) return null

  const title = threadMemory.title ?? `스레드 요약 — ${new Date().toLocaleDateString("ko-KR")}`

  return {
    id: `source_${threadId}_${Date.now()}`,
    thread_id: threadId,
    type: "thread_summary",
    title,
    content,
    status: "confirmed",
    created_at: Date.now(),
    updated_at: Date.now()
  }
}

function handleSourcePromoteCommand(input: any): { ok: boolean; message: string } {
  const projectId = safeString(input?.project_id) || "chat_project"
  const asset = buildSourceAssetFromThread(input)

  if (!asset) {
    return {
      ok: false,
      message: "현재 스레드에 저장된 내용이 없습니다. 먼저 대화를 진행해주세요."
    }
  }

  try {
    addProjectSourceAsset(projectId, asset)
    return {
      ok: true,
      message: `✅ 프로젝트 소스로 저장했습니다.\n\n**제목:** ${asset.title}\n\n${asset.content.slice(0, 400)}${asset.content.length > 400 ? "\n\n..." : ""}`
    }
  } catch {
    return {
      ok: false,
      message: "소스 저장 중 오류가 발생했습니다."
    }
  }
}

function extractInboundQuery(input: any): string {
  if (safeString(input?.message).length > 0) return safeString(input.message)

  const messages = safeArray(input?.messages)
  const last = [...messages].reverse().find((m: any) => safeString(m?.role) === "user")
  if (last) {
    if (typeof last.content === "string") return safeString(last.content)
    if (Array.isArray(last.content)) {
      return last.content
        .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
        .join(" ")
        .trim()
    }
  }

  return ""
}

// GPT-4o vision API 직접 호출 (이미지 첨부 파일 분석)
async function analyzeImageWithVision(attached: any, userText: string): Promise<string> {
  const apiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  if (!apiKey) return "OPENAI_API_KEY가 설정되지 않아 이미지를 분석할 수 없습니다."

  const body = {
    model: "gpt-5.2",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:${attached.type};base64,${attached.base64}`,
              detail: "high"
            }
          },
          { type: "text", text: userText || "이 이미지를 분석해줘" }
        ]
      }
    ],
    max_tokens: 2048
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60000)

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })

    clearTimeout(timer)

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      const msg = data?.error?.message ?? `HTTP ${response.status}`
      return `이미지 분석 실패: ${msg}`
    }

    const text = data?.choices?.[0]?.message?.content ?? ""
    return typeof text === "string" && text.trim() ? text.trim() : "이미지 분석 결과를 가져올 수 없습니다."
  } catch (e: any) {
    clearTimeout(timer)
    return `이미지 분석 중 오류: ${e?.message ?? "network_error"}`
  }
}

// 첨부 파일을 AI 메시지에 주입하는 함수
// PDF 파일 → Gemini API로 직접 분석 (base64 전달)
async function analyzePdfWithGemini(attached: any, userText: string): Promise<string> {
  const apiKey = String((globalThis as any)?.process?.env?.GEMINI_API_KEY ?? "").trim()
  if (!apiKey) {
    // Gemini 없으면 OpenAI로 텍스트 추출 시도
    return analyzePdfWithOpenAI(attached, userText)
  }

  try {
    const body = {
      contents: [
        {
          parts: [
            {
              inline_data: {
                mime_type: "application/pdf",
                data: attached.base64
              }
            },
            {
              text: userText || "이 PDF 문서의 내용을 분석하고 핵심 내용을 요약해줘"
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4096
      }
    }

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000)
      }
    )

    const data = await resp.json().catch(() => ({}))

    if (!resp.ok) {
      throw new Error(data?.error?.message ?? `HTTP ${resp.status}`)
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
    if (!text) throw new Error("empty response")

    return text
  } catch (e: any) {
    // Gemini 실패 시 OpenAI fallback
    console.error("[PDF] Gemini failed:", e?.message, "→ falling back to OpenAI")
    return analyzePdfWithOpenAI(attached, userText)
  }
}

async function analyzePdfWithOpenAI(attached: any, userText: string): Promise<string> {
  const apiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  if (!apiKey) return "API 키가 없어 PDF를 분석할 수 없습니다."

  // PDF base64 → 텍스트 추출 시도
  try {
    const pdfText = Buffer.from(attached.base64, "base64").toString("latin1")
    // PDF에서 텍스트 패턴 추출 (간단한 정규식)
    const extracted = pdfText
      .replace(/[^ -~가-힣ㄱ-ㅎㅏ-ㅣ]/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 6000)
      .trim()

    if (extracted.length < 100) {
      return `PDF 파일(${attached.name})을 받았습니다. 이 파일은 스캔된 이미지 PDF로 텍스트 추출이 어렵습니다. Gemini API 키를 설정하면 이미지 PDF도 분석할 수 있습니다.`
    }

    const body = {
      model: "gpt-5.2",
      messages: [
        {
          role: "system",
          content: "당신은 문서 분석 전문가입니다. 주어진 텍스트를 분석하고 핵심 내용을 정리해주세요."
        },
        {
          role: "user",
          content: `[PDF 파일: ${attached.name}]

[추출된 텍스트]
${extracted}

${userText || "이 문서의 핵심 내용을 분석해줘"}`
        }
      ],
      max_tokens: 2048
    }

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    })

    const data = await resp.json().catch(() => ({}))
    return String(data?.choices?.[0]?.message?.content ?? "PDF 분석에 실패했습니다.")
  } catch (e: any) {
    return `PDF 분석 오류: ${e?.message ?? "unknown"}`
  }
}

function buildMessagesWithAttachment(input: any): any[] {
  const attached = input?.attached_file
  if (!attached?.base64 || !attached?.type) return []

  const isImage = String(attached.type).startsWith("image/")
  const isPdf = attached.type === "application/pdf"

  const userText = safeString(input?.message) || "이 파일을 분석해줘"

  // 이미지는 vision API에서 별도 처리 — orchestra에 넘기지 않음
  if (isImage) {
    return []
  }

  if (isPdf) {
    return [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `[첨부 파일: ${attached.name}]

${userText}`
          }
        ]
      }
    ]
  }

  // 텍스트 파일 — base64 디코딩해서 내용 포함
  try {
    const textContent = Buffer.from(attached.base64, "base64").toString("utf-8").slice(0, 8000)
    return [
      {
        role: "user",
        content: `[첨부 파일: ${attached.name}]

\`\`\`
${textContent}
\`\`\`

${userText}`
      }
    ]
  } catch {
    return [
      {
        role: "user",
        content: `[첨부 파일: ${attached.name} — 읽기 실패]

${userText}`
      }
    ]
  }
}

function injectAttachmentIntoInput(input: any): any {
  const attached = input?.attached_file
  if (!attached?.base64) return input

  const messages = buildMessagesWithAttachment(input)
  if (messages.length === 0) return input

  // 기존 messages가 있으면 마지막 user 메시지를 교체, 없으면 새로 생성
  const existingMessages = safeArray(input?.messages).filter(
    (m: any) => safeString(m?.role) !== "user" || !input?.message
  )

  return {
    ...input,
    messages: [...existingMessages, ...messages],
    message: undefined  // message 대신 messages 배열 사용
  }
}

function tryMemoryReuse(input: any): ReturnType<typeof buildReusedPayload> | null {
  const projectId = safeString(input?.project_id) || "chat_project"
  const query = extractInboundQuery(input)

  if (query.length < 10) return null

  try {
    const similar = findSimilarQuery(query, projectId, {
      threshold: REUSE_SIMILARITY_THRESHOLD,
      limit: 1
    })

    if (similar.length > 0 && similar[0].score >= REUSE_SIMILARITY_THRESHOLD) {
      const hit = similar[0]
      const provider = hit.winner_provider ?? "memory"
      return buildReusedPayload(hit.matched_answer, provider, "similar_query", hit.score)
    }
  } catch {}

  try {
    const task = safeString(input?.task) || "dialogue"
    const pastWinner = findPastWinner(projectId, task, {
      minCount: 2,
      windowMs: 7 * 24 * 60 * 60 * 1000
    })

    if (pastWinner && pastWinner.confidence >= REUSE_PAST_WINNER_CONFIDENCE) {
      return buildReusedPayload(
        pastWinner.answer_text,
        pastWinner.winner_provider,
        "past_winner",
        pastWinner.confidence
      )
    }
  } catch {}

  return null
}

export async function runChatRoute(req: RouteRequest, res: RouteResponse) {
  const input = req?.body ?? {}
  const normalizedInput = {
    ...input,
    mode: input?.mode ?? "runtime_orchestra",
    thread_id: input?.thread_id ?? "chat_thread",
    project_id: input?.project_id ?? "chat_project"
  }

  const startedAt = Date.now()

  // 첨부 파일이 있으면 normalizedInput에 주입
  const effectiveInput = normalizedInput?.attached_file
    ? injectAttachmentIntoInput(normalizedInput)
    : normalizedInput

  const inboundQuery = extractInboundQuery(effectiveInput)

  // 슬라이드 생성 명령 감지
  if (detectSlideCommand(inboundQuery)) {
    const slideResult = await handleSlideCommand(normalizedInput, inboundQuery)
    return res.json?.({
      ok: true,
      answer: { provider: "claude", text: slideResult.message, ok: slideResult.ok },
      meta: { orchestration: { final_provider: "claude", latency_ms: 0 } },
      orchestration: { final_provider: "claude" },
      bandit: {},
      derived: { detected_task: "code", execution_strategy: "slide_generate", selected_providers: ["claude"], verifier_providers: [], fallback_providers: [], parallel_providers: [], winner: "claude", runner_up: null, conflict_count: 0, executed_provider_count: 1, latency_ms: 0, estimated_cost_usd: 0, fallback_used: false, judge_confidence: 1 },
      internal: { task: "slide_generate", route: null, judge: null, conflicts: [], conflict_count: 0, executed_providers: [], execution_policy: { max_parallel: 1, cost_gate_enabled: false, max_total_estimated_cost_usd: 0, prefer_fast_fallback: false }, escalation: { pre_routing_use_pro: false, post_eval_triggered: false }, scoreboard: {} },
      result: null,
      is_slide: slideResult.ok,
      slide_data: slideResult.slide_data ?? null
    })
  }

  // 이미지 생성 명령 감지
  if (detectGeminiImageCommand(inboundQuery)) {
    const imageResult = await handleGeminiImageCommand(inboundQuery)
    return res.json?.({
      ok: true,
      answer: { provider: "gemini", text: imageResult.message, ok: imageResult.ok },
      meta: { orchestration: { final_provider: "gemini", latency_ms: 0 } },
      orchestration: { final_provider: "gemini" },
      bandit: {},
      derived: { detected_task: "dialogue", execution_strategy: "image_generate", selected_providers: ["gemini"], verifier_providers: [], fallback_providers: [], parallel_providers: [], winner: "gemini", runner_up: null, conflict_count: 0, executed_provider_count: 1, latency_ms: 0, estimated_cost_usd: 0, fallback_used: false, judge_confidence: 1 },
      internal: { task: "image_generate", route: null, judge: null, conflicts: [], conflict_count: 0, executed_providers: [], execution_policy: { max_parallel: 1, cost_gate_enabled: false, max_total_estimated_cost_usd: 0, prefer_fast_fallback: false }, escalation: { pre_routing_use_pro: false, post_eval_triggered: false }, scoreboard: {} },
      result: null,
      is_image: imageResult.ok,
      image_url: imageResult.url ?? null,
      image_revised_prompt: null
    })
  }

  if (detectImageCommand(inboundQuery)) {
    const imageResult = await handleImageCommand(inboundQuery)
    return res.json?.({
      ok: true,
      answer: { provider: "openai", text: imageResult.message, ok: imageResult.ok },
      meta: { orchestration: { final_provider: "openai", latency_ms: 0 } },
      orchestration: { final_provider: "openai" },
      bandit: {},
      derived: { detected_task: "dialogue", execution_strategy: "image_generate", selected_providers: ["openai"], verifier_providers: [], fallback_providers: [], parallel_providers: [], winner: "openai", runner_up: null, conflict_count: 0, executed_provider_count: 1, latency_ms: 0, estimated_cost_usd: 0, fallback_used: false, judge_confidence: 1 },
      internal: { task: "image_generate", route: null, judge: null, conflicts: [], conflict_count: 0, executed_providers: [], execution_policy: { max_parallel: 1, cost_gate_enabled: false, max_total_estimated_cost_usd: 0, prefer_fast_fallback: false }, escalation: { pre_routing_use_pro: false, post_eval_triggered: false }, scoreboard: {} },
      result: null,
      is_image: imageResult.ok,
      image_url: imageResult.url ?? null,
      image_revised_prompt: imageResult.revised_prompt ?? null
    })
  }

  // 소스 승격 명령 감지 — AI 호출 없이 즉시 처리
  if (detectSourcePromoteCommand(inboundQuery)) {
    const promoteResult = handleSourcePromoteCommand(normalizedInput)
    return res.json?.({
      ok: true,
      answer: {
        provider: "system",
        text: promoteResult.message,
        ok: promoteResult.ok
      },
      meta: { orchestration: { final_provider: "system", latency_ms: 0 } },
      orchestration: { final_provider: "system" },
      bandit: {},
      derived: { detected_task: null, execution_strategy: "source_promote", selected_providers: [], verifier_providers: [], fallback_providers: [], parallel_providers: [], winner: "system", runner_up: null, conflict_count: 0, executed_provider_count: 0, latency_ms: 0, estimated_cost_usd: 0, fallback_used: false, judge_confidence: 1 },
      internal: { task: "source_promote", route: null, judge: null, conflicts: [], conflict_count: 0, executed_providers: [], execution_policy: { max_parallel: 0, cost_gate_enabled: false, max_total_estimated_cost_usd: 0, prefer_fast_fallback: false }, escalation: { pre_routing_use_pro: false, post_eval_triggered: false }, scoreboard: {} },
      result: null
    })
  }

  // 이미지/PDF 첨부 파일 → 직접 분석 (orchestra 우회)
  const _attached = normalizedInput?.attached_file
  const _attachedType = String(_attached?.type ?? "")
  if (_attached && (_attachedType.startsWith("image/") || _attachedType === "application/pdf")) {
    try {
      const userText = safeString(normalizedInput?.message) || (_attachedType === "application/pdf" ? "이 PDF를 분석해줘" : "이 이미지를 분석해줘")
      const visionText = _attachedType === "application/pdf"
        ? await analyzePdfWithGemini(_attached, userText)
        : await analyzeImageWithVision(_attached, userText)
      return res.json?.({
        ok: true,
        answer: { provider: "openai", text: visionText, ok: true },
        meta: { orchestration: { final_provider: "openai", latency_ms: 0 } },
        orchestration: { final_provider: "openai" },
        bandit: {},
        derived: { detected_task: "dialogue", execution_strategy: "vision_analyze", selected_providers: ["openai"], verifier_providers: [], fallback_providers: [], parallel_providers: [], winner: "openai", runner_up: null, conflict_count: 0, executed_provider_count: 1, latency_ms: 0, estimated_cost_usd: 0, fallback_used: false, judge_confidence: 1 },
        internal: { task: "vision_analyze", route: null, judge: null, conflicts: [], conflict_count: 0, executed_providers: [], execution_policy: { max_parallel: 1, cost_gate_enabled: false, max_total_estimated_cost_usd: 0, prefer_fast_fallback: false }, escalation: { pre_routing_use_pro: false, post_eval_triggered: false }, scoreboard: {} },
        result: null
      })
    } catch (e: any) {
      return res.json?.({ ok: false, error: String(e?.message ?? "vision_error") })
    }
  }

  try {
    const reused = tryMemoryReuse(normalizedInput)
    if (reused) {
      return res.json?.(reused)
    }

    const result = await executeOrchestra(effectiveInput)

    try {
      persistRuntimeMemory(normalizedInput, result)
    } catch {}

    try {
      await logBenchmark(buildBenchmarkPayload(result, normalizedInput))
    } catch {}

    return res.json?.(buildChatPayload(result))
  } catch (error: any) {
    try {
      await logBenchmark(buildErrorBenchmarkPayload(normalizedInput, error, startedAt))
    } catch {}

    return res.json?.({
      ok: false,
      error: String(error?.message ?? "unknown_error")
    })
  }
}

export async function runChatStreamRoute(req: RouteRequest, res: RouteResponse) {
  const input = req?.body ?? {}

  // AbortController — 클라이언트 ESC/연결 끊김 시 즉시 abort
  const abortController = new AbortController()
  const { signal } = abortController

  ;(req as any)?.on?.("close", () => {
    abortController.abort()
  })

  const normalizedInput = {
    ...input,
    mode: input?.mode ?? "runtime_orchestra",
    thread_id: input?.thread_id ?? "chat_thread",
    project_id: input?.project_id ?? "chat_project",
    abort_signal: signal
  }

  const startedAt = Date.now()

  res.writeHead?.(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  })

  try {
    writeSse(res, {
      type: "start",
      thread_id: normalizedInput.thread_id,
      project_id: normalizedInput.project_id
    })

    // 첨부 파일이 있으면 normalizedInput에 주입
    const effectiveInput = normalizedInput?.attached_file
      ? injectAttachmentIntoInput(normalizedInput)
      : normalizedInput

    // 슬라이드 생성 명령 감지
    const inboundQuery = extractInboundQuery(effectiveInput)

    if (detectSlideCommand(inboundQuery)) {
      const slideResult = await handleSlideCommand(normalizedInput, inboundQuery)
      const text = slideResult.message
      const chunks = text.split(/(\s+)/).filter((p) => p.length > 0)
      for (const chunk of chunks) {
        writeSse(res, { type: "chunk", content: chunk })
        await sleep(12)
      }
      const donePayload = {
        ok: true,
        answer: { provider: "claude", text, ok: slideResult.ok },
        meta: { orchestration: { final_provider: "claude", latency_ms: 0 } },
        orchestration: { final_provider: "claude" },
        bandit: {},
        derived: { detected_task: "code", execution_strategy: "slide_generate", selected_providers: ["claude"], verifier_providers: [], fallback_providers: [], parallel_providers: [], winner: "claude", runner_up: null, conflict_count: 0, executed_provider_count: 1, latency_ms: 0, estimated_cost_usd: 0, fallback_used: false, judge_confidence: 1 },
        internal: { task: "slide_generate", route: null, judge: null, conflicts: [], conflict_count: 0, executed_providers: [], execution_policy: { max_parallel: 1, cost_gate_enabled: false, max_total_estimated_cost_usd: 0, prefer_fast_fallback: false }, escalation: { pre_routing_use_pro: false, post_eval_triggered: false }, scoreboard: {} },
        result: null,
        is_slide: slideResult.ok,
        slide_data: slideResult.slide_data ?? null
      }
      writeSse(res, { type: "done", payload: donePayload })
      res.end?.()
      return
    }

    // 이미지 생성 명령 감지
    if (detectGeminiImageCommand(inboundQuery)) {
      const imageResult = await handleGeminiImageCommand(inboundQuery)
      const text = imageResult.message
      const chunks = text.split(/(\s+)/).filter((p) => p.length > 0)
      for (const chunk of chunks) {
        writeSse(res, { type: "chunk", content: chunk })
        await sleep(12)
      }
      const donePayload = {
        ok: true,
        answer: { provider: "gemini", text, ok: imageResult.ok },
        meta: { orchestration: { final_provider: "gemini", latency_ms: 0 } },
        orchestration: { final_provider: "gemini" },
        bandit: {},
        derived: { detected_task: "dialogue", execution_strategy: "image_generate", selected_providers: ["gemini"], verifier_providers: [], fallback_providers: [], parallel_providers: [], winner: "gemini", runner_up: null, conflict_count: 0, executed_provider_count: 1, latency_ms: 0, estimated_cost_usd: 0, fallback_used: false, judge_confidence: 1 },
        internal: { task: "image_generate", route: null, judge: null, conflicts: [], conflict_count: 0, executed_providers: [], execution_policy: { max_parallel: 1, cost_gate_enabled: false, max_total_estimated_cost_usd: 0, prefer_fast_fallback: false }, escalation: { pre_routing_use_pro: false, post_eval_triggered: false }, scoreboard: {} },
        result: null,
        is_image: imageResult.ok,
        image_url: imageResult.url ?? null,
        image_revised_prompt: null
      }
      writeSse(res, { type: "done", payload: donePayload })
      res.end?.()
      return
    }

    if (detectImageCommand(inboundQuery)) {
      const imageResult = await handleImageCommand(inboundQuery)
      const text = imageResult.message
      const chunks = text.split(/(\s+)/).filter((p) => p.length > 0)
      for (const chunk of chunks) {
        writeSse(res, { type: "chunk", content: chunk })
        await sleep(12)
      }
      const donePayload = {
        ok: true,
        answer: { provider: "openai", text, ok: imageResult.ok },
        meta: { orchestration: { final_provider: "openai", latency_ms: 0 } },
        orchestration: { final_provider: "openai" },
        bandit: {},
        derived: { detected_task: "dialogue", execution_strategy: "image_generate", selected_providers: ["openai"], verifier_providers: [], fallback_providers: [], parallel_providers: [], winner: "openai", runner_up: null, conflict_count: 0, executed_provider_count: 1, latency_ms: 0, estimated_cost_usd: 0, fallback_used: false, judge_confidence: 1 },
        internal: { task: "image_generate", route: null, judge: null, conflicts: [], conflict_count: 0, executed_providers: [], execution_policy: { max_parallel: 1, cost_gate_enabled: false, max_total_estimated_cost_usd: 0, prefer_fast_fallback: false }, escalation: { pre_routing_use_pro: false, post_eval_triggered: false }, scoreboard: {} },
        result: null,
        is_image: imageResult.ok,
        image_url: imageResult.url ?? null,
        image_revised_prompt: imageResult.revised_prompt ?? null
      }
      writeSse(res, { type: "done", payload: donePayload })
      res.end?.()
      return
    }

    // 핸드오프/세션 요약 명령 감지
    if (detectHandoffCommand(inboundQuery)) {
      writeSse(res, { type: "chunk", content: "📋 세션 내용을 정리하고 있습니다...\n\n" })

      // 스레드 메시지 가져오기 — normalizedInput.messages 우선, threadMemory fallback
      const threadId = safeString(normalizedInput?.thread_id)
      const inboundMessages = safeArray(normalizedInput?.messages)
      const memoryMsgs = threadId ? (getThreadMemory(threadId)?.messages ?? []) : []
      const threadMsgs = inboundMessages.length > 0 ? inboundMessages : memoryMsgs
      console.log("[HANDOFF] inbound messages:", inboundMessages.length, "memory messages:", memoryMsgs.length)

      const result = await runHandoffSummary(threadMsgs, inboundQuery)

      const finalText = result.ok
        ? result.summary
        : `❌ 세션 요약 실패: ${result.error}`

      const chunks = finalText.split(/(\s+)/).filter(p => p.length > 0)
      for (const chunk of chunks) {
        writeSse(res, { type: "chunk", content: chunk })
        await sleep(6)
      }

      const doneMeta = {
        ok: result.ok,
        answer: { provider: "openai", text: finalText, ok: result.ok },
        meta: { orchestration: { final_provider: "openai", latency_ms: 0 } },
        orchestration: { final_provider: "openai" },
        bandit: {},
        derived: { detected_task: "dialogue", execution_strategy: "handoff_summary", selected_providers: ["openai"], verifier_providers: [], fallback_providers: [], parallel_providers: [], winner: "openai", runner_up: null, conflict_count: 0, executed_provider_count: 1, latency_ms: 0, estimated_cost_usd: 0, fallback_used: false, judge_confidence: 1 },
        internal: { task: "handoff_summary", route: null, judge: null, conflicts: [], conflict_count: 0, executed_providers: [], execution_policy: { max_parallel: 1, cost_gate_enabled: false, max_total_estimated_cost_usd: 0, prefer_fast_fallback: false }, escalation: { pre_routing_use_pro: false, post_eval_triggered: false }, scoreboard: {} },
        result: null
      }
      writeSse(res, { type: "done", payload: doneMeta })
      res.end?.()
      return
    }

    // 웹 검색 명령 감지
    if (detectWebSearchCommand(inboundQuery) && !detectDeepResearchCommand(inboundQuery)) {
      writeSse(res, { type: "chunk", content: "🔍 웹에서 검색 중...\n\n" })

      const searchResult = await runWebSearch(inboundQuery)

      if (!searchResult.ok) {
        writeSse(res, { type: "chunk", content: `검색 실패: ${searchResult.error}` })
      } else {
        const chunks = searchResult.answer.split(/(\s+)/).filter(p => p.length > 0)
        for (const chunk of chunks) {
          writeSse(res, { type: "chunk", content: chunk })
          await sleep(6)
        }
      }

      const webDone = {
        ok: searchResult.ok,
        answer: { provider: "perplexity", text: searchResult.answer, ok: searchResult.ok },
        meta: { orchestration: { final_provider: "perplexity", latency_ms: 0 } },
        orchestration: { final_provider: "perplexity" },
        bandit: {},
        derived: { detected_task: "research", execution_strategy: "web_search", selected_providers: ["perplexity"], verifier_providers: [], fallback_providers: ["openai"], parallel_providers: [], winner: "perplexity", runner_up: null, conflict_count: 0, executed_provider_count: 1, latency_ms: 0, estimated_cost_usd: 0, fallback_used: false, judge_confidence: 1 },
        internal: { task: "web_search", route: null, judge: null, conflicts: [], conflict_count: 0, executed_providers: [], execution_policy: { max_parallel: 1, cost_gate_enabled: false, max_total_estimated_cost_usd: 0, prefer_fast_fallback: false }, escalation: { pre_routing_use_pro: false, post_eval_triggered: false }, scoreboard: {} },
        result: null,
        citations: searchResult.citations
      }
      writeSse(res, { type: "done", payload: webDone })
      res.end?.()
      return
    }

    // Deep Research 명령 감지
    if (detectDeepResearchCommand(inboundQuery)) {
      const progressChunks: string[] = []

      const result = await runDeepResearch(
        inboundQuery,
        (step, text) => {
          // 진행 상황 즉시 전송
          writeSse(res, { type: "chunk", content: `\n${text}\n` })
          progressChunks.push(text)
        }
      )

      const finalText = result.ok
        ? result.report
        : `❌ 리서치 실패: ${result.error}`

      // 진행 상황 구분선 후 최종 리포트
      writeSse(res, { type: "chunk", content: "\n\n---\n\n" })

      const reportChunks = finalText.split(/(\s+)/).filter((p) => p.length > 0)
      for (const chunk of reportChunks) {
        writeSse(res, { type: "chunk", content: chunk })
        await sleep(6)
      }

      const doneMeta = {
        ok: result.ok,
        answer: { provider: "claude", text: finalText, ok: result.ok },
        meta: { orchestration: { final_provider: "claude", latency_ms: 0 } },
        orchestration: { final_provider: "claude" },
        bandit: {},
        derived: { detected_task: "research", execution_strategy: "deep_research", selected_providers: ["perplexity", "openai", "claude"], verifier_providers: [], fallback_providers: [], parallel_providers: [], winner: "claude", runner_up: "openai", conflict_count: 0, executed_provider_count: 3, latency_ms: 0, estimated_cost_usd: 0, fallback_used: false, judge_confidence: 1 },
        internal: { task: "deep_research", route: null, judge: null, conflicts: [], conflict_count: 0, executed_providers: [], execution_policy: { max_parallel: 3, cost_gate_enabled: false, max_total_estimated_cost_usd: 0, prefer_fast_fallback: false }, escalation: { pre_routing_use_pro: true, post_eval_triggered: false }, scoreboard: {} },
        result: null
      }
      writeSse(res, { type: "done", payload: doneMeta })
      res.end?.()
      return
    }

    // 법률 검토
    if (detectLegalReviewCommand(inboundQuery)) {
      writeSse(res, { type: "chunk", content: "⚖️ 법률 검토를 시작합니다...\n\n" })
      const result = await runLegalReview(inboundQuery, String(normalizedInput?.attached_text ?? normalizedInput?.pdf_text ?? "").trim(), (_, text) => { writeSse(res, { type: "chunk", content: `\n${text}\n` }) })
      const finalText = result.ok ? result.report : `❌ 법률 검토 실패: ${result.error}`
      writeSse(res, { type: "chunk", content: "\n\n---\n\n" })
      for (const chunk of finalText.split(/(\s+)/).filter((p) => p.length > 0)) { writeSse(res, { type: "chunk", content: chunk }); await sleep(6) }
      writeSse(res, { type: "done", payload: { ok: result.ok, answer: { provider: "openai", text: finalText, ok: result.ok }, meta: { orchestration: { final_provider: "openai", latency_ms: 0 } }, orchestration: { final_provider: "openai" }, bandit: {}, derived: { detected_task: "research", execution_strategy: "legal_review", selected_providers: ["perplexity", "claude", "openai"], verifier_providers: [], fallback_providers: [], parallel_providers: [], winner: "openai", runner_up: "claude", conflict_count: 0, executed_provider_count: 3, latency_ms: 0, estimated_cost_usd: 0, fallback_used: false, judge_confidence: 1 }, internal: { task: "legal_review", route: null, judge: null, conflicts: [], conflict_count: 0, executed_providers: [], execution_policy: { max_parallel: 3, cost_gate_enabled: false, max_total_estimated_cost_usd: 0, prefer_fast_fallback: false }, escalation: { pre_routing_use_pro: true, post_eval_triggered: false }, scoreboard: {} }, result: null } })
      res.end?.(); return
    }

    // 데이터 분석
    if (detectDataAnalysisCommand(inboundQuery)) {
      writeSse(res, { type: "chunk", content: "📊 데이터 분석을 시작합니다...\n\n" })
      const result = await runDataAnalysis(inboundQuery, String(normalizedInput?.attached_text ?? normalizedInput?.pdf_text ?? normalizedInput?.csv_text ?? "").trim(), (_, text) => { writeSse(res, { type: "chunk", content: `\n${text}\n` }) })
      const finalText = result.ok ? result.report : `❌ 데이터 분석 실패: ${result.error}`
      writeSse(res, { type: "chunk", content: "\n\n---\n\n" })
      for (const chunk of finalText.split(/(\s+)/).filter((p) => p.length > 0)) { writeSse(res, { type: "chunk", content: chunk }); await sleep(6) }
      writeSse(res, { type: "done", payload: { ok: result.ok, answer: { provider: "claude", text: finalText, ok: result.ok }, meta: { orchestration: { final_provider: "claude", latency_ms: 0 } }, orchestration: { final_provider: "claude" }, bandit: {}, derived: { detected_task: "research", execution_strategy: "data_analysis", selected_providers: ["openai", "claude"], verifier_providers: [], fallback_providers: [], parallel_providers: [], winner: "claude", runner_up: "openai", conflict_count: 0, executed_provider_count: 2, latency_ms: 0, estimated_cost_usd: 0, fallback_used: false, judge_confidence: 1 }, internal: { task: "data_analysis", route: null, judge: null, conflicts: [], conflict_count: 0, executed_providers: [], execution_policy: { max_parallel: 2, cost_gate_enabled: false, max_total_estimated_cost_usd: 0, prefer_fast_fallback: false }, escalation: { pre_routing_use_pro: true, post_eval_triggered: false }, scoreboard: {} }, result: null } })
      res.end?.(); return
    }

    // 기업 재무정보
    if (detectFinanceCommand(inboundQuery)) {
      writeSse(res, { type: "chunk", content: "💹 기업 재무 분석을 시작합니다...\n\n" })
      const result = await runFinanceAnalysis(inboundQuery, String(normalizedInput?.attached_text ?? normalizedInput?.pdf_text ?? "").trim(), (_, text) => { writeSse(res, { type: "chunk", content: `\n${text}\n` }) })
      const finalText = result.ok ? result.report : `❌ 재무 분석 실패: ${result.error}`
      writeSse(res, { type: "chunk", content: "\n\n---\n\n" })
      for (const chunk of finalText.split(/(\s+)/).filter((p) => p.length > 0)) { writeSse(res, { type: "chunk", content: chunk }); await sleep(6) }
      writeSse(res, { type: "done", payload: { ok: result.ok, answer: { provider: "claude", text: finalText, ok: result.ok }, meta: { orchestration: { final_provider: "claude", latency_ms: 0 } }, orchestration: { final_provider: "claude" }, bandit: {}, derived: { detected_task: "research", execution_strategy: "finance_analysis", selected_providers: ["perplexity", "openai", "claude"], verifier_providers: [], fallback_providers: [], parallel_providers: [], winner: "claude", runner_up: "openai", conflict_count: 0, executed_provider_count: 3, latency_ms: 0, estimated_cost_usd: 0, fallback_used: false, judge_confidence: 1 }, internal: { task: "finance_analysis", route: null, judge: null, conflicts: [], conflict_count: 0, executed_providers: [], execution_policy: { max_parallel: 3, cost_gate_enabled: false, max_total_estimated_cost_usd: 0, prefer_fast_fallback: false }, escalation: { pre_routing_use_pro: true, post_eval_triggered: false }, scoreboard: {} }, result: null } })
      res.end?.(); return
    }

    // 상품 개발
    if (detectProductDevCommand(inboundQuery)) {
      writeSse(res, { type: "chunk", content: "📦 상품 개발 분석을 시작합니다...\n\n" })
      const result = await runProductDevelopment(inboundQuery, String(normalizedInput?.attached_text ?? normalizedInput?.pdf_text ?? "").trim(), (_, text) => { writeSse(res, { type: "chunk", content: `\n${text}\n` }) })
      const finalText = result.ok ? result.report : `❌ 상품 기획 실패: ${result.error}`
      writeSse(res, { type: "chunk", content: "\n\n---\n\n" })
      for (const chunk of finalText.split(/(\s+)/).filter((p) => p.length > 0)) { writeSse(res, { type: "chunk", content: chunk }); await sleep(6) }
      writeSse(res, { type: "done", payload: { ok: result.ok, answer: { provider: "claude", text: finalText, ok: result.ok }, meta: { orchestration: { final_provider: "claude", latency_ms: 0 } }, orchestration: { final_provider: "claude" }, bandit: {}, derived: { detected_task: "research", execution_strategy: "product_development", selected_providers: ["perplexity", "openai", "claude"], verifier_providers: [], fallback_providers: [], parallel_providers: [], winner: "claude", runner_up: "openai", conflict_count: 0, executed_provider_count: 3, latency_ms: 0, estimated_cost_usd: 0, fallback_used: false, judge_confidence: 1 }, internal: { task: "product_development", route: null, judge: null, conflicts: [], conflict_count: 0, executed_providers: [], execution_policy: { max_parallel: 3, cost_gate_enabled: false, max_total_estimated_cost_usd: 0, prefer_fast_fallback: false }, escalation: { pre_routing_use_pro: true, post_eval_triggered: false }, scoreboard: {} }, result: null } })
      res.end?.(); return
    }

    // 소스 승격 명령 감지 — 스트림 없이 즉시 처리
    if (detectSourcePromoteCommand(inboundQuery)) {
      const promoteResult = handleSourcePromoteCommand(normalizedInput)
      const text = promoteResult.message
      const chunks = text.split(/(\s+)/).filter((p) => p.length > 0)
      for (const chunk of chunks) {
        writeSse(res, { type: "chunk", content: chunk })
        await sleep(12)
      }
      const donePayload = {
        ok: true,
        answer: { provider: "system", text, ok: promoteResult.ok },
        meta: { orchestration: { final_provider: "system", latency_ms: 0 } },
        orchestration: { final_provider: "system" },
        bandit: {},
        derived: { detected_task: null, execution_strategy: "source_promote", selected_providers: [], verifier_providers: [], fallback_providers: [], parallel_providers: [], winner: "system", runner_up: null, conflict_count: 0, executed_provider_count: 0, latency_ms: 0, estimated_cost_usd: 0, fallback_used: false, judge_confidence: 1 },
        internal: { task: "source_promote", route: null, judge: null, conflicts: [], conflict_count: 0, executed_providers: [], execution_policy: { max_parallel: 0, cost_gate_enabled: false, max_total_estimated_cost_usd: 0, prefer_fast_fallback: false }, escalation: { pre_routing_use_pro: false, post_eval_triggered: false }, scoreboard: {} },
        result: null
      }
      writeSse(res, { type: "done", payload: donePayload })
      res.end?.()
      return
    }

    // 이미지/PDF 첨부 파일 → 직접 분석 (orchestra 우회)
    const _attached = normalizedInput?.attached_file
    const _attachedType = String(_attached?.type ?? "")
    if (_attached && (_attachedType.startsWith("image/") || _attachedType === "application/pdf")) {
      const userText = safeString(normalizedInput?.message) || (_attachedType === "application/pdf" ? "이 PDF를 분석해줘" : "이 이미지를 분석해줘")
      const visionText = _attachedType === "application/pdf"
        ? await analyzePdfWithGemini(_attached, userText)
        : await analyzeImageWithVision(_attached, userText)
      const visionChunks = visionText.split(/(\s+)/).filter((p) => p.length > 0)
      for (const chunk of visionChunks) {
        if (signal.aborted) break
        writeSse(res, { type: "chunk", content: chunk })
        await sleep(18)
      }
      const donePayload = {
        ok: true,
        answer: { provider: "openai", text: visionText, ok: true },
        meta: { orchestration: { final_provider: "openai", latency_ms: 0 } },
        orchestration: { final_provider: "openai" },
        bandit: {},
        derived: { detected_task: "dialogue", execution_strategy: "vision_analyze", selected_providers: ["openai"], verifier_providers: [], fallback_providers: [], parallel_providers: [], winner: "openai", runner_up: null, conflict_count: 0, executed_provider_count: 1, latency_ms: 0, estimated_cost_usd: 0, fallback_used: false, judge_confidence: 1 },
        internal: { task: "vision_analyze", route: null, judge: null, conflicts: [], conflict_count: 0, executed_providers: [], execution_policy: { max_parallel: 1, cost_gate_enabled: false, max_total_estimated_cost_usd: 0, prefer_fast_fallback: false }, escalation: { pre_routing_use_pro: false, post_eval_triggered: false }, scoreboard: {} },
        result: null
      }
      writeSse(res, { type: "done", payload: donePayload })
      res.end?.()
      return
    }

    const reused = tryMemoryReuse(normalizedInput)

    if (reused) {
      const text = safeString(reused.answer?.text)
      const chunks = text.length > 0 ? text.split(/(\s+)/).filter((p) => p.length > 0) : []

      for (const chunk of chunks) {
        if (signal.aborted) break
        writeSse(res, { type: "chunk", content: chunk })
        await sleep(12)
      }

      writeSse(res, { type: "done", payload: reused })
      res.end?.()
      return
    }

    const result = await executeOrchestra(effectiveInput, async (event: any) => {
      if (signal.aborted) return
      // runtime이 emit하는 모든 이벤트를 SSE로 직접 전달
      writeSse(res, event)
    })

    if (signal.aborted) {
      res.end?.()
      return
    }

    try {
      persistRuntimeMemory(normalizedInput, result)
    } catch {}

    const threadId = safeString(normalizedInput?.thread_id)
    const projectId = safeString(normalizedInput?.project_id) || "chat_project"

    const _result = result as any
    if (_result.ok !== false && _result.summary && projectId) {
      try {
        const now = Date.now()
        const dateStr = new Date(now).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })
        addProjectSourceAsset(projectId, {
          id: `session_summary_${now}`,
          thread_id: threadId || null,
          type: "thread_summary",
          title: `세션 요약 — ${dateStr}`,
          content: _result.summary,
          status: "confirmed",
          created_at: now,
          updated_at: now
        })
      } catch {}
    }

    const payload = buildChatPayload(result)
    writeSse(res, { type: "done", payload })

    res.end?.()

    try {
      await logBenchmark(buildBenchmarkPayload(result, normalizedInput))
    } catch {}
  } catch (error: any) {
    if (signal.aborted) {
      res.end?.()
      return
    }

    writeSse(res, {
      type: "error",
      error: String(error?.message ?? "unknown_error")
    })

    res.end?.()

    try {
      await logBenchmark(buildErrorBenchmarkPayload(normalizedInput, error, startedAt))
    } catch {}
  }
}

export const chatRoute = {
  path: "/api/chat",
  handler: runChatRoute
}

export const chatStreamRoute = {
  path: "/api/chat/stream",
  handler: runChatStreamRoute
}
