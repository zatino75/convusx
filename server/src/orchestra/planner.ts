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

  const deep_analysis =
    input.trim().length >= 300 ||
    (input.includes("```") && input.trim().length >= 200) ||
    includesAny(text, ["force_pro", "force_pro: true", "deep dive", "전문가 수준으로"])

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
    "force_pro: true",
    "force pro",
    "pro mode",
    "use pro",
    "pro로",
    "pro 사용",
    "gpt-5.4-pro",
    "심층 분석",
    "심층 연구",
    "deep dive",
    "전문가 수준",
    "전문가 수준으로"
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
      "에러 수정",
      "파이썬",
      "python",
      "함수",
      "짜줘",
      "작성해",
      "구현해",
      "만들어줘",
      "스크립트",
      "알고리즘",
      "클래스",
      "자바",
      "java",
      "golang",
      "go",
      "rust",
      "swift",
      "kotlin",
      "sql",
      "데이터베이스",
      "database",
      "html",
      "css"
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
