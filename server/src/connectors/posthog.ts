/**
 * posthog.ts — PostHog Analytics 커넥터
 */

export async function callPostHog(query: string): Promise<string> {
  const apiKey = process.env.POSTHOG_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!apiKey || !projectId) return '[PostHog: API 키 없음 — 분석 데이터 건너뜀]';

  // PostHog HogQL 쿼리 실행
  try {
    const res = await fetch(`https://app.posthog.com/api/projects/${projectId}/query`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: { kind: 'HogQLQuery', query: `SELECT event, count() FROM events GROUP BY event ORDER BY count() DESC LIMIT 20` },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return `[PostHog 오류: HTTP ${res.status}]`;
    const data = await res.json();
    const rows = (data.results ?? []).slice(0, 10);
    return `**PostHog 이벤트 분석**\n${rows.map((r: any[]) => `- ${r[0]}: ${r[1]}건`).join('\n')}`;
  } catch (e) {
    return `[PostHog 오류: ${e instanceof Error ? e.message : '알 수 없음'}]`;
  }
}

