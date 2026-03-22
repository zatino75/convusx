type JudgeCandidate = {
  provider: string
  answer_text: string
  raw?: any
}

type Conflict = {
  type: string
  severity: "low" | "medium" | "high"
  provider_a: string
  provider_b: string
  summary: string
  weight?: number
}

type JudgeScoreRow = {
  provider: string
  score: number
  reasons: string[]
}

function normalizeText(input: string) {
  return String(input ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
}

function splitSentences(input: string): string[] {
  const text = normalizeText(input)
  if (!text) return []

  return (text.match(/[^.!?\n]+[.!?\n]?/g) ?? [])
    .map((part) => part.trim())
    .filter(Boolean)
}

function extractNumbers(input: string): number[] {
  const matches = normalizeText(input).match(/-?\d+(?:\.\d+)?/g) ?? []
  return matches
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function estimateCoverage(answer: string): number {
  const sentences = splitSentences(answer)
  const lengthScore = Math.min(1, normalizeText(answer).length / 700)
  const sentenceScore = Math.min(1, sentences.length / 8)
  return Number(((lengthScore * 0.6) + (sentenceScore * 0.4)).toFixed(4))
}

function estimateStructure(answer: string): number {
  const text = normalizeText(answer)
  const hasBullets = /(^|\n)\s*[-*]\s+/.test(text)
  const hasNumbered = /(^|\n)\s*\d+\.\s+/.test(text)
  const hasParagraphs = /\n\s*\n/.test(text)
  const sentenceCount = splitSentences(text).length

  let score = 0.45
  if (hasBullets) score += 0.2
  if (hasNumbered) score += 0.15
  if (hasParagraphs) score += 0.1
  if (sentenceCount >= 4) score += 0.1

  return Number(Math.min(1, score).toFixed(4))
}

function estimateSpecificity(answer: string): number {
  const text = normalizeText(answer)
  const numbers = extractNumbers(text)
  const hasQuoted = /"[^"]+"/.test(text)
  const hasColon = /:\s/.test(text)
  const longWords = unique(text.split(/\s+/).filter((word) => word.length >= 7)).length

  let score = 0.4
  score += Math.min(0.2, numbers.length * 0.04)
  if (hasQuoted) score += 0.1
  if (hasColon) score += 0.1
  score += Math.min(0.2, longWords * 0.01)

  return Number(Math.min(1, score).toFixed(4))
}

function detectConflictType(a: string, b: string): string | null {
  const numsA = extractNumbers(a)
  const numsB = extractNumbers(b)

  if (numsA.length > 0 && numsB.length > 0) {
    const aSet = unique(numsA.map((x) => x.toFixed(4)))
    const bSet = unique(numsB.map((x) => x.toFixed(4)))
    const overlap = aSet.some((x) => bSet.includes(x))
    if (!overlap) return "numeric_conflict"
  }

  const textA = normalizeText(a)
  const textB = normalizeText(b)

  const feasibilityTerms = ["cannot", "impossible", "불가", "어렵다", "불가능"]
  const positiveTerms = ["can", "possible", "가능", "할 수", "된다"]
  const riskTerms = ["risk", "danger", "unsafe", "위험", "리스크"]
  const safeTerms = ["safe", "low risk", "안전", "문제없", "낮은 리스크"]
  const recommendTerms = ["recommend", "best", "추천", "최선", "우선"]
  const rejectTerms = ["avoid", "not recommend", "비추천", "피해야", "권하지"]

  const feasibilityFlip =
    feasibilityTerms.some((term) => textA.includes(term)) &&
    positiveTerms.some((term) => textB.includes(term))

  const feasibilityFlipReverse =
    feasibilityTerms.some((term) => textB.includes(term)) &&
    positiveTerms.some((term) => textA.includes(term))

  if (feasibilityFlip || feasibilityFlipReverse) return "feasibility_conflict"

  const riskFlip =
    riskTerms.some((term) => textA.includes(term)) &&
    safeTerms.some((term) => textB.includes(term))

  const riskFlipReverse =
    riskTerms.some((term) => textB.includes(term)) &&
    safeTerms.some((term) => textA.includes(term))

  if (riskFlip || riskFlipReverse) return "risk_conflict"

  const recFlip =
    recommendTerms.some((term) => textA.includes(term)) &&
    rejectTerms.some((term) => textB.includes(term))

  const recFlipReverse =
    recommendTerms.some((term) => textB.includes(term)) &&
    rejectTerms.some((term) => textA.includes(term))

  if (recFlip || recFlipReverse) return "recommendation_conflict"

  if (textA && textB && textA !== textB) {
    const firstA = splitSentences(textA)[0] ?? ""
    const firstB = splitSentences(textB)[0] ?? ""
    if (firstA && firstB && firstA !== firstB) return "direction_conflict"
  }

  return null
}

function createConflict(candidateA: JudgeCandidate, candidateB: JudgeCandidate): Conflict | null {
  const type = detectConflictType(candidateA.answer_text, candidateB.answer_text)
  if (!type) return null

  const severity: Conflict["severity"] =
    type === "numeric_conflict" || type === "feasibility_conflict" || type === "risk_conflict"
      ? "high"
      : type === "direction_conflict"
        ? "medium"
        : "low"

  return {
    type,
    severity,
    provider_a: candidateA.provider,
    provider_b: candidateB.provider,
    summary: `${candidateA.provider} vs ${candidateB.provider}: ${type}`,
    weight:
      type === "numeric_conflict" ? 1 :
      type === "feasibility_conflict" ? 0.9 :
      type === "risk_conflict" ? 0.85 :
      type === "direction_conflict" ? 0.8 :
      type === "recommendation_conflict" ? 0.6 :
      0.5
  }
}

function collectConflicts(candidates: JudgeCandidate[]): Conflict[] {
  const out: Conflict[] = []

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const conflict = createConflict(candidates[i], candidates[j])
      if (conflict) out.push(conflict)
    }
  }

  return out
}

function scoreCandidate(candidate: JudgeCandidate, task: string, conflicts: Conflict[]): JudgeScoreRow {
  const reasons: string[] = []
  const coverage = estimateCoverage(candidate.answer_text)
  const structure = estimateStructure(candidate.answer_text)
  const specificity = estimateSpecificity(candidate.answer_text)

  let score = 0.45
  score += coverage * 0.22
  score += structure * 0.16
  score += specificity * 0.17

  reasons.push(`coverage:${coverage.toFixed(2)}`)
  reasons.push(`structure:${structure.toFixed(2)}`)
  reasons.push(`specificity:${specificity.toFixed(2)}`)

  const providerConflicts = conflicts.filter(
    (conflict) => conflict.provider_a === candidate.provider || conflict.provider_b === candidate.provider
  )

  const highConflicts = providerConflicts.filter((conflict) => conflict.severity === "high").length
  const mediumConflicts = providerConflicts.filter((conflict) => conflict.severity === "medium").length

  score -= highConflicts * 0.05
  score -= mediumConflicts * 0.025

  if (highConflicts > 0) reasons.push(`high_conflicts:${highConflicts}`)
  if (mediumConflicts > 0) reasons.push(`medium_conflicts:${mediumConflicts}`)

  const normalizedTask = String(task ?? "").trim().toLowerCase()

  if (normalizedTask === "code") {
    const hasCodeFence = /```/.test(candidate.answer_text)
    const hasPathLike = /[A-Za-z0-9_\-/\\]+\.[A-Za-z0-9]+/.test(candidate.answer_text)
    if (hasCodeFence) {
      score += 0.05
      reasons.push("code_fence_bonus")
    }
    if (hasPathLike) {
      score += 0.03
      reasons.push("path_specific_bonus")
    }
  }

  if (normalizedTask === "research" || normalizedTask === "reasoning") {
    const hasComparativeTerms = /(because|therefore|however|근거|따라서|하지만|반면)/i.test(candidate.answer_text)
    if (hasComparativeTerms) {
      score += 0.04
      reasons.push("reasoning_connector_bonus")
    }
  }

  return {
    provider: candidate.provider,
    score: Number(Math.max(0, Math.min(1, score)).toFixed(4)),
    reasons
  }
}

export async function judge(params: {
  candidates: JudgeCandidate[]
  task?: string
}) {
  const candidates = Array.isArray(params?.candidates) ? params.candidates : []
  const task = String(params?.task ?? "").trim().toLowerCase()

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
        claims: []
      }
    }
  }

  if (candidates.length === 1) {
    return {
      ...candidates[0],
      ok: true,
      meta: {
        judge_selected_provider: candidates[0].provider,
        judge_scores: [
          {
            provider: candidates[0].provider,
            score: 1,
            reasons: ["single_candidate"]
          }
        ],
        judge_rationale: "single_candidate",
        judge_confidence: 1,
        conflict_count: 0,
        conflicts: [],
        claims: []
      }
    }
  }

  const conflicts = collectConflicts(candidates)
  const scores = candidates
    .map((candidate) => scoreCandidate(candidate, task, conflicts))
    .sort((a, b) => b.score - a.score)

  const winner = scores[0]
  const runnerUp = scores[1]
  const confidence = Number(
    Math.max(
      0.51,
      Math.min(
        0.99,
        0.6 + ((winner?.score ?? 0) - (runnerUp?.score ?? 0)) * 1.5
      )
    ).toFixed(4)
  )

  const selected = candidates.find((candidate) => candidate.provider === winner.provider) ?? candidates[0]

  return {
    ...selected,
    ok: true,
    meta: {
      judge_selected_provider: selected.provider,
      judge_scores: scores,
      judge_rationale: `selected ${selected.provider} by composite scoring`,
      judge_confidence: confidence,
      conflict_count: conflicts.length,
      conflicts,
      claims: []
    }
  }
}
