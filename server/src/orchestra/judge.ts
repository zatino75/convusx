import { extractClaims } from "./claims.js"
import { detectConflicts } from "./conflicts.js"

type JudgeCandidate = {
  provider: string
  answer_text: string
  raw?: any
}

type JudgeScoreRow = {
  provider: string
  score: number
  dimensions: {
    directness: number
    structure: number
    decisiveness: number
    task_fit: number
    risk: number
    reliability: number
    claims_density: number
    conflict_penalty: number
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function normalizeTask(task: any): "dialogue" | "reasoning" | "research" | "code" {
  const value = String(task ?? "").trim().toLowerCase()

  if (value.includes("code")) return "code"
  if (value.includes("research")) return "research"
  if (value.includes("reasoning")) return "reasoning"
  return "dialogue"
}

function normalizeText(value: any): string {
  return String(value ?? "").replace(/\r\n/g, "\n").trim()
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term))
}

function lineCount(text: string): number {
  return text
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean).length
}

function scoreDirectness(text: string): number {
  const lower = text.toLowerCase()
  let score = 0.5

  if (text.length >= 80) score += 0.1
  if (text.length >= 180) score += 0.1
  if (!includesAny(lower, [
    "understood",
    "i can help",
    "please provide",
    "need more information",
    "추가 정보",
    "더 자세한 정보",
    "원하시면"
  ])) {
    score += 0.2
  }

  if (includesAny(lower, ["recommend", "결론", "추천", "선택", "정리하면"])) {
    score += 0.1
  }

  return clamp(score, 0, 1)
}

function scoreStructure(text: string): number {
  let score = 0.35
  const lines = lineCount(text)

  if (lines >= 3) score += 0.2
  if (lines >= 6) score += 0.15
  if (includesAny(text, ["- ", "1.", "2.", "3.", "결론", "리스크", "장점", "단점"])) {
    score += 0.2
  }

  return clamp(score, 0, 1)
}

function scoreDecisiveness(text: string, task: string): number {
  const lower = text.toLowerCase()
  let score = 0.3

  if (includesAny(lower, [
    "recommend",
    "should",
    "must",
    "choose",
    "final recommendation",
    "결론",
    "추천",
    "선택",
    "유리합니다",
    "맞습니다"
  ])) {
    score += 0.4
  }

  if (task === "reasoning" || task === "research") {
    if (includesAny(lower, ["trade-off", "risk", "alternative", "반면", "리스크", "대안"])) {
      score += 0.2
    }
  }

  if (includesAny(lower, ["maybe", "might", "case by case", "상황에 따라", "애매"])) {
    score -= 0.15
  }

  return clamp(score, 0, 1)
}

function scoreTaskFit(text: string, task: string): number {
  const lower = text.toLowerCase()

  if (task === "dialogue") {
    let score = 0.45
    if (!includesAny(lower, ["placeholder", "insufficient output"])) score += 0.2
    if (includesAny(lower, ["핵심", "요약", "추천"])) score += 0.1
    return clamp(score, 0, 1)
  }

  if (task === "reasoning") {
    let score = 0.35
    if (includesAny(lower, ["because", "therefore", "trade-off", "이유", "따라서", "근거"])) score += 0.25
    if (includesAny(lower, ["결론", "추천", "선택", "최종"])) score += 0.2
    if (includesAny(lower, ["risk", "리스크", "반면", "대안"])) score += 0.15
    return clamp(score, 0, 1)
  }

  if (task === "research") {
    let score = 0.3
    if (includesAny(lower, ["market", "competitor", "margin", "positioning", "시장", "경쟁", "마진", "포지셔닝"])) score += 0.25
    if (includesAny(lower, ["recommend", "gtm", "추천", "진입", "우선순위"])) score += 0.2
    if (includesAny(lower, ["compare", "comparison", "비교", "vs"])) score += 0.15
    return clamp(score, 0, 1)
  }

  let score = 0.25
  if (includesAny(lower, ["function", "class", "interface", "return", "const ", "let ", "```"])) score += 0.35
  if (includesAny(lower, ["bug", "edge case", "refactor", "implementation", "구현", "예외", "검증"])) score += 0.2
  return clamp(score, 0, 1)
}

function scoreRisk(text: string, task: string): number {
  const lower = text.toLowerCase()
  let score = 0.45

  if (task === "research" || task === "reasoning" || task === "code") {
    if (includesAny(lower, [
      "risk",
      "limitation",
      "edge case",
      "fallback",
      "trade-off",
      "리스크",
      "한계",
      "예외",
      "주의",
      "대안"
    ])) {
      score += 0.35
    }
  }

  return clamp(score, 0, 1)
}

function scoreReliability(candidate: JudgeCandidate): number {
  const ok = Boolean(candidate?.raw?.ok ?? true)
  const errorCode = String(candidate?.raw?.error_code ?? "").trim()
  const answer = normalizeText(candidate.answer_text)

  let score = 0.45
  if (ok) score += 0.2
  if (!errorCode) score += 0.15
  if (answer.length >= 60) score += 0.1
  if (candidate?.raw?.adapter_used === "real") score += 0.1

  return clamp(score, 0, 1)
}

function scoreClaimsDensity(claimCount: number, task: string): number {
  if (task === "research") return clamp(claimCount / 10, 0, 1)
  if (task === "reasoning") return clamp(claimCount / 8, 0, 1)
  if (task === "code") return clamp(claimCount / 6, 0, 1)
  return clamp(claimCount / 5, 0, 1)
}

function weightForTask(task: "dialogue" | "reasoning" | "research" | "code") {
  if (task === "dialogue") {
    return {
      directness: 0.24,
      structure: 0.14,
      decisiveness: 0.14,
      task_fit: 0.18,
      risk: 0.04,
      reliability: 0.14,
      claims_density: 0.08,
      conflict_penalty: 0.04
    }
  }

  if (task === "reasoning") {
    return {
      directness: 0.12,
      structure: 0.16,
      decisiveness: 0.22,
      task_fit: 0.18,
      risk: 0.10,
      reliability: 0.10,
      claims_density: 0.08,
      conflict_penalty: 0.04
    }
  }

  if (task === "research") {
    return {
      directness: 0.10,
      structure: 0.18,
      decisiveness: 0.14,
      task_fit: 0.20,
      risk: 0.10,
      reliability: 0.12,
      claims_density: 0.12,
      conflict_penalty: 0.04
    }
  }

  return {
    directness: 0.08,
    structure: 0.12,
    decisiveness: 0.12,
    task_fit: 0.28,
    risk: 0.12,
    reliability: 0.16,
    claims_density: 0.08,
    conflict_penalty: 0.04
  }
}

function buildClaimsMap(candidates: JudgeCandidate[]) {
  return candidates.map((candidate) => ({
    provider: candidate.provider,
    claims: extractClaims(candidate.answer_text)
  }))
}

function buildConflictPenalty(provider: string, conflicts: any[]): number {
  const related = conflicts.filter((c) => Array.isArray(c?.providers) && c.providers.includes(provider)).length
  if (related <= 0) return 1
  return clamp(1 - related * 0.15, 0.55, 1)
}

function scoreCandidate(
  candidate: JudgeCandidate,
  task: "dialogue" | "reasoning" | "research" | "code",
  claimCount: number,
  conflictPenalty: number
): JudgeScoreRow {
  const text = normalizeText(candidate.answer_text)
  const weights = weightForTask(task)

  const dimensions = {
    directness: scoreDirectness(text),
    structure: scoreStructure(text),
    decisiveness: scoreDecisiveness(text, task),
    task_fit: scoreTaskFit(text, task),
    risk: scoreRisk(text, task),
    reliability: scoreReliability(candidate),
    claims_density: scoreClaimsDensity(claimCount, task),
    conflict_penalty: conflictPenalty
  }

  const score =
    dimensions.directness * weights.directness +
    dimensions.structure * weights.structure +
    dimensions.decisiveness * weights.decisiveness +
    dimensions.task_fit * weights.task_fit +
    dimensions.risk * weights.risk +
    dimensions.reliability * weights.reliability +
    dimensions.claims_density * weights.claims_density +
    dimensions.conflict_penalty * weights.conflict_penalty

  return {
    provider: candidate.provider,
    score: Number(score.toFixed(4)),
    dimensions: {
      directness: Number(dimensions.directness.toFixed(4)),
      structure: Number(dimensions.structure.toFixed(4)),
      decisiveness: Number(dimensions.decisiveness.toFixed(4)),
      task_fit: Number(dimensions.task_fit.toFixed(4)),
      risk: Number(dimensions.risk.toFixed(4)),
      reliability: Number(dimensions.reliability.toFixed(4)),
      claims_density: Number(dimensions.claims_density.toFixed(4)),
      conflict_penalty: Number(dimensions.conflict_penalty.toFixed(4))
    }
  }
}

function buildRationale(task: string, conflicts: any[]) {
  const base =
    task === "code"
      ? "task_fit_reliability_and_implementation_priority"
      : task === "research"
        ? "task_fit_structure_claims_and_reliability_priority"
        : task === "reasoning"
          ? "decisiveness_tradeoff_claims_and_reliability_priority"
          : "directness_clarity_and_reliability_priority"

  if (conflicts.length > 0) {
    return base + "_with_detected_claim_conflicts"
  }

  return base
}

export async function judge(params: {
  candidates: JudgeCandidate[]
  task: string
}) {
  const task = normalizeTask(params?.task)
  const candidates = Array.isArray(params?.candidates) ? params.candidates : []

  if (candidates.length === 0) return null

  const claimsMap = buildClaimsMap(candidates)
  const conflicts = detectConflicts(claimsMap)

  if (candidates.length === 1) {
    const only = candidates[0]
    return {
      provider: only.provider,
      answer_text: only.answer_text,
      raw: only.raw ?? null,
      ok: true,
      meta: {
        judge_selected_provider: only.provider,
        judge_scores: [
          {
            provider: only.provider,
            score: 1,
            dimensions: {
              directness: 1,
              structure: 1,
              decisiveness: 1,
              task_fit: 1,
              risk: 1,
              reliability: 1,
              claims_density: 1,
              conflict_penalty: 1
            }
          }
        ],
        judge_rationale: "single_candidate",
        conflicts,
        claims: claimsMap
      }
    }
  }

  const scored = candidates
    .map((candidate) => {
      const providerClaims = claimsMap.find((x) => x.provider === candidate.provider)?.claims ?? []
      const conflictPenalty = buildConflictPenalty(candidate.provider, conflicts)

      return {
        candidate,
        scored: scoreCandidate(candidate, task, providerClaims.length, conflictPenalty)
      }
    })
    .sort((a, b) => b.scored.score - a.scored.score)

  const winner = scored[0]
  const judgeScores = scored.map((row) => row.scored)
  const rationale = buildRationale(task, conflicts)

  return {
    provider: winner.candidate.provider,
    answer_text: winner.candidate.answer_text,
    raw: winner.candidate.raw ?? null,
    ok: true,
    meta: {
      judge_selected_provider: winner.candidate.provider,
      judge_scores: judgeScores,
      judge_rationale: rationale,
      conflicts,
      claims: claimsMap
    }
  }
}
