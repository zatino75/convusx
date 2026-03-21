export type PlannerTaskType = "dialogue" | "reasoning" | "research" | "code"

type PlannerCandidate = {
  provider: string
}

type PlannerStep = {
  id: string
  type: PlannerTaskType
  title: string
  goal: string
  prompt: string
  candidates: PlannerCandidate[]
  candidate_runs: PlannerCandidate[]
  messages: Array<{
    role: string
    content: string
  }>
}

export type ExecutionPlan = {
  planner_version: string
  task: PlannerTaskType
  mode: string
  goal: string
  input_text: string
  steps: PlannerStep[]
  metadata: {
    source: string
  }
}

function normalize(text: string): string {
  return String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase()
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term))
}

function normalizeExplicitTask(task: any): PlannerTaskType | null {
  const value = normalize(String(task ?? ""))

  if (value === "dialogue") return "dialogue"
  if (value === "reasoning") return "reasoning"
  if (value === "research") return "research"
  if (value === "code") return "code"

  return null
}

function detectTaskType(input: string): PlannerTaskType {
  const text = normalize(input)

  if (
    includesAny(text, [
      "code",
      "typescript",
      "javascript",
      "node.js",
      "nodejs",
      "express",
      "fastify",
      "rest api",
      "api 서버",
      "서버 코드",
      "샘플 코드",
      "예시 코드",
      "orchestration",
      "fallback",
      "provider",
      "router",
      "function",
      "class",
      "interface",
      "코드",
      "구현",
      "함수"
    ])
  ) {
    return "code"
  }

  if (
    includesAny(text, [
      "roi",
      "논리적으로",
      "전략 중",
      "어떤 게 더",
      "왜",
      "이유",
      "trade-off",
      "tradeoff",
      "단기",
      "장기",
      "판단",
      "선택해야",
      "무엇이 더 나은가",
      "which is better",
      "reasoning"
    ])
  ) {
    return "reasoning"
  }

  if (
    includesAny(text, [
      "시장 점유율",
      "점유율",
      "상위 5개",
      "상위 3개",
      "자료 조사",
      "리서치",
      "research",
      "출처",
      "근거",
      "evidence",
      "source",
      "sources",
      "citation",
      "citations",
      "보고서",
      "통계",
      "데이터"
    ])
  ) {
    return "research"
  }

  return "dialogue"
}

function defaultProviders(task: PlannerTaskType): string[] {
  if (task === "dialogue") return ["openai"]
  if (task === "reasoning") return ["openai", "claude"]
  if (task === "research") return ["claude", "openai", "perplexity"]
  return ["claude", "openai"]
}

export function buildExecutionPlan(params: {
  message?: string
  messages?: Array<{ role?: string; content?: any }>
  task?: string
  mode?: string
  goal?: string
}): ExecutionPlan {
  const inputText =
    typeof params?.message === "string" && params.message.trim().length > 0
      ? params.message.trim()
      : typeof params?.goal === "string" && params.goal.trim().length > 0
        ? params.goal.trim()
        : ""

  const explicitTask = normalizeExplicitTask(params?.task)
  const task = explicitTask ?? detectTaskType(inputText)

  const providers = defaultProviders(task)

  const normalizedMessages =
    Array.isArray(params?.messages) && params.messages.length > 0
      ? params.messages.map((m) => ({
          role: typeof m?.role === "string" && m.role.trim().length > 0 ? m.role : "user",
          content:
            typeof m?.content === "string"
              ? m.content
              : JSON.stringify(m?.content ?? "")
        }))
      : [
          {
            role: "user",
            content: inputText
          }
        ]

  return {
    planner_version: "v2",
    task,
    mode: params?.mode ?? "runtime_orchestra",
    goal: inputText,
    input_text: inputText,
    steps: [
      {
        id: "step_1",
        type: task,
        title: task,
        goal: task,
        prompt: inputText,
        candidates: providers.map((provider) => ({ provider })),
        candidate_runs: providers.map((provider) => ({ provider })),
        messages: normalizedMessages
      }
    ],
    metadata: {
      source: "planner.ts"
    }
  }
}
