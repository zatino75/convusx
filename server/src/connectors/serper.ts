/**
 * serper.ts — Serper (Google Search) 커넥터
 *
 * POST https://google.serper.dev/search
 * Header: X-API-KEY
 * Body: { q, num: 10, gl: "kr", hl: "ko" }
 * 결과 정규화: { title, link, snippet, source }
 */

const SERPER_ENDPOINT = 'https://google.serper.dev/search';

export interface SerperResult {
  title: string;
  link: string;
  snippet: string;
  source: string;
}

export async function callSerper(query: string, num = 10): Promise<string> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return '[Serper: SERPER_API_KEY 없음 — 검색 건너뜀]';

  try {
    const res = await fetch(SERPER_ENDPOINT, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num, gl: 'kr', hl: 'ko' }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return `[Serper 오류: HTTP ${res.status}]`;
    const data = await res.json();

    const organic = Array.isArray(data?.organic) ? data.organic : [];
    const results: SerperResult[] = organic.slice(0, num).map((r: any) => ({
      title: String(r?.title ?? '').trim(),
      link: String(r?.link ?? '').trim(),
      snippet: String(r?.snippet ?? '').trim(),
      source: String(r?.source ?? r?.displayLink ?? '').trim(),
    }));

    const answerBox = data?.answerBox;
    const answerText = answerBox?.answer || answerBox?.snippet || '';
    const header = answerText ? `**요약**: ${answerText}\n\n` : '';

    const lines = results
      .map((r, i) => `${i + 1}. **${r.title}** (${r.link})\n   ${r.snippet}`)
      .join('\n');

    return header + (lines || '(검색 결과 없음)');
  } catch (e) {
    return `[Serper 오류: ${e instanceof Error ? e.message : '알 수 없음'}]`;
  }
}
