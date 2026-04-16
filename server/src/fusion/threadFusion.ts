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
import { FUSION_TOTAL_CAP } from '../config/defaults.js';

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

// 엔터티 정밀 매칭 보너스. structured.entities 에 등록된 고유명사 phrase 가
// 쿼리 안에 통째로 나오면 강한 관련도를 부여한다.
function entityHitBonus(entities: string[] | undefined, queryLower: string): number {
  if (!entities || entities.length === 0) return 0;
  let bonus = 0;
  for (const raw of entities) {
    const e = String(raw ?? '').trim().toLowerCase();
    if (e.length < 2) continue;
    if (queryLower.includes(e)) bonus += 4; // ngramScore 스케일과 조화
  }
  return bonus;
}

// 스레드별 관련도 점수에 비례해 총 예산(FUSION_TOTAL_CAP) 을 분배한다.
// 높은 점수 item 은 더 긴 excerpt, 낮은 점수 item 은 짧은 excerpt.
// 단, 최소 120자는 보장해 맥락이 끊어지지 않도록 한다.
function allocateBudget(scores: number[], total: number, minPer = 120): number[] {
  const sum = scores.reduce((a, b) => a + Math.max(0, b), 0);
  if (sum <= 0 || scores.length === 0) return scores.map(() => minPer);
  const reserved = minPer * scores.length;
  const remaining = Math.max(0, total - reserved);
  return scores.map((s) => minPer + Math.floor((Math.max(0, s) / sum) * remaining));
}

function truncate(text: string, max: number): string {
  const t = text.replace(/\n+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(1, max - 1)) + '…';
}

// ─── 메인 융합 함수 ───────────────────────────────────────────────────────────
export function fuseThreadContext(opts: {
  project_id: string;
  query: string;
  max_threads?: number;
  max_reports?: number;
  /** @deprecated 개별 excerpt 최대값. 새 할당 로직이 FUSION_TOTAL_CAP 내에서 동적으로 결정. */
  max_excerpt_len?: number;
  /** 전체 fused_summary 글자 상한. 기본 FUSION_TOTAL_CAP (3000). */
  total_cap?: number;
}): FusedThreadContext {
  const { project_id, query } = opts;
  const maxThreads = Math.max(1, opts.max_threads ?? 5);
  const maxReports = Math.max(1, opts.max_reports ?? 3);
  const totalCap = Math.max(600, opts.total_cap ?? FUSION_TOTAL_CAP);
  const tokens = koreanNgram(query);
  const queryLower = query.toLowerCase();

  // ─ 1. 스레드 메모리 검색 ──────────────────────────────────────────────────
  const allThreads = getProjectThreadMemories(project_id);
  const scoredThreads: (MatchedThread & { _score: number })[] = [];

  for (const mem of allThreads) {
    let score = 0;
    let excerpt = '';
    let matchedOn: MatchedThread['matched_on'] = 'message';

    const st = (mem as any).structured;
    const entityBonus = entityHitBonus(st?.entities, queryLower);

    // 제목 검색 (가중치 x3) + entityBonus
    if (mem.title) {
      const ts = ngramScore(mem.title, tokens);
      if (ts > 0) {
        score = ts * 3 + entityBonus;
        matchedOn = 'title';
        excerpt = String(mem.title);
      }
    }

    // 구조화 메모리 검색 (가중치 x2) + entityBonus
    if (st) {
      const stText = [st.summary, ...(st.decisions ?? []), ...(st.facts ?? [])].filter(Boolean).join(' ');
      const ss = ngramScore(stText, tokens) * 2 + entityBonus;
      if (ss > score) {
        score = ss;
        matchedOn = 'structured';
        excerpt = stText;
      }
    }

    // 메시지 검색 (최근 40개)
    for (const msg of ((mem as any).messages ?? []).slice(-40)) {
      const content = typeof msg.content === 'string'
        ? msg.content
        : (Array.isArray(msg.content) ? msg.content.map((c: any) => c?.text ?? '').join(' ') : '');
      const ms = ngramScore(content, tokens) + entityBonus;
      if (ms > score) {
        score = ms;
        matchedOn = 'message';
        excerpt = content;
      }
    }

    if (score > 0) {
      scoredThreads.push({
        thread_id: mem.thread_id,
        title: (mem as any).title ?? null,
        relevance_score: score,
        excerpt, // truncation 은 렌더링 단계에서 예산 배분 후 실행
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
        .join(' ');
      return {
        deptId: r.deptId,
        directive: r.directive,
        excerpt, // truncation 은 렌더링에서
        confidence: r.confidence,
      };
    });
  } catch {
    // SQLite 없으면 스킵
  }

  // ─ 3. 융합 요약 생성 (FUSION_TOTAL_CAP 예산 내 점수비례 배분) ────────────
  // 헤더/라벨 오버헤드를 제외하고 excerpt 본문에 쓸 예산 계산
  const overhead = 200; // 스레드/보고서 헤더 + 블록 제목 여유
  const itemCount = topThreads.length + matchedReports.length;
  const bodyBudget = Math.max(300, totalCap - overhead);

  const threadScores = topThreads.map((t) => t.relevance_score);
  const reportScores = matchedReports.map((r) => r.confidence * 4); // confidence(0~1) → 스레드 score 스케일과 비슷하게
  const allScores = [...threadScores, ...reportScores];
  const budgets = itemCount > 0 ? allocateBudget(allScores, bodyBudget) : [];

  const parts: string[] = [];

  if (topThreads.length > 0) {
    const threadLines = topThreads.map((t, i) => {
      const titleStr = t.title ? `"${t.title}"` : `스레드:${t.thread_id.slice(0, 8)}`;
      const body = truncate(t.excerpt, budgets[i] ?? 160);
      return `[스레드${i + 1}] ${titleStr} (관련도:${t.relevance_score})\n  ${body}`;
    });
    parts.push(`관련 대화 스레드 ${topThreads.length}건:\n${threadLines.join('\n')}`);
  }

  if (matchedReports.length > 0) {
    const base = topThreads.length;
    const reportLines = matchedReports.map((r, i) => {
      const body = truncate(r.excerpt, budgets[base + i] ?? 160);
      return `[보고서${i + 1}] ${r.deptId.toUpperCase()}팀 — 지시: "${r.directive.slice(0, 60)}"\n  ${body}`;
    });
    parts.push(`관련 부서 보고서 ${matchedReports.length}건:\n${reportLines.join('\n')}`);
  }

  let fused_summary = parts.length > 0
    ? parts.join('\n\n')
    : `프로젝트 내 관련 컨텍스트가 발견되지 않았다. (query: "${query.slice(0, 80)}")`;

  // 안전장치: totalCap 초과 시 마지막에 한번 더 자른다.
  if (fused_summary.length > totalCap) {
    fused_summary = fused_summary.slice(0, totalCap - 1) + '…';
  }

  logger.debug('[threadFusion v3]', {
    project_id, query: query.slice(0, 60),
    threads: topThreads.length, reports: matchedReports.length,
    total: allThreads.length,
    fused_len: fused_summary.length,
    cap: totalCap,
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

