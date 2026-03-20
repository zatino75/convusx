export type PlannerTaskType = "dialogue" | "reasoning" | "research" | "code"

export type PlannerStep = {
  id: string
  type: PlannerTaskType
  title: string
  goal: string
  candidates: Array<{ provider: string }>
  candidate_runs: Array<{ provider: string }>
}

export type PlannerPlan = {
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

export type PlannerOutput = {
  task_type: PlannerTaskType
  execution_plan: string[]
}

function normalize(text: string): string {
  return String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase()
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term))
}

export function detectTaskType(input: string): PlannerTaskType {
  const text = normalize(input)

  if (
    includesAny(text, [
      "typescript",
      "javascript",
      "node.js",
      "nodejs",
      "express",
      "fastify",
      "rest api",
      "api server",
      "function",
      "class",
      "interface",
      "code",
      "코드",
      "구현",
      "함수",
      "서버 예시"
    ])
  ) {
    return "code"
  }

  if (
    includesAny(text, [
      "시장 점유율",
      "market share",
      "출처",
      "근거",
      "리서치",
      "조사",
      "research",
      "evidence",
      "pros",
      "cons",
      "산업 분석",
      "시장 분석",
      "기업 분석",
      "비교 분석",
      "섹터 분석",
      "시장 진입",
      "진입 전략",
      "진입 시",
      "검토해야 할",
      "검토 항목",
      "우선순위",
      "경쟁사",
      "경쟁 제품",
      "타깃 고객",
      "수익성",
      "유통 구조",
      "마진 구조",
      "포지셔닝",
      "카테고리",
      "브랜드 분석",
      "제품 분석",
      "시장성",
      "사업성",
      "feasibility",
      "go to market",
      "gtm",
      "benchmark",
      "벤치마크"
    ])
  ) {
    return "research"
  }

  if (
    includesAny(text, [
      "roi",
      "논리적으로",
      "왜",
      "이유",
      "전략 중",
      "어떤 게 더",
      "단기",
      "장기",
      "trade-off",
      "reasoning",
      "따라서",
      "판단",
      "최종 결론",
      "하나만 선택",
      "최종 선택",
      "더 유리",
      "찬반",
      "반대",
      "입장 선택"
    ])
  ) {
    return "reasoning"
  }

  return "dialogue"
}

function defaultProviders(task: PlannerTaskType): string[] {
  if (task === "dialogue") return ["openai"]
  if (task === "reasoning") return ["openai", "claude"]
  if (task === "research") return ["openai", "claude", "perplexity"]
  return ["claude", "openai"]
}

export function buildPlan(input: string): PlannerOutput {
  const task = detectTaskType(input)

  return {
    task_type: task,
    execution_plan: [
      "detect_task:" + task,
      "route:" + defaultProviders(task).join(","),
      "execute",
      "judge"
    ]
  }
}

export function buildPlannerPlan(params: {
  input_text: string
  mode?: string
}): PlannerPlan {
  const inputText = String(params?.input_text ?? "").trim()
  const task = detectTaskType(inputText)
  const providers = defaultProviders(task)

  return {
    planner_version: "v3",
    task,
    mode: params?.mode ?? "runtime_orchestra",
    goal: inputText,
    input_text: inputText,
    steps: [
      {
        id: "step_1",
        type: task,
        title: task,
        goal: inputText,
        candidates: providers.map((provider) => ({ provider })),
        candidate_runs: providers.map((provider) => ({ provider }))
      }
    ],
    metadata: {
      source: "planner.ts"
    }
  }
}
