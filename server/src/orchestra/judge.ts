import type { DetectedConflict } from "./conflicts.js"
import { getProviderRoutingScore, recordJudgeOutcome } from "./scoreboard.js"

type JudgeCandidate = {
  provider: string
  answer_text: string
  raw?: unknown
}

type JudgeScoreRow = {
  provider: string
  score: number
  reasons: string[]
}

type JudgeProvider = "claude" | "openai"

type CanonicalTask =
  | "dialogue"
  | "reasoning"
  | "research"
  | "code_implement"
  | "code_debug"
  | "code_refactor_review"
  | "writing_creative"
  | "writing_business"
  | "long_doc"
  | "excel"
  | "ppt"
  | "word"
  | "pdf"
  | "legal_review"
  | "data_analysis"
  | "finance_analysis"
  | "product_development"
  | "code"
  | "writing"
  | "generic"

const HIGH_STAKES_TASKS = new Set<CanonicalTask>([
  "reasoning",
  "research",
  "code_implement",
  "code_debug",
  "code_refactor_review",
  "writing_business",
  "long_doc",
  "pdf",
  "word",
  "excel",
  "ppt",
  "legal_review",
  "data_analysis",
  "finance_analysis",
  "product_development",
])

const CANONICAL_TASKS = new Set<CanonicalTask>([
  "dialogue",
  "reasoning",
  "research",
  "code_implement",
  "code_debug",
  "code_refactor_review",
  "writing_creative",
  "writing_business",
  "long_doc",
  "excel",
  "ppt",
  "word",
  "pdf",
  "legal_review",
  "data_analysis",
  "finance_analysis",
  "product_development",
  "code",
  "writing",
  "generic",
])

function normalizeText(input: string): string {
  return String(input ?? "").replace(/\r\n/g, "\n").trim()
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function round4(value: number): number {
  return Number(value.toFixed(4))
}

function normalizeTask(input: string): CanonicalTask {
  const task = String(input ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")

  if (!task) return "generic"
  if (task === "code_refactor" || task === "code_review" || task === "code_refactor/review") {
    return "code_refactor_review"
  }
  if (task === "legal") return "legal_review"
  if (task === "analysis") return "data_analysis"
  if (task === "finance") return "finance_analysis"
  if (task === "product") return "product_development"

  if (task.startsWith("writing_") && !CANONICAL_TASKS.has(task as CanonicalTask)) return "writing"
  if (task.startsWith("code_") && !CANONICAL_TASKS.has(task as CanonicalTask)) return "code"
  if (task.startsWith("writing")) return "writing"
  if (task.startsWith("code")) return "code"

  return CANONICAL_TASKS.has(task as CanonicalTask) ? (task as CanonicalTask) : "generic"
}

function splitSentences(input: string): string[] {
  const text = normalizeText(input)
  if (!text) return []
  return (text.match(/[^.!?\n]+[.!?\n]?/g) ?? []).map((part) => part.trim()).filter(Boolean)
}

function extractNumbers(input: string): number[] {
  const matches = normalizeText(input).match(/-?\d+(?:\.\d+)?/g) ?? []
  return matches.map(Number).filter(Number.isFinite)
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function estimateCoverage(answer: string): number {
  const sentences = splitSentences(answer)
  const lengthScore = Math.min(1, normalizeText(answer).length / 800)
  const sentenceScore = Math.min(1, sentences.length / 10)
  return round4((lengthScore * 0.6) + (sentenceScore * 0.4))
}

function estimateStructure(answer: string): number {
  const text = normalizeText(answer)
  let score = 0.4
  if (/(?:^|\n)\s*[-*]\s+/.test(text)) score += 0.18
  if (/(?:^|\n)\s*\d+\.\s+/.test(text)) score += 0.14
  if (/\n\s*\n/.test(text)) score += 0.1
  if (splitSentences(text).length >= 5) score += 0.1
  if (/#{1,3}\s+\S+/.test(text)) score += 0.08

  const sectionMatches = text.match(/(?:^|\n)\s*(?:#{1,3}\s+\S|(?:\d+[.)]\s+|\*{1,2})[가-힣a-zA-Z])[^\n]{3,}/g) ?? []
  if (sectionMatches.length >= 3) score += 0.1
  if (sectionMatches.length >= 5) score += 0.1

  return round4(clamp(score, 0, 1))
}

function estimateSpecificity(answer: string): number {
  const text = normalizeText(answer)
  const numbers = extractNumbers(text)
  let score = 0.38
  score += Math.min(0.22, numbers.length * 0.04)
  if (/"[^"]+"/.test(text)) score += 0.08
  if (/: /.test(text)) score += 0.08
  score += Math.min(0.22, unique(text.split(/\s+/).filter((word) => word.length >= 7)).length * 0.01)
  return round4(clamp(score, 0, 1))
}

function hasMetaResponse(answer: string): boolean {
  const text = normalizeText(answer).toLowerCase()
  const metaPatterns = [
    /^(알겠습니다|도와드리겠습니다|물론이죠|네,\s)/,
    /^(sure|certainly|of course|i(?:'|’)d be happy)/i,
    /어떤 방식으로.*원하시나요/,
    /어떤 형식.*원하시나요/,
    /구체적으로.*알려주시면/,
  ]
  return metaPatterns.some((pattern) => pattern.test(text.slice(0, 100)))
}

function getConflictTypeWeight(typeInput: string): number {
  const type = String(typeInput ?? "").trim().toLowerCase()
  if (!type) return 0.07
  if (type.includes("numeric")) return 0.22
  if (type.includes("fact")) return 0.16
  if (type.includes("risk")) return 0.12
  if (type.includes("implementation")) return 0.1
  if (type.includes("context")) return 0.18
  if (type.includes("comparison")) return 0.08
  if (type.includes("recommendation")) return 0.06
  return 0.07
}

function getSeverityBase(severityInput: string): number {
  const severity = String(severityInput ?? "").trim().toLowerCase()
  if (severity === "high") return 0.12
  if (severity === "medium") return 0.06
  return 0.03
}

function isOpenAIProvider(provider: string): boolean {
  return /openai|gpt|codex/i.test(provider)
}

function isClaudeProvider(provider: string): boolean {
  return /claude|anthropic/i.test(provider)
}

function inferPrimaryAndVerifier(candidates: JudgeCandidate[]) {
  return {
    primaryProvider: String(candidates[0]?.provider ?? "").trim(),
    verifierProvider: String(candidates[1]?.provider ?? "").trim(),
  }
}

function chooseJudgeProvider(params: {
  task: CanonicalTask
  primaryProvider?: string
  verifierProvider?: string
}): JudgeProvider {
  const { task } = params
  const primary = String(params.primaryProvider ?? "")
  const verifier = String(params.verifierProvider ?? "")

  const verifierIsClaude = isClaudeProvider(verifier)
  const verifierIsOpenAI = isOpenAIProvider(verifier)
  const primaryIsClaude = isClaudeProvider(primary)
  const primaryIsOpenAI = isOpenAIProvider(primary)

  switch (task) {
    case "reasoning":
    case "research":
    case "writing_business":
    case "long_doc":
    case "word":
    case "legal_review":
    case "finance_analysis":
      return verifierIsOpenAI ? "claude" : "openai"

    case "dialogue":
    case "code_implement":
    case "code_debug":
    case "code_refactor_review":
    case "writing_creative":
    case "excel":
    case "ppt":
    case "pdf":
    case "data_analysis":
    case "product_development":
      return verifierIsClaude ? "openai" : "claude"

    default:
      if (verifierIsClaude) return "openai"
      if (verifierIsOpenAI) return "claude"
      if (primaryIsOpenAI) return "claude"
      if (primaryIsClaude) return "openai"
      return "claude"
  }
}

function shouldRunAIJudge(params: {
  task: CanonicalTask
  candidates: JudgeCandidate[]
  conflicts: DetectedConflict[]
  preliminaryScores: JudgeScoreRow[]
}): boolean {
  const enabled = String(process.env.ENABLE_AI_JUDGE ?? "true").toLowerCase() !== "false"
  if (!enabled) return false
  if (params.candidates.length < 2) return false

  const winner = params.preliminaryScores[0]
  const runnerUp = params.preliminaryScores[1]
  if (!winner || !runnerUp) return false

  const diff = Math.abs(winner.score - runnerUp.score)
  const highConflict = params.conflicts.some((conflict) => String(conflict?.severity ?? "").toLowerCase() === "high")
  const mediumPlusConflict = params.conflicts.some((conflict) => ["high", "medium"].includes(String(conflict?.severity ?? "").toLowerCase()))

  if (HIGH_STAKES_TASKS.has(params.task) && (diff < 0.12 || mediumPlusConflict)) return true
  if (highConflict) return true
  if (diff < 0.06) return true

  return false
}

function scoreCandidate(
  candidate: JudgeCandidate,
  canonicalTask: CanonicalTask,
  conflicts: DetectedConflict[],
): JudgeScoreRow {
  const reasons: string[] = []
  const coverage = estimateCoverage(candidate.answer_text)
  const structure = estimateStructure(candidate.answer_text)
  const specificity = estimateSpecificity(candidate.answer_text)

  let coverageW = 0.22
  let structureW = 0.16
  let specificityW = 0.17

  switch (canonicalTask) {
    case "code":
    case "code_implement":
    case "code_debug":
    case "code_refactor_review":
      coverageW = 0.14
      structureW = 0.14
      specificityW = 0.25
      break
    case "research":
      coverageW = 0.2
      structureW = 0.22
      specificityW = 0.13
      break
    case "reasoning":
      coverageW = 0.18
      structureW = 0.14
      specificityW = 0.23
      break
    case "writing_creative":
      coverageW = 0.24
      structureW = 0.18
      specificityW = 0.12
      break
    case "writing_business":
      coverageW = 0.22
      structureW = 0.24
      specificityW = 0.16
      break
    case "long_doc":
      coverageW = 0.24
      structureW = 0.24
      specificityW = 0.1
      break
    case "dialogue":
      coverageW = 0.1
      structureW = 0.1
      specificityW = 0.22
      break
    case "excel":
    case "ppt":
      coverageW = 0.16
      structureW = 0.24
      specificityW = 0.18
      break
    case "word":
      coverageW = 0.2
      structureW = 0.24
      specificityW = 0.16
      break
    case "pdf":
      coverageW = 0.22
      structureW = 0.2
      specificityW = 0.14
      break
    case "legal_review":
    case "finance_analysis":
      coverageW = 0.2
      structureW = 0.2
      specificityW = 0.2
      break
    case "data_analysis":
    case "product_development":
      coverageW = 0.19
      structureW = 0.21
      specificityW = 0.19
      break
  }

  let score = 0.45
  score += coverage * coverageW
  score += structure * structureW
  score += specificity * specificityW

  const providerConflicts = conflicts.filter(
    (conflict) => Array.isArray(conflict.providers) && conflict.providers.includes(candidate.provider),
  )

  const highConflicts = providerConflicts.filter((conflict) => conflict.severity === "high").length
  const mediumConflicts = providerConflicts.filter((conflict) => conflict.severity === "medium").length
  const lowConflicts = providerConflicts.filter((conflict) => conflict.severity === "low").length

  const weightedPenalty = providerConflicts.reduce((acc, conflict) => {
    const severityBase = getSeverityBase(String(conflict?.severity ?? "low"))
    const explicitWeight = typeof (conflict as { weight?: unknown }).weight === "number"
      ? Number((conflict as { weight?: number }).weight)
      : 0.5
    const typeWeight = getConflictTypeWeight(String(conflict?.type ?? ""))
    return acc + (severityBase * explicitWeight) + typeWeight
  }, 0)

  score -= weightedPenalty

  const numericConflicts = providerConflicts.filter((conflict) => String(conflict?.type ?? "").toLowerCase().includes("numeric")).length
  const factConflicts = providerConflicts.filter((conflict) => String(conflict?.type ?? "").toLowerCase().includes("fact")).length
  const recommendationConflicts = providerConflicts.filter((conflict) => String(conflict?.type ?? "").toLowerCase().includes("recommendation")).length
  const comparisonConflicts = providerConflicts.filter((conflict) => String(conflict?.type ?? "").toLowerCase().includes("comparison")).length

  reasons.push(`coverage:${coverage.toFixed(4)}`)
  reasons.push(`structure:${structure.toFixed(4)}`)
  reasons.push(`specificity:${specificity.toFixed(4)}`)
  reasons.push(`conflict_penalty:${weightedPenalty.toFixed(3)}`)

  if (highConflicts > 0) reasons.push(`high_conflicts:${highConflicts}`)
  if (mediumConflicts > 0) reasons.push(`medium_conflicts:${mediumConflicts}`)
  if (lowConflicts > 0) reasons.push(`low_conflicts:${lowConflicts}`)
  if (numericConflicts > 0) reasons.push(`numeric_conflicts:${numericConflicts}`)
  if (factConflicts > 0) reasons.push(`fact_conflicts:${factConflicts}`)
  if (recommendationConflicts > 0) reasons.push(`recommendation_conflicts:${recommendationConflicts}`)
  if (comparisonConflicts > 0) reasons.push(`comparison_conflicts:${comparisonConflicts}`)

  if (highConflicts >= 2) {
    score -= 0.15
    reasons.push("multi_high_conflict_penalty")
  }
  if (numericConflicts >= 2) {
    score -= 0.08
    reasons.push("multi_numeric_conflict_penalty")
  }

  if (["research", "reasoning", "finance_analysis", "data_analysis"].includes(canonicalTask)) {
    if (/\|.+\|.+\|/.test(candidate.answer_text)) {
      score += 0.06
      reasons.push("table_bonus")
    }
  }

  if (/(결론|권고|추천|따라서|최종|결정|선택|recommend|conclusion|therefore)/i.test(candidate.answer_text)) {
    score += 0.05
    reasons.push("conclusion_bonus")
  }

  if (["code", "code_implement", "code_debug", "code_refactor_review"].includes(canonicalTask)) {
    const hasCodeFence = /```/.test(candidate.answer_text)
    const hasPathLike = /[A-Za-z0-9_\-/\\]+\.[A-Za-z0-9]+/.test(candidate.answer_text)
    if (hasCodeFence) {
      score += 0.05
      reasons.push("code_fence_bonus")
    }
    if (hasCodeFence && /(function|const|def |class |import |return )/i.test(candidate.answer_text)) {
      score += 0.04
      reasons.push("executable_code_bonus")
    }
    if (hasPathLike) {
      score += 0.03
      reasons.push("path_specific_bonus")
    }
    if (!hasCodeFence && canonicalTask !== "code_refactor_review") {
      score -= 0.1
      reasons.push("no_code_fence_penalty")
    }
    if (/(TODO|FIXME|placeholder|your.*here|여기에.*작성|수정.*필요)/i.test(candidate.answer_text)) {
      score -= 0.06
      reasons.push("placeholder_penalty")
    }
    if (canonicalTask === "code_debug" && /(root cause|원인|재현|stack trace|재현 조건)/i.test(candidate.answer_text)) {
      score += 0.04
      reasons.push("debug_root_cause_bonus")
    }
    if (canonicalTask === "code_refactor_review" && /(책임|결합도|구조|리팩터링|break risk|migration|의존성)/i.test(candidate.answer_text)) {
      score += 0.05
      reasons.push("review_structure_bonus")
    }
  }

  if (["research", "reasoning"].includes(canonicalTask)) {
    if (/(because|therefore|however|근거|따라서|하지만|반면)/i.test(candidate.answer_text)) {
      score += 0.04
      reasons.push("reasoning_connector_bonus")
    }
  }

  if (canonicalTask === "research") {
    if (/(출처|참고|source|https?:\/\/|according to|에 따르면|\[\d+\])/i.test(candidate.answer_text)) {
      score += 0.04
      reasons.push("research_citation_bonus")
    }
    if (/\d+[\.,]?\d*\s*(?:%|억|만|원|개|건|배|달러|\$|명|회)/i.test(candidate.answer_text)) {
      score += 0.03
      reasons.push("research_data_bonus")
    }
  }

  if (canonicalTask === "reasoning") {
    if (/(?:^|\n)\s*(?:\d+[.)\s]|첫째|둘째|셋째|Step\s*\d)/im.test(candidate.answer_text)) {
      score += 0.04
      reasons.push("reasoning_step_bonus")
    }
    if (/(그러나|반면|하지만|이에 반해|물론.*하지만|비판|한계|단점)/i.test(candidate.answer_text)) {
      score += 0.03
      reasons.push("reasoning_counterpoint_bonus")
    }
  }

  if (["writing", "writing_creative", "writing_business", "word"].includes(canonicalTask)) {
    const textLen = candidate.answer_text.trim().length
    const writingText = normalizeText(candidate.answer_text)
    if (textLen >= 600) {
      score += 0.04
      reasons.push("writing_length_600_bonus")
    }
    if (textLen >= 900) {
      score += 0.03
      reasons.push("writing_length_900_bonus")
    }
    const writingSections = writingText.match(/(?:^|\n)\s*(?:#{1,3}\s+\S|(?:\d+[.)]\s+|\*{1,2})[가-힣a-zA-Z])[^\n]{3,}/g) ?? []
    if (writingSections.length >= 3) {
      score += 0.05
      reasons.push("writing_section3_bonus")
    }
    if (writingSections.length >= 5) {
      score += 0.04
      reasons.push("writing_section5_bonus")
    }
    if (/(##\s|^#\s|\*\*[가-힣]{2,}\*\*)/m.test(writingText)) {
      score += 0.03
      reasons.push("writing_header_bonus")
    }
    if (/(서론|배경|개요|overview|introduction)/i.test(writingText) && /(결론|권고|제안|마무리|conclusion|recommendation)/i.test(writingText)) {
      score += 0.04
      reasons.push("writing_completeness_bonus")
    }
    if (canonicalTask === "writing_business" || canonicalTask === "word") {
      if (/(실행|로드맵|권고|리스크|다음 단계|우선순위|예산|일정|action)/i.test(writingText)) {
        score += 0.04
        reasons.push("business_execution_bonus")
      }
    }
    if (canonicalTask === "writing_creative") {
      if (/(비유|톤|리듬|서사|이미지|감정선|브랜드 보이스)/i.test(writingText)) {
        score += 0.04
        reasons.push("creative_style_bonus")
      }
    }
  }

  if (canonicalTask === "dialogue") {
    const textLen = candidate.answer_text.trim().length
    if (textLen >= 50 && textLen <= 300) {
      score += 0.05
      reasons.push("dialogue_concise_bonus")
    }
    if (textLen > 300 && textLen <= 2000) {
      score += 0.04
      reasons.push("dialogue_detailed_bonus")
    }
    if (textLen > 3000) {
      score -= 0.04
      reasons.push("dialogue_verbose_penalty")
    }
    const opener = normalizeText(candidate.answer_text).slice(0, 120).toLowerCase()
    const hasDirectOpener = !/(안녕하세요|반갑습니다|좋은 질문|흥미로운|도움이|물론이죠|네,\s*이에|알겠습니다|도와드리겠)/.test(opener)
    if (hasDirectOpener) {
      score += 0.04
      reasons.push("dialogue_direct_entry_bonus")
    }
    const dialogueText = normalizeText(candidate.answer_text)
    if (/(예를 들어|예시|구체적으로|방법은|방법:|예:|\bexample\b|\bfor instance\b)/i.test(dialogueText)) {
      score += 0.03
      reasons.push("dialogue_example_bonus")
    }
  }

  if (canonicalTask === "long_doc" || canonicalTask === "pdf") {
    const longText = normalizeText(candidate.answer_text)
    const textLen = candidate.answer_text.trim().length
    if (textLen >= 600) {
      score += 0.03
      reasons.push("long_doc_depth_600_bonus")
    }
    if (textLen >= 1000) {
      score += 0.03
      reasons.push("long_doc_depth_1000_bonus")
    }
    if (/(핵심|요약|결론|key point|summary|takeaway|실행 항목|주요 발견)/i.test(longText)) {
      score += 0.04
      reasons.push("long_doc_extraction_bonus")
    }
    if (/(리스크|위험|독소조항|불리한|risk|취약|문제점|주의사항)/i.test(longText)) {
      score += 0.04
      reasons.push("long_doc_risk_bonus")
    }
    if (/(즉시\s*실행|실행\s*방안|액션|action item|다음\s*단계|next step|권고안|개선안)/i.test(longText)) {
      score += 0.04
      reasons.push("long_doc_action_bonus")
    }
    if (/\d+[\.,]?\d*\s*(?:%|억|만|천|원|개|건|배|위|점|명|회|달러|\$)/.test(longText)) {
      score += 0.03
      reasons.push("long_doc_data_evidence_bonus")
    }
    const longSections = longText.match(/(?:^|\n)\s*(?:#{1,3}\s+\S|(?:\d+[.)]\s+|\*{1,2})[가-힣a-zA-Z])[^\n]{3,}/g) ?? []
    if (longSections.length >= 3) {
      score += 0.04
      reasons.push("long_doc_section3_bonus")
    }
    if (canonicalTask === "pdf" && /(표|차트|도표|figure|table|appendix|부록)/i.test(longText)) {
      score += 0.04
      reasons.push("pdf_layout_evidence_bonus")
    }
  }

  if (canonicalTask === "excel") {
    const text = normalizeText(candidate.answer_text)
    if (/(SUM|VLOOKUP|XLOOKUP|INDEX|MATCH|피벗|조건부 서식|수식|함수)/i.test(text)) {
      score += 0.05
      reasons.push("excel_formula_bonus")
    }
    if (/(열|행|시트|컬럼|필드|헤더|표)/i.test(text)) {
      score += 0.03
      reasons.push("excel_sheet_structure_bonus")
    }
  }

  if (canonicalTask === "ppt") {
    const text = normalizeText(candidate.answer_text)
    if (/(슬라이드|slide|타이틀|목차|페이지|비주얼|차트|스토리라인)/i.test(text)) {
      score += 0.05
      reasons.push("ppt_storyline_bonus")
    }
    if (/(1장|2장|3장|slide\s*1|agenda)/i.test(text)) {
      score += 0.03
      reasons.push("ppt_page_plan_bonus")
    }
  }

  if (canonicalTask === "legal_review") {
    const text = normalizeText(candidate.answer_text)
    if (/(법령|조문|판례|약관|계약서|책임|손해배상|해지|면책)/i.test(text)) {
      score += 0.05
      reasons.push("legal_basis_bonus")
    }
    if (/(high|medium|low|고위험|중위험|저위험)/i.test(text)) {
      score += 0.04
      reasons.push("legal_severity_bonus")
    }
    if (/(수정안|수정 문안|대체 문구|권고 조항)/i.test(text)) {
      score += 0.05
      reasons.push("legal_redraft_bonus")
    }
  }

  if (canonicalTask === "data_analysis") {
    const text = normalizeText(candidate.answer_text)
    if (/(추세|트렌드|상관|이상치|분산|증감|전환율|리텐션)/i.test(text)) {
      score += 0.04
      reasons.push("data_pattern_bonus")
    }
    if (/(차트|그래프|시각화|대시보드|축|bar|line|scatter)/i.test(text)) {
      score += 0.03
      reasons.push("data_visualization_bonus")
    }
  }

  if (canonicalTask === "finance_analysis") {
    const text = normalizeText(candidate.answer_text)
    if (/(per|pbr|roe|ebitda|fcf|부채비율|영업이익률|유동비율)/i.test(text)) {
      score += 0.05
      reasons.push("finance_metric_bonus")
    }
    if (/(밸류에이션|멀티플|시나리오|업계 평균|peer)/i.test(text)) {
      score += 0.04
      reasons.push("finance_comparison_bonus")
    }
  }

  if (canonicalTask === "product_development") {
    const text = normalizeText(candidate.answer_text)
    if (/(usp|차별화|포지셔닝|타겟 고객|gtm|출시|유통|가격 전략)/i.test(text)) {
      score += 0.05
      reasons.push("product_strategy_bonus")
    }
    if (/(시장 규모|경쟁사|페르소나|로드맵|채널 전략)/i.test(text)) {
      score += 0.04
      reasons.push("product_market_bonus")
    }
  }

  const answerLength = normalizeText(candidate.answer_text).length
  const tooShortThreshold = canonicalTask === "dialogue"
    ? 40
    : canonicalTask === "writing_creative"
      ? 60
      : 80
  const tooShortPenalty = canonicalTask === "dialogue" ? 0.02 : 0.04

  if (answerLength < tooShortThreshold) {
    score -= tooShortPenalty
    reasons.push("too_short_penalty")
  }

  if (hasMetaResponse(candidate.answer_text)) {
    score -= 0.12
    reasons.push("meta_response_penalty")
  }

  return {
    provider: candidate.provider,
    score: round4(clamp(score, 0, 1)),
    reasons,
  }
}

const TASK_RUBRIC: Record<CanonicalTask, string> = {
  dialogue: `
평가 기준 (각 항목 0-10점):
1. 즉각성: 서론/면책조항 없이 바로 답변에 진입하는가?
2. 정확성: 사실 오류나 논리적 모순이 없는가?
3. 간결성: 불필요한 반복 없이 핵심만 전달하는가?
4. 의도 파악: 사용자가 원하는 것을 정확히 이해했는가?
5. 실용성: 즉시 활용 가능한 정보를 제공하는가?
6. 완결성: 질문의 핵심 부분에 모두 답했는가?
감점: 메타 응답 시작, 과도한 장황함.`,

  reasoning: `
평가 기준 (각 항목 0-10점):
1. 논리 흐름
2. 근거 품질
3. 반론 고려
4. 결론 명확성
5. 일관성
6. 독립성
감점: 결론 회피, 근거 없는 단정, 환각 사실 인용.`,

  research: `
평가 기준 (각 항목 0-10점):
1. 사실 정확성
2. 포괄성
3. 구조화
4. 깊이
5. 실용성
가점: 출처, 데이터, 비교 표, 명확한 권고안.`,

  code_implement: `
평가 기준 (각 항목 0-10점):
1. 실행 가능성
2. 완전성
3. 코드 품질
4. 문제 해결 적합성
5. 파일/함수 수준 구체성
감점: placeholder, TODO, 코드 없이 설명만 제시.`,

  code_debug: `
평가 기준 (각 항목 0-10점):
1. root cause 정렬성
2. 수정 최소성
3. 재현/검증 단계 제시
4. 회귀 리스크 고려
5. 실제 패치 가능성
감점: 증상만 가리고 원인을 놓침.`,

  code_refactor_review: `
평가 기준 (각 항목 0-10점):
1. 구조적 문제 식별
2. 책임 분리 적절성
3. 멀티파일 일관성
4. break risk / migration note 품질
5. 제안의 실행 가능성
감점: 과도한 재작성, 추상화 남용, 영향 범위 누락.`,

  writing_creative: `
평가 기준 (각 항목 0-10점):
1. 창의성: 진부하지 않은 발상, 신선한 관점, 예상 밖의 표현 사용
2. 톤 일관성: 전체 글에서 목소리/감성/스타일이 일관되게 유지되는가
3. 감정/이미지 전달력: 독자가 시각적으로 상상하고 감정이입할 수 있는 묘사
4. 완성도: 시작-전개-결말 구조가 있고, 끊김 없이 완결된 작품인가
5. 독창성: 다른 작품과 차별되는 고유한 목소리와 세계관
6. 서사 흐름: 리듬감, 긴장-이완, 장면 전환의 자연스러움
7. 언어 밀도: 불필요한 수식어 없이 핵심 이미지가 응축된 표현
감점: 클리셰 표현, 과도한 장황함, 평면적 캐릭터, 설명적 서술, AI 특유의 틀에 박힌 문장 구조.
가점: 독자에게 여운을 남기는 마무리, 감각적 디테일, 예상을 비트는 반전.`,

  writing_business: `
평가 기준 (각 항목 0-10점):
1. 명확성
2. 구조화
3. 실행 가능성
4. 리스크/가정 명시
5. 독자 적합성
가점: 다음 단계, 우선순위, 일정/예산/실행안.`,

  long_doc: `
평가 기준 (각 항목 0-10점):
1. 핵심 추출
2. 리스크 분석
3. 구조화
4. 실행 권고
5. 완결성
가점: 수치 인용, 시나리오, 우선순위.`,

  excel: `
평가 기준 (각 항목 0-10점):
1. 계산/수식 정확성
2. 시트 구조 제안
3. 필드 정의 명확성
4. 실무 활용성
5. 검증 가능성
가점: 함수 예시, 컬럼 구조, 검증 규칙.`,

  ppt: `
평가 기준 (각 항목 0-10점):
1. 스토리라인
2. 슬라이드 구조
3. 시각화 적합성
4. 메시지 우선순위
5. 발표용 완성도
가점: 슬라이드별 구성안, 차트/도식 제안.`,

  word: `
평가 기준 (각 항목 0-10점):
1. 문서 구조
2. 명확성
3. 실행 가능성
4. 독자 적합성
5. 완결성
가점: 제목/섹션/권고안/체크리스트.`,

  pdf: `
평가 기준 (각 항목 0-10점):
1. 문서 내용 파악 정확성
2. 표/차트/부록 등 시각 요소 반영
3. 핵심 위험/포인트 추출
4. 구조화
5. 활용 가능한 요약/권고
감점: 원문 재복붙, 표/차트 무시.`,

  legal_review: `
평가 기준 (각 항목 0-10점):
1. 위험 식별: 법적 리스크와 불리한 조항을 정확히 찾아냈는가?
2. 근거 명확성: 관련 법령/판례를 구체적으로 인용했는가?
3. 심각도 분류: HIGH/MEDIUM/LOW 위험 등급이 적절한가?
4. 수정 권고: 실행 가능한 구체적 수정안을 제시했는가?
5. 구조화: 조항별로 체계적으로 정리되어 있는가?
가점 요소: 법령 조문 인용, 판례 언급, 수정 문안 제시`,

  data_analysis: `
평가 기준 (각 항목 0-10점):
1. 수치 정확성: 통계/지표 계산이 올바른가?
2. 패턴 발견: 트렌드, 이상치, 상관관계를 명확히 식별했는가?
3. 인사이트: 데이터를 비즈니스 관점으로 해석했는가?
4. 시각화 제안: 적절한 차트/그래프 유형을 제안했는가?
5. 실행 가능성: 즉시 활용 가능한 권고사항이 있는가?
가점 요소: 구체적 수치, 비교 기준 제시, 액션 플랜`,

  finance_analysis: `
평가 기준 (각 항목 0-10점):
1. 지표 정확성: PER/PBR/ROE 등 재무 지표 계산이 정확한가?
2. 비교 분석: 업계 평균 대비 비교가 포함되어 있는가?
3. 다각도 분석: 수익성/안정성/성장성을 모두 다뤘는가?
4. 리스크 식별: 재무적 위험 요소를 명확히 제시했는가?
5. 투자 관점: 객관적인 투자 관점의 종합 평가가 있는가?
가점 요소: 수치 인용, 산업 비교, 시나리오 분석`,

  product_development: `
평가 기준 (각 항목 0-10점):
1. 시장 분석: 타겟 시장과 경쟁 환경을 정확히 파악했는가?
2. 차별화: 명확한 USP(핵심 차별점)를 제시했는가?
3. 실행 가능성: GTM 전략이 구체적이고 실행 가능한가?
4. 리스크: 예상 위험과 대응 방안을 포함했는가?
5. 구조화: 기획서 형식으로 체계적으로 정리되어 있는가?
가점 요소: 시장 규모 수치, 경쟁사 비교, 실행 타임라인`,

  code: `전반적인 코드 품질, 실행 가능성, 정확성, 유지보수성을 기준으로 평가하세요.`,
  writing: `전반적인 글의 완성도, 구조, 설득력, 활용성을 기준으로 평가하세요.`,
  generic: `전반적인 품질, 정확성, 유용성, 직접성을 기준으로 평가하세요.`,
}

async function aiJudge(params: {
  candidates: JudgeCandidate[]
  task: CanonicalTask
  question: string
  judgeProvider: JudgeProvider
}): Promise<{ winner: string; scores: Record<string, number>; rationale: string; judgeProvider: JudgeProvider } | null> {
  const rubric = TASK_RUBRIC[params.task] ?? TASK_RUBRIC.generic

  const candidateSummaries = params.candidates
    .map((candidate, index) => {
      const text = String(candidate.answer_text ?? "").slice(0, 2000)
      return `[답변 ${index + 1} - ${candidate.provider}]\n${text}`
    })
    .join("\n\n---\n\n")

  const prompt = `당신은 AI 응답 품질 평가 전문가입니다. 아래 기준에 따라 엄격하고 공정하게 평가하세요.

[Task 유형]: ${params.task}

[평가 루브릭]:
${rubric}

[사용자 질문]:
${params.question.slice(0, 400)}

[평가 대상 답변 ${params.candidates.length}개]:
${candidateSummaries}

지시사항:
- 각 답변에 0-10점을 부여하세요 (소수점 1자리)
- 점수 차이가 의미있게 나타나도록 변별력 있게 평가하세요
- 길이가 길다고 좋은 것이 아닙니다
- 반드시 아래 JSON만 출력하세요

{
  "winner": "provider_name",
  "scores": {"provider1": 8.5, "provider2": 7.2},
  "rationale": "선택 이유를 한 문장으로"
}`

  try {
    let responseText = ""

    if (params.judgeProvider === "openai") {
      const openaiKey = String(process.env.OPENAI_API_KEY ?? "").trim()
      if (!openaiKey) return null

      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.OPENAI_JUDGE_MODEL || "gpt-5.2",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 500,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(20000),
      })
      const data = await resp.json().catch(() => ({}))
      responseText = String((data as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content ?? "")
    } else {
      const claudeKey = String(process.env.ANTHROPIC_API_KEY ?? "").trim()
      if (!claudeKey) return null

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": claudeKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.CLAUDE_JUDGE_MODEL || "claude-sonnet-4-6",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 500,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(20000),
      })
      const data = await resp.json().catch(() => ({}))
      responseText = String((data as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? "")
    }

    const clean = responseText.replace(/```json|```/g, "").trim()
    const parsed = JSON.parse(clean) as { winner?: string; scores?: Record<string, number>; rationale?: string }
    if (!parsed?.winner || !parsed?.scores) return null

    return {
      winner: String(parsed.winner),
      scores: parsed.scores,
      rationale: String(parsed.rationale ?? ""),
      judgeProvider: params.judgeProvider,
    }
  } catch {
    return null
  }
}

export async function judge(params: {
  candidates: JudgeCandidate[]
  task?: string
  conflicts?: DetectedConflict[]
  question?: string
}) {
  const candidates = Array.isArray(params?.candidates) ? params.candidates : []
  const canonicalTask = normalizeTask(String(params?.task ?? ""))
  const conflicts = Array.isArray(params?.conflicts) ? params.conflicts : []
  const question = String(params?.question ?? "").trim()

  if (candidates.length === 0) {
    return {
      provider: null,
      answer_text: "",
      ok: false,
      meta: {
        judge_selected_provider: null,
        judge_scores: [],
        judge_rationale: "no_candidates",
        judge_confidence: 0,
        conflict_count: 0,
        conflicts: [],
        claims: [],
      },
    }
  }

  if (candidates.length === 1) {
    return {
      ...candidates[0],
      ok: true,
      meta: {
        judge_selected_provider: candidates[0].provider,
        judge_scores: [{ provider: candidates[0].provider, score: 1, reasons: ["single_candidate"] }],
        judge_rationale: "single_candidate",
        judge_confidence: 1,
        conflict_count: conflicts.length,
        conflicts,
        claims: [],
      },
    }
  }

  const heuristicScores = candidates
    .map((candidate) => scoreCandidate(candidate, canonicalTask, conflicts))
    .sort((a, b) => b.score - a.score)

  const scoreboardWeights: Record<string, number> = {}
  for (const candidate of candidates) {
    try {
      const routing = getProviderRoutingScore(candidate.provider, canonicalTask)
      const winRate = Number((routing as { effective_win_rate?: number; blended_win_rate?: number } | undefined)?.effective_win_rate ?? (routing as { blended_win_rate?: number } | undefined)?.blended_win_rate ?? 0.5)
      scoreboardWeights[candidate.provider] = round4(clamp(winRate, 0.35, 0.85))
    } catch {
      scoreboardWeights[candidate.provider] = 0.5
    }
  }

  const preliminaryScores = heuristicScores
    .map((row) => {
      const sbWeight = scoreboardWeights[row.provider] ?? 0.5
      return {
        provider: row.provider,
        score: round4(clamp((row.score * 0.7) + (sbWeight * 0.3), 0, 1)),
        reasons: [...row.reasons, `scoreboard_win_rate:${sbWeight.toFixed(2)}`],
      }
    })
    .sort((a, b) => b.score - a.score)

  const { primaryProvider, verifierProvider } = inferPrimaryAndVerifier(candidates)
  // primary provider bonus — 동점일 때 primary(Claude) 우선
  const primaryBonus: Record<string, number> = {}
  for (const candidate of candidates) {
    primaryBonus[candidate.provider] = candidate.provider === String(primaryProvider ?? "").trim().toLowerCase() ? 0.03 : 0
  }

  const judgeProvider = chooseJudgeProvider({
    task: canonicalTask,
    primaryProvider,
    verifierProvider,
  })

  let aiResult: { winner: string; scores: Record<string, number>; rationale: string; judgeProvider: JudgeProvider } | null = null
  if (shouldRunAIJudge({
    task: canonicalTask,
    candidates,
    conflicts,
    preliminaryScores,
  })) {
    aiResult = await aiJudge({
      candidates,
      task: canonicalTask,
      question,
      judgeProvider,
    }).catch(() => null)
  }

  const blendedScores = heuristicScores
    .map((row) => {
      const aiScore = aiResult?.scores?.[row.provider]
      const aiNormalized = typeof aiScore === "number" ? aiScore / 10 : null
      const sbWeight = scoreboardWeights[row.provider] ?? 0.5

      const blended = aiNormalized !== null
        ? (aiNormalized * 0.5) + (row.score * 0.3) + (sbWeight * 0.2)
        : (row.score * 0.7) + (sbWeight * 0.3)

      const pBonus = primaryBonus[row.provider] ?? 0
      return {
        provider: row.provider,
        score: round4(clamp(blended + pBonus, 0, 1)),
        reasons: [
          ...row.reasons,
          aiNormalized !== null ? `ai_judge:${aiNormalized.toFixed(2)}` : "ai_judge:skipped_or_fallback",
          `scoreboard_win_rate:${sbWeight.toFixed(2)}`,
        ],
      }
    })
    .sort((a, b) => b.score - a.score)

  const winner = blendedScores[0]
  const runnerUp = blendedScores[1]
  const scoreDiff = (winner?.score ?? 0) - (runnerUp?.score ?? 0)
  const winnerScore = winner?.score ?? 0

  const confidence = round4(clamp(
    (winnerScore * 0.4) + Math.min(scoreDiff * 3.0, 0.25) + (aiResult ? 0.18 : 0) + 0.25,
    0.55,
    0.98,
  ))

  const selected = candidates.find((candidate) => candidate.provider === winner.provider) ?? candidates[0]

  if (canonicalTask && selected.provider) {
    const losers = candidates.filter((candidate) => candidate.provider !== selected.provider).map((candidate) => candidate.provider)
    try {
      recordJudgeOutcome({
        winner: selected.provider,
        losers,
        task: canonicalTask,
        judge_confidence: confidence,
        source: "judge_auto",
      })
    } catch {
      // noop
    }
  }

  return {
    ...selected,
    ok: true,
    meta: {
      judge_selected_provider: selected.provider,
      judge_scores: blendedScores,
      judge_rationale: aiResult?.rationale
        ? `AI(${aiResult.judgeProvider}): ${aiResult.rationale}`
        : `selected ${selected.provider} by heuristic+scoreboard`,
      judge_confidence: confidence,
      conflict_count: conflicts.length,
      conflicts,
      claims: [],
      ai_judge_used: Boolean(aiResult),
      judge_provider: aiResult?.judgeProvider ?? null,
      scoreboard_weights: scoreboardWeights,
      canonical_task: canonicalTask,
    },
  }
}
