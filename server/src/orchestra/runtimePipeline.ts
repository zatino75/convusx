import { finalizeEvaluationArtifacts, runEvaluationPass, type ProviderCandidate } from "./evaluationPipeline.js"

export type RunJudgeStepInput = {
  task: string
  message?: string
  candidates: ProviderCandidate[]
  primaryProvider?: string
  projectId?: string
  threadId?: string
}

export async function runJudgeStep(input: RunJudgeStepInput) {
  const artifacts = await runEvaluationPass({
    task: input.task,
    message: input.message,
    candidates: input.candidates,
    primaryProvider: input.primaryProvider,
    projectId: input.projectId,
    threadId: input.threadId,
  })

  return finalizeEvaluationArtifacts(artifacts)
}

export function sanitizeProviderStreamSummary<T extends { provider?: string; raw?: any }>(
  rows: T[],
  winnerProvider: string
): T[] {
  const winner = String(winnerProvider ?? "").trim().toLowerCase()
  return (rows ?? []).map((row) => {
    const provider = String(row?.provider ?? row?.raw?.provider ?? "").trim().toLowerCase()
    if (!provider || provider === winner) return row
    const raw = row?.raw && typeof row.raw === "object" ? { ...row.raw } : row?.raw
    if (raw && typeof raw === "object") {
      delete raw.preview_text
      delete raw.preview_excerpt
      delete raw.last_non_empty_chunk
    }
    return { ...row, raw }
  })
}

export function chooseRunnerUp(scoreRows: Array<{ provider: string; score: number }>, winnerProvider: string) {
  const winner = String(winnerProvider ?? "").trim().toLowerCase()
  return [...(scoreRows ?? [])]
    .sort((a, b) => Number(b?.score ?? 0) - Number(a?.score ?? 0))
    .find((row) => String(row?.provider ?? "").trim().toLowerCase() !== winner)?.provider ?? ""
}
