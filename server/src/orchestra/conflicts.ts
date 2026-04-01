import type { ExtractedClaim } from "./claims.js"
import { extractClaims } from "./claims.js"

export type DetectedConflict = {
  type: string
  severity: "low" | "medium" | "high"
  providers: string[]
  summary: string
  weight: number
}

// Conflict Decision — 어느 provider 주장이 더 신뢰할 만한가 판단 레코드
export type ConflictDecision = {
  conflict_type: string
  severity: "low" | "medium" | "high"
  providers: string[]
  winner_provider: string | null
  loser_provider: string | null
  rationale: string
  confidence: number        // 0~1 판단 신뢰도
  conflict_weight: number   // 원본 conflict weight
  judge_backed: boolean     // judge 선택과 일치 여부
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
  // 오탐 방지: 유사도 0.35 미만은 주제 자체가 다름 → 스킵
  if (similarity < 0.35) return 0
  // 오탐 방지: 유사도 0.85 이상은 거의 동일한 내용 → 갈등 아님
  if (similarity >= 0.85) return 0

  const numConflict = numericConflict(a, b)
  const condConflict = conditionConflict(a, b)
  const base = 1 - similarity
  const confidenceWeight = ((a.confidence ?? 0.5) + (b.confidence ?? 0.5)) / 2

  let score =
    (base * 0.45) +
    (numConflict * 0.40) +   // 수치 충돌에 가중 (팩트 오류가 가장 중요)
    (condConflict * 0.15)

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
  if (weight < 0.32) return   // 오탐 방지: threshold 상향 (0.20 → 0.32)

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
      if (score < 0.30) continue   // 오탐 방지: threshold 상향 (0.20 → 0.30)

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

// ------- Conflict → Decision 판단 레코드 -------

// task별 기본 신뢰 우선순위 (factual 정확도 기반)
const TASK_TRUST_PRIORITY: Record<string, string[]> = {
  reasoning:  ["openai", "claude", "gemini", "perplexity"],
  research:   ["perplexity", "openai", "claude", "gemini"],
  dialogue:   ["claude", "openai", "gemini", "perplexity"],
  writing:    ["claude", "openai", "gemini", "perplexity"],
  code:       ["claude", "openai", "gemini", "perplexity"],
  long_doc:   ["claude", "gemini", "openai", "perplexity"]
}

function normP(v: any): string {
  return String(v ?? "").trim().toLowerCase()
}

function buildDecisionRationale(
  winnerProvider: string | null,
  loserProvider: string | null,
  conflictType: string,
  judgeWinner: string,
  task: string
): { rationale: string; confidence: number } {
  const ctype = conflictType.replace(/_conflict$/, "").replace(/_/g, " ")

  if (!winnerProvider) {
    return {
      rationale: `${ctype} 충돌 — 판단 근거 불충분 (양쪽 provider 없음)`,
      confidence: 0.3
    }
  }

  const isJudgeBacked = normP(winnerProvider) === normP(judgeWinner)
  const taskPriority = TASK_TRUST_PRIORITY[task] ?? []
  const winnerRank = taskPriority.indexOf(normP(winnerProvider))
  const loserRank = loserProvider ? taskPriority.indexOf(normP(loserProvider)) : -1

  let baseConfidence = 0.55
  let rationale = ""

  if (isJudgeBacked) {
    baseConfidence += 0.20
    rationale = `Judge가 ${winnerProvider} 선택 → ${ctype} 충돌에서 ${winnerProvider} 주장 신뢰`
  } else if (winnerRank >= 0 && (loserRank < 0 || winnerRank < loserRank)) {
    baseConfidence += 0.10
    rationale = `${task} task 기준 신뢰 우선순위 — ${winnerProvider}(${winnerRank + 1}위) > ${loserProvider ?? "unknown"}(${loserRank >= 0 ? loserRank + 1 : "?"}위)`
  } else {
    baseConfidence = 0.45
    rationale = `${ctype} 충돌 — 명확한 우위 없음, ${winnerProvider} 우선 (약한 신호)`
  }

  // 수치 충돌은 신뢰도 소폭 감소 (팩트 검증 필요)
  if (conflictType.includes("numeric") || conflictType.includes("fact")) {
    baseConfidence -= 0.05
    rationale += " ⚠ 수치/사실 충돌 — 외부 검증 권고"
  }

  return {
    rationale,
    confidence: Number(Math.min(0.95, Math.max(0.30, baseConfidence)).toFixed(2))
  }
}

export function resolveConflictDecisions(
  conflicts: DetectedConflict[],
  judgeWinner: string,
  judgeConfidence: number,
  task: string
): ConflictDecision[] {
  if (!conflicts || conflicts.length === 0) return []

  const decisions: ConflictDecision[] = []
  const taskPriority = TASK_TRUST_PRIORITY[task] ?? []

  for (const conflict of conflicts) {
    // context 충돌 (provider vs context)은 skip — provider간 충돌만 처리
    const providerOnly = conflict.providers.filter((p) => normP(p) !== "context")
    if (providerOnly.length < 2) continue

    let winnerProvider: string | null = null
    let loserProvider: string | null = null

    // 1순위: judge winner가 conflict provider 중 하나이면 → winner로 채택
    const judgeInConflict = providerOnly.find((p) => normP(p) === normP(judgeWinner))
    if (judgeInConflict) {
      winnerProvider = judgeInConflict
      loserProvider = providerOnly.find((p) => normP(p) !== normP(judgeWinner)) ?? null
    } else {
      // 2순위: task 신뢰 우선순위로 결정
      const ranked = providerOnly
        .map((p) => ({ p, rank: taskPriority.indexOf(normP(p)) }))
        .sort((a, b) => {
          if (a.rank < 0 && b.rank < 0) return 0
          if (a.rank < 0) return 1
          if (b.rank < 0) return -1
          return a.rank - b.rank
        })
      if (ranked.length >= 2) {
        winnerProvider = ranked[0].p
        loserProvider = ranked[1].p
      } else if (ranked.length === 1) {
        winnerProvider = ranked[0].p
      }
    }

    const { rationale, confidence } = buildDecisionRationale(
      winnerProvider, loserProvider, conflict.type, judgeWinner, task
    )

    decisions.push({
      conflict_type: conflict.type,
      severity: conflict.severity,
      providers: providerOnly,
      winner_provider: winnerProvider,
      loser_provider: loserProvider,
      rationale,
      confidence,
      conflict_weight: conflict.weight,
      judge_backed: Boolean(judgeInConflict)
    })
  }

  // 중복 제거: 동일 provider 조합 + 동일 conflict_type은 최고 weight만 남김
  const seen = new Map<string, ConflictDecision>()
  for (const d of decisions) {
    const key = `${d.conflict_type}::${[...d.providers].sort().join(",")}`
    const existing = seen.get(key)
    if (!existing || d.conflict_weight > existing.conflict_weight) {
      seen.set(key, d)
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.conflict_weight - a.conflict_weight)
    .slice(0, 10) // 최대 10개
}
