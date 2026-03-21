type ConflictClaim = {
  provider?: string
  text?: string
  claim?: string
  type?: string
  subject?: string
  predicate?: string
  object?: string
  confidence?: number
  [k: string]: any
}

type ConflictItem = {
  type: string
  severity: "low" | "medium" | "high"
  weight: number
  provider_a: string
  provider_b: string
  text_a: string
  text_b: string
  claim_a: any
  claim_b: any
  subject_key: string
}

function normalizeText(value: any): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function claimText(claim: ConflictClaim): string {
  return String(
    claim?.text ??
    claim?.claim ??
    [claim?.subject, claim?.predicate, claim?.object].filter(Boolean).join(" ")
  ).trim()
}

function providerOf(claim: ConflictClaim): string {
  return String(claim?.provider ?? "unknown").trim().toLowerCase()
}

function containsAny(text: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (text.includes(pattern)) return true
  }
  return false
}

function isOppositePair(a: string, b: string, left: string[], right: string[]): boolean {
  return (
    (containsAny(a, left) && containsAny(b, right)) ||
    (containsAny(a, right) && containsAny(b, left))
  )
}

function semanticConflictType(a: string, b: string): string | null {
  if (isOppositePair(a, b, ["increase", "up", "higher", "grow", "상승", "증가", "높다"], ["decrease", "down", "lower", "drop", "하락", "감소", "낮다"])) {
    return "direction_conflict"
  }

  if (isOppositePair(a, b, ["possible", "can", "enabled", "가능", "된다", "허용"], ["impossible", "cannot", "can't", "disabled", "불가능", "안된다", "금지"])) {
    return "feasibility_conflict"
  }

  if (isOppositePair(a, b, ["recommend", "best", "prefer", "추천", "최적", "우선"], ["avoid", "not best", "do not recommend", "비추천", "지양"])) {
    return "recommendation_conflict"
  }

  if (isOppositePair(a, b, ["safe", "stable", "secure", "안전", "안정"], ["unsafe", "unstable", "insecure", "위험", "불안정"])) {
    return "risk_conflict"
  }

  return null
}

function extractNumbers(text: string): number[] {
  const matches = text.match(/-?\d+(?:\.\d+)?/g) ?? []
  return matches
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x))
}

function relativeDiff(a: number, b: number): number {
  const maxBase = Math.max(Math.abs(a), Math.abs(b), 1)
  return Math.abs(a - b) / maxBase
}

function numericConflictType(a: string, b: string): string | null {
  const numsA = extractNumbers(a)
  const numsB = extractNumbers(b)

  if (numsA.length < 1 || numsB.length < 1) return null

  const x = numsA[0]
  const y = numsB[0]

  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  if (x === y) return null

  if (relativeDiff(x, y) >= 0.3) {
    return "numeric_conflict"
  }

  return null
}

function extractPreferredOption(text: string): string {
  const normalized = normalizeText(text)

  const patterns = [
    /\boption\s+([a-z0-9]+)/i,
    /\bstrategy\s+([a-z0-9]+)/i,
    /\bchoose\s+([a-z0-9]+)/i,
    /\bpick\s+([a-z0-9]+)/i,
    /\b추천\s*[:：]?\s*([a-z0-9가-힣]+)/i,
    /\b선택\s*[:：]?\s*([a-z0-9가-힣]+)/i
  ]

  for (const pattern of patterns) {
    const m = normalized.match(pattern)
    if (m && m[1]) return String(m[1]).trim()
  }

  return ""
}

function optionConflictType(a: string, b: string): string | null {
  const optionA = extractPreferredOption(a)
  const optionB = extractPreferredOption(b)

  if (!optionA || !optionB) return null
  if (optionA === optionB) return null

  const recA = containsAny(a, ["recommend", "choose", "pick", "추천", "선택", "최적", "best"])
  const recB = containsAny(b, ["recommend", "choose", "pick", "추천", "선택", "최적", "best"])

  if (recA && recB) return "option_conflict"
  return null
}

function subjectKey(claim: ConflictClaim): string {
  const parts = [
    String(claim?.subject ?? "").trim().toLowerCase(),
    String(claim?.predicate ?? "").trim().toLowerCase()
  ].filter(Boolean)

  if (parts.length > 0) return parts.join("|")

  const text = normalizeText(claimText(claim))
  if (!text) return "unknown"

  const option = extractPreferredOption(text)
  if (option) return "option|" + option

  const tokens = text.split(" ").filter(Boolean).slice(0, 6)
  return tokens.join(" ")
}

function subjectOverlap(a: ConflictClaim, b: ConflictClaim): boolean {
  const keyA = subjectKey(a)
  const keyB = subjectKey(b)

  if (keyA === "unknown" || keyB === "unknown") {
    return true
  }

  if (keyA === keyB) return true
  if (keyA.includes(keyB) || keyB.includes(keyA)) return true

  const textA = normalizeText(claimText(a))
  const textB = normalizeText(claimText(b))

  const tokensA = new Set(textA.split(" ").filter(Boolean))
  const tokensB = new Set(textB.split(" ").filter(Boolean))

  let overlap = 0
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++
  }

  return overlap >= 2
}

function detectConflictType(a: ConflictClaim, b: ConflictClaim): string | null {
  const textA = normalizeText(claimText(a))
  const textB = normalizeText(claimText(b))

  if (!textA || !textB) return null
  if (!subjectOverlap(a, b)) return null

  const semantic = semanticConflictType(textA, textB)
  if (semantic) return semantic

  const numeric = numericConflictType(textA, textB)
  if (numeric) return numeric

  const option = optionConflictType(textA, textB)
  if (option) return option

  return null
}

function baseWeight(type: string): number {
  if (type === "numeric_conflict") return 1
  if (type === "feasibility_conflict") return 0.9
  if (type === "risk_conflict") return 0.85
  if (type === "direction_conflict") return 0.8
  if (type === "recommendation_conflict") return 0.6
  if (type === "option_conflict") return 0.5
  return 0.5
}

function confidenceOf(claim: ConflictClaim): number {
  const raw = Number(claim?.confidence ?? 0.7)
  return Number.isFinite(raw) ? Math.max(0.4, Math.min(1, raw)) : 0.7
}

function buildSeverity(weight: number): "low" | "medium" | "high" {
  if (weight >= 0.85) return "high"
  if (weight >= 0.6) return "medium"
  return "low"
}

function buildDedupKey(item: ConflictItem): string {
  const providers = [item.provider_a, item.provider_b].sort().join("|")
  const texts = [normalizeText(item.text_a), normalizeText(item.text_b)].sort().join("|")
  return [item.type, providers, item.subject_key, texts].join("::")
}

type CandidateClaims = {
  provider?: string
  claims?: ConflictClaim[]
}

export function detectConflicts(input: CandidateClaims[] = []): ConflictItem[] {
  const flatClaims: ConflictClaim[] = []

  for (const row of input ?? []) {
    const provider = String(row?.provider ?? "").trim().toLowerCase()
    for (const claim of row?.claims ?? []) {
      flatClaims.push({
        ...claim,
        provider: provider || claim?.provider
      })
    }
  }

  const conflicts: ConflictItem[] = []
  const seen = new Set<string>()

  for (let i = 0; i < flatClaims.length; i++) {
    for (let j = i + 1; j < flatClaims.length; j++) {
      const a = flatClaims[i]
      const b = flatClaims[j]

      if (!a || !b) continue

      const providerA = providerOf(a)
      const providerB = providerOf(b)

      if (!providerA || !providerB) continue
      if (providerA === providerB) continue

      const conflictType = detectConflictType(a, b)
      if (!conflictType) continue

      const weight = Number((baseWeight(conflictType) * ((confidenceOf(a) + confidenceOf(b)) / 2)).toFixed(4))

      const item: ConflictItem = {
        type: conflictType,
        severity: buildSeverity(weight),
        weight,
        provider_a: providerA,
        provider_b: providerB,
        text_a: claimText(a),
        text_b: claimText(b),
        claim_a: a,
        claim_b: b,
        subject_key: subjectKey(a)
      }

      const dedupKey = buildDedupKey(item)
      if (seen.has(dedupKey)) continue

      seen.add(dedupKey)
      conflicts.push(item)
    }
  }

  return conflicts
}
