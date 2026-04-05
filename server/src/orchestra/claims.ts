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
  const raw = String(text ?? "")
  const results: number[] = []

  // 한국어 복합 수치 — "1조 2천억", "3억 5천만", "2천5백만" 등
  const koreanPattern = /(-?[\d,]+(?:\.\d+)?)\s*(조|억|만|천)?/g
  const unitMap: Record<string, number> = { 조: 1e12, 억: 1e8, 만: 1e4, 천: 1e3 }

  // 조+억, 억+만, 만+천 복합 패턴 먼저 처리 (우선순위: 큰 단위 → 작은 단위)
  // "1조 2천억" → 1*1e12 + 2000*1e8 = 1.2조
  // "3억 5천만" → 3*1e8 + 5000*1e4 = 3.5억
  // 복합 한국어 수치 — "1조 2천억", "3억 5천만", "2조 5천억"
  // "N천억" = N*1000*1e8, "N천만" = N*1000*1e4
  const complexPairs: Array<{ pat: RegExp; fn: (a: number, b: number) => number }> = [
    { pat: /(-?[\d,]+)\s*조\s*([\d,]+)\s*천억/g, fn: (a, b) => a * 1e12 + b * 1e11 },
    { pat: /(-?[\d,]+)\s*조\s*([\d,]+)\s*억/g,   fn: (a, b) => a * 1e12 + b * 1e8  },
    { pat: /(-?[\d,]+)\s*억\s*([\d,]+)\s*천만/g, fn: (a, b) => a * 1e8  + b * 1e7  },
    { pat: /(-?[\d,]+)\s*억\s*([\d,]+)\s*만/g,   fn: (a, b) => a * 1e8  + b * 1e4  },
    { pat: /(-?[\d,]+)\s*만\s*([\d,]+)\s*천/g,   fn: (a, b) => a * 1e4  + b * 1e3  },
  ]
  for (const { pat, fn } of complexPairs) {
    let cm: RegExpExecArray | null
    while ((cm = pat.exec(raw)) !== null) {
      const a = parseFloat(cm[1].replace(/,/g, ""))
      const b = parseFloat(cm[2].replace(/,/g, ""))
      const val = fn(a, b)
      if (Number.isFinite(val)) results.push(val)
    }
  }
  // "N천억" 단독 — "2천억" = 2000억
  const prefixPairs: Array<[RegExp, number]> = [
    [/([\d,]+)\s*천억/g, 1e11],
    [/([\d,]+)\s*천만/g, 1e7],
    [/([\d,]+)\s*백만/g, 1e6],
    [/([\d,]+)\s*백억/g, 1e10],
  ]
  for (const [pp, unit] of prefixPairs) {
    let pm2: RegExpExecArray | null
    while ((pm2 = pp.exec(raw)) !== null) {
      const val = parseFloat(pm2[1].replace(/,/g, "")) * unit
      if (Number.isFinite(val)) results.push(val)
    }
  }

  // 단순 한국어 단위 — "5억", "3만" 등
  let km: RegExpExecArray | null
  while ((km = koreanPattern.exec(raw)) !== null) {
    const numStr = km[1]?.replace(/,/g, "")
    const unit = km[2]
    if (!numStr) continue
    const base = parseFloat(numStr)
    if (!Number.isFinite(base)) continue
    const val = unit ? base * unitMap[unit] : base
    if (Number.isFinite(val)) results.push(val)
  }

  // % 수치 — "2.1%", "30%" → 그대로 수치 추출
  const pctPattern = /(-?[\d]+(?:\.\d+)?)\s*%/g
  let pm: RegExpExecArray | null
  while ((pm = pctPattern.exec(raw)) !== null) {
    const val = parseFloat(pm[1])
    if (Number.isFinite(val)) results.push(val)
  }

  // 일반 숫자 (콤마 포함) — "1,234", "3.14"
  const numPattern = /-?[\d,]+(?:\.\d+)?/g
  let nm: RegExpExecArray | null
  while ((nm = numPattern.exec(raw)) !== null) {
    const val = parseFloat(nm[0].replace(/,/g, ""))
    if (Number.isFinite(val)) results.push(val)
  }

  return [...new Set(results)]
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
