export type ExtractedClaim = {
  id: string
  type: "recommendation" | "risk" | "comparison" | "fact" | "implementation"
  text: string
  normalized: string
}

function normalizeText(value: any): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
}

function lineSplit(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

function sentenceSplit(text: string): string[] {
  const normalized = text.replace(/\n+/g, ". ")
  return normalized
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function detectClaimType(text: string): ExtractedClaim["type"] {
  const lower = text.toLowerCase()

  if (
    lower.includes("recommend") ||
    lower.includes("should") ||
    lower.includes("must") ||
    lower.includes("final") ||
    lower.includes("추천") ||
    lower.includes("결론") ||
    lower.includes("선택") ||
    lower.includes("유리") ||
    lower.includes("적합")
  ) {
    return "recommendation"
  }

  if (
    lower.includes("risk") ||
    lower.includes("limitation") ||
    lower.includes("trade-off") ||
    lower.includes("edge case") ||
    lower.includes("주의") ||
    lower.includes("리스크") ||
    lower.includes("한계") ||
    lower.includes("예외")
  ) {
    return "risk"
  }

  if (
    lower.includes("vs") ||
    lower.includes("better") ||
    lower.includes("worse") ||
    lower.includes("compare") ||
    lower.includes("comparison") ||
    lower.includes("비교") ||
    lower.includes("더 낫") ||
    lower.includes("우위")
  ) {
    return "comparison"
  }

  if (
    lower.includes("function") ||
    lower.includes("class") ||
    lower.includes("interface") ||
    lower.includes("implementation") ||
    lower.includes("refactor") ||
    lower.includes("구현") ||
    lower.includes("리팩터") ||
    lower.includes("코드")
  ) {
    return "implementation"
  }

  return "fact"
}

function buildClaimsFromParts(parts: string[]): ExtractedClaim[] {
  const seen = new Set<string>()
  const claims: ExtractedClaim[] = []

  for (const raw of parts) {
    const text = normalizeText(raw)
    if (text.length < 18) continue

    const normalized = text.toLowerCase()
    if (seen.has(normalized)) continue
    seen.add(normalized)

    claims.push({
      id: "claim_" + String(claims.length + 1),
      type: detectClaimType(text),
      text,
      normalized
    })
  }

  return claims
}

export function extractClaims(answerText: any): ExtractedClaim[] {
  const text = normalizeText(answerText)
  if (!text) return []

  const lines = lineSplit(text)
  const sentences = sentenceSplit(text)

  const preferred = lines.length >= 3 ? lines : sentences
  return buildClaimsFromParts(preferred)
}
