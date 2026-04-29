/**
 * costCalc.ts — per-call USD cost estimator
 *
 * Adapter usage (input/output tokens) + pricing table (config/defaults.ts) →
 * USD cost. DepartmentAgent / Ensemble 등에서 호출당 비용을 계산해
 * dept_xp.total_cost_usd 누적에 사용한다.
 */
import type { ModelUsage } from '../adapters/types.js';
import { MODEL_PRICING_USD_PER_1K_TOKENS } from '../config/defaults.js';

// 2026-04-29: 미등록 모델 경고를 첫 1회만 발화 (로그 폭증 방지).
//   동일 모델이 분당 수십 회 호출돼도 경고는 1회 → 운영자가 dashboard 에서 즉시 인지.
const _warnedMissingModels = new Set<string>();

/**
 * 모델명과 토큰 사용량으로 USD 비용을 계산한다.
 * - 모델이 pricing 테이블에 없으면 0 반환 + console.warn (모델당 1회) → cost_usd=0 누락 감지
 * - usage 가 없거나 토큰 수가 NaN 이면 0 반환 (silent)
 *
 * CLAUDE.md 규칙 #24 — pricing 미등록 모델 호출 시 비용 추적 누락. 신모델은 반드시
 * config/defaults.ts MODEL_PRICING_USD_PER_1K_TOKENS 에 entry 를 먼저 추가해야 한다.
 */
export function estimateCostUsd(modelName: string | null | undefined, usage: ModelUsage | null | undefined): number {
  if (!modelName || !usage) return 0;
  const pricing = MODEL_PRICING_USD_PER_1K_TOKENS[modelName];
  if (!pricing) {
    if (!_warnedMissingModels.has(modelName)) {
      _warnedMissingModels.add(modelName);
      // logger 를 import 하면 순환 위험이 있어 console.warn 사용. journalctl 에서 동일하게 캡처됨.
      console.warn(`[costCalc] 가격표 미등록 모델: ${modelName} — cost_usd=0 기록됨. config/defaults.ts MODEL_PRICING_USD_PER_1K_TOKENS 에 entry 추가 필요 (CLAUDE.md #24).`);
    }
    return 0;
  }

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
