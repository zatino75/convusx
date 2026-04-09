import { readModelScoreboard } from "./scoreboard.js"
import type { CanonicalTask } from "../types/tasks.js"
import { normalizeTask } from "../types/tasks.js"
import { MODEL_PRICING_USD_PER_1K_TOKENS, MAX_CONV_MESSAGES } from "../config/defaults.js"

type DispatchInput = {
  provider: string
  task?: string
  role?: string   // "primary" | "verifier" | "optional" | "synthesis" | "scout"
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

// MODEL_PRICING_USD_PER_1K_TOKENS → imported from ../config/defaults.js

function round(value: number, digits = 8) {
  return Number(Number(value || 0).toFixed(digits))
}

function safeNumber(value: any) {
  const v = Number(value ?? 0)
  return Number.isFinite(v) ? v : 0
}

// normalizeTask → imported from ../types/tasks.js (with defaultTask="dialogue" at call sites)

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

// 대화 길이 제한 — MAX_CONV_MESSAGES imported from ../config/defaults.js

function trimContextMessages(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const systemMsgs = messages.filter((m) => m.role === "system")
  const convMsgs = messages.filter((m) => m.role !== "system")

  if (convMsgs.length <= MAX_CONV_MESSAGES) return messages

  // 최신 N개 유지 — 가장 오래된 쪽부터 제거 (최신 컨텍스트가 중요)
  const trimmed = convMsgs.slice(convMsgs.length - MAX_CONV_MESSAGES)
  // user 메시지로 시작해야 함 — assistant로 시작하면 첫 메시지 제거
  const adjusted = trimmed[0]?.role === "assistant" ? trimmed.slice(1) : trimmed
  return [...systemMsgs, ...adjusted]
}

function normalizeMessages(input: DispatchInput): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  // 현재 사용자 입력 (message 필드) — 히스토리와 별도로 전달됨
  const currentMessage =
    typeof input?.message === "string" && input.message.trim().length > 0
      ? input.message.trim()
      : typeof input?.input?.message === "string" && input.input.message.trim().length > 0
        ? input.input.message.trim()
        : ""

  const rawMessages =
    Array.isArray(input?.messages) && input.messages.length > 0
      ? input.messages
      : Array.isArray(input?.input?.messages) && input.input.messages.length > 0
        ? input.input.messages
        : null

  if (rawMessages && rawMessages.length > 0) {
    const normalized = rawMessages.map((m: any) => {
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
    // 연속 중복 메시지 제거 (같은 role + 같은 content 연속 시 API 오류 방지)
    const deduped: typeof normalized = []
    for (const msg of normalized) {
      const last = deduped[deduped.length - 1]
      if (last && last.role === msg.role && last.content.trim() === msg.content.trim()) continue
      deduped.push(msg)
    }

    // ── 핵심 수정: 현재 사용자 질문이 messages 배열 끝에 없으면 추가 ──
    // 프론트엔드가 message(현재 입력)와 messages(히스토리)를 별도로 전송하는데,
    // 여기서 messages만 사용하면 현재 질문이 AI에 전달되지 않는 버그 발생
    if (currentMessage) {
      const lastMsg = deduped[deduped.length - 1]
      const alreadyEndsWithCurrent =
        lastMsg?.role === "user" && lastMsg.content.includes(currentMessage)

      if (!alreadyEndsWithCurrent) {
        deduped.push({ role: "user", content: currentMessage })
      }
    }

    return trimContextMessages(deduped)
  }

  return [
    {
      role: "user",
      content: currentMessage || (typeof input?.input === "string" ? input.input : "")
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
  task: CanonicalTask
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
  task: CanonicalTask
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
      currentModel: "gpt-5.2",
      nextModel: "gpt-5.4-pro"
    })

    if (canPromote) {
      return "gpt-5.4-pro"
    }

    return "gpt-5.2"
  }

  if (params.provider === "gemini") {
    if (shouldForceOpenAIPro({ task: params.task, input: params.input })) {
      return "gemini-2.5-pro"
    }

    // scoreboard 기반 Gemini pro 자동 승격
    const canPromoteGemini = shouldPromoteByBoard({
      board,
      provider: params.provider,
      task: params.task,
      currentModel: "gemini-2.5-pro",
      nextModel: "gemini-2.5-pro"
    })

    if (canPromoteGemini) {
      return "gemini-2.5-pro"
    }

    return "gemini-2.5-pro"
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

function defaultModel(provider: string, task: CanonicalTask, input?: any): string {
  if (provider === "openai") {
    return pickTieredModel({ provider, task, input }) ?? "gpt-5.2"
  }

  if (provider === "claude") {
    return pickTieredModel({ provider, task, input }) ?? "claude-sonnet-4-6"
  }

  if (provider === "gemini") {
    return pickTieredModel({ provider, task, input }) ?? "gemini-2.5-pro"
  }

  if (provider === "perplexity") {
    if (task === "research" || task === "reasoning") return "sonar-reasoning-pro"
    return "sonar-pro"
  }

  return "gpt-5.2"
}

function defaultTemperature(task: CanonicalTask, role = "primary"): number {
  // synthesis/blend 호출은 자연스러운 텍스트 합성을 위해 온도 고정
  if (role === "synthesis") return 0.25
  if (task === "dialogue") return 0.2
  if (task === "writing_creative") return 0.7
  if (task === "writing_business") return 0.2
  if (task === "writing") return 0.3
  if (task === "research") return 0.1
  if (task === "long_doc") return 0.1
  if (task === "reasoning") return 0.1
  if (task === "code") return 0
  return 0.1
}

function defaultMaxTokens(task: CanonicalTask, provider: string, input?: any): number {
  const explicitModel = String(input?.model ?? "").trim().toLowerCase()

  if (provider === "openai" && (task === "research" || task === "reasoning")) {
    if (explicitModel === "gpt-5.4-pro") {
      return task === "research" ? 1800 : 1600
    }

    return task === "research" ? 2200 : 1800
  }

  if (task === "dialogue") return 16000
  if (task === "writing_creative") return 3500
  if (task === "writing_business") return 2500
  if (task === "writing") return 3000
  if (task === "long_doc") return 4000
  if (task === "reasoning") return 2200
  if (task === "research") return 3000
  if (task === "code") return 2800
  return 1400
}

function buildTimeoutMs(provider: string, task: CanonicalTask, input?: any): number {
  const explicitModel = String(input?.model ?? "").trim().toLowerCase()

  if (provider === "openai") {
    if (explicitModel === "gpt-5.4-pro") {
      if (task === "research") return 30000
      if (task === "reasoning") return 45000
      return 40000
    }

    if (task === "research") return 30000
    if (task === "reasoning") return 60000
    if (task === "code") return 90000
    return 45000
  }

  if (provider === "gemini") {
    if (task === "long_doc") return 50000
    if (task === "research") return 30000
    if (task === "reasoning") return 30000
    if (task === "code") return 30000
    return 30000
  }

  if (provider === "claude") {
    if (task === "writing_creative") return 70000
    if (task === "writing_business") return 60000
    if (task === "writing") return 70000
    if (task === "long_doc") return 90000
    if (task === "research") return 40000
    if (task === "reasoning") return 60000
    if (task === "code") return 90000
    if (task === "dialogue") return 150000
    return 150000
  }

  if (provider === "perplexity") {
    if (task === "research") return 100000
    if (task === "reasoning") return 90000
    return 60000
  }

  // 나머지 provider fallthrough
  if (task === "research") return 90000
  if (task === "code") return 90000
  if (task === "reasoning") return 90000
  return 60000
}

function buildMaxRetries(provider: string, task: CanonicalTask, input?: any): number {
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

function buildTaskSystemPrompt(task: CanonicalTask, provider: string, structuredOutput = false, role = "primary"): string {
  const COMMON = [
    "당신은 CORVUS X 멀티 AI 시스템의 일원입니다.",
    "한국어로 질문이 들어오면 반드시 한국어로 답하세요.",
    "메타 응답(예: '알겠습니다', '도와드리겠습니다', '어떤 형식을 원하시나요')은 절대 출력하지 마세요.",
    "질문에 즉시 실질적인 답변을 제공하세요.",
    "Deliver comprehensive, high-quality responses. Choose the most effective format — use tables when comparing options, use prose when explaining concepts, use code blocks ONLY for programming code and technical commands (never for regular text, bullet lists, or summaries), use bullet points when listing discrete items. Always include a concrete conclusion or recommendation when the question requires a decision. Never pad responses with filler or meta-commentary. Never truncate or cut off mid-answer — always complete your response fully.",
    "【포맷 규칙】 코드 블록(```)은 프로그래밍 코드·명령어·JSON·SQL에만 사용하세요. 일반 텍스트, 목록, 법률 조항, 요약, 액션 아이템은 반드시 일반 마크다운(##, -, **등)으로 작성하세요. 코드 블록으로 일반 글을 감싸는 것은 엄격히 금지됩니다."
  ].join(" ")

  // synthesis/patching 호출은 중립 프롬프트 사용 — role-specific 지시와 충돌 방지
  if (role === "synthesis") {
    return [
      COMMON,
      "주어진 지시에 따라 최고 품질의 결과물을 생성하세요. 별도 설명이나 주석 없이 요청한 내용만 출력하세요."
    ].join(" ")
  }

  if (task === "dialogue") {
    // TASK_WEIGHTS: claude(0.12) > openai(0.08) — claude가 primary, openai가 verifier
    const roleMap: Record<string, string> = {
      claude: "당신은 주 대화 AI입니다. 사용자의 질문에 충분히 상세하고 구조적으로 답하세요. 핵심 포인트를 빠짐없이 다루고, 실용적인 정보와 구체적인 예시를 포함해 완결성 있는 답변을 제공하세요. 절대 중간에 끊거나 요약으로 대체하지 마세요.",
      openai: "당신은 비판적 검증 AI입니다. 답변의 논리적 허점이나 누락된 관점을 짚고, 더 나은 대안을 제시하세요.",
      gemini: "당신은 맥락 분석 AI입니다. 대화의 배경과 숨겨진 의도를 파악해 풍부한 맥락 정보를 제공하세요.",
      perplexity: "당신은 팩트 스카우트 AI입니다. 신뢰할 수 있는 사실과 최신 정보를 근거 중심으로 제공하세요."
    }
    return [COMMON, roleMap[provider] ?? roleMap.claude].join(" ")
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
    // role 기반 agent 분화 — provider보다 role 우선
    const rolePrompts: Record<string, string> = {
      // primary: Claude가 구현, OpenAI가 verifier일 때
      primary: provider === "claude"
        ? "당신은 코드 구현 AI(Code Implementer)입니다. 프로덕션 품질의 완성된 코드를 작성하세요. 플레이스홀더 없이 실제 동작하는 코드만 출력하고, 예외 처리·엣지 케이스·타입 안전성을 반드시 포함하세요. 코드 블록 외 설명은 최소화하세요."
        : provider === "openai"
          ? "당신은 코드 구현 및 리뷰 AI입니다. 요청한 기능을 완전히 구현하고, 보안 취약점·성능 문제·논리 오류가 없는지 즉시 검토하세요. 완성된 코드만 출력하세요."
          : provider === "gemini"
            ? "당신은 아키텍처 설계 AI(Architect)입니다. 코드의 전체 구조, 모듈 분리, 확장성, 유지보수성 관점에서 설계 방향을 제시하고 구조화된 구현을 제공하세요."
            : "당신은 기술 문서 AI입니다. 관련 공식 문서, API 레퍼런스, 실제 사용 예제를 출처와 함께 제공하세요.",

      // verifier: 코드 리뷰어 (OpenAI gpt-5.3-codex)
      verifier: "당신은 코드 리뷰 AI(Code Reviewer)입니다. 제출된 코드를 검토하고 다음 순서로 응답하세요: 1) 버그·논리 오류 발견 시 수정된 전체 코드 출력 (설명 없이 코드만). 2) 보안 취약점이 있으면 수정 코드와 간단한 이유. 3) 완전히 정확하면 'LGTM' 한 줄만 출력. 절대 리뷰 코멘트와 코드를 섞지 마세요.",

      // synthesis: 리팩토링/패치
      synthesis: "당신은 리팩토링 AI(Refactor Architect)입니다. 주어진 코드를 개선하여 완성본을 반환하세요. 가독성·성능·구조를 개선하되 기능 변경은 금지. 개선이 불필요하면 'APPROVED' 한 줄만 출력. 수정본만 출력하고 설명은 코드 내 주석으로만 추가하세요.",

      // scout: 디버깅/탐색
      scout: "당신은 디버그 조사 AI(Debug Investigator)입니다. 버그의 근본 원인을 추적하고 재현 조건을 명확히 하세요. 원인 분석 → 수정 코드 → 예방 방법 순서로 응답하세요. 수정된 전체 코드를 반드시 포함하세요."
    }

    const prompt = rolePrompts[role] ?? rolePrompts.primary
    return [COMMON, prompt].join(" ")
  }

  // ── writing_creative: Claude primary + OpenAI verifier ──
  if (task === "writing_creative") {
    const roleMap: Record<string, string> = {
      claude: "당신은 창작 글쓰기 AI입니다. 독창적이고 설득력 있는 문장을 작성하세요. 감성적 호소와 스토리텔링을 활용하고, 모든 섹션을 빠짐없이 완성하세요.",
      openai: "당신은 글쓰기 검토 AI입니다. 문장의 사실성·구조·일관성을 검토하고 독자 관점에서 개선안을 제시하세요.",
      gemini: "당신은 스타일 최적화 AI입니다. 문체·톤·가독성을 분석하고 타깃 독자에게 최적화된 표현으로 개선하세요.",
    }
    return [COMMON, roleMap[provider] ?? roleMap.claude].join(" ")
  }

  // ── writing_business: OpenAI primary + Claude verifier ──
  if (task === "writing_business") {
    const roleMap: Record<string, string> = {
      openai: "당신은 업무 문서 작성 AI입니다. 보고서·제안서·계약 초안 등 구조화된 업무 문서를 작성하세요. 사실성과 명확성을 최우선으로 하고, 모든 섹션을 빠짐없이 완성하세요.",
      claude: "당신은 문서 검토 AI입니다. 톤·흐름·논리적 일관성을 검토하고 비즈니스 문서로서 적합성을 평가하세요.",
    }
    return [COMMON, roleMap[provider] ?? roleMap.openai].join(" ")
  }

  if (task === "writing") {
    const roleMap: Record<string, string> = {
      openai: "당신은 편집 검토 AI입니다. 작성된 글의 구조, 흐름, 논리적 일관성을 검토하고 구체적인 개선안을 제시하세요. 누락된 섹션이나 약한 논거가 있으면 반드시 지적하고 보완 내용을 제안하세요.",
      claude: "당신은 주 작성 AI입니다. 요청에 명시된 모든 섹션을 빠짐없이 작성하세요. 각 섹션은 ## 헤더로 구분하고, 번호를 붙여 명확히 구조화하세요. 단순 설명이 아니라 실무에서 즉시 활용 가능한 구체적 내용을 담아야 합니다. 결론 또는 권고사항을 반드시 포함하세요.",
      gemini: "당신은 스타일 최적화 AI입니다. 글의 문체, 톤, 가독성을 분석하고 타깃 독자(투자자/파트너/고객)에게 최적화된 표현으로 개선안을 제시하세요. 각 섹션의 설득력을 높이는 구체적 언어 수정을 포함하세요.",
      perplexity: "당신은 사실 보강 AI입니다. 글에 필요한 시장 데이터, 수치, 사례, 트렌드를 실시간 검색하여 각 섹션에 근거를 추가하세요. 수치와 출처를 명시하세요."
    }
    const SECTION_ENFORCE = structuredOutput
      ? " 【필수】 요청의 모든 섹션/항목을 빠짐없이 작성하세요. 섹션 생략, '이하 생략', '간략히' 같은 표현 금지."
      : ""
    return [COMMON, roleMap[provider] ?? roleMap.claude].join(" ") + SECTION_ENFORCE
  }

  if (task === "long_doc") {
    const roleMap: Record<string, string> = {
      openai: "당신은 핵심 추출 AI입니다. 장문 문서에서 의사결정자가 즉시 필요한 핵심 결론, 리스크 항목, 실행 가능한 액션 아이템을 구조화하여 추출하세요. 각 항목에 우선순위와 이유를 명시하세요.",
      claude: "당신은 심층 분석 AI입니다. 문서의 논리 구조, 리스크 요소, 숨겨진 가정, 모순점을 분석하세요. 분석은 반드시 다음 구조로 작성: 1) 핵심 발견사항 2) 리스크 평가 3) 협상/수정 필요 항목 4) 즉시 실행 권고.",
      gemini: "당신은 주 문서 처리 AI입니다. 문서 전체를 빠짐없이 처리하고 다음 섹션 구조로 정리하세요: 1) 핵심 수치/사실 요약 2) 기회 및 위협 분석 3) 실행 가능한 전략 인사이트 4) 단계별 권고 액션. 각 섹션은 ## 헤더로 구분하고 구체적 수치와 근거를 포함하세요.",
      perplexity: "당신은 보완 정보 AI입니다. 문서 내용을 검증하고 관련 최신 시장 데이터, 법률/규제 정보, 비교 사례를 실시간으로 보완하세요. 출처 URL 또는 출처명을 반드시 명시하세요."
    }
    const SECTION_ENFORCE = structuredOutput
      ? " 【필수】 요청의 모든 분석 섹션을 완성하세요. 항목 생략 금지. 각 섹션에 구체적 근거와 수치를 포함하세요."
      : ""
    return [COMMON, roleMap[provider] ?? roleMap.gemini].join(" ") + SECTION_ENFORCE
  }

  if (task === "legal_review") {
    const LEGAL_COMMON = "【법률 검토 지침】 주어진 정보만으로 최대한 완전한 법률 분석을 제공하세요. 추가 정보를 먼저 물어보지 마세요 — 현재 자료로 분석 가능한 모든 것을 먼저 완성하고, 분석 말미에 추가 정보가 있으면 도움이 될 항목만 간략히 언급하세요. 목록·조항·액션 아이템은 반드시 마크다운 bullet(-)이나 번호 목록으로 작성하고, 코드 블록을 사용하지 마세요."
    const roleMap: Record<string, string> = {
      openai: `당신은 법률 분석 전문 AI입니다. 첨부된 법률 문서(소장·소송장·계약서·판결문·약관 등)를 철저히 분석하고, 다음 구조로 완전한 법률 검토를 제공하세요:
## 1. 사건 개요 (당사자, 소송 유형, 청구 내용 요약)
## 2. 서류 구성 분석 (각 문서의 법적 의미와 역할)
## 3. 법적 쟁점 분석 (청구 근거 조항, 해당 법률 조문, 판례 적용 가능성)
## 4. 상대방 주장의 법적 타당성 평가 (강점과 약점)
## 5. 의뢰인(피고) 측 대응 방향 및 방어 전략
## 6. 리스크 평가 (패소 가능성, 재산·양육권 영향 등)
## 7. 즉시 취해야 할 법적 행동 (기한 포함)
모든 섹션을 빠짐없이 작성하고, 관련 법 조문(민법, 가사소송법 등)을 명시하세요.`,
      claude: `당신은 법률 비판 검토 AI입니다. 주 분석 AI의 법률 검토를 읽고 다음을 수행하세요:
1) 누락된 법적 쟁점이나 잘못 해석된 법조문이 있으면 정확히 지적하고 보완하세요.
2) 더 강력한 방어 전략이나 반소(反訴) 가능성을 검토하세요.
3) 주 분석이 충분히 완전하면 핵심 법률 포인트 2~3개를 강조해 보완하세요.
마크다운 bullet(-)만 사용하고 코드 블록 사용 금지.`,
    }
    return [COMMON, LEGAL_COMMON, roleMap[provider] ?? roleMap.openai].join(" ")
  }

  return COMMON
}

function prependSystemMessage(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  task: CanonicalTask,
  provider: string,
  structuredOutput = false,
  role = "primary"
) {
  const systemPrompt = buildTaskSystemPrompt(task, provider, structuredOutput, role)

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
  const task = normalizeTask(String(input?.task ?? input?.input?.task ?? ""), "dialogue")
  const structuredOutput = Boolean(input?.input?.metadata?.planner_signals?.structured_output)
  const role = String(input?.role ?? "primary")
  const messages = prependSystemMessage(normalizeMessages(input), task, provider, structuredOutput, role)

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
        : defaultTemperature(task, role),
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
    step_type: normalizeTask(String(input?.task ?? ""), "dialogue"),
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
    rawUsage?.promptTokenCount ??    // Gemini usageMetadata
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
