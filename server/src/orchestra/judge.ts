import type { DetectedConflict } from "./conflicts.js"

type JudgeCandidate = {
  provider: string
  answer_text: string
  raw?: any
}

type JudgeScoreRow = {
  provider: string
  score: number
  reasons: string[]
}

function normalizeText(input: string) {
  return String(input ?? "").replace(/\r\n/g, "\n").trim()
}

function splitSentences(input: string): string[] {
  const text = normalizeText(input)
  if (!text) return []
  return (text.match(/[^.!?\n]+[.!?\n]?/g) ?? [])
    .map((p) => p.trim())
    .filter(Boolean)
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
  const lengthScore = Math.min(1, normalizeText(answer).length / 700)
  const sentenceScore = Math.min(1, sentences.length / 8)
  return Number(((lengthScore * 0.6) + (sentenceScore * 0.4)).toFixed(4))
}

function estimateStructure(answer: string): number {
  const text = normalizeText(answer)
  let score = 0.45
  if (/(^|\n)\s*[-*]\s+/.test(text)) score += 0.2
  if (/(^|\n)\s*\d+\.\s+/.test(text)) score += 0.15
  if (/\n\s*\n/.test(text)) score += 0.1
  if (splitSentences(text).length >= 4) score += 0.1
  return Number(Math.min(1, score).toFixed(4))
}

function estimateSpecificity(answer: string): number {
  const text = normalizeText(answer)
  const numbers = extractNumbers(text)
  let score = 0.4
  score += Math.min(0.2, numbers.length * 0.04)
  if (/"[^"]+"/.test(text)) score += 0.1
  if (/: /.test(text)) score += 0.1
  score += Math.min(0.2, unique(text.split(/\s+/).filter((w) => w.length >= 7)).length * 0.01)
  return Number(Math.min(1, score).toFixed(4))
}

function getConflictTypeWeight(typeInput: string) {
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

function getSeverityBase(severityInput: string) {
  const severity = String(severityInput ?? "").trim().toLowerCase()

  if (severity === "high") return 0.12
  if (severity === "medium") return 0.06
  return 0.03
}

function scoreCandidate(
  candidate: JudgeCandidate,
  task: string,
  conflicts: DetectedConflict[]
): JudgeScoreRow {
  const reasons: string[] = []

  const coverage = estimateCoverage(candidate.answer_text)
  const structure = estimateStructure(candidate.answer_text)
  const specificity = estimateSpecificity(candidate.answer_text)

  let score = 0.45
  score += coverage * 0.22
  score += structure * 0.16
  score += specificity * 0.17

  const providerConflicts = conflicts.filter((c) =>
    Array.isArray(c.providers) && c.providers.includes(candidate.provider)
  )

  const highConflicts = providerConflicts.filter((c) => c.severity === "high").length
  const mediumConflicts = providerConflicts.filter((c) => c.severity === "medium").length
  const lowConflicts = providerConflicts.filter((c) => c.severity === "low").length

  const weightedPenalty = providerConflicts.reduce((acc, c) => {
    const severityBase = getSeverityBase(String(c?.severity ?? "low"))
    const explicitWeight = typeof (c as any).weight === "number" ? Number((c as any).weight) : 0.5
    const typeWeight = getConflictTypeWeight(String(c?.type ?? ""))
    return acc + (severityBase * explicitWeight) + typeWeight
  }, 0)

  score -= weightedPenalty

  const numericConflicts = providerConflicts.filter((c) => String(c?.type ?? "").toLowerCase().includes("numeric")).length
  const factConflicts = providerConflicts.filter((c) => String(c?.type ?? "").toLowerCase().includes("fact")).length
  const contextConflicts = providerConflicts.filter((c) => Array.isArray(c.providers) && c.providers.includes("context")).length
  const recommendationConflicts = providerConflicts.filter((c) => String(c?.type ?? "").toLowerCase().includes("recommendation")).length
  const comparisonConflicts = providerConflicts.filter((c) => String(c?.type ?? "").toLowerCase().includes("comparison")).length

  reasons.push(`coverage:${coverage.toFixed(4)}`)
  reasons.push(`structure:${structure.toFixed(4)}`)
  reasons.push(`specificity:${specificity.toFixed(4)}`)
  reasons.push(`conflict_penalty:${weightedPenalty.toFixed(3)}`)

  if (highConflicts > 0) reasons.push(`high_conflicts:${highConflicts}`)
  if (mediumConflicts > 0) reasons.push(`medium_conflicts:${mediumConflicts}`)
  if (lowConflicts > 0) reasons.push(`low_conflicts:${lowConflicts}`)

  if (numericConflicts > 0) reasons.push(`numeric_conflicts:${numericConflicts}`)
  if (factConflicts > 0) reasons.push(`fact_conflicts:${factConflicts}`)
  if (contextConflicts > 0) reasons.push(`context_conflicts:${contextConflicts}`)
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

  if (contextConflicts >= 2) {
    score -= 0.1
    reasons.push("multi_context_conflict_penalty")
  }

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
  conflicts?: DetectedConflict[]
}) {
  const candidates = Array.isArray(params?.candidates) ? params.candidates : []
  const task = String(params?.task ?? "").trim().toLowerCase()
  const conflicts = Array.isArray(params?.conflicts) ? params.conflicts : []

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
        conflict_count: conflicts.length,
        conflicts,
        claims: []
      }
    }
  }

  const scores = candidates
    .map((candidate) => scoreCandidate(candidate, task, conflicts))
    .sort((a, b) => b.score - a.score)

  const winner = scores[0]
  const runnerUp = scores[1]

  const scoreDiff = (winner?.score ?? 0) - (runnerUp?.score ?? 0)
  const winnerScore = winner?.score ?? 0
  // winner 점수 자체가 높으면 confidence도 높게 반영
  const confidence = Number(
    Math.max(
      0.55,
      Math.min(
        0.99,
        (winnerScore * 0.5) + (scoreDiff * 2.0) + 0.4
      )
    ).toFixed(4)
  )

  const selected =
    candidates.find((candidate) => candidate.provider === winner.provider) ?? candidates[0]

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
