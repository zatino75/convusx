/**
 * perplexity.ts — Perplexity sonar-pro 커넥터 (DepartmentAgent runPreResearch 용)
 *
 * adapters/perplexity.ts 와 달리 15s 하드 타임아웃을 강제한다.
 * 사전 조사는 빨라야 의미가 있음.
 */

import { PERPLEXITY_BASE } from '../config/defaults.js';

export async function callPerplexityConnector(query: string, maxTokens = 1500): Promise<string> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return '[Perplexity: API 키 없음]';

  try {
    const res = await fetch(`${PERPLEXITY_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages: [{ role: 'user', content: query }],
        max_tokens: maxTokens,
        temperature: 0.2,
        return_citations: true,
        search_recency_filter: 'month',
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return `[Perplexity 오류: HTTP ${res.status}]`;
    const data = await res.json();
    const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
    const msg = choice?.message;
    let text = '';
    if (typeof msg?.content === 'string') text = msg.content.trim();
    else if (Array.isArray(msg?.content)) {
      text = msg.content
        .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim();
    }
    return text || '[Perplexity: 빈 응답]';
  } catch (e) {
    const msg = e instanceof Error ? e.message : '알 수 없음';
    return `[Perplexity 오류: ${msg}]`;
  }
}
