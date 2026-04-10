import type { CanonicalTask, CodeSubtask } from "../types/tasks.js"

// PlannedTask — CanonicalTask의 별칭 (하위호환)
export type { CanonicalTask as PlannedTask, CodeSubtask }

export type PlannerSignals = {
  benchmark_mode: boolean
  deep_analysis: boolean
  deep_research: boolean
  force_pro: boolean
  structured_output: boolean
}

function normalizeText(input: string) {
  return String(input ?? "").trim().toLowerCase()
}

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword))
}

// ── 플래닝 시그널 추출 ──
// 태스크 분류는 Claude Haiku(llmRouter)가 전담.
// 여기서는 Haiku가 판단하기 어려운 메타 시그널만 추출.
export function extractPlanningSignals(input: string): PlannerSignals {
  const text = normalizeText(input)

  const benchmark_mode = includesAny(text, [
    "benchmark", "eval", "evaluation", "테스트셋", "비교평가", "정량비교", "벤치마크"
  ])

  const deep_analysis = includesAny(text, [
    "deep analysis", "심층분석", "깊게 분석", "정밀 분석", "자세히 분석",
    "종합 분석", "전체적으로 분석", "다각도로", "종합적으로", "철저하게",
    "상세히 분석", "면밀히",
    // 법률·계약 문서는 본질적으로 심층 분석
    "소장", "소송장", "판결문", "계약서 분석", "계약서 검토", "법률 검토", "법적 검토"
  ])

  const deep_research = includesAny(text, [
    "deep research", "심층 리서치", "깊게 조사", "철저히 조사",
    "리서치해줘", "리서치 해줘", "조사해줘", "최신 정보 조사",
    "최신 동향", "시장 조사", "트렌드 조사"
  ])

  const force_pro = includesAny(text, [
    "force_pro", "force pro", "use pro", "pro로", "pro 사용", "gpt-5.4-pro"
  ])

  const structured_output =
    includesAny(text, [
      "반드시 포함", "포함 항목", "포함해야", "다음 섹션", "다음 항목",
      "다음 구조", "섹션으로", "구성해주세요", "구조로 작성",
      "must include", "include the following", "following sections", "structured format"
    ]) || /(?:^|\s)\d+[\.)]\s+\S/.test(text)

  return {
    benchmark_mode,
    deep_analysis,
    deep_research,
    force_pro,
    structured_output
  }
}

// ── 코드 서브태스크 세분화 ──
// Haiku가 "code" 계열로 분류한 경우 implement/debug/review 중 어떤 것인지 판단
export function detectCodeSubtask(input: string): CodeSubtask | null {
  const text = normalizeText(input)

  if (!includesAny(text, [
    "code", "coding", "debug", "debugging", "refactor", "bug", "typescript", "javascript",
    "tsx", "react", "node", "backend", "frontend", "빌드", "코드", "디버그", "리팩터",
    "버그", "에러 수정", "파이썬", "python", "함수", "짜줘", "구현해", "스크립트",
    "알고리즘", "클래스", "java", "golang", "rust", "swift", "kotlin", "sql", "html",
    "css", "api endpoint", "rest api"
  ])) return null

  if (includesAny(text, [
    "review", "code review", "pr review", "리뷰", "검토", "문제점 찾아", "보안 검토",
    "refactor", "refactoring", "리팩터", "리팩토링", "구조 개선", "중복 제거", "cleanup"
  ])) {
    return "code_refactor_review"
  }

  if (includesAny(text, [
    "debug", "bug", "error", "fix", "에러", "오류", "고쳐", "수정", "안 돼", "실패", "stack trace"
  ])) {
    return "code_debug"
  }

  return "code_implement"
}

// ── 태스크 분류 ──
// 실제 분류는 llmRouter(Claude Haiku)가 전담.
// 이 함수는 Haiku 폴백 시에만 사용되며 "dialogue"를 기본값으로 반환.
export function detectTaskType(_input: string): CanonicalTask {
  return "dialogue"
}

export function planRequest(input: string) {
  const task = detectTaskType(input)
  return {
    task,
    code_subtask: null,
    signals: extractPlanningSignals(input)
  }
}
