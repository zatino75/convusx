export type BenchmarkTaskType = "dialogue" | "reasoning" | "research" | "code";

export type RubricBreakdown = {
  request_fulfillment: number;
  clarity: number;
  directness: number;
  usefulness: number;
};

export type PairwiseEvaluation = {
  winner: string;
  reason: string;
  winner_reason: string;
  loser_reason: string;
  rubric_breakdown: RubricBreakdown;
};

export function evaluatePairwise(left: string, right: string): PairwiseEvaluation {
  return {
    winner: "left",
    reason: "placeholder",
    winner_reason: "placeholder",
    loser_reason: "placeholder",
    rubric_breakdown: {
      request_fulfillment: 0,
      clarity: 0,
      directness: 0,
      usefulness: 0
    }
  };
}
