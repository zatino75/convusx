export type ResearchSynthesisInput = {
  winnerText: string
  winnerProvider?: string
  citations?: string[]
  sourceNotes?: string[]
}

function arr(value: any): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : []
}

export function runResearchSynthesis(input: ResearchSynthesisInput) {
  return {
    type: "research",
    answer: {
      text: String(input?.winnerText ?? "").trim(),
      provider: String(input?.winnerProvider ?? "").trim(),
    },
    citations: arr(input?.citations),
    sourceNotes: arr(input?.sourceNotes),
  }
}
