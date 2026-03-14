export type ScoreboardRow = {
  provider: string;
  score: number;
};

export function buildScoreboard(rows: ScoreboardRow[]): ScoreboardRow[] {
  return [...rows].sort((a, b) => b.score - a.score);
}
