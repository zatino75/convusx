import { resolveAdaptiveRoute } from "./adaptiveRouter.js"
import * as adapterDispatcher from "./adapterDispatcher.js"
import * as judgeModule from "./judge.js"
import { runClaimsEngine } from "../claims/claimsEngine.js"
import { detectConflicts } from "../conflicts/conflictDetector.js"

function resolveAdapterFn(mod: any) {
  const candidates = [
    "runAdapter",
    "dispatchAdapter",
    "executeAdapter",
    "run",
    "dispatch",
    "execute",
    "default"
  ]

  for (const key of candidates) {
    if (typeof mod?.[key] === "function") {
      return mod[key]
    }
  }

  for (const key of Object.keys(mod ?? {})) {
    if (typeof mod?.[key] === "function") {
      return mod[key]
    }
  }

  return null
}

const runAdapter = resolveAdapterFn(adapterDispatcher)

const judge =
  (judgeModule as any).judge ??
  (judgeModule as any).runJudge ??
  (judgeModule as any).default ??
  null

function hasUsableAnswer(result: any): boolean {
  if (!result) return false
  if (result.ok !== true) return false

  const text =
    String(
      result?.answer_text ??
      result?.text ??
      result?.content ??
      result?.answer ??
      ""
    ).trim()

  return text.length > 0
}

function normalizeAdapterResult(provider: string, result: any, task: string, mode: string) {
  return {
    provider,
    ok: Boolean(result?.ok),
    answer_text: String(result?.answer_text ?? result?.text ?? result?.content ?? result?.answer ?? ""),
    error_code: result?.error_code ?? result?.raw?.error?.code ?? null,
    text: String(result?.text ?? result?.answer_text ?? result?.content ?? result?.answer ?? ""),
    step_type: String(result?.step_type ?? task),
    mode: String(result?.mode ?? mode),
    adapter_used: result?.adapter_used ?? "real",
    raw: result?.raw ?? result
  }
}

async function executeProvider(runAdapterFn: any, provider: string, params: {
  message: string
  task: string
  mode: string
}) {
  const raw = await runAdapterFn({
    provider,
    message: params.message,
    task: params.task
  })

  return normalizeAdapterResult(provider, raw, params.task, params.mode)
}

export async function executeOrchestra(params: {
  task: string
  message: string
  goal?: string
  mode?: string
}) {
  const mode = String(params.mode ?? "runtime_orchestra")

  const route = resolveAdaptiveRoute({
    task: params.task,
    mode,
    message: params.message,
    goal: params.goal
  })

  if (!runAdapter) {
    throw new Error("adapterDispatcher: NO callable function found")
  }

  const executionProviders = [
    route.primary_provider,
    ...route.verifier_providers,
    ...route.optional_providers
  ]
    .map((x) => String(x ?? "").trim().toLowerCase())
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)

  const executionResults: any[] = []

  for (const provider of executionProviders) {
    const result = await executeProvider(runAdapter, provider, {
      message: params.message,
      task: route.task,
      mode
    })

    executionResults.push(result)
  }

  const primary =
    executionResults.find((x) => x.provider === route.primary_provider) ??
    null

  const verifier =
    executionResults.find((x) => route.verifier_providers.includes(x.provider)) ??
    null

  const successfulResults = executionResults.filter((x) => hasUsableAnswer(x))

  const successfulPrimary =
    successfulResults.find((x) => x.provider === route.primary_provider) ??
    null

  const bestAvailable =
    successfulPrimary ??
    successfulResults[0] ??
    primary ??
    verifier ??
    executionResults[0] ??
    null

  // ===== CLAIMS =====
  const claimsInput = executionResults.map((item) => ({
    provider: item.provider,
    result: item
  }))

  const claimsResult = runClaimsEngine(claimsInput)

  // ===== CONFLICT DETECTOR 추가 =====
  const conflicts = detectConflicts(claimsResult.claims)

  let final = bestAvailable

  if (
    judge &&
    successfulResults.length >= 2 &&
    successfulPrimary
  ) {
    const verifierForJudge =
      successfulResults.find((x) => x.provider !== successfulPrimary.provider) ??
      null

    const judged = await judge({
      primary: successfulPrimary,
      verifier: verifierForJudge,
      claims: claimsResult.claims,
      claim_density: claimsResult.claim_density,
      evidence_strength: claimsResult.evidence_strength,
      conflicts, // 🔥 추가
      routing_reason: route.routing_reason,
      provider_chain: route.provider_chain
    })

    final = normalizeAdapterResult(
      judged?.provider ?? successfulPrimary.provider,
      judged,
      route.task,
      mode
    )
  }

  return {
    route,
    primary,
    verifier,
    executions: executionResults,
    claims: claimsResult,
    conflicts, // 🔥 반환 추가
    final
  }
}