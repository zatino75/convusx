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
  if (value.includes("reasoning")) return "reasoning"
  if (value.includes("evidence")) return "evidence"
  // 전용 파이프라인 task → research
  if (
    value.includes("research") ||
    value.includes("legal_review") ||
    value.includes("data_analysis") ||
    value.includes("finance_analysis") ||
    value.includes("product_development")
  ) return "research"

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

  // next 모델 데이터가 충분해야 승격 허용
  const nextHasSignal =
    safeNumber(nextNode?.recent_runs) >= 2 ||
    safeNumber(nextNode?.runs) >= 3

  if (!nextHasSignal) {
    return false
  }

  const currentScore = modelTierScore(currentNode)
  const nextScore = modelTierScore(nextNode)
  const scoreGap = nextScore - currentScore

  const currentWeak =
    safeNumber(currentNode?.recent_success_rate) < 0.50 ||
    safeNumber(currentNode?.recent_win_rate) < 0.40

  const nextStrong =
    safeNumber(nextNode?.recent_success_rate) >= 0.65 &&
    safeNumber(nextNode?.recent_win_rate) >= 0.55

  // scoreGap 0.08로 완화 (기존 0.12)
  return scoreGap >= 0.08 || (currentWeak && nextStrong)
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

    // scoreboard 데이터 기반 자동 승격 — allow_auto_promote_pro 조건 제거
    const canPromote = shouldPromoteByBoard({
      board,
      provider: params.provider,
      task: params.task,
      currentModel: "gpt-5.4",
      nextModel: "gpt-5.4-pro"
    })

    if (canPromote) {
      return "gpt-5.4-pro"
    }

    return "gpt-5.4"
  }

  if (params.provider === "gemini") {
    return "gemini-3.1-pro-preview"
  }

  if (params.provider === "claude") {
    if (shouldForceOpenAIPro({ task: params.task, input: params.input })) {
      return "claude-opus-4-6"
    }

    // scoreboard 기반 Claude opus 자동 승격
    const canPromoteClaude = shouldPromoteByBoard({
      board,
      provider: params.provider,
      task: params.task,
      currentModel: "claude-sonnet-4-6",
      nextModel: "claude-opus-4-6"
    })

    if (canPromoteClaude) {
      return "claude-opus-4-6"
    }

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
    if (task === "research") return 20000
    if (task === "reasoning") return 20000
    if (task === "code") return 20000
    return 20000
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
    return 0
  }

  return 1
}

function buildTaskSystemPrompt(task: OrxTask, provider: string): string {
  const COMMON = [
    "당신은 AI Orchestra 멀티 AI 시스템의 일원입니다.",
    "한국어로 질문이 들어오면 반드시 한국어로 답하세요.",
    "메타 응답(예: '알겠습니다', '도와드리겠습니다', '어떤 형식을 원하시나요')은 절대 출력하지 마세요.",
    "질문에 즉시 실질적인 답변을 제공하세요.",
    "Deliver high-quality responses by choosing the most effective format for the content — use tables when comparing multiple options, use prose when explaining concepts, use code blocks for code, use bullet points only when listing discrete items. Prioritize clarity, accuracy, and actionable insight over length. Always include a concrete conclusion or recommendation when the question requires a decision. Never pad responses with filler or meta-commentary."
  ].join(" ")

  if (task === "dialogue") {
    const roleMap: Record<string, string> = {
      openai: "당신은 주 대화 AI입니다. 간결하고 실용적으로 답하되, 사용자에게 바로 유용한 정보를 제공하세요.",
      claude: "당신은 비판적 검증 AI입니다. 답변의 논리적 허점이나 누락된 관점을 짚고, 더 나은 대안을 제시하세요.",
      gemini: "당신은 맥락 분석 AI입니다. 대화의 배경과 숨겨진 의도를 파악해 풍부한 맥락 정보를 제공하세요.",
      perplexity: "당신은 팩트 스카우트 AI입니다. 신뢰할 수 있는 사실과 최신 정보를 근거 중심으로 제공하세요."
    }
    return [COMMON, roleMap[provider] ?? roleMap.openai].join(" ")
  }

  if (task === "reasoning") {
    const roleMap: Record<string, string> = {
      openai: "당신은 주 추론 AI입니다. 체계적으로 분석하고 명확한 최종 결론을 반드시 제시하세요. 중립을 유지하지 말고 하나의 입장을 선택하세요.",
      claude: "당신은 반론 검증 AI입니다. 주 추론에 대한 가장 강력한 반론을 먼저 제시하고, 그럼에도 불구하고 자신의 최종 결론을 명확히 선택하세요. 결론 회피 금지.",
      gemini: "당신은 시스템 사고 AI입니다. 문제를 구성 요소, 피드백 루프, 2차 효과 관점에서 분석하고 구조적 통찰을 제공하세요.",
      perplexity: "당신은 근거 수집 AI입니다. 추론을 뒷받침하는 실증적 근거, 사례, 데이터를 출처와 함께 제공하세요."
    }
    return [COMMON, roleMap[provider] ?? roleMap.openai].join(" ")
  }

  if (task === "research") {
    const roleMap: Record<string, string> = {
      openai: "당신은 종합 정리 AI입니다. 수집된 정보를 통합해 구조화된 분석, 핵심 인사이트, 실행 가능한 최종 권고안을 제시하세요.",
      claude: "당신은 심층 비판 분석 AI입니다. 표면적 결론 너머의 리스크, 반례, 숨겨진 가정을 파고들어 비판적 시각의 독립 분석을 제공하세요.",
      gemini: "당신은 장문 패턴 분석 AI입니다. 광범위한 데이터에서 트렌드, 패턴, 구조적 변화를 식별하고 체계적으로 정리하세요.",
      perplexity: "당신은 실시간 정보 수집 AI입니다. 최신 정보를 검색해 출처 URL 또는 출처명과 함께 사실 기반 데이터를 제공하세요."
    }
    return [COMMON, roleMap[provider] ?? roleMap.openai].join(" ")
  }

  if (task === "code") {
    const roleMap: Record<string, string> = {
      openai: "당신은 코드 리뷰 AI입니다. 제출된 코드의 버그, 보안 취약점, 성능 문제를 검토하세요. 문제가 있으면 수정 코드를 제시하고, 없으면 'LGTM' 및 간단한 개선 제안을 주세요.",
      claude: "당신은 코드 구현 AI입니다. 프로덕션 품질의 완성된 코드를 작성하세요. 플레이스홀더 없이 실제 동작하는 코드만 출력하고, 예외 처리와 엣지 케이스를 반드시 포함하세요.",
      gemini: "당신은 아키텍처 설계 AI입니다. 코드의 전체 구조, 모듈 분리, 확장성, 유지보수성 관점에서 설계 방향을 제시하세요.",
      perplexity: "당신은 기술 문서 AI입니다. 관련 공식 문서, API 레퍼런스, 실제 사용 예제를 출처와 함께 제공하세요."
    }
    return [COMMON, roleMap[provider] ?? roleMap.openai].join(" ")
  }

  return COMMON
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
    // abort_signal: 클라이언트 ESC → chat.ts → runtime.ts → dispatcher → adapter
    abort_signal: input?.input?.abort_signal ?? null,
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

  // 클라이언트 abort 신호 — adapter 호출 전 체크
  const abortSignal: AbortSignal | null = payload.abort_signal ?? null
  if (abortSignal?.aborted) {
    return buildFallbackResponse(input, "aborted")
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
        abort_signal: abortSignal,
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
