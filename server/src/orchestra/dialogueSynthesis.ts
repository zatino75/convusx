export type DialogueSynthesisInput = {
  winnerText: string
  runnerUpText?: string
  winnerProvider?: string
  runnerUpProvider?: string
  mode?: string
}

function clean(input: any) {
  return String(input ?? "").trim()
}

export function runDialogueSynthesis(input: DialogueSynthesisInput) {
  const winnerText = clean(input?.winnerText)
  const runnerUpText = clean(input?.runnerUpText)
  const useBlend = input?.mode === "blend" && runnerUpText

  const answerText = useBlend
    ? [winnerText, "", "보강 관점:", runnerUpText].join("\n").trim()
    : winnerText

  return {
    type: "dialogue",
    answer: {
      text: answerText,
      provider: clean(input?.winnerProvider),
      blended_with: useBlend ? clean(input?.runnerUpProvider) : "",
    },
  }
}
