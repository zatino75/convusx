/**
 * tavily.ts — Tavily Search + Deep Research 커넥터
 */

const TAVILY_BASE = 'https://api.tavily.com';

export async function callTavily(query: string, searchDepth: 'basic' | 'advanced' = 'advanced'): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return '[Tavily: API 키 없음 — 웹 검색 건너뜀]';

  try {
    const res = await fetch(`${TAVILY_BASE}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        query,
        search_depth: searchDepth,
        include_answer: true,
        include_raw_content: false,
        max_results: 8,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return `[Tavily 오류: HTTP ${res.status}]`;
    const data = await res.json();

    const answer = data.answer ? `**요약**: ${data.answer}\n\n` : '';
    const results = (data.results ?? []).slice(0, 5).map((r: any, i: number) =>
      `${i + 1}. **${r.title}** (${r.url})\n   ${r.content?.slice(0, 300) ?? ''}`
    ).join('\n');

    return answer + results;
  } catch (e) {
    return `[Tavily 오류: ${e instanceof Error ? e.message : '알 수 없음'}]`;
  }
}

