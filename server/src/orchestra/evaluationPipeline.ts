import { extractClaims } from "./claims.js"
import { detectConflicts, resolveConflictDecisions } from "./conflicts.js"
import { judge } from "./judge.js"

export type ProviderCandidate = {
  provider: string
  answer_text: string
  raw?: any
}

export type EvaluationArtifacts = {
  candidates: ProviderCandidate[]
  claims: any[]
  conflicts: any[]
  resolvedConflicts: any[]
  judged: any
  winner: string
  scoreRows: Array<{ provider: string; score: number; reasons?: string[] }>
}

export type EvaluationOptions = {
  task: string
  message?: string
  candidates: ProviderCandidate[]
  primaryProvider?: string
  projectId?: string
  threadId?: string
  executionStrategy?: string
}

function normalizeCandidates(candidates: ProviderCandidate[]): ProviderCandidate[] {
  return (candidates ?? [])
    .map((item) => ({
      provider: String(item?.provider ?? "").trim().toLowerCase(),
      answer_text: String(item?.answer_text ?? (item as any)?.raw?.answer_text ?? "").trim(),
      raw: item?.raw,
    }))
    .filter((item) => item.provider && item.answer_text)
}

function buildSingleCandidateArtifacts(task: string, candidate: ProviderCandidate): EvaluationArtifacts {
  return {
    candidates: [candidate],
    claims: [],
    conflicts: [],
    resolvedConflicts: [],
    judged: {
      task,
      provider: candidate.provider,
      meta: {
        judge_selected_provider: candidate.provider,
        judge_scores: [{ provider: candidate.provider, score: 1, reasons: ["single_candidate"] }],
        judge_rationale: "single candidate available",
        judge_confidence: 1,
        conflict_count: 0,
      },
    },
    winner: candidate.provider,
    scoreRows: [{ provider: candidate.provider, score: 1, reasons: ["single_candidate"] }],
  }
}

export async function runEvaluationPass(options: EvaluationOptions): Promise<EvaluationArtifacts> {
  const task = String(options?.task ?? "dialogue").trim().toLowerCase()
  const candidates = normalizeCandidates(options?.candidates ?? [])

  if (candidates.length === 0) {
    return { candidates: [], claims: [], conflicts: [], resolvedConflicts: [],
      judged: null, winner: "", scoreRows: [] }
  }

  if (candidates.length === 1) {
    return buildSingleCandidateArtifacts(task, candidates[0])
  }

  // 실제 함수 시그니처에 맞게 호출
  // extractClaims(answerText): ExtractedClaim[]
  const allClaims = candidates.flatMap((c) => {
    try { return extractClaims(c.answer_text) ?? [] } catch { return [] }
  })

  // detectConflicts(providerClaims: {provider, claims}[], context)
  const providerClaims = candidates.map((c) => ({
    provider: c.provider,
    claims: (() => { try { return extractClaims(c.answer_text) ?? [] } catch { return [] } })()
  }))

  const conflicts = (() => {
    try { return detectConflicts(providerClaims, task) ?? [] } catch { return [] }
  })()

  // judge 호출
  const judged = await judge({
    candidates: candidates.map((c) => ({ provider: c.provider, answer_text: c.answer_text, raw: c.raw })),
    task,
    conflicts: conflicts as any,
    question: options?.message ?? "",
    executionStrategy: options?.executionStrategy,
  })

  const winner = String(
    (judged as any)?.winner_provider ??
    (judged as any)?.meta?.judge_selected_provider ??
    (judged as any)?.provider ??
    candidates[0]?.provider ?? ""
  ).trim().toLowerCase()

  const scoreRows = Array.isArray((judged as any)?.score_rows)
    ? (judged as any).score_rows
    : Array.isArray((judged as any)?.meta?.judge_scores)
    ? (judged as any).meta.judge_scores
    : []

  return {
    candidates,
    claims: allClaims,
    conflicts,
    resolvedConflicts: conflicts,
    judged,
    winner,
    scoreRows,
  }
}

export function finalizeEvaluationArtifacts(artifacts: EvaluationArtifacts) {
  const winner = String(artifacts?.winner ?? "").trim().toLowerCase()
  const winnerCandidate = (artifacts?.candidates ?? [])
    .find((c) => c.provider === winner) ?? artifacts?.candidates?.[0] ?? null
  const runnerUp = [...(artifacts?.scoreRows ?? [])]
    .sort((a, b) => Number(b?.score ?? 0) - Number(a?.score ?? 0))
    .find((row) => String(row?.provider ?? "").trim().toLowerCase() !== winner)

  return {
    winner,
    winnerCandidate,
    runnerUpProvider: String(runnerUp?.provider ?? "").trim().toLowerCase(),
    scoreRows: artifacts?.scoreRows ?? [],
    conflicts: artifacts?.resolvedConflicts ?? artifacts?.conflicts ?? [],
    claims: artifacts?.claims ?? [],
    judged: artifacts?.judged,
  }
}
