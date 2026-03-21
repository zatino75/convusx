import type { Claim, ClaimType, ClaimsResult } from "./types.js"

function normalize(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function extractText(item: any): string {
  return String(
    item?.result?.answer_text ??
    item?.result?.text ??
    item?.result?.content ??
    item?.result?.answer ??
    item?.answer_text ??
    item?.text ??
    ""
  ).trim()
}

function stripMarkdown(text: string): string {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\r/g, "")
}

function cleanSentence(text: string): string {
  return String(text ?? "")
    .replace(/^\s*#+\s*/g, "")
    .replace(/^\s*[-*•]+\s*/g, "")
    .replace(/^\s*\d+[.)]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function isLabelLine(text: string): boolean {
  const t = String(text ?? "").trim()

  if (/^[가-힣A-Za-z0-9 _()/-]{1,24}:\s*$/.test(t)) return true

  if (/^[가-힣A-Za-z0-9 _()/-]{1,24}:\s*[^.!?]+$/.test(t)) {
    if (!/[.!?다요니다]$/.test(t)) return true
  }

  return false
}

function isStructuralNoise(text: string): boolean {
  const raw = String(text ?? "").trim()
  const lower = normalize(raw)

  if (!raw) return true
  if (/^#{1,6}\s+/.test(raw)) return true
  if (/^\s*-{3,}\s*$/.test(raw)) return true
  if (/^\s*={3,}\s*$/.test(raw)) return true
  if (/^\s*\|.*\|\s*$/.test(raw)) return true
  if (/^\s*[-*•]\s*$/.test(raw)) return true
  if (lower === "---") return true
  if (raw.length < 4) return true
  if (isLabelLine(raw)) return true

  return false
}

function splitSentences(text: string): string[] {
  const stripped = stripMarkdown(text)

  const lines = stripped
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => !isStructuralNoise(x))

  const out: string[] = []

  for (const line of lines) {
    const cleaned = cleanSentence(line)
    if (!cleaned) continue
    if (isStructuralNoise(cleaned)) continue

    const parts = cleaned
      .split(/(?<=[.!?])\s+/)
      .map((x) => cleanSentence(x))
      .filter(Boolean)
      .filter((x) => !isStructuralNoise(x))

    if (parts.length > 0) {
      out.push(...parts)
    } else {
      out.push(cleaned)
    }
  }

  return out
}

function isRecommendationSentence(text: string): boolean {
  const lower = normalize(text)
  return /recommend|choose|pick|prefer|best|추천|선택|최적|권장|우선/.test(lower)
}

function isComparisonSentence(text: string): boolean {
  const lower = normalize(text)
  return /better|worse|higher|lower|more than|less than|>|<|보다/.test(lower)
}

function hasRealNumericSignal(text: string): boolean {
  const raw = String(text ?? "").replace(/\b[a-zA-Z가-힣]+[0-9]+[a-zA-Z가-힣]*\b/g, " ")
  return /\d+(\.\d+)?/.test(raw)
}

function hasVerbLikeSignal(text: string): boolean {
  const lower = normalize(text)

  return (
    /\bis\b/.test(lower) ||
    /\bare\b/.test(lower) ||
    /\bcan\b/.test(lower) ||
    /\bcannot\b/.test(lower) ||
    /\bshould\b/.test(lower) ||
    /\bwill\b/.test(lower) ||
    /\bneed\b/.test(lower) ||
    /\brecommend\b/.test(lower) ||
    /\bincrease\b/.test(lower) ||
    /\bdecrease\b/.test(lower) ||
    /이다|입니다|있다|있습니다|된다|됩니다|가능|불가능|권장|추천|필요|증가|감소|높다|낮다|중요/.test(lower)
  )
}

function isEnumerationLike(text: string): boolean {
  const t = String(text ?? "").trim()

  if (!t) return true
  if (/[.!?다요니다]$/.test(t)) return false
  if (hasVerbLikeSignal(t)) return false

  const commaCount = (t.match(/,/g) ?? []).length
  const middleDotCount = (t.match(/·/g) ?? []).length
  const slashCount = (t.match(/\//g) ?? []).length

  if (commaCount >= 2) return true
  if (middleDotCount >= 2) return true
  if (slashCount >= 3) return true
  if (/^[가-힣A-Za-z0-9 _()/-]{2,40}$/.test(t)) return true

  return false
}

function isTitleLike(text: string): boolean {
  const t = String(text ?? "").trim()

  if (!t) return true
  if (/[.!?다요니다]$/.test(t)) return false
  if (hasVerbLikeSignal(t)) return false
  if (t.length <= 32) return true
  if (/^[가-힣A-Za-z0-9 _()/-]+$/.test(t) && !/\d/.test(t)) return true

  return false
}

function detectClaimType(text: string): ClaimType {
  if (isRecommendationSentence(text)) return "recommendation"
  if (isComparisonSentence(text)) return "comparison"
  if (hasRealNumericSignal(text)) return "numeric"
  return "fact"
}

function polarityOf(text: string): "pos" | "neg" {
  const lower = normalize(text)

  if (/not|cannot|can't|impossible|avoid|do not recommend|비추천|불가능|안된다|지양/.test(lower)) {
    return "neg"
  }

  return "pos"
}

function extractSubject(text: string, type: ClaimType): string {
  const raw = String(text ?? "").trim()

  const m = raw.match(/^([가-힣A-Za-z0-9 _()/-]{1,48})(?:은|는|이|가)\s+/)
  if (m && m[1]) return String(m[1]).trim()

  const m2 = raw.match(/^([A-Za-z][A-Za-z0-9 _()/-]{1,48})\s+(?:is|are|can|cannot)\s+/i)
  if (m2 && m2[1]) return String(m2[1]).trim()

  if (type === "recommendation") return "recommendation"
  if (type === "comparison") return "comparison"
  if (type === "numeric") return "numeric"

  return raw.slice(0, 48)
}

function extractPredicate(text: string, type: ClaimType): string {
  const lower = normalize(text)

  if (type === "recommendation") return "recommend"

  if (type === "comparison") {
    if (lower.includes("<") || lower.includes("작다") || lower.includes("lower") || lower.includes("less")) {
      return "less_than"
    }
    return "greater_than"
  }

  if (type === "numeric") return "value"
  if (/can|가능/.test(lower)) return "can"
  if (/cannot|불가능/.test(lower)) return "cannot"

  return "is"
}

function extractObject(text: string, type: ClaimType): string {
  if (type === "numeric") {
    const m = String(text ?? "").match(/-?\d+(\.\d+)?/)
    return m ? m[0] : String(text ?? "")
  }

  if (type === "recommendation") {
    const m = String(text ?? "").match(/(choose|pick|recommend)\s+([a-z0-9가-힣_-]+)/i)
    if (m && m[2]) return String(m[2]).trim()
  }

  return String(text ?? "").trim()
}

function computeEvidenceScore(text: string): number {
  const lower = normalize(text)
  let score = 0

  if (hasRealNumericSignal(text)) score += 0.3
  if (/data|research|study|evidence|according to|source|sources|benchmark|metric|metrics|통계|자료|보고서|근거/.test(lower)) {
    score += 0.3
  }
  if (/risk|trade-off|alternative|limitation|리스크|대안|한계/.test(lower)) {
    score += 0.15
  }

  return Number(Math.min(1, score).toFixed(4))
}

function shouldKeepSentence(text: string): boolean {
  const cleaned = cleanSentence(text)

  if (!cleaned) return false
  if (isStructuralNoise(cleaned)) return false
  if (isLabelLine(cleaned)) return false
  if (cleaned.length < 10) return false
  if (isEnumerationLike(cleaned)) return false
  if (isTitleLike(cleaned)) return false

  return true
}

function buildClaim(provider: string, sentence: string, index: number): Claim {
  const cleaned = cleanSentence(sentence)
  const type = detectClaimType(cleaned)

  return {
    id: provider + "_claim_" + index,
    provider,
    type,
    text: cleaned,
    subject: extractSubject(cleaned, type),
    predicate: extractPredicate(cleaned, type),
    object: extractObject(cleaned, type),
    polarity: polarityOf(cleaned)
  } as Claim
}

function extractClaims(provider: string, text: string): Claim[] {
  const sentences = splitSentences(text).filter(shouldKeepSentence)
  return sentences.map((s, i) => buildClaim(provider, s, i))
}

function providerSeed(provider: string): number {
  const p = String(provider ?? "").trim().toLowerCase()
  if (p === "openai") return 1
  if (p === "claude") return 0.93
  if (p === "gemini") return 0.88
  if (p === "perplexity") return 0.84
  return 0.8
}

function claimConfidenceFromText(text: string): number {
  const evidence = computeEvidenceScore(text)
  return Number((0.55 + Math.min(0.4, evidence)).toFixed(4))
}

export function runClaimsEngine(results: any[]): ClaimsResult {
  const claims: Claim[] = []

  const providerStats: Record<string, {
    claim_count: number
    evidence_score_total: number
    confidence_total: number
  }> = {}

  for (const item of results ?? []) {
    const provider = String(item?.provider ?? "unknown").trim().toLowerCase()
    const text = extractText(item)

    const extracted = extractClaims(provider, text)
    claims.push(...extracted)

    providerStats[provider] = providerStats[provider] ?? {
      claim_count: 0,
      evidence_score_total: 0,
      confidence_total: 0
    }

    for (const claim of extracted) {
      const confidence = claimConfidenceFromText(claim.text)

      providerStats[provider].claim_count += 1
      providerStats[provider].evidence_score_total += computeEvidenceScore(claim.text)
      providerStats[provider].confidence_total += confidence
    }
  }

  const claim_density: Record<string, number> = {}
  const evidence_strength: Record<string, number> = {}
  const provider_confidence: Record<string, number> = {}
  const provider_reliability_seed: Record<string, number> = {}

  for (const provider of Object.keys(providerStats)) {
    const count = Math.max(1, providerStats[provider].claim_count)

    claim_density[provider] = providerStats[provider].claim_count
    evidence_strength[provider] = Number((providerStats[provider].evidence_score_total / count).toFixed(4))
    provider_confidence[provider] = Number((providerStats[provider].confidence_total / count).toFixed(4))
    provider_reliability_seed[provider] = providerSeed(provider)
  }

  return {
    claims,
    conflicts: [],
    claim_density,
    evidence_strength,
    provider_confidence,
    provider_reliability_seed
  } as ClaimsResult
}
