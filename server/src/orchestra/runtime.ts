import { resolveAdaptiveRoute } from "./adaptiveRouter.js"
import * as adapterDispatcher from "./adapterDispatcher.js"
import { judge } from "./judge.js"
import { detectTaskType } from "./planner.js"

const runAdapter = adapterDispatcher.runAdapter

function normalizeProvider(v: any) {
  return String(v ?? "").trim().toLowerCase()
}

function hasUsableAnswer(v: any) {
  if (!v || v.ok !== true) return false
  const t = String(v.answer_text ?? "").trim()
  return t.length > 0
}

function modelHintFor(provider: string, task: string) {
  const normalizedProvider = normalizeProvider(provider)
  const normalizedTask = String(task ?? "").trim().toLowerCase()

  if (normalizedProvider === "claude") {
    return "claude-sonnet-4-6"
  }

  if (normalizedProvider === "gemini") {
    return "gemini-3.1-pro-preview"
  }

  if (normalizedProvider === "openai") {
    if (normalizedTask === "code") return "gpt-5.3-codex"
    return "gpt-5.4"
  }

  if (normalizedProvider === "perplexity") {
    if (normalizedTask === "research" || normalizedTask === "reasoning") {
      return "sonar-reasoning-pro"
    }
    return "sonar-pro"
  }

  return null
}

function providerAwareTimeoutMs(provider: string, requestedTimeoutMs: number, role: "primary" | "secondary", task: string) {
  const normalizedProvider = normalizeProvider(provider)
  const base = Number(requestedTimeoutMs ?? 0)

  if (normalizedProvider === "openai") {
    if (task === "research") return Math.max(base, 70000)
    if (task === "reasoning") return Math.max(base, 60000)
    if (task === "code") return Math.max(base, 70000)
    return Math.max(base, 45000)
  }

  if (normalizedProvider === "claude") {
    if (role === "secondary") {
      return Math.max(base, 70000)
    }
    return Math.max(base, 70000)
  }

  if (normalizedProvider === "gemini" && (task === "research" || task === "reasoning")) {
    return Math.max(base, 60000)
  }

  return base
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  provider: string,
  task: string,
  modelHint?: string | null
): Promise<T | any> {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise
  }

  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          provider,
          ok: false,
          answer_text: "",
          error_code: "timeout",
          adapter_used: "timeout",
          latency_ms: timeoutMs,
          model: modelHint ?? modelHintFor(provider, task),
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
            estimated_cost_usd: 0
          }
        })
      }, timeoutMs)
    })
  ])
}

function shouldEarlyStop(params: {
  task: string
  primaryResult: any
  verifierProviders: string[]
  executionPolicy: any
}) {
  if (!params?.executionPolicy?.early_stop_enabled) return false
  if (params?.task !== "dialogue") return false
  if (Array.isArray(params?.verifierProviders) && params.verifierProviders.length > 0) return false
  return hasUsableAnswer(params?.primaryResult)
}

function buildPatchedRoute(route: any, executions: Array<{ provider: string; result: any }>, finalAnswer: any) {
  const selectedProviders = Array.isArray(route?.selected_providers) ? route.selected_providers : []
  const verifierProviders = Array.isArray(route?.verifier_providers) ? route.verifier_providers : []
  const optionalProviders = Array.isArray(route?.optional_providers) ? route.optional_providers : []

  const successfulProviders = executions
    .filter((x) => hasUsableAnswer(x.result))
    .map((x) => x.provider)

  return {
    ...route,
    selected_providers: selectedProviders,
    verifier_providers: verifierProviders,
    optional_providers: optionalProviders,
    provider_chain: successfulProviders,
    fallback_used:
      successfulProviders.length > 0 &&
      typeof finalAnswer?.provider === "string" &&
      selectedProviders.length > 0 &&
      finalAnswer.provider !== selectedProviders[0]
  }
}

function buildExecutionStats(executed: Array<{ provider: string; result: any }>) {
  const rows = executed.map((x) => ({
    provider: x.provider,
    success: Boolean(x?.result?.ok),
    latency_ms: Math.max(0, Number(x?.result?.latency_ms ?? 0)),
    error_code: typeof x?.result?.error_code === "string" ? x.result.error_code : null,
    model: typeof x?.result?.model === "string" ? x.result.model : null,
    usage: {
      input_tokens: Math.max(0, Number(x?.result?.usage?.input_tokens ?? 0)),
      output_tokens: Math.max(0, Number(x?.result?.usage?.output_tokens ?? 0)),
      total_tokens: Math.max(0, Number(x?.result?.usage?.total_tokens ?? 0)),
      estimated_cost_usd: Math.max(0, Number(x?.result?.usage?.estimated_cost_usd ?? 0))
    }
  }))

  const totals = rows.reduce(
    (acc, row) => {
      acc.input_tokens += row.usage.input_tokens
      acc.output_tokens += row.usage.output_tokens
      acc.total_tokens += row.usage.total_tokens
      acc.estimated_cost_usd += row.usage.estimated_cost_usd
      return acc
    },
    {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      estimated_cost_usd: 0
    }
  )

  return {
    providers: rows,
    totals: {
      input_tokens: totals.input_tokens,
      output_tokens: totals.output_tokens,
      total_tokens: totals.total_tokens,
      estimated_cost_usd: Number(totals.estimated_cost_usd.toFixed(8))
    }
  }
}

export async function executeOrchestra(params: any) {
  const inboundMessage =
    typeof params?.message === "string" && params.message.trim().length > 0
      ? params.message.trim()
      : Array.isArray(params?.messages)
        ? params.messages
            .filter((m: any) => String(m?.role ?? "user") === "user")
            .map((m: any) => String(m?.content ?? ""))
            .join("\n\n")
            .trim()
        : ""

  const task = params?.task ?? detectTaskType(inboundMessage)

  const route = resolveAdaptiveRoute({
    ...params,
    task,
    message: inboundMessage
  })

  const executionPolicy = route?.execution_policy ?? {}
  const primaryProvider = Array.isArray(route?.selected_providers) ? route.selected_providers[0] ?? null : null
  const verifierProvider = Array.isArray(route?.verifier_providers) ? route.verifier_providers[0] ?? null : null
  const optionalProviders = Array.isArray(route?.optional_providers)
    ? route.optional_providers.slice(0, Number(executionPolicy?.max_optional_to_execute ?? 0))
    : []

  const executed: Array<{ provider: string; result: any }> = []

  async function executeProvider(provider: string, timeoutMs: number, role: "primary" | "secondary") {
    const normalizedProvider = normalizeProvider(provider)
    const plannedModel = modelHintFor(normalizedProvider, task)
    const actualTimeoutMs = providerAwareTimeoutMs(normalizedProvider, timeoutMs, role, task)

    const promise = runAdapter({
      provider: normalizedProvider,
      task,
      mode: params?.mode ?? "runtime_orchestra",
      message: inboundMessage,
      messages: params?.messages,
      input: {
        ...(params ?? {}),
        provider: normalizedProvider,
        task,
        mode: params?.mode ?? "runtime_orchestra",
        message: inboundMessage,
        messages: params?.messages,
        model: plannedModel,
        metadata: {
          ...(params?.metadata ?? {}),
          routing: {
            task,
            primary_provider: primaryProvider,
            verifier_provider: verifierProvider,
            selected_primary: route?.routing_reason?.selected_primary?.provider ?? null,
            selected_by_freshness: Boolean(route?.routing_reason?.selected_by_freshness),
            selection_override_reason: route?.routing_reason?.selection_override_reason ?? null,
            conflict_risk: route?.conflict_risk ?? null,
            execution_strategy: route?.execution_strategy ?? null
          }
        }
      }
    })

    const result = await withTimeout(promise, actualTimeoutMs, normalizedProvider, task, plannedModel)
    executed.push({ provider: normalizedProvider, result })
    return result
  }

  let primaryResult: any = null
  let verifierResult: any = null

  if (primaryProvider) {
    primaryResult = await executeProvider(primaryProvider, Number(executionPolicy?.timeout_ms_primary ?? 45000), "primary")
  }

  if (!shouldEarlyStop({
    task,
    primaryResult,
    verifierProviders: route?.verifier_providers ?? [],
    executionPolicy
  })) {
    if (executionPolicy?.execute_verifier && verifierProvider) {
      verifierResult = await executeProvider(verifierProvider, Number(executionPolicy?.timeout_ms_secondary ?? 30000), "secondary")
    }

    if (executionPolicy?.execute_optional && optionalProviders.length > 0) {
      const secondaryTimeout = Number(executionPolicy?.timeout_ms_secondary ?? 30000)
      await Promise.all(
        optionalProviders.map((provider: string) => executeProvider(provider, secondaryTimeout, "secondary"))
      )
    }
  }

  const candidates = executed
    .filter((x) => hasUsableAnswer(x.result))
    .map((x) => ({
      provider: x.provider,
      answer_text: x.result.answer_text,
      raw: x.result
    }))

  let judged: any = null

  if (candidates.length === 1) {
    judged = {
      provider: candidates[0].provider,
      answer_text: candidates[0].answer_text,
      raw: candidates[0].raw ?? null,
      ok: true,
      meta: {
        judge_selected_provider: candidates[0].provider,
        judge_scores: [
          {
            provider: candidates[0].provider,
            score: 1,
            dimensions: {
              directness: 1,
              structure: 1,
              decisiveness: 1,
              task_fit: 1,
              risk: 1,
              reliability: 1,
              claims_density: 1,
              conflict_penalty: 1
            }
          }
        ],
        judge_rationale: "single_candidate",
        conflicts: [],
        claims: []
      }
    }
  }

  if (candidates.length > 1) {
    judged = await judge({
      candidates,
      task
    })
  }

  const finalAnswer = judged
    ? {
        provider: judged?.provider ?? primaryProvider,
        text: judged?.answer_text ?? "",
        ok: Boolean(judged?.ok)
      }
    : {
        provider: primaryResult?.provider ?? primaryProvider,
        text: String(primaryResult?.answer_text ?? ""),
        ok: Boolean(primaryResult?.ok)
      }

  const executionStats = buildExecutionStats(executed)

  const internalRationale = {
    route,
    judge: judged
      ? {
          selected_provider: judged?.meta?.judge_selected_provider ?? judged?.provider ?? null,
          scores: Array.isArray(judged?.meta?.judge_scores) ? judged.meta.judge_scores : [],
          rationale: judged?.meta?.judge_rationale ?? null
        }
      : {
          selected_provider: finalAnswer.provider ?? null,
          scores: [],
          rationale: "primary_only_fallback"
        },
    claims: judged && Array.isArray(judged?.meta?.claims) ? judged.meta.claims : [],
    conflicts: judged && Array.isArray(judged?.meta?.conflicts) ? judged.meta.conflicts : [],
    executed_providers: executed.map((x) => x.provider),
    usage: executionStats
  }

  const patchedRoute = buildPatchedRoute(route, executed, finalAnswer)

  return {
    final_answer: finalAnswer,
    internal_rationale: {
      ...internalRationale,
      route: patchedRoute
    },
    route: patchedRoute,
    primary: primaryResult,
    verifier: verifierResult,
    optional_results: executed
      .filter((x) => x.provider !== primaryProvider && x.provider !== verifierProvider)
      .map((x) => x.result),
    final: {
      provider: finalAnswer.provider,
      answer_text: finalAnswer.text,
      ok: finalAnswer.ok,
      meta: {
        judge_selected_provider: internalRationale.judge.selected_provider,
        judge_scores: internalRationale.judge.scores,
        judge_rationale: internalRationale.judge.rationale,
        conflicts: internalRationale.conflicts,
        claims: internalRationale.claims
      }
    },
    conflicts: internalRationale.conflicts,
    claims: internalRationale.claims,
    executed_providers: internalRationale.executed_providers
  }
}
