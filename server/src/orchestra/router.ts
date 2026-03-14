export type RoutedProvider = "openai" | "claude" | "gemini" | "perplexity";

export function selectProvider(taskType: string): RoutedProvider {
  switch (taskType) {
    case "research":
      return "perplexity";
    case "reasoning":
      return "claude";
    case "code":
      return "openai";
    default:
      return "openai";
  }
}
