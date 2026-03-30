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
      "조사해줘",
      "최신 정보",
      "팩트체크",
      "출처 확인",
      "트렌드 분석",
      "시장 동향",
      "업계 동향",
      "최근 동향",
      "최신 트렌드",
      "news search",
      "검색해줘",
      "실시간",
      "오늘 기준",
      "현재 기준",
      // 법률 검토
      "법률 검토", "계약서 검토", "법적 검토", "법적 위험", "법률 분석",
      "계약서 분석", "약관 검토", "법률 리뷰", "법적 리스크", "legal review",
      // 데이터 분석
      "데이터 분석", "통계 분석", "수치 분석", "데이터 시각화",
      "csv 분석", "엑셀 분석", "kpi 분석", "data analysis",
      // 재무정보
      "재무정보", "재무분석", "재무제표", "재무 분석", "손익계산서",
      "밸류에이션", "투자분석", "공시 분석", "financial analysis",
      // 상품 개발
      "상품 개발", "제품 개발", "상품 기획", "브랜딩 전략", "시장 분석",
      "경쟁사 분석", "swot 분석", "gtm 전략", "product development"
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
