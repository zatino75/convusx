type ProviderResult = {
  provider: string
  result?: any
  score?: number
  ok?: boolean
  latency?: number | null
  verifier_signal?: string | null
  verifier_recommendation?: string | null
  primary_recommendation?: string | null
  provider_conflicts?: string[]
  score_breakdown?: any
}

function normalizeText(value: any): string {
  return String(value ?? "")
    .replace(/\r/g, "")
    .trim()
}

function getWinnerRawText(orchestraResult: any): string {
  const output = orchestraResult?.output

  return normalizeText(
    output?.answer_text ??
    output?.text ??
    output?.content ??
    output?.answer ??
    output?.summary ??
    output
  )
}

function getScoreboard(orchestraResult: any): ProviderResult[] {
  if (!Array.isArray(orchestraResult?.scoreboard)) {
    return []
  }

  return orchestraResult.scoreboard
}

function getTask(orchestraResult: any): string {
  return String(
    orchestraResult?.judge_trace?.task ??
    orchestraResult?.planner_plan?.task ??
    orchestraResult?.router_decision?.task ??
    "dialogue"
  ).toLowerCase()
}

function getRunnerUpText(scoreboard: ProviderResult[]): string {
  const runnerUp = scoreboard
    .slice()
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))[1]

  return normalizeText(
    runnerUp?.result?.answer_text ??
    runnerUp?.result?.text ??
    runnerUp?.result?.content ??
    runnerUp?.result?.answer ??
    ""
  )
}

function splitUsefulLines(text: string): string[] {
  return normalizeText(text)
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean)
}

function mergeResearchWinnerAndRunnerUp(winnerText: string, runnerUpText: string): string {
  const winner = normalizeText(winnerText)
  const runner = normalizeText(runnerUpText)

  if (!winner) return runner
  if (!runner) return winner

  const winnerLower = winner.toLowerCase()
  const runnerLines = splitUsefulLines(runner)

  const additions = runnerLines.filter((line) => {
    const lower = line.toLowerCase()
    if (line.length < 24) return false
    if (winnerLower.includes(lower)) return false
    if (lower.startsWith("summary")) return false
    if (lower.startsWith("conclusion")) return false
    if (lower.startsWith("recommendation")) return false
    return true
  }).slice(0, 3)

  if (additions.length === 0) {
    return winner
  }

  return [winner, ...additions.map((x) => `- ${x}`)].join("\n")
}

function isReasoningLineUseful(line: string): boolean {
  const lower = line.toLowerCase()

  if (line.length < 18) return false
  if (lower.startsWith("summary")) return false
  if (lower.startsWith("conclusion")) return false
  if (lower.startsWith("recommendation")) return false

  return (
    lower.includes("because") ||
    lower.includes("therefore") ||
    lower.includes("risk") ||
    lower.includes("margin") ||
    lower.includes("trade-off") ||
    lower.includes("tradeoff") ||
    lower.includes("conservative") ||
    lower.includes("operator") ||
    lower.includes("strategy") ||
    lower.includes("리스크") ||
    lower.includes("마진") ||
    lower.includes("보수적") ||
    lower.includes("전략") ||
    lower.includes("따라서")
  )
}

function extractRecommendationLine(text: string): string | null {
  const lines = splitUsefulLines(text)

  for (const line of lines) {
    const lower = line.toLowerCase()

    if (
      lower.includes("final recommendation") ||
      lower.includes("recommend ") ||
      lower.includes("choose ") ||
      lower.includes("결론") ||
      lower.includes("최종") ||
      lower.includes("추천")
    ) {
      return line
    }
  }

  return null
}

function mergeReasoningWinnerAndRunnerUp(winnerText: string, runnerUpText: string): string {
  const winner = normalizeText(winnerText)
  const runner = normalizeText(runnerUpText)

  if (!winner) return runner
  if (!runner) return winner

  const winnerLower = winner.toLowerCase()
  const runnerLines = splitUsefulLines(runner)

  const additions = runnerLines.filter((line) => {
    const lower = line.toLowerCase()
    if (!isReasoningLineUseful(line)) return false
    if (winnerLower.includes(lower)) return false
    return true
  }).slice(0, 3)

  const winnerRecommendation = extractRecommendationLine(winner)
  const runnerRecommendation = extractRecommendationLine(runner)

  let merged = winner

  if (additions.length > 0) {
    merged += "\n" + additions.map((x) => `- ${x}`).join("\n")
  }

  if (
    runnerRecommendation &&
    !winnerRecommendation &&
    !merged.toLowerCase().includes(runnerRecommendation.toLowerCase())
  ) {
    merged += "\n" + runnerRecommendation
  }

  return merged
}

function buildRunnerUpSnapshot(orchestraResult: any, scoreboard: ProviderResult[]) {
  const sorted = scoreboard
    .slice()
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))

  if (sorted[1]) {
    return {
      provider: sorted[1].provider,
      score: sorted[1].score
    }
  }

  const verificationProviders = Array.isArray(orchestraResult?.verification_bundle?.providers)
    ? orchestraResult.verification_bundle.providers
    : []

  if (verificationProviders.length > 0) {
    return {
      provider: verificationProviders[0],
      score: null
    }
  }

  return null
}

export function buildFinalAnswer(orchestraResult: any) {
  const task = getTask(orchestraResult)
  const scoreboard = getScoreboard(orchestraResult)
    .slice()
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))

  const topProvider = scoreboard[0]?.provider ?? orchestraResult?.winner_provider ?? null
  const topScore = Number(scoreboard[0]?.score ?? 0)

  const winnerText = getWinnerRawText(orchestraResult)
  const runnerUpText = getRunnerUpText(scoreboard)

  let finalText = winnerText
  let synthesisNote = "preserved winner output without structural rewrite"

  if (task === "research") {
    finalText = mergeResearchWinnerAndRunnerUp(winnerText, runnerUpText)
    synthesisNote = "winner-first research merge with runner-up support lines"
  }

  if (task === "reasoning") {
    finalText = mergeReasoningWinnerAndRunnerUp(winnerText, runnerUpText)
    synthesisNote = "winner-first reasoning merge with runner-up support lines"
  }

  return {
    summary: "",
    synthesized_answer: finalText,
    synthesis_notes: [
      `Selected winner: ${topProvider}`,
      `Provider ranking: ${topProvider}(${Number(topScore.toFixed(2))})`,
      synthesisNote
    ],
    judge_trace: orchestraResult?.judge_trace ?? null,
    decision_log: orchestraResult?.decision_log ?? null,
    decision_rationale: orchestraResult?.decision_log?.judge_rationale ?? null,
    winner_snapshot: scoreboard[0]
      ? {
          provider: scoreboard[0].provider,
          score: scoreboard[0].score
        }
      : null,
    runner_up_snapshot: buildRunnerUpSnapshot(orchestraResult, scoreboard),
    scoreboard_summary: scoreboard.map((item) => ({
      provider: item.provider,
      score: item.score,
      latency: item.latency ?? null,
      ok: item.ok ?? null,
      provider_conflicts: item.provider_conflicts ?? [],
      verifier_signal: item.verifier_signal ?? "none",
      verifier_recommendation: item.verifier_recommendation ?? null,
      primary_recommendation: item.primary_recommendation ?? null,
      score_breakdown: item.score_breakdown ?? null
    })),
    provider_chain: Array.isArray(orchestraResult?.provider_chain) ? orchestraResult.provider_chain : [],
    claims: Array.isArray(orchestraResult?.claims) ? orchestraResult.claims : [],
    claim_density: orchestraResult?.claim_density ?? {},
    evidence_strength: orchestraResult?.evidence_strength ?? {},
    conflicts: Array.isArray(orchestraResult?.conflicts) ? orchestraResult.conflicts : [],
    conflict_count: typeof orchestraResult?.conflict_count === "number" ? orchestraResult.conflict_count : 0,
    verification_bundle: orchestraResult?.verification_bundle ?? { providers: [], results: [] },
    router_decision: orchestraResult?.router_decision ?? null
  }
}
