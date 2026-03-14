export type JudgeDecision = {
  winner: string;
  rationale: string;
};

export function judgeCandidates(candidates: string[]): JudgeDecision {
  return {
    winner: candidates[0] ?? "none",
    rationale: "judge placeholder"
  };
}
