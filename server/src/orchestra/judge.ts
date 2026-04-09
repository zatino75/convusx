import fs from "fs"
import fsp from "fs/promises"
import type { DetectedConflict } from "./conflicts.js"
import { getProviderRoutingScore, recordJudgeOutcome } from "./scoreboard.js"
import type { CanonicalTask } from "../types/tasks.js"
import { CANONICAL_TASKS, HIGH_STAKES_TASKS, normalizeTask } from "../types/tasks.js"
import { logger } from "../observability/logger.js"
import { OPENAI_BASE, ANTHROPIC_BASE, GEMINI_BASE } from "../config/defaults.js"

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

type JudgeProvider = "claude" | "openai" | "gemini"


// HIGH_STAKES_TASKS, CANONICAL_TASKS, normalizeTask → imported from ../types/tasks.js

function normalizeText(input: string): string {
  return String(input ?? "").replace(/\r\n/g, "\n").trim()
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function round4(value: number): number {
  return Number(value.toFixed(4))
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

function countMarkdownTables(text: string): { tableCount: number; totalRows: number } {
  const normalized = normalizeText(text)
  const lines = normalized.split("\n")
  let tableCount = 0
  let totalRows = 0
  let inTable = false

  for (const line of lines) {
    const isTableLine = /^\s*\|.+\|/.test(line)
    if (isTableLine) {
      if (!inTable) { tableCount++; inTable = true }
      // separator 행(|---|---|) 제외하고 카운트
      if (!/^\s*\|[\s:]*-{2,}/.test(line)) totalRows++
    } else {
      inTable = false
    }
  }
  return { tableCount, totalRows }
}

function estimateCoverage(answer: string): number {
  const text = normalizeText(answer)
  const sentences = splitSentences(answer)

  // 테이블이 포함된 응답: 테이블 품질 기반 coverage (글자 수 편향 제거)
  const { tableCount, totalRows } = countMarkdownTables(text)
  if (tableCount >= 1 && totalRows >= 3) {
    const tableScore = Math.min(1, tableCount * 0.25 + totalRows * 0.05)
    const textScore = Math.min(1, text.length / 1200)
    // 테이블 품질 70%, 텍스트 보충 30%
    return round4(tableScore * 0.7 + textScore * 0.3)
  }

  // 일반 응답: 기존 로직
  const lengthScore = Math.min(1, text.length / 800)
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

  // ── 테이블(표) 감지 보너스: Markdown 테이블 사용 시 구조 점수 가산 ──
  const tableRows = text.match(/(?:^|\n)\s*\|[^|\n]+\|/g) ?? []
  const tableSeparator = /(?:^|\n)\s*\|[\s:]*-{2,}[\s:]*\|/.test(text)
  if (tableRows.length >= 3 && tableSeparator) {
    score += 0.15  // 유효한 Markdown 테이블
    if (tableRows.length >= 6) score += 0.05  // 6행 이상 상세 테이블 추가 보너스
  }

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
  // A안: Gemini Flash를 중립 심판으로 사용
  // Gemini는 오케스트라 메인 대화에 참여하지 않으므로 공정성 보장
  // reasoning에서 Gemini Pro가 primary이지만, Judge는 Flash(다른 모델)이므로 허용
  const geminiKey = String(process.env.GEMINI_API_KEY ?? "").trim()
  if (geminiKey) return "gemini"

  // Gemini API 키 없을 때 폴백: 기존 로직 (경쟁자가 아닌 쪽 선택)
  const primary = String(params.primaryProvider ?? "")
  const verifier = String(params.verifierProvider ?? "")
  if (isClaudeProvider(primary) || isClaudeProvider(verifier)) return "openai"
  if (isOpenAIProvider(primary) || isOpenAIProvider(verifier)) return "claude"
  return "claude"
}

function shouldRunAIJudge(params: {
  task: CanonicalTask
  candidates: JudgeCandidate[]
  conflicts: DetectedConflict[]
  preliminaryScores: JudgeScoreRow[]
  executionStrategy?: string
}): boolean {
  const enabled = String(process.env.ENABLE_AI_JUDGE ?? "true").toLowerCase() !== "false"
  if (!enabled) return false
  if (params.candidates.length < 2) return false

  const winner = params.preliminaryScores[0]
  const runnerUp = params.preliminaryScores[1]
  if (!winner || !runnerUp) return false

  const diff = Math.abs(winner.score - runnerUp.score)
  const strategy = String(params.executionStrategy ?? "").toLowerCase()
  const highConflict = params.conflicts.some((conflict) => String(conflict?.severity ?? "").toLowerCase() === "high")
  const mediumPlusConflict = params.conflicts.some((conflict) => ["high", "medium"].includes(String(conflict?.severity ?? "").toLowerCase()))

  // ── 비용 제어: execution strategy 기반 ──
  // single_primary (fast mode): AI Judge 거의 사용 안 함 — heuristic + scoreboard로 충분
  // high conflict 같은 극단적 상황만 예외
  if (strategy === "single_primary") {
    if (highConflict && diff < 0.08) return true
    return false
  }

  // parallel_primary (verify 없는 병렬): 보수적으로 AI Judge 사용
  if (strategy === "parallel_primary") {
    if (highConflict) return true
    if (diff < 0.06 && HIGH_STAKES_TASKS.has(params.task)) return true
    return false
  }

  // parallel_primary_verifier / parallel_primary_verifier_optional: 본격 Judge 모드
  // Gemini Flash Judge가 설정된 경우 저비용이므로 적극적으로 사용
  const useGeminiJudge = String(process.env.GEMINI_API_KEY ?? "").trim().length > 0
  if (useGeminiJudge) {
    if (diff < 0.15) return true
    if (mediumPlusConflict) return true
    if (HIGH_STAKES_TASKS.has(params.task)) return true
    return false
  }

  // Fallback: OpenAI/Claude Judge (고비용이므로 보수적)
  if (HIGH_STAKES_TASKS.has(params.task) && (diff < 0.12 || mediumPlusConflict)) return true
  if (highConflict) return true
  if (diff < 0.06) return true

  return false
}

// ── Task 전용 품질 평가축 (4번째 축) ──
// coverage/structure/specificity는 범용 축이고, 이 함수는 task마다 고유한 품질 기준을 평가합니다.
function estimateTaskSpecificQuality(answer: string, task: CanonicalTask): { score: number; reasons: string[] } {
  const text = normalizeText(answer)
  const reasons: string[] = []
  let score = 0.4 // neutral baseline

  switch (task) {
    case "code_implement": {
      // 완성도: 실행 가능한 코드 블록, import문, 에러 처리
      const codeFences = (text.match(/```/g) ?? []).length / 2
      const hasImport = /(import |require\(|from ['"])/i.test(text)
      const hasErrorHandling = /(try\s*\{|catch\s*\(|\.catch\(|if\s*\(\s*!|throw\s+new)/i.test(text)
      const hasExport = /(export\s+(default\s+)?|module\.exports)/i.test(text)
      if (codeFences >= 1) { score += 0.15; reasons.push("tsq_code_block") }
      if (hasImport) { score += 0.1; reasons.push("tsq_import") }
      if (hasErrorHandling) { score += 0.1; reasons.push("tsq_error_handling") }
      if (hasExport) { score += 0.05; reasons.push("tsq_export") }
      if (/(TODO|FIXME|placeholder|your.*here)/i.test(text)) { score -= 0.15; reasons.push("tsq_placeholder_penalty") }
      break
    }
    case "code_debug": {
      // root cause 분석, 최소 수정, 검증 단계
      const hasRootCause = /(root cause|원인|버그.*원인|문제.*원인|이유는|because.*bug|the issue is)/i.test(text)
      const hasMinimalFix = /(수정.*방법|fix:|해결|patch|변경.*부분만|minimal|최소)/i.test(text)
      const hasVerification = /(테스트|검증|확인.*방법|verify|reproduce|재현|이렇게.*확인)/i.test(text)
      const hasStackTrace = /(stack\s*trace|에러\s*로그|error.*log|traceback|line\s+\d+)/i.test(text)
      if (hasRootCause) { score += 0.15; reasons.push("tsq_root_cause") }
      if (hasMinimalFix) { score += 0.1; reasons.push("tsq_minimal_fix") }
      if (hasVerification) { score += 0.1; reasons.push("tsq_verification") }
      if (hasStackTrace) { score += 0.05; reasons.push("tsq_stack_trace") }
      if (!hasRootCause) { score -= 0.1; reasons.push("tsq_no_root_cause_penalty") }
      break
    }
    case "code_refactor_review": {
      // 구조 분석, 의존성, 롤백 간편성, 다파일 일관성
      const hasStructureAnalysis = /(구조|아키텍처|결합도|의존성|책임|SRP|관심사|모듈|dependency|coupling|cohesion)/i.test(text)
      const hasRollbackConsideration = /(롤백|rollback|되돌리|revert|호환성|하위.*호환|backward)/i.test(text)
      const hasMultiFileAwareness = /(파일.*수정|여러.*파일|다른.*파일|import.*변경|affected.*files|impacted)/i.test(text)
      const hasBefore_after = /(기존|변경.*전|변경.*후|before|after|현재.*코드|제안.*코드)/i.test(text)
      if (hasStructureAnalysis) { score += 0.12; reasons.push("tsq_structure_analysis") }
      if (hasRollbackConsideration) { score += 0.08; reasons.push("tsq_rollback") }
      if (hasMultiFileAwareness) { score += 0.1; reasons.push("tsq_multi_file") }
      if (hasBefore_after) { score += 0.08; reasons.push("tsq_before_after") }
      break
    }
    case "writing_business": {
      // 완결성, 실행 가능성, 구조적 명확성
      const hasActionItems = /(실행.*항목|action\s*item|다음\s*단계|next\s*step|로드맵|타임라인|일정|deadline)/i.test(text)
      const hasMetrics = /(\d+[\.,]?\d*\s*(?:%|억|만|원|달러|\$|건|명)|KPI|ROI|전환율|지표)/i.test(text)
      const hasRiskAnalysis = /(리스크|위험|주의.*사항|고려.*사항|risk|caveat|limitation|제약)/i.test(text)
      const hasExecOwner = /(담당|책임자|팀|부서|owner|assignee|R&R)/i.test(text)
      if (hasActionItems) { score += 0.12; reasons.push("tsq_action_items") }
      if (hasMetrics) { score += 0.1; reasons.push("tsq_metrics") }
      if (hasRiskAnalysis) { score += 0.08; reasons.push("tsq_risk") }
      if (hasExecOwner) { score += 0.06; reasons.push("tsq_ownership") }
      break
    }
    case "writing_creative": {
      // 문체, 서사, 감성, 독창성
      const hasToneVoice = /(톤|보이스|문체|어조|분위기|tone|voice|style|mood)/i.test(text)
      const hasNarrative = /(서사|스토리|이야기|캐릭터|비유|metaphor|imagery|narrative)/i.test(text)
      const hasEmotionalDepth = /(감정|감성|공감|몰입|tension|emotion|empathy|심리)/i.test(text)
      const avgSentenceLen = text.length / Math.max(1, splitSentences(text).length)
      const hasVariety = avgSentenceLen > 15 && avgSentenceLen < 80
      if (hasToneVoice) { score += 0.1; reasons.push("tsq_tone") }
      if (hasNarrative) { score += 0.1; reasons.push("tsq_narrative") }
      if (hasEmotionalDepth) { score += 0.08; reasons.push("tsq_emotion") }
      if (hasVariety) { score += 0.06; reasons.push("tsq_variety") }
      break
    }
    case "pdf": {
      // 추출 정확성, 구조 보존, 사실 인용
      const hasPageRef = /(페이지|page\s*\d|p\.\s*\d|\d+쪽|섹션)/i.test(text)
      const hasQuotation = /[""].*[""]|『.*』|「.*」/.test(text)
      const hasStructuredExtract = /(표|테이블|목차|항목|섹션.*\d|figure|table\s*\d)/i.test(text)
      const { tableCount } = countMarkdownTables(text)
      if (hasPageRef) { score += 0.1; reasons.push("tsq_page_ref") }
      if (hasQuotation) { score += 0.08; reasons.push("tsq_quotation") }
      if (hasStructuredExtract) { score += 0.08; reasons.push("tsq_structured_extract") }
      if (tableCount >= 1) { score += 0.1; reasons.push("tsq_table_extract") }
      break
    }
    case "excel": {
      // 수식/함수 포함, 데이터 구조, 실행 가능성
      const hasFormula = /(=SUM|=VLOOKUP|=IF\(|=INDEX|=AVERAGE|=COUNT|수식|formula|함수)/i.test(text)
      const hasDataStructure = /(컬럼|행|열|시트|워크시트|column|row|sheet|header)/i.test(text)
      const { tableCount } = countMarkdownTables(text)
      const hasConcreteSteps = /(단계|step|방법|절차|이렇게.*하세요|순서)/i.test(text)
      if (hasFormula) { score += 0.15; reasons.push("tsq_formula") }
      if (hasDataStructure) { score += 0.1; reasons.push("tsq_data_structure") }
      if (tableCount >= 1) { score += 0.08; reasons.push("tsq_table") }
      if (hasConcreteSteps) { score += 0.06; reasons.push("tsq_steps") }
      break
    }
    case "ppt": {
      // 슬라이드 구조, 핵심 메시지, 시각화 제안
      const hasSlideStructure = /(슬라이드|slide|장|페이지.*구성|목차|agenda)/i.test(text)
      const hasKeyMessage = /(핵심.*메시지|key.*message|주요.*포인트|takeaway|결론)/i.test(text)
      const hasVisualSuggestion = /(차트|그래프|다이어그램|인포그래픽|시각화|visual|chart|graph|diagram)/i.test(text)
      const hasAudienceAwareness = /(청중|대상|타겟|audience|목적|의도)/i.test(text)
      if (hasSlideStructure) { score += 0.12; reasons.push("tsq_slide_structure") }
      if (hasKeyMessage) { score += 0.1; reasons.push("tsq_key_message") }
      if (hasVisualSuggestion) { score += 0.08; reasons.push("tsq_visual") }
      if (hasAudienceAwareness) { score += 0.06; reasons.push("tsq_audience") }
      break
    }
    case "word": {
      // 문서 완결성, 포맷팅, 목차 수준 구조
      const hasDocStructure = /(목차|서론|본론|결론|부록|참고.*문헌|table\s*of\s*contents|appendix)/i.test(text)
      const hasFormalTone = /(귀사|당사|검토|승인|결재|수신|참조|제목|관련)/i.test(text)
      const hasPageAwareness = /(페이지|머리글|바닥글|header|footer|page\s*break)/i.test(text)
      if (hasDocStructure) { score += 0.12; reasons.push("tsq_doc_structure") }
      if (hasFormalTone) { score += 0.08; reasons.push("tsq_formal") }
      if (hasPageAwareness) { score += 0.06; reasons.push("tsq_page_format") }
      break
    }
    case "legal_review": {
      // 법적 정확성, 조항 인용, 리스크 평가
      const hasLegalRef = /(제\d+조|조항|법률|법령|계약서|약관|clause|section\s*\d|article)/i.test(text)
      const hasRiskAssessment = /(리스크|위험|주의|쟁점|분쟁.*가능|소송|liability|exposure|risk)/i.test(text)
      const hasRecommendation = /(권고|조치|수정.*필요|삭제.*필요|추가.*필요|recommend|should\s*be)/i.test(text)
      if (hasLegalRef) { score += 0.15; reasons.push("tsq_legal_ref") }
      if (hasRiskAssessment) { score += 0.12; reasons.push("tsq_legal_risk") }
      if (hasRecommendation) { score += 0.08; reasons.push("tsq_legal_rec") }
      break
    }
    case "finance_analysis": {
      // 수치, 비교, 추세, 근거
      const hasNumbers = extractNumbers(text).length >= 3
      const hasTrend = /(추세|증가|감소|성장|하락|전년.*대비|YoY|QoQ|MoM|trend)/i.test(text)
      const hasComparison = /(대비|비교|versus|vs|차이|gap|benchmark)/i.test(text)
      const hasSource = /(출처|자료|보고서|기준일|as\s*of|source|report)/i.test(text)
      if (hasNumbers) { score += 0.12; reasons.push("tsq_numbers") }
      if (hasTrend) { score += 0.1; reasons.push("tsq_trend") }
      if (hasComparison) { score += 0.08; reasons.push("tsq_comparison") }
      if (hasSource) { score += 0.06; reasons.push("tsq_source") }
      break
    }
    case "data_analysis": {
      // 데이터 해석, 시각화 제안, 통계적 근거
      const hasStatistic = /(평균|중앙값|표준편차|분산|상관|회귀|mean|median|std|p-value|correlation)/i.test(text)
      const hasInsight = /(인사이트|발견|패턴|이상치|특이|insight|finding|pattern|anomaly|outlier)/i.test(text)
      const hasVisualization = /(차트|그래프|히스토그램|산점도|히트맵|chart|plot|visualization)/i.test(text)
      if (hasStatistic) { score += 0.12; reasons.push("tsq_statistic") }
      if (hasInsight) { score += 0.1; reasons.push("tsq_insight") }
      if (hasVisualization) { score += 0.08; reasons.push("tsq_vis_suggest") }
      break
    }
    case "reasoning": {
      // 논증 단계, 반례 고려, 전제 명시
      const hasSteps = /(?:^|\n)\s*(?:\d+[.)\s]|첫째|둘째|셋째|Step\s*\d)/im.test(text)
      const hasCounterpoint = /(그러나|반면|하지만|한편|비판|한계|반론|counterargument|however|on\s*the\s*other)/i.test(text)
      const hasPremise = /(전제|가정|조건|만약|assuming|given\s*that|premise|if\s*we\s*assume)/i.test(text)
      const hasConclusion = /(따라서|결론|그러므로|therefore|hence|in\s*conclusion)/i.test(text)
      if (hasSteps) { score += 0.1; reasons.push("tsq_steps") }
      if (hasCounterpoint) { score += 0.1; reasons.push("tsq_counterpoint") }
      if (hasPremise) { score += 0.08; reasons.push("tsq_premise") }
      if (hasConclusion) { score += 0.08; reasons.push("tsq_conclusion") }
      break
    }
    case "research": {
      // 출처, 데이터, 다각적 관점
      const hasCitation = /(출처|참고|source|https?:\/\/|according\s*to|에\s*따르면|\[\d+\])/i.test(text)
      const hasData = /\d+[\.,]?\d*\s*(?:%|억|만|원|달러|\$|명|건|배)/i.test(text)
      const hasMultiPerspective = /(반면|한편|다른.*관점|일부.*주장|비판|supporters|critics|on\s*the\s*other)/i.test(text)
      const hasRecency = /(2024|2025|2026|최근|latest|recent|올해)/i.test(text)
      if (hasCitation) { score += 0.12; reasons.push("tsq_citation") }
      if (hasData) { score += 0.08; reasons.push("tsq_data") }
      if (hasMultiPerspective) { score += 0.08; reasons.push("tsq_multi_perspective") }
      if (hasRecency) { score += 0.06; reasons.push("tsq_recency") }
      break
    }
    default: {
      // dialogue, generic 등 — 직접성, 메타 응답 회피
      if (hasMetaResponse(text)) { score -= 0.1; reasons.push("tsq_meta_penalty") }
      const isDirectAnswer = text.length >= 30 && !hasMetaResponse(text)
      if (isDirectAnswer) { score += 0.1; reasons.push("tsq_direct") }
      break
    }
  }

  return { score: round4(clamp(score, 0, 1)), reasons }
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
  const taskQuality = estimateTaskSpecificQuality(candidate.answer_text, canonicalTask)

  // 4축: coverage, structure, specificity, taskQuality
  // taskQuality는 task 전용 평가축으로 변별력의 핵심
  let coverageW = 0.18
  let structureW = 0.13
  let specificityW = 0.14
  let taskQualityW = 0.15  // 4번째 축 기본 가중치

  switch (canonicalTask) {
    case "code":
    case "code_implement":
      coverageW = 0.10
      structureW = 0.10
      specificityW = 0.18
      taskQualityW = 0.22  // 코드 완성도가 가장 중요
      break
    case "code_debug":
      coverageW = 0.10
      structureW = 0.10
      specificityW = 0.15
      taskQualityW = 0.25  // root cause + minimal fix 평가 비중 최대
      break
    case "code_refactor_review":
      coverageW = 0.12
      structureW = 0.12
      specificityW = 0.16
      taskQualityW = 0.20  // 구조 분석 + 롤백 고려
      break
    case "research":
      coverageW = 0.16
      structureW = 0.18
      specificityW = 0.10
      taskQualityW = 0.16  // 출처 + 다각적 관점
      break
    case "reasoning":
      coverageW = 0.14
      structureW = 0.10
      specificityW = 0.16
      taskQualityW = 0.20  // 논증 단계 + 반례
      break
    case "writing_creative":
      coverageW = 0.20
      structureW = 0.14
      specificityW = 0.08
      taskQualityW = 0.18  // 문체 + 서사
      break
    case "writing_business":
      coverageW = 0.16
      structureW = 0.18
      specificityW = 0.12
      taskQualityW = 0.20  // 실행 가능성 + 메트릭스
      break
    case "long_doc":
      coverageW = 0.20
      structureW = 0.20
      specificityW = 0.08
      taskQualityW = 0.12
      break
    case "dialogue":
      coverageW = 0.08
      structureW = 0.08
      specificityW = 0.18
      taskQualityW = 0.16  // 직접성, 메타 응답 회피
      break
    case "excel":
      coverageW = 0.12
      structureW = 0.18
      specificityW = 0.14
      taskQualityW = 0.22  // 수식/함수/데이터 구조
      break
    case "ppt":
      coverageW = 0.12
      structureW = 0.20
      specificityW = 0.14
      taskQualityW = 0.20  // 슬라이드 구조 + 시각화
      break
    case "word":
      coverageW = 0.16
      structureW = 0.20
      specificityW = 0.12
      taskQualityW = 0.16  // 문서 완결성
      break
    case "pdf":
      coverageW = 0.18
      structureW = 0.16
      specificityW = 0.10
      taskQualityW = 0.20  // 추출 정확성 + 구조 보존
      break
    case "legal_review":
      coverageW = 0.14
      structureW = 0.16
      specificityW = 0.16
      taskQualityW = 0.22  // 조항 인용 + 리스크
      break
    case "finance_analysis":
      coverageW = 0.14
      structureW = 0.16
      specificityW = 0.16
      taskQualityW = 0.22  // 수치 + 추세 분석
      break
    case "data_analysis":
      coverageW = 0.14
      structureW = 0.16
      specificityW = 0.14
      taskQualityW = 0.20  // 통계 + 인사이트
      break
    case "product_development":
      coverageW = 0.15
      structureW = 0.17
      specificityW = 0.15
      taskQualityW = 0.15
      break
  }

  let score = 0.40
  score += coverage * coverageW
  score += structure * structureW
  score += specificity * specificityW
  score += taskQuality.score * taskQualityW

  reasons.push(...taskQuality.reasons)

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

  // ── 테이블(표) 사용 보너스: 비교/분석/데이터 시각화 품질 평가 ──
  {
    const tableLines = (candidate.answer_text.match(/(?:^|\n)\s*\|[^|\n]+\|/g) ?? []).length
    const hasTableSep = /(?:^|\n)\s*\|[\s:]*-{2,}[\s:]*\|/.test(candidate.answer_text)
    if (tableLines >= 3 && hasTableSep) {
      // 유효한 Markdown 테이블 존재
      const highTableTasks = ["research", "reasoning", "finance_analysis", "data_analysis", "product_analysis", "legal_review"]
      const medTableTasks = ["dialogue", "writing_business", "code", "code_implement", "long_doc", "pdf_analysis"]
      if (highTableTasks.includes(canonicalTask)) {
        score += 0.08
        reasons.push("table_bonus")
        if (tableLines >= 6) { score += 0.04; reasons.push("table_detailed") }
      } else if (medTableTasks.includes(canonicalTask)) {
        score += 0.05
        reasons.push("table_bonus")
      } else {
        score += 0.03
        reasons.push("table_bonus")
      }
    }
  }

  // 결론 보너스: 표 중심 응답에서는 축소 (표 자체가 결론역할)
  if (/(결론|권고|추천|따라서|최종|결정|선택|recommend|conclusion|therefore)/i.test(candidate.answer_text)) {
    const { tableCount: conclusionTableCount } = countMarkdownTables(normalizeText(candidate.answer_text))
    if (conclusionTableCount >= 2) {
      score += 0.02  // 표 중심 응답: 축소
      reasons.push("conclusion_minor")
    } else {
      score += 0.05
      reasons.push("conclusion_bonus")
    }
  }

  // ── 보조 보너스 (taskQuality 4축과 중복 최소화하여 절반으로 축소) ──
  if (["code", "code_implement", "code_debug", "code_refactor_review"].includes(canonicalTask)) {
    const hasCodeFence = /```/.test(candidate.answer_text)
    if (hasCodeFence) {
      score += 0.02
      reasons.push("code_fence_bonus")
    }
    if (!hasCodeFence && canonicalTask !== "code_refactor_review") {
      score -= 0.06
      reasons.push("no_code_fence_penalty")
    }
  }

  if (["writing", "writing_creative", "writing_business", "word"].includes(canonicalTask)) {
    const textLen = candidate.answer_text.trim().length
    const writingText = normalizeText(candidate.answer_text)
    if (textLen >= 600) {
      score += 0.02
      reasons.push("writing_length_600_bonus")
    }
    const writingSections = writingText.match(/(?:^|\n)\s*(?:#{1,3}\s+\S|(?:\d+[.)]\s+|\*{1,2})[가-힣a-zA-Z])[^\n]{3,}/g) ?? []
    if (writingSections.length >= 3) {
      score += 0.02
      reasons.push("writing_section3_bonus")
    }
  }

  if (canonicalTask === "dialogue") {
    const dialogueText = normalizeText(candidate.answer_text)
    const textLen = dialogueText.length
    const { tableCount: dlgTableCount, totalRows: dlgTableRows } = countMarkdownTables(dialogueText)
    const hasSubstantialTables = dlgTableCount >= 1 && dlgTableRows >= 3

    // 표가 있는 응답: 글자 수 보너스/페널티 대신 테이블 품질로 평가
    if (hasSubstantialTables) {
      if (dlgTableCount >= 3) {
        score += 0.05
        reasons.push("dialogue_multi_table_bonus")
      } else if (dlgTableRows >= 5) {
        score += 0.04
        reasons.push("dialogue_table_detail_bonus")
      } else {
        score += 0.03
        reasons.push("dialogue_table_present_bonus")
      }
    } else {
      // 표 없는 일반 응답: 기존 길이 기반 보너스
      if (textLen >= 50 && textLen <= 300) {
        score += 0.05
        reasons.push("dialogue_concise_bonus")
      }
      if (textLen > 300 && textLen <= 2000) {
        score += 0.03  // 0.04 → 0.03 축소 (글자 수 편향 감소)
        reasons.push("dialogue_detailed_bonus")
      }
      if (textLen > 3000) {
        score -= 0.04
        reasons.push("dialogue_verbose_penalty")
      }
    }

    const opener = dialogueText.slice(0, 120).toLowerCase()
    const hasDirectOpener = !/(안녕하세요|반갑습니다|좋은 질문|흥미로운|도움이|물론이죠|네,\s*이에|알겠습니다|도와드리겠)/.test(opener)
    if (hasDirectOpener) {
      score += 0.04
      reasons.push("dialogue_direct_entry_bonus")
    }
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
  deep_research: `심층 조사 품질, 출처 다양성, 분석 깊이, 종합 능력을 기준으로 평가하세요.`,
  evidence: `증거 수집의 정확성, 논리적 연결, 사실 검증 수준을 기준으로 평가하세요.`,
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

    if (params.judgeProvider === "gemini") {
      // A안: Gemini Flash 중립 심판 (저비용, 빠름, Primary/Verifier와 이해관계 없음)
      const geminiKey = String(process.env.GEMINI_API_KEY ?? "").trim()
      if (!geminiKey) return null

      const geminiModel = process.env.GEMINI_JUDGE_MODEL || "gemini-2.0-flash"
      const resp = await fetch(
        `${GEMINI_BASE}/models/${geminiModel}:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              maxOutputTokens: 500,
              temperature: 0,
            },
          }),
          signal: AbortSignal.timeout(20000),
        }
      )
      const data = await resp.json().catch((e: unknown) => { logger.warn("judge gemini json parse failed", { error: e }); return {} })
      responseText = String(
        (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
          ?.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
      )
    } else if (params.judgeProvider === "openai") {
      const openaiKey = String(process.env.OPENAI_API_KEY ?? "").trim()
      if (!openaiKey) return null

      const resp = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
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
      const data = await resp.json().catch((e: unknown) => { logger.warn("judge openai json parse failed", { error: e }); return {} })
      responseText = String((data as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content ?? "")
    } else {
      const claudeKey = String(process.env.ANTHROPIC_API_KEY ?? "").trim()
      if (!claudeKey) return null

      const resp = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
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
      const data = await resp.json().catch((e: unknown) => { logger.warn("judge claude json parse failed", { error: e }); return {} })
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
  } catch (e) {
    logger.warn("aiJudge failed", { error: e })
    return null
  }
}

// ─── Pairwise Comparison (로그 전용, 기존 판정에 영향 없음) ───

const PAIRWISE_LOG_PATH = "server/data/pairwise-log.jsonl"
const ENABLE_PAIRWISE_LOG = () => String(process.env.ENABLE_PAIRWISE_LOG ?? "true").trim().toLowerCase() !== "false"

async function ensurePairwiseDir() {
  try { await fsp.mkdir("server/data", { recursive: true }) } catch { /* noop */ }
}

async function pairwiseJudge(params: {
  candidates: JudgeCandidate[]
  task: CanonicalTask
  question: string
}): Promise<{
  winner: string
  loser: string
  rationale: string
  order: string[]
  raw_response: string
} | null> {
  if (params.candidates.length < 2) return null
  const geminiKey = String(process.env.GEMINI_API_KEY ?? "").trim()
  if (!geminiKey) return null

  // 포지션 바이어스 완화: 랜덤 순서
  const shuffled = [...params.candidates].sort(() => Math.random() - 0.5)
  const [a, b] = shuffled

  const textA = String(a.answer_text ?? "").slice(0, 2000)
  const textB = String(b.answer_text ?? "").slice(0, 2000)

  const prompt = `당신은 AI 응답 품질 비교 전문가입니다.
아래 두 답변 중 사용자 질문에 더 적합한 답변을 선택하세요.

[Task 유형]: ${params.task}
[사용자 질문]: ${params.question.slice(0, 400)}

[답변 A]:
${textA}

[답변 B]:
${textB}

지시사항:
- 길이가 길다고 좋은 것이 아닙니다
- 정확성, 유용성, 직접성을 기준으로 판단하세요
- 반드시 아래 JSON만 출력하세요

{ "winner": "A" 또는 "B", "rationale": "선택 이유를 한 문장으로" }`

  try {
    const geminiModel = process.env.GEMINI_JUDGE_MODEL || "gemini-2.0-flash"
    const resp = await fetch(
      `${GEMINI_BASE}/models/${geminiModel}:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 300, temperature: 0 },
        }),
        signal: AbortSignal.timeout(15000),
      }
    )
    const data = await resp.json().catch(() => ({}))
    const responseText = String(
      (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
        ?.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
    )
    const clean = responseText.replace(/```json|```/g, "").trim()
    const parsed = JSON.parse(clean) as { winner?: string; rationale?: string }
    if (!parsed?.winner) return null

    const winnerLabel = String(parsed.winner).toUpperCase()
    const winnerCandidate = winnerLabel === "A" ? a : b
    const loserCandidate = winnerLabel === "A" ? b : a

    return {
      winner: winnerCandidate.provider,
      loser: loserCandidate.provider,
      rationale: String(parsed.rationale ?? ""),
      order: [a.provider, b.provider],
      raw_response: responseText.slice(0, 500),
    }
  } catch (e) {
    logger.debug("[pairwise] pairwiseJudge failed", { error: String(e) })
    return null
  }
}

async function logPairwiseComparison(result: {
  winner: string
  loser: string
  rationale: string
  order: string[]
  raw_response: string
} | null, extra?: {
  task: string
  question: string
  heuristic_winner: string
  ai_judge_winner: string | null
  final_winner: string
}) {
  if (!result || !extra) return
  try {
    await ensurePairwiseDir()
    const record = {
      timestamp: new Date().toISOString(),
      task: extra.task,
      question_preview: extra.question.slice(0, 200),
      pairwise_winner: result.winner,
      pairwise_loser: result.loser,
      pairwise_rationale: result.rationale,
      presentation_order: result.order,
      heuristic_winner: extra.heuristic_winner,
      ai_judge_winner: extra.ai_judge_winner,
      final_winner: extra.final_winner,
      agreement: {
        with_heuristic: result.winner === extra.heuristic_winner,
        with_ai_judge: extra.ai_judge_winner ? result.winner === extra.ai_judge_winner : null,
        with_final: result.winner === extra.final_winner,
      },
    }
    await fsp.appendFile(PAIRWISE_LOG_PATH, JSON.stringify(record) + "\n", "utf-8")
    // rotation: 2000줄 초과 시 앞부분 제거
    try {
      const raw = await fsp.readFile(PAIRWISE_LOG_PATH, "utf-8")
      const lines = raw.split("\n").filter(Boolean)
      if (lines.length > 2000) {
        await fsp.writeFile(PAIRWISE_LOG_PATH, lines.slice(lines.length - 1500).join("\n") + "\n", "utf-8")
      }
    } catch { /* noop */ }
  } catch (e) {
    logger.debug("[pairwise] logPairwiseComparison failed", { error: String(e) })
  }
}

export async function judge(params: {
  candidates: JudgeCandidate[]
  task?: string
  conflicts?: DetectedConflict[]
  question?: string
  executionStrategy?: string
}) {
  const candidates = Array.isArray(params?.candidates) ? params.candidates : []
  const canonicalTask = normalizeTask(String(params?.task ?? ""))
  const conflicts = Array.isArray(params?.conflicts) ? params.conflicts : []
  const question = String(params?.question ?? "").trim()
  const executionStrategy = String(params?.executionStrategy ?? "").trim()

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
    executionStrategy,
  })) {
    aiResult = await aiJudge({
      candidates,
      task: canonicalTask,
      question,
      judgeProvider,
    }).catch((e: unknown) => { logger.warn("judge aiJudge call failed", { error: e }); return null })
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

  // ─── Pairwise 비교 로그 (fire-and-forget, 판정에 영향 없음) ───
  if (ENABLE_PAIRWISE_LOG() && candidates.length >= 2) {
    pairwiseJudge({ candidates, task: canonicalTask, question })
      .then((pwResult) => logPairwiseComparison(pwResult, {
        task: canonicalTask,
        question,
        heuristic_winner: heuristicScores[0]?.provider ?? "",
        ai_judge_winner: aiResult?.winner ?? null,
        final_winner: selected.provider,
      }))
      .catch(() => { /* noop */ })
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
