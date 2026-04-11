// scoreboard.ts — DEPRECATED stub (Phase 4)
export type ModelScoreNode = { wins: number; losses: number; score: number }
export type ModelTaskBoard = Record<string, ModelScoreNode>
export type ProviderTaskModelBoard = Record<string, ModelTaskBoard>
export type ModelScoreboard = { providers: ProviderTaskModelBoard; updated_at: number }
const EMPTY: ModelScoreboard = { providers: {}, updated_at: 0 }

export function saveModelScoreboard(..._: any[]): void {}
export function loadModelScoreboard(): Record<string, unknown> { return {} }
export function readScoreboard(): any[] { return [] }
export function resetScoreboard(): void {}
export function resetModelScoreboardAll(): void {}
export function updateScoreboardFromBenchmark(..._: any[]): void {}
export function recordProviderExecution(..._: any[]): void {}
export function recordProviderConflict(..._: any[]): void {}
export function getProviderRoutingScore(..._: any[]): number { return 0.5 }
export function decayRecentBanditSignals(): void {}
export function readRoutingScores(..._: any[]): Record<string, number> { return {} }
export function readTaskRoutingScores(): Record<string, Record<string, number>> { return {} }
export function recordJudgeOutcome(..._: any[]): void {}
export function readModelScoreboard(): ModelScoreboard { return EMPTY }
export function updateModelScoreboard(..._: any[]): ModelScoreboard { return EMPTY }
