import { executeOrchestra } from "../orchestra/runtime.js"
import { logBenchmark } from "../orchestra/benchmark.js"
import { appendProjectMemory, getLatestProjectContext, findPastWinner } from "../memory/projectMemory.js"
import { upsertThreadMemory, findSimilarQuery } from "../memory/threadMemory.js"

type RouteRequest = {
  body?: any
}

type RouteResponse = {
  json?: (payload: unknown) => unknown
  writeHead?: (statusCode: number, headers: Record<string, string>) => void
  write?: (chunk: string) => void
  end?: () => void
}

const REUSE_SIMILARITY_THRESHOLD = 0.72
const REUSE_PAST_WINNER_CONFIDENCE = 0.85

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

  return {
    ok: true,
    answer: result?.final_answer ?? {
      provider: null,
      text: "",
      ok: false
    },
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

  const decisions = uniqueStrings([
    safeString(winnerReason?.rationale),
    safeString(selectionTrace?.judge_rationale),
    ...safeArray(selectionTrace?.selected_reasons),
    ...judgeScores.flatMap((row: any) => safeArray(row?.reasons))
  ])

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

  try {
    const reused = tryMemoryReuse(normalizedInput)
    if (reused) {
      return res.json?.(reused)
    }

    const result = await executeOrchestra(normalizedInput)

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
  const normalizedInput = {
    ...input,
    mode: input?.mode ?? "runtime_orchestra",
    thread_id: input?.thread_id ?? "chat_thread",
    project_id: input?.project_id ?? "chat_project"
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

    const reused = tryMemoryReuse(normalizedInput)

    if (reused) {
      const text = safeString(reused.answer?.text)
      const chunks = text.length > 0 ? text.split(/(\s+)/).filter((p) => p.length > 0) : []

      for (const chunk of chunks) {
        writeSse(res, { type: "chunk", content: chunk })
        await sleep(12)
      }

      writeSse(res, { type: "done", payload: reused })
      res.end?.()
      return
    }

    const result = await executeOrchestra(normalizedInput)

    try {
      persistRuntimeMemory(normalizedInput, result)
    } catch {}

    const payload = buildChatPayload(result)
    const text = String(payload?.answer?.text ?? "")
    const chunks = text.length > 0 ? text.split(/(\s+)/).filter((part) => part.length > 0) : []

    for (const chunk of chunks) {
      writeSse(res, { type: "chunk", content: chunk })
      await sleep(18)
    }

    writeSse(res, { type: "done", payload })

    res.end?.()

    try {
      await logBenchmark(buildBenchmarkPayload(result, normalizedInput))
    } catch {}
  } catch (error: any) {
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