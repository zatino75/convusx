// ── Provider 관련 상수 ──
// OrchestrationPanel, AppViews, ScoreboardCard 등에서 중복 제거

export const PROVIDER_COLOR: Record<string, string> = {
  openai:     "#10a37f",
  claude:     "#c96442",
  gemini:     "#4285f4",
  perplexity: "#6366f1",
}

export const PROVIDER_LABEL: Record<string, string> = {
  openai:     "OpenAI",
  claude:     "Claude",
  gemini:     "Gemini",
  perplexity: "Perplexity",
}

export const TASK_LABEL: Record<string, string> = {
  dialogue:            "대화",
  reasoning:           "추론",
  research:            "리서치",
  deep_research:       "심층 리서치",
  code:                "코드",
  code_implement:      "코드 구현",
  code_debug:          "디버그",
  code_refactor_review:"코드 리뷰",
  writing:             "글쓰기",
  writing_creative:    "창작",
  writing_business:    "비즈니스",
  long_doc:            "장문 분석",
  word:                "Word",
  excel:               "Excel",
  ppt:                 "PPT",
  pdf:                 "PDF",
  legal_review:        "법률 검토",
  data_analysis:       "데이터 분석",
  finance_analysis:    "재무 분석",
  product_development: "상품 개발",
}

export function getProviderColor(provider: string): string {
  return PROVIDER_COLOR[provider?.toLowerCase()] ?? "#888"
}

export function getProviderLabel(provider: string): string {
  return PROVIDER_LABEL[provider?.toLowerCase()] ?? provider
}

export function getTaskLabel(task: string): string {
  return TASK_LABEL[task] ?? task
}
