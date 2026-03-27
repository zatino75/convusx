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
  ensemble?: {
    coverage_vote: number
    conflict_vote: number
    task_vote: number
  }
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

// ─── Sub-scorers ────────────────────────────────────────────────────────────

function estimateCoverage(answer: string): number {
  const sentences = splitSentences(answer)
  const lengthScore = Math.min(1, normalizeText(answer).length / 700)
  const sentenceScore = Math.min(1, sentences.length / 8)
  return Number(((lengthScore * 0.6) + (sentenceScore * 0.4)).toFixed(4))
}

function estimateStructure(answer: string): number {
  const text = normalizeText(answer)
  let score = 0.45
  if (/(^\n)\s*[-*]\s+/.test(text)) score += 0.2
  if (/(^\n)\s*\d+\.\s+/.test(text)) score += 0.15
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

// ─── Ensemble judges ─────────────────────────────────────────────────────────

/** Judge 1: Coverage quality (length, structure, specificity) */
function judgeCoverage(candidate: JudgeCandidate): number {
  const coverage = estimateCoverage(candidate.answer_text)
  const structure = estimateStructure(candidate.answer_text)
  const specificity = estimateSpecificity(candidate.answer_text)
  return Number(Math.min(1, (coverage * 0.4) + (structure * 0.3) + (specificity * 0.3)).toFixed(4))
}

/** Judge 2: Conflict penalty (how clean the answer is) */
function judgeConflict(candidate: JudgeCandidate, conflicts: DetectedConflict[]): number {
  const providerConflicts = conflicts.filter((c) =>
    Array.isArray(c.providers) && c.providers.includes(candidate.provider)
  )

  if (providerConflicts.length === 0) return 1.0

  const weightedPenalty = providerConflicts.reduce((acc, c) => {
    const severityBase = getSeverityBase(String(c?.severity ?? "low"))
    const explicitWeight = typeof (c as any).weight === "number" ? Number((c as any).weight) : 0.5
    const typeWeight = getConflictTypeWeight(String(c?.type ?? ""))
    return acc + (severityBase * explicitWeight) + typeWeight
  }, 0)

  const highConflicts = providerConflicts.filter((c) => c.severity === "high").length
  const numericConflicts = providerConflicts.filter((c) => String(c?.type ?? "").includes("numeric")).length
  const contextConflicts = providerConflicts.filter((c) => String(c?.type ?? "").includes("context")).length

  let extra = 0
  if (highConflicts >= 2) extra += 0.15
  if (numericConflicts >= 2) extra += 0.08
  if (contextConflicts >= 2) extra += 0.1

  return Number(Math.max(0, Math.min(1, 1 - weightedPenalty - extra)).toFixed(4))
}

/** Judge 3: Task-fit (task-specific signal bonuses) */
function judgeTaskFit(candidate: JudgeCandidate, task: string): number {
  const normalizedTask = task.trim().toLowerCase()
  let score = 0.5

  if (normalizedTask === "code") {
    if (/```/.test(candidate.answer_text)) score += 0.25
    if (/[A-Za-z0-9_\-/\\]+\.[A-Za-z0-9]+/.test(candidate.answer_text)) score += 0.15
    if (/function|const|import|class|return/.test(candidate.answer_text)) score += 0.1
  } else if (normalizedTask === "research" || normalizedTask === "reasoning") {
    if (/(because|therefore|however|근거|따라서|하지만|반면)/i.test(candidate.answer_text)) score += 0.2
    if (/\d+%|\d+ percent|\d+배/i.test(candidate.answer_text)) score += 0.1
    if (splitSentences(candidate.answer_text).length >= 6) score += 0.1
    if (/출처|source|reference|cited/i.test(candidate.answer_text)) score += 0.1
  } else if (normalizedTask === "dialogue") {
    const sentences = splitSentences(candidate.answer_text)
    if (sentences.length >= 2 && sentences.length <= 10) score += 0.2
    if (/\?/.test(candidate.answer_text)) score += 0.1
  }

  return Number(Math.min(1, score).toFixed(4))
}

// ─── Ensemble composite ───────────────────────────────────────────────────────

function scoreCandidate(
  candidate: JudgeCandidate,
  task: string,
  conflicts: DetectedConflict[]
): JudgeScoreRow {
  const coverageVote = judgeCoverage(candidate)
  const conflictVote = judgeConflict(candidate, conflicts)
  const taskVote = judgeTaskFit(candidate, task)

  // Ensemble weights: conflict is highest priority, then coverage, then task-fit
  const ensembleScore = (coverageVote * 0.35) + (conflictVote * 0.45) + (taskVote * 0.20)

  const providerConflicts = conflicts.filter((c) =>
    Array.isArray(c.providers) && c.providers.includes(candidate.provider)
  )
  const highConflicts = providerConflicts.filter((c) => c.severity === "high").length
  const mediumConflicts = providerConflicts.filter((c) => c.severity === "medium").length
  const lowConflicts = providerConflicts.filter((c) => c.severity === "low").length

  const reasons: string[] = [
    `coverage_vote:${coverageVote.toFixed(4)}`,
    `conflict_vote:${conflictVote.toFixed(4)}`,
    `task_vote:${taskVote.toFixed(4)}`,
    `ensemble:${ensembleScore.toFixed(4)}`
  ]

  if (highConflicts > 0) reasons.push(`high_conflicts:${highConflicts}`)
  if (mediumConflicts > 0) reasons.push(`medium_conflicts:${mediumConflicts}`)
  if (lowConflicts > 0) reasons.push(`low_conflicts:${lowConflicts}`)

  return {
    provider: candidate.provider,
    score: Number(Math.max(0, Math.min(1, ensembleScore)).toFixed(4)),
    reasons,
    ensemble: {
      coverage_vote: coverageVote,
      conflict_vote: conflictVote,
      task_vote: taskVote
    }
  }
}

// ─── Confidence calibration ──────────────────────────────────────────────────

function calibrateConfidence(
  scores: JudgeScoreRow[],
  conflicts: DetectedConflict[]
): number {
  if (scores.length === 0) return 0

  const winner = scores[0]
  const runnerUp = scores[1]

  // Base: score gap between winner and runner-up
  const gap = runnerUp ? (winner.score - runnerUp.score) : 1.0
  let confidence = 0.55 + (gap * 1.8)

  // Penalty: high total conflict density lowers confidence
  const highConflictCount = conflicts.filter((c) => c.severity === "high").length
  const totalConflictCount = conflicts.length
  confidence -= highConflictCount * 0.06
  confidence -= totalConflictCount * 0.015

  // Penalty: many candidates means more uncertainty
  if (scores.length >= 4) confidence -= 0.04
  if (scores.length >= 3) confidence -= 0.02

  // Bonus: winner has high conflict_vote (clean answer)
  const conflictVote = winner.ensemble?.conflict_vote ?? 0.5
  if (conflictVote >= 0.9) confidence += 0.06
  else if (conflictVote >= 0.75) confidence += 0.03

  // Bonus: winner has strong task_vote alignment
  const taskVote = winner.ensemble?.task_vote ?? 0.5
  if (taskVote >= 0.8) confidence += 0.04

  // Penalty: runner-up is close (gap < 0.05 = too close to call)
  if (runnerUp && gap < 0.05) confidence -= 0.08

  return Number(Math.max(0.35, Math.min(0.99, confidence)).toFixed(4))
}

// ─── Main judge export ───────────────────────────────────────────────────────

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
  const confidence = calibrateConfidence(scores, conflicts)

  const selected =
    candidates.find((candidate) => candidate.provider === winner.provider) ?? candidates[0]

  return {
    ...selected,
    ok: true,
    meta: {
      judge_selected_provider: selected.provider,
      judge_scores: scores,
      judge_rationale: `ensemble(coverage+conflict+task) selected ${selected.provider} | gap:${scores[1] ? (winner.score - scores[1].score).toFixed(4) : "n/a"}`,
      judge_confidence: confidence,
      conflict_count: conflicts.length,
      conflicts,
      claims: []
    }
  }
}