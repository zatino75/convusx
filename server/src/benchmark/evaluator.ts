type EvalInput = {
  label: string
  mode: string
  final_answer: any
}

export type BenchmarkTaskType = "dialogue" | "reasoning" | "research" | "code" | "writing" | "long_doc"

type RubricBreakdown = {
  base_text_quality: number
  request_fit: number
  multi_provider_reasoning: number
  verifier_agreement: number
  claim_density: number
  evidence_strength: number
  conflict_resolution: number
  judge_quality: number
  consistency: number
  code_quality: number
  penalty: number
}

type PairwisePreference = {
  reason: string
  winner_reason: string
  loser_reason: string
  rubric_breakdown: RubricBreakdown
}

type EvalOutput = {
  quality_score: number
  quality_reasons: string[]
  text_length: number
  detected_task: BenchmarkTaskType
  rubric_breakdown: RubricBreakdown
  pairwise_hint: PairwisePreference
}

function textOf(finalAnswer: any): string {
  const answer = finalAnswer?.answer

  if (typeof answer?.answer_text === "string" && answer.answer_text.trim().length > 0) {
    return answer.answer_text
  }

  if (typeof answer?.text === "string" && answer.text.trim().length > 0) {
    return answer.text
  }

  if (typeof answer === "string" && answer.trim().length > 0) {
    return answer
  }

  if (typeof finalAnswer?.synthesized_answer === "string" && finalAnswer.synthesized_answer.trim().length > 0) {
    return finalAnswer.synthesized_answer
  }

  if (typeof finalAnswer?.summary === "string" && finalAnswer.summary.trim().length > 0) {
    return finalAnswer.summary
  }

  return ""
}

function normalize(text: string): string {
  return String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase()
}

function includesAny(text: string, terms: string[]): boolean {
  const lower = normalize(text)
  return terms.some((term) => lower.includes(term.toLowerCase()))
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function hasCodeBlock(text: string): boolean {
  return /```[\s\S]*?```/.test(text)
}

function sentenceCount(text: string): number {
  return text
    .split(/[.!?]\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean).length
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items))
}

function normalizeKnownTask(value: any): BenchmarkTaskType | null {
  const text = String(value ?? "").trim().toLowerCase()

  if (text.includes("code")) return "code"
  if (text.includes("long_doc") || text.includes("long_document")) return "long_doc"
  if (text.includes("writing") || text.includes("write")) return "writing"
  if (text.includes("research")) return "research"
  if (text.includes("reasoning")) return "reasoning"
  if (text.includes("dialogue")) return "dialogue"

  return null
}

function detectTaskType(input: EvalInput, text: string): BenchmarkTaskType {
  const labelTask = normalizeKnownTask(input?.label)
  if (labelTask) {
    return labelTask
  }

  const finalJudgeTask = normalizeKnownTask(input?.final_answer?.judge_trace?.task)
  if (finalJudgeTask) {
    return finalJudgeTask
  }

  const answerStepTask = normalizeKnownTask(input?.final_answer?.answer?.step_type)
  if (answerStepTask) {
    return answerStepTask
  }

  const joined = `${input?.mode ?? ""} ${text}`.toLowerCase()

  if (includesAny(joined, ["function", "class", "typescript", "javascript", "backend", "api", "return", "async", "await", "```", "provider", "fallback", "orchestration"])) {
    return "code"
  }

  if (includesAny(joined, ["전체 문서", "긴 문서", "장문", "pdf 분석", "pdf 요약", "계약서 전체", "full document", "document analysis", "long document", "summarize document", "전문 요약"])) {
    return "long_doc"
  }

  if (includesAny(joined, ["블로그 포스트", "이메일 초안", "보도자료", "카피라이팅", "마케팅 문구", "자기소개서", "blog post", "newsletter", "press release", "copywriting", "cover letter", "essay writing"])) {
    return "writing"
  }

  if (includesAny(joined, ["source", "evidence", "criteria", "pros", "cons", "trade-off", "benchmark", "출처", "근거"])) {
    return "research"
  }

  if (includesAny(joined, ["because", "therefore", "why", "roi", "리스크", "마진", "따라서"])) {
    return "reasoning"
  }

  return "dialogue"
}

function buildEmptyRubric(): RubricBreakdown {
  return {
    base_text_quality: 0,
    request_fit: 0,
    multi_provider_reasoning: 0,
    verifier_agreement: 0,
    claim_density: 0,
    evidence_strength: 0,
    conflict_resolution: 0,
    judge_quality: 0,
    consistency: 0,
    code_quality: 0,
    penalty: 0
  }
}

function getSignals(text: string, finalAnswer: any) {
  const scoreboard = Array.isArray(finalAnswer?.scoreboard_summary) ? finalAnswer.scoreboard_summary : []
  const judgeTrace = finalAnswer?.judge_trace ?? {}
  const claims = Array.isArray(finalAnswer?.claims) ? finalAnswer.claims : []
  const providerChain = Array.isArray(finalAnswer?.provider_chain) ? finalAnswer.provider_chain : []

  const claimDensityValues = scoreboard
    .map((item: any) => Number(item?.score_breakdown?.claim_density_bonus ?? 0))
    .filter((v: number) => Number.isFinite(v))

  const evidenceStrengthValues = scoreboard
    .map((item: any) => Number(item?.score_breakdown?.evidence_strength_bonus ?? 0))
    .filter((v: number) => Number.isFinite(v))

  const conflictPenaltyValues = scoreboard
    .map((item: any) => Number(item?.score_breakdown?.conflict_penalty ?? 0))
    .filter((v: number) => Number.isFinite(v))

  return {
    textLength: text.trim().length,
    sentenceCount: sentenceCount(text),
    providerCount: providerChain.length > 0 ? providerChain.length : scoreboard.length,
    scoreboardCount: scoreboard.length,
    agreeingVerifiers: scoreboard.filter((item: any) => item?.verifier_signal === "agree").length,
    disagreeingVerifiers: scoreboard.filter((item: any) => item?.verifier_signal === "disagree").length,
    nonNoneVerifiers: scoreboard.filter((item: any) => item?.verifier_signal && item.verifier_signal !== "none").length,
    claimsCount: claims.length,
    maxClaimDensityBonus: claimDensityValues.length > 0 ? Math.max(...claimDensityValues) : 0,
    maxEvidenceStrengthBonus: evidenceStrengthValues.length > 0 ? Math.max(...evidenceStrengthValues) : 0,
    maxConflictPenalty: conflictPenaltyValues.length > 0 ? Math.max(...conflictPenaltyValues) : 0,
    conflictCount: Number(finalAnswer?.conflict_count ?? 0),
    hasJudgeTrace: !!judgeTrace?.winner,
    hasDecisionRationale: typeof finalAnswer?.decision_rationale === "string" && finalAnswer.decision_rationale.trim().length > 0,
    hasWinnerSnapshot: !!finalAnswer?.winner_snapshot?.provider,
    hasRunnerUpSnapshot: !!finalAnswer?.runner_up_snapshot?.provider,
    hasFinalRecommendation: includesAny(text, ["final recommendation", "final answer", "recommend", "choose", "결론", "최종 추천", "추천"]),
    hasEvidenceWords: includesAny(text, ["evidence", "source", "data", "benchmark", "출처", "근거", "데이터"]),
    hasTradeoffWords: includesAny(text, ["trade-off", "tradeoff", "pros", "cons", "리스크", "장점", "단점"]),
    hasReasoningWords: includesAny(text, ["because", "therefore", "why", "roi", "risk", "margin", "따라서", "리스크", "마진"]),
    hasCodeWords: includesAny(text, ["function", "class", "interface", "type ", "return", "async", "await", "export ", "const ", "fallback", "provider", "router"]),
    hasCodeBlock: hasCodeBlock(text),
    hasWritingStructure: includesAny(text, ["서론", "본론", "결론", "introduction", "conclusion", "paragraph", "문단", "단락"]),
    hasWritingQualityWords: includesAny(text, ["명확", "간결", "설득력", "자연스럽", "readable", "coherent", "compelling", "engaging"]),
    hasSummaryStructure: includesAny(text, ["요약", "핵심", "결론", "주요 내용", "summary", "key points", "highlights", "takeaway"])
  }
}

function addReason(reasons: string[], reason: string, condition: boolean) {
  if (condition) {
    reasons.push(reason)
  }
}

function scoreDialogue(text: string, rubric: RubricBreakdown, reasons: string[]) {
  const length = text.trim().length

  if (length >= 60) {
    rubric.base_text_quality += 1
    rubric.request_fit += 1
    addReason(reasons, "dialogue_substance", true)
  }

  if (length >= 120 && length <= 900) {
    rubric.base_text_quality += 1
    rubric.request_fit += 1
    addReason(reasons, "dialogue_useful_length", true)
  }

  if (includesAny(text, ["차별", "가치", "고객", "포지셔닝", "benefit", "value"])) {
    rubric.request_fit += 1
    addReason(reasons, "dialogue_practical_fit", true)
  }
}

function scoreReasoning(text: string, signals: ReturnType<typeof getSignals>, rubric: RubricBreakdown, reasons: string[]) {
  if (signals.textLength >= 180) {
    rubric.base_text_quality += 1
    rubric.request_fit += 1
    addReason(reasons, "reasoning_substance", true)
  }

  if (signals.hasReasoningWords) {
    rubric.request_fit += 1
    addReason(reasons, "reasoning_logic_language", true)
  }

  if (signals.hasTradeoffWords) {
    rubric.request_fit += 1
    addReason(reasons, "reasoning_tradeoff", true)
  }

  if (signals.hasFinalRecommendation) {
    rubric.request_fit += 1
    addReason(reasons, "reasoning_final_choice", true)
  }
}

function scoreResearch(text: string, signals: ReturnType<typeof getSignals>, rubric: RubricBreakdown, reasons: string[]) {
  if (signals.textLength >= 220) {
    rubric.base_text_quality += 1
    rubric.request_fit += 1
    addReason(reasons, "research_substance", true)
  }

  if (signals.hasEvidenceWords) {
    rubric.request_fit += 1
    rubric.evidence_strength += 1
    addReason(reasons, "research_evidence_language", true)
  }

  if (signals.hasTradeoffWords) {
    rubric.request_fit += 1
    addReason(reasons, "research_tradeoff", true)
  }

  if (signals.hasFinalRecommendation) {
    rubric.request_fit += 1
    addReason(reasons, "research_final_recommendation", true)
  }
}

function scoreCode(text: string, signals: ReturnType<typeof getSignals>, rubric: RubricBreakdown, reasons: string[]) {
  if (signals.hasCodeBlock) {
    rubric.code_quality += 2
    addReason(reasons, "code_block", true)
  }

  if (signals.hasCodeWords) {
    rubric.code_quality += 2
    rubric.request_fit += 1
    addReason(reasons, "code_tokens", true)
  }

  if (signals.textLength >= 180) {
    rubric.base_text_quality += 1
    addReason(reasons, "code_substance", true)
  }
}

function scoreWriting(text: string, signals: ReturnType<typeof getSignals>, rubric: RubricBreakdown, reasons: string[]) {
  if (signals.textLength >= 200) {
    rubric.base_text_quality += 2
    rubric.request_fit += 1
    addReason(reasons, "writing_substance", true)
  }

  if (signals.textLength >= 500) {
    rubric.base_text_quality += 1
    addReason(reasons, "writing_depth", true)
  }

  if (signals.hasWritingStructure) {
    rubric.consistency += 1
    rubric.request_fit += 1
    addReason(reasons, "writing_structure", true)
  }

  if (signals.hasWritingQualityWords) {
    rubric.base_text_quality += 1
    addReason(reasons, "writing_quality_language", true)
  }

  if (signals.sentenceCount >= 5) {
    rubric.consistency += 1
    addReason(reasons, "writing_sentence_density", true)
  }
}

function scoreLongDoc(text: string, signals: ReturnType<typeof getSignals>, rubric: RubricBreakdown, reasons: string[]) {
  if (signals.textLength >= 300) {
    rubric.base_text_quality += 1
    rubric.request_fit += 1
    addReason(reasons, "long_doc_substance", true)
  }

  if (signals.textLength >= 600) {
    rubric.base_text_quality += 1
    addReason(reasons, "long_doc_depth", true)
  }

  if (signals.hasSummaryStructure) {
    rubric.claim_density += 2
    rubric.request_fit += 1
    addReason(reasons, "long_doc_summary_structure", true)
  }

  if (signals.hasEvidenceWords) {
    rubric.evidence_strength += 2
    addReason(reasons, "long_doc_evidence_extraction", true)
  }

  if (signals.claimsCount >= 3) {
    rubric.claim_density += 1
    addReason(reasons, "long_doc_claim_density", true)
  }
}

function scoreOrchestration(signals: ReturnType<typeof getSignals>, rubric: RubricBreakdown, reasons: string[]) {
  if (signals.providerCount >= 2) {
    rubric.multi_provider_reasoning += 3
    addReason(reasons, "multi_provider_chain", true)
  }

  if (signals.providerCount >= 2 && signals.scoreboardCount >= 2) {
    rubric.multi_provider_reasoning += 1
    addReason(reasons, "scoreboard_depth", true)
  }

  if (signals.agreeingVerifiers >= 1) {
    rubric.verifier_agreement += 2
    addReason(reasons, "verifier_agreement", true)
  } else if (signals.nonNoneVerifiers >= 1) {
    rubric.verifier_agreement += 1
    addReason(reasons, "verifier_present", true)
  }

  rubric.claim_density += clamp(Math.round(signals.maxClaimDensityBonus * 4), 0, 3)
  rubric.evidence_strength += clamp(Math.round(signals.maxEvidenceStrengthBonus * 4), 0, 3)

  if (signals.maxClaimDensityBonus > 0) {
    addReason(reasons, "claim_density_bonus", true)
  }

  if (signals.maxEvidenceStrengthBonus > 0) {
    addReason(reasons, "evidence_strength_bonus", true)
  }

  if (signals.providerCount >= 2 && signals.conflictCount === 0) {
    rubric.conflict_resolution += 2
    addReason(reasons, "conflict_free_orchestration", true)
  }

  if (signals.hasJudgeTrace && signals.hasDecisionRationale && signals.hasWinnerSnapshot) {
    rubric.judge_quality += 2
    addReason(reasons, "judge_trace_present", true)
  }

  if (signals.hasWinnerSnapshot && (signals.hasRunnerUpSnapshot || signals.providerCount >= 2)) {
    rubric.consistency += 2
    addReason(reasons, "winner_runnerup_structure", true)
  }

  if (signals.disagreeingVerifiers > 0) {
    rubric.penalty -= 1
    addReason(reasons, "verifier_disagreement_penalty", true)
  }

  if (signals.maxConflictPenalty >= 0.5 || signals.conflictCount > 0) {
    rubric.penalty -= 1
    addReason(reasons, "conflict_penalty", true)
  }
}

function totalScore(task: BenchmarkTaskType, rubric: RubricBreakdown): number {
  let weighted: number

  if (task === "dialogue") {
    weighted =
      rubric.base_text_quality * 0.9 +
      rubric.request_fit * 1.2 +
      rubric.multi_provider_reasoning * 1.2 +
      rubric.verifier_agreement * 1.0 +
      rubric.claim_density * 0.6 +
      rubric.evidence_strength * 0.5 +
      rubric.conflict_resolution * 1.0 +
      rubric.judge_quality * 1.0 +
      rubric.consistency * 1.0 +
      rubric.code_quality * 0.1 +
      rubric.penalty
  } else if (task === "reasoning") {
    weighted =
      rubric.base_text_quality * 0.7 +
      rubric.request_fit * 1.2 +
      rubric.multi_provider_reasoning * 1.8 +
      rubric.verifier_agreement * 1.6 +
      rubric.claim_density * 1.2 +
      rubric.evidence_strength * 1.0 +
      rubric.conflict_resolution * 1.2 +
      rubric.judge_quality * 1.2 +
      rubric.consistency * 1.2 +
      rubric.code_quality * 0.1 +
      rubric.penalty
  } else if (task === "research") {
    weighted =
      rubric.base_text_quality * 0.7 +
      rubric.request_fit * 1.1 +
      rubric.multi_provider_reasoning * 2.0 +
      rubric.verifier_agreement * 1.7 +
      rubric.claim_density * 1.3 +
      rubric.evidence_strength * 1.4 +
      rubric.conflict_resolution * 1.2 +
      rubric.judge_quality * 1.2 +
      rubric.consistency * 1.2 +
      rubric.code_quality * 0.1 +
      rubric.penalty
  } else if (task === "writing") {
    weighted =
      rubric.base_text_quality * 1.6 +
      rubric.request_fit * 1.3 +
      rubric.multi_provider_reasoning * 0.9 +
      rubric.verifier_agreement * 0.8 +
      rubric.claim_density * 0.4 +
      rubric.evidence_strength * 0.3 +
      rubric.conflict_resolution * 0.8 +
      rubric.judge_quality * 0.8 +
      rubric.consistency * 1.4 +
      rubric.code_quality * 0.0 +
      rubric.penalty
  } else if (task === "long_doc") {
    weighted =
      rubric.base_text_quality * 0.8 +
      rubric.request_fit * 1.0 +
      rubric.multi_provider_reasoning * 1.4 +
      rubric.verifier_agreement * 1.2 +
      rubric.claim_density * 1.8 +
      rubric.evidence_strength * 1.6 +
      rubric.conflict_resolution * 1.2 +
      rubric.judge_quality * 1.0 +
      rubric.consistency * 1.0 +
      rubric.code_quality * 0.0 +
      rubric.penalty
  } else {
    // code (default)
    weighted =
      rubric.base_text_quality * 0.6 +
      rubric.request_fit * 1.0 +
      rubric.multi_provider_reasoning * 1.6 +
      rubric.verifier_agreement * 1.3 +
      rubric.claim_density * 0.8 +
      rubric.evidence_strength * 0.7 +
      rubric.conflict_resolution * 1.0 +
      rubric.judge_quality * 1.0 +
      rubric.consistency * 1.0 +
      rubric.code_quality * 1.5 +
      rubric.penalty
  }

  return Math.round(weighted * 10) / 10
}

function buildPairwiseHint(task: BenchmarkTaskType, rubric: RubricBreakdown): PairwisePreference {
  let reason = "better overall task fit"
  let winnerReason = "had stronger task fit"
  let loserReason = "showed weaker task fit"

  if (task === "writing" && rubric.base_text_quality >= 3) {
    reason = "stronger writing quality and structure"
    winnerReason = "produced more coherent, well-structured writing"
    loserReason = "produced weaker writing structure or quality"
  } else if (task === "long_doc" && rubric.claim_density >= 3) {
    reason = "stronger document analysis and key point extraction"
    winnerReason = "extracted more claims and evidence from the document"
    loserReason = "missed key claims or had weaker extraction"
  } else if (rubric.multi_provider_reasoning >= 3) {
    reason = "stronger orchestration-aware reasoning with multi-provider validation"
    winnerReason = "used multi-provider structure, judge signals, and better orchestration depth"
    loserReason = "lacked orchestration depth or validator support"
  } else if (rubric.code_quality >= 3) {
    reason = "stronger code implementation quality"
    winnerReason = "included more concrete implementation detail"
    loserReason = "included weaker implementation detail"
  } else if (rubric.evidence_strength >= 2) {
    reason = "stronger evidence-backed decision quality"
    winnerReason = "used more evidence, support, or criteria"
    loserReason = "used weaker evidence or criteria"
  }

  return {
    reason,
    winner_reason: winnerReason,
    loser_reason: loserReason,
    rubric_breakdown: rubric
  }
}

export function evaluateBenchmarkResult(input: EvalInput): EvalOutput {
  const finalAnswer = input?.final_answer ?? {}
  const text = textOf(finalAnswer)
  const detectedTask = detectTaskType(input, text)
  const rubric = buildEmptyRubric()
  const reasons: string[] = []
  const signals = getSignals(text, finalAnswer)

  scoreOrchestration(signals, rubric, reasons)

  if (detectedTask === "dialogue") {
    scoreDialogue(text, rubric, reasons)
  } else if (detectedTask === "reasoning") {
    scoreReasoning(text, signals, rubric, reasons)
  } else if (detectedTask === "research") {
    scoreResearch(text, signals, rubric, reasons)
  } else if (detectedTask === "writing") {
    scoreWriting(text, signals, rubric, reasons)
  } else if (detectedTask === "long_doc") {
    scoreLongDoc(text, signals, rubric, reasons)
  } else {
    scoreCode(text, signals, rubric, reasons)
  }

  if (text.trim().length < 40) {
    rubric.penalty -= 2
    addReason(reasons, "thin_answer_penalty", true)
  }

  return {
    quality_score: totalScore(detectedTask, rubric),
    quality_reasons: unique(reasons),
    text_length: text.length,
    detected_task: detectedTask,
    rubric_breakdown: rubric,
    pairwise_hint: buildPairwiseHint(detectedTask, rubric)
  }
}
