import type { ExtractedClaim } from "./claims.js"

export type CandidateClaims = {
  provider: string
  claims: ExtractedClaim[]
}

export type DetectedConflict = {
  type: "recommendation_mismatch" | "risk_mismatch" | "comparison_mismatch" | "close_competition"
  severity: "low" | "medium" | "high"
  providers: string[]
  claim_texts: string[]
  note: string
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term))
}

function recommendationDirection(text: string): "positive" | "negative" | "neutral" {
  const lower = String(text ?? "").toLowerCase()

  if (
    includesAny(lower, [
      "recommend",
      "should",
      "must",
      "best",
      "prefer",
      "추천",
      "선택",
      "유리",
      "적합",
      "맞습니다"
    ])
  ) {
    return "positive"
  }

  if (
    includesAny(lower, [
      "avoid",
      "not recommended",
      "should not",
      "do not",
      "비추천",
      "피해야",
      "하지 말",
      "불리",
      "부적합"
    ])
  ) {
    return "negative"
  }

  return "neutral"
}

function riskDirection(text: string): "high" | "low" | "neutral" {
  const lower = String(text ?? "").toLowerCase()

  if (
    includesAny(lower, [
      "high risk",
      "serious risk",
      "major risk",
      "critical",
      "큰 리스크",
      "치명적",
      "위험",
      "문제"
    ])
  ) {
    return "high"
  }

  if (
    includesAny(lower, [
      "low risk",
      "manageable",
      "acceptable",
      "minor risk",
      "리스크 낮",
      "관리 가능",
      "감수 가능"
    ])
  ) {
    return "low"
  }

  return "neutral"
}

function pushConflict(
  out: DetectedConflict[],
  type: DetectedConflict["type"],
  severity: DetectedConflict["severity"],
  providers: string[],
  claimTexts: string[],
  note: string
) {
  out.push({
    type,
    severity,
    providers,
    claim_texts: claimTexts,
    note
  })
}

export function detectConflicts(candidates: CandidateClaims[]): DetectedConflict[] {
  const out: DetectedConflict[] = []

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const left = candidates[i]
      const right = candidates[j]

      const leftRecommendations = left.claims.filter((c) => c.type === "recommendation")
      const rightRecommendations = right.claims.filter((c) => c.type === "recommendation")

      for (const a of leftRecommendations) {
        for (const b of rightRecommendations) {
          const dirA = recommendationDirection(a.text)
          const dirB = recommendationDirection(b.text)

          if (dirA !== "neutral" && dirB !== "neutral" && dirA !== dirB) {
            pushConflict(
              out,
              "recommendation_mismatch",
              "high",
              [left.provider, right.provider],
              [a.text, b.text],
              "recommendations_point_in_opposite_directions"
            )
          }
        }
      }

      const leftRisks = left.claims.filter((c) => c.type === "risk")
      const rightRisks = right.claims.filter((c) => c.type === "risk")

      for (const a of leftRisks) {
        for (const b of rightRisks) {
          const dirA = riskDirection(a.text)
          const dirB = riskDirection(b.text)

          if (dirA !== "neutral" && dirB !== "neutral" && dirA !== dirB) {
            pushConflict(
              out,
              "risk_mismatch",
              "medium",
              [left.provider, right.provider],
              [a.text, b.text],
              "risk_assessment_differs"
            )
          }
        }
      }

      const leftComparisons = left.claims.filter((c) => c.type === "comparison")
      const rightComparisons = right.claims.filter((c) => c.type === "comparison")

      if (leftComparisons.length > 0 && rightComparisons.length > 0) {
        pushConflict(
          out,
          "comparison_mismatch",
          "low",
          [left.provider, right.provider],
          [leftComparisons[0].text, rightComparisons[0].text],
          "comparison_framing_differs"
        )
      }
    }
  }

  return out
}
