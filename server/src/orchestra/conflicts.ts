import type { ExtractedClaim } from "./claims.js"
import { extractClaims } from "./claims.js"

export type DetectedConflict = {
  type: string
  severity: "low" | "medium" | "high"
  providers: string[]
  summary: string
  weight: number
}

function normalize(text: string) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\w가-힣\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function textSimilarity(a: string, b: string): number {
  const na = normalize(a)
  const nb = normalize(b)

  if (!na || !nb) return 0

  const setA = new Set(na.split(" ").filter(Boolean))
  const setB = new Set(nb.split(" ").filter(Boolean))

  const intersection = [...setA].filter((x) => setB.has(x)).length
  const union = new Set([...setA, ...setB]).size

  return union === 0 ? 0 : intersection / union
}

function numericConflict(a: ExtractedClaim, b: ExtractedClaim): number {
  if (!a.numeric_values || !b.numeric_values) return 0

  let maxRatio = 0

  for (const x of a.numeric_values) {
    for (const y of b.numeric_values) {
      const diff = Math.abs(x - y)
      const denom = Math.max(Math.abs(x), Math.abs(y), 1)
      const ratio = diff / denom
      if (ratio > maxRatio) maxRatio = ratio
    }
  }

  if (maxRatio < 0.15) return 0
  return Math.min(1, maxRatio)
}

function conditionConflict(a: ExtractedClaim, b: ExtractedClaim): number {
  return a.has_condition !== b.has_condition ? 0.5 : 0
}

function severityFromScore(score: number): "low" | "medium" | "high" {
  if (score >= 0.75) return "high"
  if (score >= 0.45) return "medium"
  return "low"
}

function buildConflictScore(a: ExtractedClaim, b: ExtractedClaim): number {
  const similarity = textSimilarity(a.text, b.text)
  if (similarity < 0.25) return 0

  const numConflict = numericConflict(a, b)
  const condConflict = conditionConflict(a, b)
  const base = 1 - similarity
  const confidenceWeight = ((a.confidence ?? 0.5) + (b.confidence ?? 0.5)) / 2

  let score =
    (base * 0.5) +
    (numConflict * 0.3) +
    (condConflict * 0.2)

  score *= confidenceWeight

  return Number(score.toFixed(3))
}

function pushConflict(
  out: DetectedConflict[],
  type: string,
  providers: string[],
  summary: string,
  weight: number
) {
  if (weight < 0.2) return

  out.push({
    type,
    severity: severityFromScore(weight),
    providers,
    summary,
    weight
  })
}

function compareClaimSets(
  out: DetectedConflict[],
  leftProvider: string,
  leftClaims: ExtractedClaim[],
  rightProvider: string,
  rightClaims: ExtractedClaim[],
  prefix: string
) {
  for (const a of leftClaims) {
    for (const b of rightClaims) {
      if (a.type !== b.type) continue

      const score = buildConflictScore(a, b)
      if (score < 0.2) continue

      pushConflict(
        out,
        `${prefix}_${a.type}_conflict`,
        [leftProvider, rightProvider],
        `${leftProvider} vs ${rightProvider}: ${a.text.slice(0, 80)} <> ${b.text.slice(0, 80)}`,
        score
      )
    }
  }
}

export function detectConflicts(
  providerClaims: { provider: string; claims: ExtractedClaim[] }[],
  context: string
): DetectedConflict[] {
  const conflicts: DetectedConflict[] = []

  for (let i = 0; i < providerClaims.length; i += 1) {
    for (let j = i + 1; j < providerClaims.length; j += 1) {
      const left = providerClaims[i]
      const right = providerClaims[j]

      compareClaimSets(
        conflicts,
        left.provider,
        left.claims,
        right.provider,
        right.claims,
        "provider"
      )
    }
  }

  const contextClaims = extractClaims(context)

  if (contextClaims.length > 0) {
    for (const row of providerClaims) {
      compareClaimSets(
        conflicts,
        row.provider,
        row.claims,
        "context",
        contextClaims,
        "context"
      )
    }
  }

  return conflicts
}
