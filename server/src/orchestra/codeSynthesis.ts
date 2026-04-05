export type CodeSynthesisInput = {
  winnerText: string
  winnerProvider?: string
  patch?: string
  impactedFiles?: string[]
  verificationSteps?: string[]
  riskSummary?: string[]
  rollbackNote?: string
}

function list(input: any): string[] {
  return Array.isArray(input) ? input.map((item) => String(item ?? "").trim()).filter(Boolean) : []
}

export function runCodeSynthesis(input: CodeSynthesisInput) {
  return {
    type: "code",
    answer: {
      text: String(input?.winnerText ?? "").trim(),
      provider: String(input?.winnerProvider ?? "").trim(),
    },
    suggestedPatch: String(input?.patch ?? "").trim(),
    impactedFiles: list(input?.impactedFiles),
    verificationSteps: list(input?.verificationSteps),
    riskSummary: list(input?.riskSummary),
    rollbackNote: String(input?.rollbackNote ?? "").trim(),
  }
}
