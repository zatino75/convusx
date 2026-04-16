/**
 * threadFusion.ts — CORVUS X Thread Fusion Engine (v2 — 한국어 N-gram 강화)
 *
 * 프로젝트 내 모든 스레드의 대화/결과물/결론/표/코드/리서치를 자동 상호 교환·융합.
 * - 한국어 N-gram(bi-gram + tri-gram) 토크나이저 적용 → 공백 분리 실패 문제 해결
 * - SQLite FTS5 보고서 + JSON 스레드 메모리 통합 검색
 * - 수동 참조 UI 전면 삭제 — 에이전트가 스스로 컨텍스트 주입
 */

import { getProjectThreadMemories } from '../memory/threadMemory.js';
import { searchReports } from '../memory/sqliteMemory.js';
import { logger } from '../observability/logger.js';

export type FusedThreadContext = {
  project_id: string;
  query: string;
  matched_threads: MatchedThread[];
  matched_reports: MatchedReport[];
  fused_summary: string;
  total_threads_scanned: number;
};

type MatchedThread = {
  thread_id: string;
  title: string | null;
  relevance_score: number;
  excerpt: string;
  matched_on: 'message' | 'structured' | 'title';
};

type MatchedReport = {
  deptId: string;
  directive: string;
  excerpt: string;
  confidence: number;
};

// ─── 한국어 N-gram 토크나이저 ─────────────────────────────────────────────────
function koreanNgram(text: string, n = 2): string[] {
  if (!text) return [];
  const normalized = text
    .toLowerCase()
    .replace(/[^\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318Fa-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = new Set<string>();

  // 공백 분리 단어
  for (const word of normalized.split(' ')) {
    if (word.length >= 2) tokens.add(word);
  }

  // N-gram (bi + tri)
  const chars = [...normalized.replace(/\s/g, '')];
  for (let i = 0; i < chars.length - 1; i++) {
    const bi = chars[i] + chars[i + 1];
    if (bi.trim().length >= 2) tokens.add(bi);
    if (i + 2 < chars.length) {
      const tri = chars[i] + chars[i + 1] + chars[i + 2];
      if (tri.trim().length >= 2) tokens.add(tri);
    }
  }

  return [...tokens];
}

function ngramScore(haystack: string, tokens: string[]): number {
  const h = haystack.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (t.length >= 2 && h.includes(t)) score += t.length > 2 ? 2 : 1;
  }
  return score;
}

// ─── 메인 융합 함수 ───────────────────────────────────────────────────────────
export function fuseThreadContext(opts: {
  project_id: string;
  query: string;
  max_threads?: number;
  max_reports?: number;
  max_excerpt_len?: number;
}): FusedThreadContext {
  const { project_id, query } = opts;
  const maxThreads = Math.max(1, opts.max_threads ?? 5);
  const maxReports = Math.max(1, opts.max_reports ?? 3);
  const maxExcerpt = Math.max(100, opts.max_excerpt_len ?? 500);
  const tokens = koreanNgram(query);

  // ─ 1. 스레드 메모리 검색 ──────────────────────────────────────────────────
  const allThreads = getProjectThreadMemories(project_id);
  const scoredThreads: (MatchedThread & { _score: number })[] = [];

  for (const mem of allThreads) {
    let score = 0;
    let excerpt = '';
    let matchedOn: MatchedThread['matched_on'] = 'message';

    // 제목 검색 (가중치 x3)
    if (mem.title) {
      const ts = ngramScore(mem.title, tokens);
      if (ts > 0) {
        score = ts * 3;
        matchedOn = 'title';
        excerpt = String(mem.title).slice(0, maxExcerpt);
      }
    }

    // 구조화 메모리 검색 (가중치 x2)
    const st = (mem as any).structured;
    if (st) {
      const stText = [st.summary, ...(st.decisions ?? []), ...(st.facts ?? [])].filter(Boolean).join(' ');
      const ss = ngramScore(stText, tokens) * 2;
      if (ss > score) {
        score = ss;
        matchedOn = 'structured';
        excerpt = stText.slice(0, maxExcerpt);
      }
    }

    // 메시지 검색 (최근 40개)
    for (const msg of ((mem as any).messages ?? []).slice(-40)) {
      const content = typeof msg.content === 'string'
        ? msg.content
        : (Array.isArray(msg.content) ? msg.content.map((c: any) => c?.text ?? '').join(' ') : '');
      const ms = ngramScore(content, tokens);
      if (ms > score) {
        score = ms;
        matchedOn = 'message';
        excerpt = content.slice(0, maxExcerpt);
      }
    }

    if (score > 0) {
      scoredThreads.push({
        thread_id: mem.thread_id,
        title: (mem as any).title ?? null,
        relevance_score: score,
        excerpt,
        matched_on: matchedOn,
        _score: score,
      });
    }
  }

  scoredThreads.sort((a, b) => b._score - a._score);
  const topThreads = scoredThreads.slice(0, maxThreads).map(({ _score, ...rest }) => rest);

  // ─ 2. SQLite FTS5 보고서 검색 ──────────────────────────────────────────────
  let matchedReports: MatchedReport[] = [];
  try {
    const reportResults = searchReports(query, maxReports);
    matchedReports = reportResults.map(r => {
      const sections = (r.report as any).sections ?? [];
      const excerpt = sections
        .flatMap((s: any) => [s.heading, ...(s.items ?? [])].slice(0, 3))
        .join(' ')
        .slice(0, maxExcerpt);
      return {
        deptId: r.deptId,
        directive: r.directive,
        excerpt,
        confidence: r.confidence,
      };
    });
  } catch {
    // SQLite 없으면 스킵
  }

  // ─ 3. 융합 요약 생성 ──────────────────────────────────────────────────────
  const parts: string[] = [];

  if (topThreads.length > 0) {
    const threadLines = topThreads.map((t, i) => {
      const titleStr = t.title ? `"${t.title}"` : `스레드:${t.thread_id.slice(0, 8)}`;
      return `[스레드${i + 1}] ${titleStr} (관련도:${t.relevance_score})\n  ${t.excerpt.replace(/\n/g, ' ').slice(0, 300)}`;
    });
    parts.push(`관련 대화 스레드 ${topThreads.length}건:\n${threadLines.join('\n')}`);
  }

  if (matchedReports.length > 0) {
    const reportLines = matchedReports.map((r, i) =>
      `[보고서${i + 1}] ${r.deptId.toUpperCase()}팀 — 지시: "${r.directive.slice(0, 40)}"\n  ${r.excerpt.replace(/\n/g, ' ').slice(0, 300)}`
    );
    parts.push(`관련 부서 보고서 ${matchedReports.length}건:\n${reportLines.join('\n')}`);
  }

  const fused_summary = parts.length > 0
    ? parts.join('\n\n')
    : `프로젝트 내 관련 컨텍스트가 발견되지 않았다. (query: "${query.slice(0, 80)}")`;

  logger.debug('[threadFusion v2]', {
    project_id, query: query.slice(0, 60),
    threads: topThreads.length, reports: matchedReports.length,
    total: allThreads.length,
  });

  return {
    project_id,
    query,
    matched_threads: topThreads,
    matched_reports: matchedReports,
    fused_summary,
    total_threads_scanned: allThreads.length,
  };
}

// ─── system 블록 빌더 (에이전트 프롬프트 주입용) ──────────────────────────────
export function buildFusionSystemBlock(opts: {
  project_id: string;
  query: string;
  max_threads?: number;
}): string {
  const result = fuseThreadContext(opts);
  if (result.matched_threads.length === 0 && result.matched_reports.length === 0) return '';
  return [
    `[프로젝트 지식 자동 융합 컨텍스트]`,
    `현재 프로젝트의 과거 스레드와 부서 보고서에서 자동 추출한 내용이다. 현재 질문에 직접 관련된 내용만 선별해 답변에 활용하라.`,
    result.fused_summary,
  ].join('\n');
}

