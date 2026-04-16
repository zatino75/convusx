/**
 * pubmed.ts — PubMed 논문 검색 커넥터
 */

const PUBMED_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

export async function callPubMed(query: string, maxResults = 5): Promise<string> {
  try {
    // 검색 ID 수집
    const searchRes = await fetch(
      `${PUBMED_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&retmode=json`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (!searchRes.ok) return `[PubMed 오류: HTTP ${searchRes.status}]`;
    const searchData = await searchRes.json();
    const ids: string[] = searchData.esearchresult?.idlist ?? [];
    if (ids.length === 0) return '[PubMed: 검색 결과 없음]';

    // 초록 수집
    const summaryRes = await fetch(
      `${PUBMED_BASE}/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (!summaryRes.ok) return `[PubMed 요약 오류: HTTP ${summaryRes.status}]`;
    const summaryData = await summaryRes.json();
    const docs = summaryData.result ?? {};

    const lines = ids.map((id, i) => {
      const doc = docs[id] ?? {};
      return `${i + 1}. **${doc.title ?? '제목 없음'}** (${doc.pubdate ?? '날짜 불명'})\n   저자: ${(doc.authors ?? []).slice(0, 3).map((a: any) => a.name).join(', ')}`;
    });

    return `**PubMed 논문 검색 결과** (검색어: ${query})\n${lines.join('\n')}`;
  } catch (e) {
    return `[PubMed 오류: ${e instanceof Error ? e.message : '알 수 없음'}]`;
  }
}

