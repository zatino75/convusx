/**
 * costCalc.ts — per-call USD cost estimator
 *
 * Adapter usage (input/output tokens) + pricing table (config/defaults.ts) →
 * USD cost. DepartmentAgent / Ensemble 등에서 호출당 비용을 계산해
 * dept_xp.total_cost_usd 누적에 사용한다.
 */
import type { ModelUsage } from '../adapters/types.js';
import { MODEL_PRICING_USD_PER_1K_TOKENS } from '../config/defaults.js';

/**
 * 모델명과 토큰 사용량으로 USD 비용을 계산한다.
 * - 모델이 pricing 테이블에 없으면 0 반환 (silent)
 * - usage 가 없거나 토큰 수가 NaN 이면 0 반환
 */
export function estimateCostUsd(modelName: string | null | undefined, usage: ModelUsage | null | undefined): number {
  if (!modelName || !usage) return 0;
  const pricing = MODEL_PRICING_USD_PER_1K_TOKENS[modelName];
  if (!pricing) return 0;

  // 2026-04-25 Phase 2 결함 수정: Gemini usageMetadata 키 추가.
  //   Anthropic: input_tokens / output_tokens
  //   OpenAI:    prompt_tokens / completion_tokens
  //   Gemini:    promptTokenCount / candidatesTokenCount
  // 이전에는 Gemini 키 누락 → 토큰 0 → cost_usd 0 으로 로그됨.
  const u = usage as any;
  const inputTokens = numberOrZero(u.input_tokens ?? u.prompt_tokens ?? u.promptTokenCount);
  const outputTokens = numberOrZero(u.output_tokens ?? u.completion_tokens ?? u.candidatesTokenCount);
  if (inputTokens === 0 && outputTokens === 0) return 0;

  const cost = (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
  return Number.isFinite(cost) && cost > 0 ? cost : 0;
}

function numberOrZero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
