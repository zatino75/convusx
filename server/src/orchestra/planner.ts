export type PlannerSignals = {
  benchmark_mode: boolean
  deep_analysis: boolean
  deep_research: boolean
  force_pro: boolean
}

export type PlannedTask =
  | "dialogue"
  | "reasoning"
  | "research"
  | "code"

function normalizeText(input: string) {
  return String(input ?? "").trim().toLowerCase()
}

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword))
}

export function extractPlanningSignals(input: string): PlannerSignals {
  const text = normalizeText(input)

  const benchmark_mode = includesAny(text, [
    "benchmark",
    "eval",
    "evaluation",
    "테스트셋",
    "비교평가",
    "정량비교",
    "벤치마크"
  ])

  const deep_analysis = includesAny(text, [
    "deep analysis",
    "analyze deeply",
    "심층분석",
    "깊게 분석",
    "정밀 분석",
    "자세히 분석"
  ])

  const deep_research = includesAny(text, [
    "deep research",
    "research deeply",
    "심층 리서치",
    "깊은 리서치",
    "정밀 리서치",
    "깊게 조사"
  ])

  const force_pro = includesAny(text, [
    "force_pro",
    "force pro",
    "use pro",
    "pro로",
    "pro 사용",
    "gpt-5.4-pro"
  ])

  return {
    benchmark_mode,
    deep_analysis,
    deep_research,
    force_pro
  }
}

export function detectTaskType(input: string): PlannedTask {
  const text = normalizeText(input)

  if (
    includesAny(text, [
      "code",
      "coding",
      "debug",
      "debugging",
      "refactor",
      "bug",
      "typescript",
      "javascript",
      "tsx",
      "react",
      "node",
      "api",
      "backend",
      "frontend",
      "compile",
      "build error",
      "빌드",
      "코드",
      "디버그",
      "리팩터",
      "버그",
      "에러 수정"
    ])
  ) {
    return "code"
  }

  if (
    includesAny(text, [
      "research",
      "fact-check",
      "fact check",
      "latest",
      "recent",
      "current",
      "verify with sources",
      "시장조사",
      "리서치",
      "조사",
      "최신 정보",
      "팩트체크",
      "출처 확인"
    ])
  ) {
    return "research"
  }

  if (
    includesAny(text, [
      "reason",
      "reasoning",
      "why",
      "compare",
      "tradeoff",
      "decision",
      "strategy",
      "plan",
      "설계",
      "전략",
      "판단",
      "비교",
      "추론",
      "왜",
      "어떻게 결정"
    ])
  ) {
    return "reasoning"
  }

  return "dialogue"
}

export function planRequest(input: string) {
  const task = detectTaskType(input)
  const signals = extractPlanningSignals(input)

  return {
    task,
    signals
  }
}
