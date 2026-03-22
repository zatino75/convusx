import { readModelScoreboard } from "./modelScoreboard.js"

type DispatchInput = {
  provider: string
  task?: string
  mode?: string
  input?: any
  message?: string
  messages?: Array<{ role?: string; content?: any }>
  onToken?: (chunk: string, meta?: any) => void | Promise<void>
  onEvent?: (event: any) => void | Promise<void>
}

type AdapterModule = Record<string, any>

type AdapterResolver = {
  label: string
  modulePath: string
}

type AdapterCallable = (payload: any) => Promise<any>

type OrxTask =
  | "dialogue"
  | "reasoning"
  | "research"
  | "code"
  | "evidence"

const REGISTRY: Record<string, AdapterResolver[]> = {
  openai: [
    { label: "src/adapters/openai.ts", modulePath: "../adapters/openai.js" }
  ],
  claude: [
    { label: "src/adapters/claude.ts", modulePath: "../adapters/claude.js" }
  ],
  gemini: [
    { label: "src/adapters/gemini.ts", modulePath: "../adapters/gemini.js" }
  ],
  perplexity: [
    { label: "src/adapters/perplexity.ts", modulePath: "../adapters/perplexity.js" }
  ]
}

const MODEL_PRICING_USD_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  "gpt-5.4": { input: 0.003, output: 0.009 },
  "gpt-5.4-pro": { input: 0.015, output: 0.12 },
  "gpt-5.3-codex": { input: 0.006, output: 0.018 },

  "claude-sonnet-4-6": { input: 0.0035, output: 0.018 },

  "gemini-3.1-pro-preview": { input: 0.00125, output: 0.005 },

  "sonar-reasoning-pro": { input: 0.002, output: 0.008 },
  "sonar-pro": { input: 0.001, output: 0.004 }
}

function round(value: number, digits = 8) {
  return Number(Number(value || 0).toFixed(digits))
}

function safeNumber(value: any) {
  const v = Number(value ?? 0)
  return Number.isFinite(v) ? v : 0
}

function normalizeTask(task: any): OrxTask {
  const value = String(task ?? "").trim().toLowerCase()

  if (value.includes("code")) return "code"
  if (value.includes("research")) return "research"
  if (value.includes("reasoning")) return "reasoning"
  if (value.includes("evidence")) return "evidence"

  return "dialogue"
}

function normalizeProvider(provider: any): string {
  const value = String(provider ?? "").trim().toLowerCase()

  if (value === "openai") return "openai"
  if (value === "claude") return "claude"
  if (value === "gemini") return "gemini"
  if (value === "perplexity") return "perplexity"

  return "openai"
}

async function tryImportModule(modulePath: string): Promise<AdapterModule | null> {
  try {
    const mod = await import(modulePath)
    return mod as AdapterModule
  } catch {
    return null
  }
}

function normalizeMessages(input: DispatchInput): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const rawMessages =
    Array.isArray(input?.messages) && input.messages.length > 0
      ? input.messages
      : Array.isArray(input?.input?.messages) && input.input.messages.length > 0
        ? input.input.messages
        : null

  if (rawMessages && rawMessages.length > 0) {
    return rawMessages.map((m: any) => {
      const rawRole = String(m?.role ?? "user").trim().toLowerCase()
      const role =
        rawRole === "system"
          ? "system"
          : rawRole === "assistant"
            ? "assistant"
            : "user"

      let content = ""

      if (typeof m?.content === "string") {
        content = m.content
      } else if (Array.isArray(m?.content)) {
        content = m.content
          .map((x: any) => {
            if (typeof x === "string") return x
            if (typeof x?.text === "string") return x.text
            return ""
          })
          .join("\n")
          .trim()
      } else {
        content = JSON.stringify(m?.content ?? "")
      }

      return { role, content }
    })
  }

  const fallbackMessage =
    typeof input?.message === "string" && input.message.trim().length > 0
      ? input.message
      : typeof input?.input?.message === "string" && input.input.message.trim().length > 0
        ? input.input.message
        : typeof input?.input === "string"
          ? input.input
          : ""

  return [
    {
      role: "user",
      content: fallbackMessage
    }
  ]
}

function modelTierScore(node: any) {
  const recentRuns = safeNumber(node?.recent_runs)
  const runs = safeNumber(node?.runs)
  const recentWinRate = safeNumber(node?.recent_win_rate)
  const recentSuccessRate = safeNumber(node?.recent_success_rate)
  const freshnessScore = safeNumber(node?.freshness_score)
  const winRate = safeNumber(node?.win_rate)
  const successRate = safeNumber(node?.success_rate)
  const costEfficiency = safeNumber(node?.cost_efficiency)
  const avgCostUsd = safeNumber(node?.avg_cost_usd)

  const signalScore = Math.min(1, Math.max(recentRuns / 6, runs / 12))
  const costPenalty = Math.min(1, avgCostUsd / 0.03)

  return (
    recentWinRate * 0.26 +
    recentSuccessRate * 0.24 +
    freshnessScore * 0.16 +
    winRate * 0.12 +
    successRate * 0.10 +
    costEfficiency * 0.07 +
    signalScore * 0.10 -
    costPenalty * 0.05
  )
}

function getModelNode(board: any, provider: string, task: string, model: string) {
  return board?.[provider]?.[task]?.[model] ?? null
}

function shouldPromoteByBoard(params: {
  board: any
  provider: string
  task: string
  currentModel: string
  nextModel: string
}) {
  const currentNode = getModelNode(params.board, params.provider, params.task, params.currentModel)
  const nextNode = getModelNode(params.board, params.provider, params.task, params.nextModel)

  const nextHasSignal =
    safeNumber(nextNode?.recent_runs) >= 3 ||
    safeNumber(nextNode?.runs) >= 5

  if (!nextHasSignal) {
    return false
  }

  const currentScore = modelTierScore(currentNode)
  const nextScore = modelTierScore(nextNode)
  const scoreGap = nextScore - currentScore

  const currentWeak =
    safeNumber(currentNode?.recent_success_rate) < 0.45 ||
    safeNumber(currentNode?.recent_win_rate) < 0.35

  const nextStrong =
    safeNumber(nextNode?.recent_success_rate) >= 0.7 &&
    safeNumber(nextNode?.recent_win_rate) >= 0.6

  return scoreGap >= 0.12 || (currentWeak && nextStrong)
}

function shouldForceOpenAIPro(params: {
  task: OrxTask
  input?: any
}) {
  const input = params.input ?? {}
  const routing = input?.metadata?.routing ?? {}
  const escalation = routing?.escalation ?? {}

  const explicitModel = String(input?.model ?? "").trim().toLowerCase()
  if (explicitModel === "gpt-5.4-pro") return true

  if (Boolean(input?.force_pro)) return true
  if (Boolean(input?.use_pro)) return true
  if (Boolean(input?.benchmark_mode)) return true
  if (Boolean(input?.deep_analysis)) return true
  if (Boolean(input?.deep_research)) return true
  if (Boolean(escalation?.use_pro)) return true

  return false
}

function pickTieredModel(params: {
  provider: string
  task: OrxTask
  input?: any
}) {
  const board = readModelScoreboard()

  if (params.provider === "openai") {
    if (params.task === "code") {
      return "gpt-5.3-codex"
    }

    if (shouldForceOpenAIPro(params)) {
      return "gpt-5.4-pro"
    }

    const currentModel = "gpt-5.4"
    const nextModel = "gpt-5.4-pro"

    const canPromote = shouldPromoteByBoard({
      board,
      provider: params.provider,
      task: params.task,
      currentModel,
      nextModel
    })

    if (canPromote && Boolean(params.input?.allow_auto_promote_pro)) {
      return "gpt-5.4-pro"
    }

    return "gpt-5.4"
  }

  if (params.provider === "gemini") {
    return "gemini-3.1-pro-preview"
  }

  if (params.provider === "claude") {
    return "claude-sonnet-4-6"
  }

  return null
}

function defaultModel(provider: string, task: OrxTask, input?: any): string {
  if (provider === "openai") {
    return pickTieredModel({ provider, task, input }) ?? "gpt-5.4"
  }

  if (provider === "claude") {
    return pickTieredModel({ provider, task, input }) ?? "claude-sonnet-4-6"
  }

  if (provider === "gemini") {
    return pickTieredModel({ provider, task, input }) ?? "gemini-3.1-pro-preview"
  }

  if (provider === "perplexity") {
    if (task === "research" || task === "reasoning") return "sonar-reasoning-pro"
    return "sonar-pro"
  }

  return "gpt-5.4"
}

function defaultTemperature(task: OrxTask): number {
  if (task === "dialogue") return 0.2
  if (task === "research") return 0.1
  if (task === "reasoning") return 0.1
  if (task === "code") return 0
  return 0.1
}

function defaultMaxTokens(task: OrxTask, provider: string, input?: any): number {
  const explicitModel = String(input?.model ?? "").trim().toLowerCase()

  if (provider === "openai" && (task === "research" || task === "reasoning")) {
    if (explicitModel === "gpt-5.4-pro") {
      return task === "research" ? 1800 : 1600
    }

    return task === "research" ? 2200 : 1800
  }

  if (task === "dialogue") return 1200
  if (task === "reasoning") return 2200
  if (task === "research") return 3000
  if (task === "code") return 2800
  return 1400
}

function buildTimeoutMs(provider: string, task: OrxTask, input?: any): number {
  const explicitModel = String(input?.model ?? "").trim().toLowerCase()

  if (provider === "openai") {
    if (explicitModel === "gpt-5.4-pro") {
      if (task === "research") return 90000
      if (task === "reasoning") return 80000
      return 70000
    }

    if (task === "research") return 70000
    if (task === "reasoning") return 65000
    if (task === "code") return 60000
    return 45000
  }

  if (provider === "gemini") {
    if (task === "research") return 55000
    if (task === "reasoning") return 50000
    if (task === "code") return 50000
    return 45000
  }

  if (provider === "claude") {
    if (task === "research") return 70000
    if (task === "reasoning") return 65000
    if (task === "code") return 60000
    return 45000
  }

  if (task === "research") return 70000
  if (task === "code") return 60000
  if (task === "reasoning") return 60000
  return 45000
}

function buildMaxRetries(provider: string, task: OrxTask, input?: any): number {
  const explicitModel = String(input?.model ?? "").trim().toLowerCase()

  if (provider === "openai") {
    if (explicitModel === "gpt-5.4-pro" && (task === "research" || task === "reasoning")) {
      return 0
    }

    if (task === "research" || task === "reasoning") {
      return 0
    }

    return 1
  }

  if (provider === "gemini") {
    if (task === "research" || task === "reasoning") return 1
    return 1
  }

  return 1
}

function buildTaskSystemPrompt(task: OrxTask, provider: string): string {
  if (task === "dialogue") {
    return [
      "Respond directly and concretely.",
      "Do not ask unnecessary follow-up questions unless essential information is truly missing.",
      "Do not reply with meta acknowledgements like 'Understood' or 'I can help with that'.",
      "Give a useful answer immediately.",
      "Be practical, concise, and commercially useful.",
      "Avoid generic filler."
    ].join(" ")
  }

  if (task === "reasoning") {
    const base = [
      "Solve the request directly.",
      "Provide structured reasoning with explicit trade-offs.",
      "Do not stay neutral when a choice is needed.",
      "Do not ask the user to provide a format or more structure unless the task is impossible without it.",
      "Do not output meta acknowledgements.",
      "End with one clear final recommendation or conclusion."
    ]

    if (provider === "claude") {
      base.push(
        "Act as a verifier-quality reasoner.",
        "State the strongest counterargument, then still choose one final position.",
        "Do not output placeholder text like 'insufficient output'.",
        "Do not refuse to decide."
      )
    }

    return base.join(" ")
  }

  if (task === "research") {
    const base = [
      "Answer the user's request directly with substantive analysis.",
      "Do not respond with clarifying templates, meta acknowledgements, or statements about how you will answer.",
      "Do not say things like 'Understood', 'If you want, send', 'What decision are you trying to make', or 'You can use this format'.",
      "Treat the user prompt as already sufficient unless it is literally impossible to answer.",
      "Produce a real market analysis, comparison, evaluation, or recommendation immediately.",
      "Use a clear structure with sections, concrete points, trade-offs, and a final recommendation.",
      "Do not end with a weak placeholder like 'Final Recommendation: market structure'.",
      "Do not output notes about what you plan to do.",
      "Prefer complete, high-density output over short generic output."
    ]

    if (provider === "claude") {
      base.push(
        "Your job is not to be vague.",
        "You must provide a substantive second-opinion style answer with risks, objections, and a final choice.",
        "Do not output placeholder text like 'insufficient output'.",
        "If the prompt asks for one choice, choose one."
      )
    }

    return base.join(" ")
  }

  if (task === "code") {
    return [
      "Provide production-usable code or architecture guidance.",
      "Be concrete and implementation-oriented.",
      "Do not output placeholders unless strictly necessary.",
      "Do not output meta acknowledgements.",
      "Prefer robust, maintainable solutions."
    ].join(" ")
  }

  return "Respond directly."
}

function prependSystemMessage(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  task: OrxTask,
  provider: string
) {
  const systemPrompt = buildTaskSystemPrompt(task, provider)

  if (!systemPrompt.trim()) {
    return messages
  }

  const existingSystem = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n")
    .trim()

  if (existingSystem.length > 0) {
    return [
      {
        role: "system",
        content: systemPrompt + "\n\n" + existingSystem
      },
      ...messages.filter((m) => m.role !== "system")
    ]
  }

  return [
    {
      role: "system",
      content: systemPrompt
    },
    ...messages
  ]
}

function buildPayload(input: DispatchInput) {
  const provider = normalizeProvider(input?.provider)
  const task = normalizeTask(input?.task ?? input?.input?.task)
  const messages = prependSystemMessage(normalizeMessages(input), task, provider)

  return {
    provider,
    task,
    mode: String(input?.mode ?? input?.input?.mode ?? "runtime_orchestra"),
    model:
      typeof input?.input?.model === "string" && input.input.model.trim().length > 0
        ? input.input.model
        : defaultModel(provider, task, input?.input),
    messages,
    temperature:
      typeof input?.input?.temperature === "number"
        ? input.input.temperature
        : defaultTemperature(task),
    max_tokens:
      typeof input?.input?.max_tokens === "number"
        ? input.input.max_tokens
        : defaultMaxTokens(task, provider, input?.input),
    timeout_ms:
      typeof input?.input?.timeout_ms === "number"
        ? input.input.timeout_ms
        : buildTimeoutMs(provider, task, input?.input),
    max_retries:
      typeof input?.input?.max_retries === "number"
        ? input.input.max_retries
        : buildMaxRetries(provider, task, input?.input),
    metadata: {
      ...(input?.input?.metadata ?? {}),
      normalized_task: task
    },
    thread_id: input?.input?.thread_id ?? "default",
    project_id: input?.input?.project_id ?? "default",
    raw_input: input?.input ?? {
      message: input?.message ?? "",
      task: input?.task ?? task
    }
  }
}

function responseText(result: any): string {
  if (typeof result?.answer === "string" && result.answer.trim().length > 0) return result.answer
  if (typeof result?.text === "string" && result.text.trim().length > 0) return result.text
  if (typeof result?.output_text === "string" && result.output_text.trim().length > 0) return result.output_text
  if (typeof result?.answer_text === "string" && result.answer_text.trim().length > 0) return result.answer_text
  return ""
}

function detectErrorCode(result: any): string | null {
  if (typeof result?.error?.code === "string" && result.error.code.trim().length > 0) {
    return result.error.code
  }

  if (Array.isArray(result?.attempts) && result.attempts.length > 0) {
    const last = result.attempts[result.attempts.length - 1]
    if (typeof last?.error_code === "string" && last.error_code.trim().length > 0) {
      return last.error_code
    }
  }

  return null
}

function isMeaninglessText(answer: string): boolean {
  const t = String(answer ?? "").trim().toLowerCase()

  if (!t) return true
  if (t === "insufficient output.") return true
  if (t === "final recommendation: insufficient output.") return true
  if (t.includes("what decision are you trying to make")) return true
  if (t.includes("if you want, send")) return true
  if (t.includes("you can use this format")) return true
  if (t.startsWith("understood")) return true

  return false
}

function isSuccessfulResult(result: any): boolean {
  const answer = responseText(result)
  const errorCode = detectErrorCode(result)

  if (errorCode) return false
  if (typeof result?.error?.message === "string" && result.error.message.trim().length > 0) return false
  if (answer.trim().length === 0) return false
  if (isMeaninglessText(answer)) return false

  return true
}

function buildFallbackResponse(input: DispatchInput, reason?: string, moduleLabel?: string) {
  return {
    provider: normalizeProvider(input?.provider),
    ok: false,
    answer_text: "",
    error_code: reason ?? "not_found",
    text: "",
    step_type: normalizeTask(input?.task),
    mode: String(input?.mode ?? "runtime_orchestra"),
    adapter_used: "fallback",
    adapter_reason: reason ?? "not_found",
    adapter_module: moduleLabel ?? null,
    model: typeof input?.input?.model === "string" ? input.input.model : null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      estimated_cost_usd: 0
    },
    raw: null
  }
}

function directCallableFromModule(mod: AdapterModule | null): AdapterCallable | null {
  if (!mod) return null

  if (typeof mod.generate === "function") return mod.generate
  if (mod.openaiAdapter && typeof mod.openaiAdapter.generate === "function") {
    return mod.openaiAdapter.generate.bind(mod.openaiAdapter)
  }
  if (mod.claudeAdapter && typeof mod.claudeAdapter.generate === "function") {
    return mod.claudeAdapter.generate.bind(mod.claudeAdapter)
  }
  if (mod.geminiAdapter && typeof mod.geminiAdapter.generate === "function") {
    return mod.geminiAdapter.generate.bind(mod.geminiAdapter)
  }
  if (mod.default && typeof mod.default.generate === "function") {
    return mod.default.generate.bind(mod.default)
  }
  if (typeof mod.default === "function") return mod.default

  return null
}

function factoryCallableFromModule(mod: AdapterModule | null): AdapterCallable | null {
  if (!mod) return null

  const factoryNames = [
    "makeOpenAIAdapter",
    "makeClaudeAdapter",
    "makeGeminiAdapter",
    "makePerplexityAdapter"
  ]

  for (const name of factoryNames) {
    if (typeof mod[name] !== "function") continue

    const instance = mod[name]()
    if (instance && typeof instance.generate === "function") {
      return instance.generate.bind(instance)
    }
  }

  return null
}

function pickCallable(mod: AdapterModule | null): AdapterCallable | null {
  const direct = directCallableFromModule(mod)
  if (direct) return direct

  const factory = factoryCallableFromModule(mod)
  if (factory) return factory

  return null
}

function estimateTokensFromText(text: string) {
  const chars = String(text ?? "").length
  return Math.max(0, Math.ceil(chars / 4))
}

function estimateCostUsd(model: string | null, inputTokens: number, outputTokens: number) {
  if (!model) return 0

  const pricing = MODEL_PRICING_USD_PER_1K_TOKENS[model]
  if (!pricing) return 0

  const inputCost = (Math.max(0, inputTokens) / 1000) * pricing.input
  const outputCost = (Math.max(0, outputTokens) / 1000) * pricing.output

  return round(inputCost + outputCost, 8)
}

function normalizeUsage(result: any, payload: any, answerText: string, model: string | null) {
  const rawUsage =
    result?.usage ??
    result?.raw?.usage ??
    result?.meta?.usage ??
    {}

  const inputTokens =
    Number(rawUsage?.input_tokens ??
    rawUsage?.prompt_tokens ??
    rawUsage?.promptTokens ??
    rawUsage?.inputTokenCount ??
    estimateTokensFromText((payload?.messages ?? []).map((m: any) => m.content).join("\n\n")))

  const outputTokens =
    Number(rawUsage?.output_tokens ??
    rawUsage?.completion_tokens ??
    rawUsage?.completionTokens ??
    rawUsage?.outputTokenCount ??
    rawUsage?.candidatesTokenCount ??
    estimateTokensFromText(answerText))

  const totalTokens =
    Number(rawUsage?.total_tokens ??
    rawUsage?.totalTokens ??
    rawUsage?.totalTokenCount ??
    (inputTokens + outputTokens))

  const estimatedCostUsd =
    Number(rawUsage?.estimated_cost_usd ?? rawUsage?.estimatedCostUsd ?? 0) > 0
      ? Number(rawUsage?.estimated_cost_usd ?? rawUsage?.estimatedCostUsd ?? 0)
      : estimateCostUsd(model, inputTokens, outputTokens)

  return {
    input_tokens: Math.max(0, Math.round(inputTokens)),
    output_tokens: Math.max(0, Math.round(outputTokens)),
    total_tokens: Math.max(0, Math.round(totalTokens)),
    estimated_cost_usd: round(Math.max(0, estimatedCostUsd), 8)
  }
}

function detectModel(result: any, payload: any): string | null {
  if (typeof result?.model === "string" && result.model.trim().length > 0) return result.model
  if (typeof result?.raw?.model === "string" && result.raw.model.trim().length > 0) return result.raw.model
  if (typeof payload?.model === "string" && payload.model.trim().length > 0) return payload.model
  return null
}

async function emitAdapterEvent(
  input: DispatchInput,
  event: any
) {
  if (typeof input?.onEvent === "function") {
    await input.onEvent(event)
  }
}

async function emitAdapterToken(
  input: DispatchInput,
  chunk: string,
  meta?: any
) {
  if (typeof input?.onToken === "function") {
    await input.onToken(chunk, meta)
  }
}

function buildStreamingPayload(input: DispatchInput, payload: any) {
  return {
    ...payload,
    stream: Boolean(input?.onToken || input?.onEvent),
    onToken: async (chunk: string, meta?: any) => {
      await emitAdapterToken(input, chunk, meta)
    },
    onEvent: async (event: any) => {
      await emitAdapterEvent(input, event)
    }
  }
}

function mergeStreamedText(result: any, streamedText: string) {
  const existingText = responseText(result)
  if (existingText.trim().length > 0) return existingText
  return streamedText
}

export async function dispatchProvider(input: DispatchInput): Promise<any> {
  const provider = normalizeProvider(input?.provider)
  const resolvers = REGISTRY[provider] ?? []
  const payload = buildPayload({
    ...input,
    provider
  })

  if (resolvers.length === 0) {
    return buildFallbackResponse(input, "registry_not_found")
  }

  for (const resolver of resolvers) {
    const mod = await tryImportModule(resolver.modulePath)
    if (!mod) continue

    const fn = pickCallable(mod)
    if (!fn) continue

    try {
      const startedAt = Date.now()
      let streamedText = ""

      const streamingPayload = buildStreamingPayload(input, payload)
      const result = await fn({
        ...streamingPayload,
        onToken: async (chunk: string, meta?: any) => {
          const safeChunk = typeof chunk === "string" ? chunk : String(chunk ?? "")
          if (safeChunk.length > 0) {
            streamedText += safeChunk
          }
          await emitAdapterToken(input, safeChunk, meta)
        },
        onEvent: async (event: any) => {
          await emitAdapterEvent(input, event)
        }
      })
      const endedAt = Date.now()

      const answerText = mergeStreamedText(result, streamedText)
      const ok = isSuccessfulResult({
        ...result,
        answer_text: answerText,
        text: answerText
      })
      const errorCode = detectErrorCode(result) ?? (ok ? null : "insufficient_output")
      const model = detectModel(result, payload)
      const usage = normalizeUsage(
        result,
        payload,
        answerText,
        model
      )

      return {
        provider,
        ok,
        answer_text: answerText,
        error_code: errorCode,
        text: answerText.trim().length > 0 ? answerText : "",
        step_type: payload.task,
        mode: payload.mode,
        adapter_used: "real",
        adapter_module: resolver.label,
        model,
        latency_ms: endedAt - startedAt,
        usage,
        raw: result,
        streaming_supported:
          streamedText.length > 0 ||
          Boolean(result?.streaming_supported) ||
          Boolean(result?.meta?.streaming_supported)
      }
    } catch (error: any) {
      return buildFallbackResponse(
        input,
        "call_failed:" + String(error?.message ?? "unknown"),
        resolver.label
      )
    }
  }

  return buildFallbackResponse(input, "module_not_found")
}

export const runAdapter = dispatchProvider
export const dispatchAdapter = dispatchProvider
export const executeAdapter = dispatchProvider
