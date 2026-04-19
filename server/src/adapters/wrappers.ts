/**
 * wrappers.ts
 * DepartmentAgent / EnsembleRunner 가 dynamic import 로 호출하는 단순 함수 래퍼.
 * ModelAdapter 인터페이스를 얇게 감싸서 "string 을 돌려주는 함수" 로 노출한다.
 *
 * 규약: ModelResponse 는 .answer (필수) 로 본문 텍스트를 담는다.
 * 이전 버전에서는 잘못 .text 를 읽어 항상 빈 문자열이 반환되던 버그가 있었으며,
 * 그로 인해 Director 3-AI 앙상블과 DepartmentAgent.callPerplexity 가 전원 실패
 * 하여 ensemble verdict 가 항상 "low_confidence" 로 떨어지고 있었다. (2026-04-16 수정)
 */

import { claudeAdapter }     from './claude.js';
import { openaiAdapter }     from './openai.js';
import { geminiAdapter, GEMINI_MODEL_ID } from './gemini.js';
import { perplexityAdapter } from './perplexity.js';
import type { ModelUsage } from './types.js';

export type DetailedCallResult = {
  text: string;
  usage: ModelUsage;
  model: string;
};

/** Claude Sonnet 4.6 호출 */
export async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 4096,
  thinkingBudget?: number
): Promise<string> {
  const req: any = {
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    max_tokens: maxTokens,
  };

  if (thinkingBudget && thinkingBudget > 0) {
    req.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
  }

  const resp = await claudeAdapter.generate(req);
  if (resp.error) throw new Error(resp.error.message);
  return resp.answer ?? '';
}

/** Claude Haiku 4.5 호출 — 경량 통합/요약 경로 (CeoBriefing primary 등) */
export async function callClaudeHaiku(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 3000,
): Promise<string> {
  const resp = await claudeAdapter.generate({
    provider: 'claude',
    model: 'claude-haiku-4-5-20251001',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    max_tokens: maxTokens,
  } as any);
  if (resp.error) throw new Error(resp.error.message);
  return resp.answer ?? '';
}

/** GPT-5.4-pro 호출 */
export async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 4096
): Promise<string> {
  const resp = await openaiAdapter.generate({
    provider: 'openai',
    model: 'gpt-5.4-pro',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    max_tokens: maxTokens,
  } as any);
  if (resp.error) throw new Error(resp.error.message);
  return resp.answer ?? '';
}

/** Gemini 호출 — 실제 API 모델 ID는 adapters/gemini.ts의 GEMINI_MODEL_ID (단일 출처) */
export async function callGemini(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 4096
): Promise<string> {
  const resp = await geminiAdapter.generate({
    provider: 'gemini',
    model: GEMINI_MODEL_ID,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    max_tokens: maxTokens,
  } as any);
  if (resp.error) throw new Error(resp.error.message);
  return resp.answer ?? '';
}

/** Perplexity sonar-pro 호출 */
export async function callPerplexity(
  query: string,
  maxTokens = 2000
): Promise<string> {
  const resp = await perplexityAdapter.generate({
    provider: 'perplexity',
    model: 'sonar-pro',
    messages: [
      { role: 'user', content: query },
    ],
    max_tokens: maxTokens,
  } as any);
  if (resp.error) throw new Error(resp.error.message);
  return resp.answer ?? '';
}

// ─── Detailed 변형 — 토큰 사용량·모델 ID 포함 반환 ────────────────────────────
// DepartmentAgent 가 호출당 비용을 계산하려면 usage 를 알아야 하므로, 기존 문자열
// 리턴 래퍼를 건드리지 않고 동일 호출을 세부 정보와 함께 돌려받는 variant 를 제공한다.

const CLAUDE_MODEL_ID = 'claude-sonnet-4-6';
const OPENAI_MODEL_ID = 'gpt-5.4-pro';
const PERPLEXITY_MODEL_ID = 'sonar-pro';

export async function callClaudeDetailed(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 4096,
  thinkingBudget?: number
): Promise<DetailedCallResult> {
  const req: any = {
    provider: 'claude',
    model: CLAUDE_MODEL_ID,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    max_tokens: maxTokens,
  };
  if (thinkingBudget && thinkingBudget > 0) {
    req.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
  }
  const resp = await claudeAdapter.generate(req);
  if (resp.error) throw new Error(resp.error.message);
  return { text: resp.answer ?? '', usage: resp.usage ?? {}, model: resp.model ?? CLAUDE_MODEL_ID };
}

export async function callOpenAIDetailed(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 4096
): Promise<DetailedCallResult> {
  const resp = await openaiAdapter.generate({
    provider: 'openai',
    model: OPENAI_MODEL_ID,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    max_tokens: maxTokens,
  } as any);
  if (resp.error) throw new Error(resp.error.message);
  return { text: resp.answer ?? '', usage: resp.usage ?? {}, model: resp.model ?? OPENAI_MODEL_ID };
}

export async function callGeminiDetailed(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 4096
): Promise<DetailedCallResult> {
  const resp = await geminiAdapter.generate({
    provider: 'gemini',
    model: GEMINI_MODEL_ID,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    max_tokens: maxTokens,
  } as any);
  if (resp.error) throw new Error(resp.error.message);
  return { text: resp.answer ?? '', usage: resp.usage ?? {}, model: resp.model ?? GEMINI_MODEL_ID };
}

export async function callPerplexityDetailed(
  query: string,
  maxTokens = 2000
): Promise<DetailedCallResult> {
  const resp = await perplexityAdapter.generate({
    provider: 'perplexity',
    model: PERPLEXITY_MODEL_ID,
    messages: [{ role: 'user', content: query }],
    max_tokens: maxTokens,
  } as any);
  if (resp.error) throw new Error(resp.error.message);
  return { text: resp.answer ?? '', usage: resp.usage ?? {}, model: resp.model ?? PERPLEXITY_MODEL_ID };
}
