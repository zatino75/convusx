/**
 * wrappers.ts
 * DepartmentAgent에서 dynamic import로 호출하는 단순 함수 래퍼
 * 기존 ModelAdapter 인터페이스를 직접 호출로 감쌈
 */

import { claudeAdapter }     from './claude.js';
import { openaiAdapter }     from './openai.js';
import { geminiAdapter, GEMINI_MODEL_ID } from './gemini.js';
import { perplexityAdapter } from './perplexity.js';

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
  return resp.text ?? '';
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
  return resp.text ?? '';
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
  return resp.text ?? '';
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
  return resp.text ?? '';
}
