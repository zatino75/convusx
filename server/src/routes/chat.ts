import { executeOrchestra } from "../orchestra/runtime.js"
import { logBenchmark } from "../orchestra/benchmark.js"

type RouteRequest = {
  body?: any
}

type RouteResponse = {
  json: (payload: unknown) => unknown
  writeHead?: (statusCode: number, headers: Record<string, string>) => void
  write?: (chunk: string) => void
  end?: () => void
}

function safeArray(value: any): any[] {
  return Array.isArray(value) ? value : []
}

function safeObject(value: any): Record<string, any> {
  return value && typeof value === "object" ? value : {}
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

function writeSse(res: RouteResponse, payload: any) {
  res.write?.(`data: ${JSON.stringify(payload)}\n\n`)
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
    const result = await executeOrchestra(normalizedInput)

    try {
      await logBenchmark(buildBenchmarkPayload(result, normalizedInput))
    } catch {}

    return res.json(buildChatPayload(result))
  } catch (error: any) {
    try {
      await logBenchmark(buildErrorBenchmarkPayload(normalizedInput, error, startedAt))
    } catch {}

    return res.json({
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

    const result = await executeOrchestra(normalizedInput)
    const payload = buildChatPayload(result)
    const text = String(payload?.answer?.text ?? "")
    const chunks = text.length > 0 ? text.split(/(\s+)/).filter((part) => part.length > 0) : []

    for (const chunk of chunks) {
      writeSse(res, {
        type: "chunk",
        content: chunk
      })
      await sleep(18)
    }

    writeSse(res, {
      type: "done",
      payload
    })

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
