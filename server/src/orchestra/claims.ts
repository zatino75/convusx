export type ExtractedClaimType =
  | "recommendation"
  | "risk"
  | "comparison"
  | "fact"
  | "implementation"

export type ExtractedClaim = {
  id: string
  type: ExtractedClaimType
  text: string
  normalized: string
  confidence: number
  evidence_span: string
  numeric_values?: number[]
  has_condition: boolean
}

function normalizeText(value: any): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function stripCodeFences(text: string): string {
  return String(text ?? "").replace(/```[\s\S]*?```/g, " ")
}

function stripMarkdown(text: string): string {
  return String(text ?? "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
}

function cleanInput(value: any): string {
  return normalizeText(stripMarkdown(stripCodeFences(String(value ?? ""))))
}

function lineSplit(text: string): string[] {
  return String(text ?? "")
    .split("\n")
    .map((line) => normalizeText(line))
    .filter(Boolean)
}

function sentenceSplit(text: string): string[] {
  const normalized = normalizeText(text)
    .replace(/\n+/g, ". ")
    .replace(/([가-힣])\s*\.\s*([가-힣])/g, "$1. $2")

  return normalized
    .split(/(?<=[.!?])\s+|[;\n]+/)
    .map((part) => normalizeText(part))
    .filter(Boolean)
}

function isNoiseLine(text: string): boolean {
  const lower = text.toLowerCase()

  if (!text) return true
  if (text.length < 10) return true
  if (/^[\-\*\=\_]{2,}$/.test(text)) return true
  if (/^(summary|결론|요약|note|notes|주의|참고)\s*:?$/i.test(text)) return true
  if (/^(yes|no|ok|done|확인|완료|좋음|가능)$/i.test(text)) return true
  if (/^[0-9]+\s*$/.test(text)) return true
  if (/^[a-z0-9 _\-\/\\.:]+$/i.test(text) && text.length < 18 && !/\d/.test(text)) return true

  const punctuationOnly = lower.replace(/[a-z0-9가-힣]/g, "")
  if (punctuationOnly.length === lower.length) return true

  return false
}

function shouldKeepPart(text: string): boolean {
  if (isNoiseLine(text)) return false
  if (text.length < 16) return false
  return true
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term))
}

function extractNumericValues(text: string): number[] {
  const matches = String(text ?? "").match(/-?\d+(?:\.\d+)?/g) ?? []
  const values = matches
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))

  return [...new Set(values)]
}

function hasConditionPattern(text: string): boolean {
  const lower = String(text ?? "").toLowerCase()

  return (
    /\bif\b/.test(lower) ||
    /\bwhen\b/.test(lower) ||
    /\bunless\b/.test(lower) ||
    /\bonly if\b/.test(lower) ||
    /이면|면\b|경우|조건/.test(lower)
  )
}

function detectClaimType(text: string): ExtractedClaimType {
  const lower = text.toLowerCase()

  if (
    includesAny(lower, [
      "recommend",
      "recommended",
      "should",
      "must",
      "best",
      "prefer",
      "final answer",
      "final choice",
      "권장",
      "추천",
      "선택",
      "결론",
      "적합",
      "유리",
      "맞다",
      "하는 게 맞"
    ])
  ) {
    return "recommendation"
  }

  if (
    includesAny(lower, [
      "risk",
      "risky",
      "danger",
      "unsafe",
      "limitation",
      "trade-off",
      "edge case",
      "failure",
      "warning",
      "주의",
      "리스크",
      "위험",
      "한계",
      "예외",
      "문제",
      "부작용",
      "실패 가능성"
    ])
  ) {
    return "risk"
  }

  if (
    includesAny(lower, [
      "vs",
      "better",
      "worse",
      "stronger",
      "weaker",
      "compare",
      "comparison",
      "outperform",
      "underperform",
      "비교",
      "우위",
      "열위",
      "더 낫",
      "더 좋",
      "더 나쁘"
    ])
  ) {
    return "comparison"
  }

  if (
    includesAny(lower, [
      "function",
      "class",
      "interface",
      "implementation",
      "implement",
      "refactor",
      "patch",
      "api",
      "endpoint",
      "schema",
      "typescript",
      "javascript",
      "powershell",
      "module",
      "component",
      "구현",
      "리팩터",
      "코드",
      "엔드포인트",
      "스키마",
      "컴포넌트",
      "모듈"
    ])
  ) {
    return "implementation"
  }

  return "fact"
}

function dedupeKey(text: string): string {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[“”"'`]/g, "")
    .replace(/\s+/g, " ")
}

function estimateConfidence(type: ExtractedClaimType, text: string): number {
  const lower = text.toLowerCase()
  const numericValues = extractNumericValues(text)
  const conditional = hasConditionPattern(text)

  let score =
    type === "recommendation" ? 0.72 :
    type === "risk" ? 0.7 :
    type === "comparison" ? 0.68 :
    type === "implementation" ? 0.74 :
    0.62

  if (numericValues.length > 0) score += 0.08
  if (conditional) score += 0.04
  if (text.length >= 50) score += 0.04
  if (text.length >= 90) score += 0.03

  if (
    includesAny(lower, [
      "maybe",
      "perhaps",
      "possibly",
      "unclear",
      "might",
      "추정",
      "아마",
      "불확실",
      "가능성"
    ])
  ) {
    score -= 0.12
  }

  if (
    includesAny(lower, [
      "definitely",
      "clearly",
      "confirmed",
      "확정",
      "명확",
      "확실"
    ])
  ) {
    score += 0.04
  }

  return Number(Math.max(0.35, Math.min(0.95, score)).toFixed(3))
}

function buildClaim(text: string, index: number): ExtractedClaim {
  const normalized = dedupeKey(text)
  const type = detectClaimType(text)
  const numericValues = extractNumericValues(text)
  const hasCondition = hasConditionPattern(text)
  const confidence = estimateConfidence(type, text)

  const claim: ExtractedClaim = {
    id: "claim_" + String(index + 1),
    type,
    text,
    normalized,
    confidence,
    evidence_span: text,
    has_condition: hasCondition
  }

  if (numericValues.length > 0) {
    claim.numeric_values = numericValues
  }

  return claim
}

function buildClaimsFromParts(parts: string[]): ExtractedClaim[] {
  const seen = new Set<string>()
  const claims: ExtractedClaim[] = []

  for (const raw of parts) {
    const text = normalizeText(raw)
    if (!shouldKeepPart(text)) continue

    const normalized = dedupeKey(text)
    if (!normalized) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)

    claims.push(buildClaim(text, claims.length))
  }

  return claims
}

function pickPreferredParts(text: string): string[] {
  const lines = lineSplit(text).filter(shouldKeepPart)
  const sentences = sentenceSplit(text).filter(shouldKeepPart)

  const recommendationLines = lines.filter((line) => detectClaimType(line) === "recommendation")
  const riskLines = lines.filter((line) => detectClaimType(line) === "risk")
  const comparisonLines = lines.filter((line) => detectClaimType(line) === "comparison")

  const prioritized = [
    ...recommendationLines,
    ...riskLines,
    ...comparisonLines,
    ...lines,
    ...sentences
  ]

  return prioritized
}

export function extractClaims(answerText: any): ExtractedClaim[] {
  const text = cleanInput(answerText)
  if (!text) return []

  const preferred = pickPreferredParts(text)
  const claims = buildClaimsFromParts(preferred)

  if (claims.length > 0) return claims

  const fallback = sentenceSplit(text).filter((part) => normalizeText(part).length >= 12)
  return buildClaimsFromParts(fallback)
}
