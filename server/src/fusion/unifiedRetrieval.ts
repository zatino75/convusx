/**
 * unifiedRetrieval.ts — Phase 7 통합 retrieval
 *
 * 목표: 스레드 메모리 + 프로젝트 구조화 메모리 + 소스 자산(업로드 파일/노트/링크) 를
 * 한 번의 호출로 조회하고, 상호 중복 제거 + 단일 점수로 재순위 + FUSION_TOTAL_CAP
 * 안에서 공평하게 본문 길이를 배분해 하나의 system 블록으로 돌려준다.
 *
 * 기존 buildFusionSystemBlock / buildProjectFusionBlock 은 각각 독립적으로
 * 예산을 소모했기 때문에 세 가지 소스가 경쟁 없이 fragment 단위로 주입되어
 * 단일 쿼리 당 컨텍스트 품질이 일정하지 않았다. 통합 버전은 점수 기반으로
 * 가장 관련성 높은 항목 N개를 종류 불문하고 선택한다.
 */

import { getProjectThreadMemories } from '../memory/threadMemory.js';
import {
  getLatestProjectContext,
  findRelevantSourceAssets,
} from '../memory/projectMemory.js';
import { searchReports } from '../memory/sqliteMemory.js';
import { logger } from '../observability/logger.js';
import { FUSION_TOTAL_CAP } from '../config/defaults.js';

export type UnifiedItemKind = 'thread' | 'project_entry' | 'source' | 'report';

export type UnifiedItem = {
  kind: UnifiedItemKind;
  id: string;
  title: string;
  body: string;
  score: number;
  meta?: Record<string, any>;
};

export type UnifiedRetrievalResult = {
  project_id: string;
  query: string;
  items: UnifiedItem[];
  block: string;
  stats: {
    threads_scanned: number;
    sources_scanned: number;
    entries_scanned: number;
    reports_scanned: number;
  };
};

// ─── 토크나이저 / 스코어러 (threadFusion 과 동일 정책) ────────────────────────
function koreanNgram(text: string, n = 2): string[] {
  if (!text) return [];
  const normalized = text
    .toLowerCase()
    .replace(/[^\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318Fa-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = new Set<string>();
  for (const word of normalized.split(' ')) {
    if (word.length >= 2) tokens.add(word);
  }
  const chars = [...normalized.replace(/\s/g, '')];
  for (let i = 0; i < chars.length - 1; i++) {
    tokens.add(chars[i] + chars[i + 1]);
    if (i + 2 < chars.length) tokens.add(chars[i] + chars[i + 1] + chars[i + 2]);
  }
  return [...tokens];
}

function ngramScore(haystack: string, tokens: string[]): number {
  const h = (haystack ?? '').toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (t.length >= 2 && h.includes(t)) score += t.length > 2 ? 2 : 1;
  }
  return score;
}

function entityHitBonus(entities: string[] | undefined, queryLower: string): number {
  if (!entities || entities.length === 0) return 0;
  let bonus = 0;
  for (const raw of entities) {
    const e = String(raw ?? '').trim().toLowerCase();
    if (e.length < 2) continue;
    if (queryLower.includes(e)) bonus += 4;
  }
  return bonus;
}

// 내용 fingerprint — 동일 텍스트가 thread/summary/source 에 중복 나오는 걸 제거
function fingerprint(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function allocateBudget(scores: number[], total: number, minPer = 140): number[] {
  if (scores.length === 0) return [];
  const sum = scores.reduce((a, b) => a + Math.max(0, b), 0);
  const reserved = minPer * scores.length;
  const remaining = Math.max(0, total - reserved);
  if (sum <= 0) return scores.map(() => minPer);
  return scores.map((s) => minPer + Math.floor((Math.max(0, s) / sum) * remaining));
}

function truncate(text: string, max: number): string {
  const t = (text ?? '').replace(/\n+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(1, max - 1)) + '…';
}

// ─── 메인 통합 retrieval ──────────────────────────────────────────────────────
export function retrieveUnifiedContext(opts: {
  project_id: string;
  query: string;
  max_items?: number;
  total_cap?: number;
}): UnifiedRetrievalResult {
  const project_id = String(opts.project_id ?? '').trim();
  const query = String(opts.query ?? '').trim();
  const maxItems = Math.max(1, opts.max_items ?? 8);
  const totalCap = Math.max(800, opts.total_cap ?? FUSION_TOTAL_CAP);

  const tokens = koreanNgram(query);
  const queryLower = query.toLowerCase();
  const seenFingerprints = new Set<string>();
  const candidates: UnifiedItem[] = [];

  // ─ 1. 스레드 메모리 ──────────────────────────────────────────────────────
  const allThreads = getProjectThreadMemories(project_id);
  for (const mem of allThreads) {
    const st = (mem as any).structured;
    const entityBonus = entityHitBonus(st?.entities, queryLower);

    // 제목 / 구조화 / 메시지 중 최고 점수
    let bestScore = 0;
    let bestBody = '';

    if (mem.title) {
      const ts = ngramScore(mem.title, tokens);
      if (ts > 0) {
        bestScore = ts * 3 + entityBonus;
        bestBody = String(mem.title);
      }
    }

    if (st) {
      const stText = [st.summary, ...(st.decisions ?? []), ...(st.facts ?? [])]
        .filter(Boolean)
        .join(' ');
      const ss = ngramScore(stText, tokens) * 2 + entityBonus;
      if (ss > bestScore) {
        bestScore = ss;
        bestBody = stText;
      }
    }

    const messages = Array.isArray((mem as any).messages) ? (mem as any).messages : [];
    for (const msg of messages.slice(-40)) {
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.map((c: any) => c?.text ?? '').join(' ')
            : '';
      const ms = ngramScore(content, tokens) + entityBonus;
      if (ms > bestScore) {
        bestScore = ms;
        bestBody = content;
      }
    }

    if (bestScore <= 0) continue;
    const fp = fingerprint(bestBody);
    if (fp && seenFingerprints.has(fp)) continue;
    if (fp) seenFingerprints.add(fp);

    candidates.push({
      kind: 'thread',
      id: mem.thread_id,
      title: mem.title ? `"${mem.title}"` : `스레드:${mem.thread_id.slice(0, 8)}`,
      body: bestBody,
      score: bestScore,
      meta: { matched_on: 'thread' },
    });
  }

  // ─ 2. 프로젝트 구조화 메모리 엔트리 ───────────────────────────────────────
  // getLatestProjectContext 가 query-aware 로 이미 관련 entry summary/facts 를 뽑아준다.
  const projectCtx = getLatestProjectContext(project_id, query.length >= 10 ? query : undefined);
  const rc = (projectCtx as any).retrieval_context ?? {};
  const summaries: string[] = Array.isArray(rc.summary) ? rc.summary : [];
  const decisions: string[] = Array.isArray(rc.decisions) ? rc.decisions : [];
  const facts: string[] = Array.isArray(rc.facts) ? rc.facts : [];

  const projectBlob = [...summaries, ...decisions, ...facts].filter(Boolean);
  for (const text of projectBlob) {
    const s = ngramScore(text, tokens);
    if (s <= 0) continue;
    const fp = fingerprint(text);
    if (fp && seenFingerprints.has(fp)) continue;
    if (fp) seenFingerprints.add(fp);

    candidates.push({
      kind: 'project_entry',
      id: fp.slice(0, 32) || `pe_${candidates.length}`,
      title: '프로젝트 메모리',
      body: text,
      score: s * 1.2, // 구조화 지식은 가독성이 좋아 같은 점수여도 우선
    });
  }

  // ─ 3. 소스 자산 ──────────────────────────────────────────────────────────
  const sources = findRelevantSourceAssets(project_id, query);
  for (const asset of sources) {
    const content = String(asset?.content ?? '').trim();
    if (!content) continue;

    const titleScore = ngramScore(String(asset.title ?? ''), tokens) * 2;
    const contentScore = ngramScore(content.slice(0, 1500), tokens);
    const score = Math.max(titleScore, contentScore);
    if (score <= 0) continue;

    const fp = fingerprint(content);
    if (fp && seenFingerprints.has(fp)) continue;
    if (fp) seenFingerprints.add(fp);

    candidates.push({
      kind: 'source',
      id: String(asset.id),
      title: asset.title ? `"${asset.title}" (소스)` : `소스:${String(asset.id).slice(0, 8)}`,
      body: content,
      score,
      meta: { type: asset.type, status: asset.status },
    });
  }

  // ─ 4. 부서 보고서 (FTS5) ─────────────────────────────────────────────────
  let reportsScanned = 0;
  try {
    const reports = searchReports(query, 3);
    reportsScanned = reports.length;
    for (const r of reports) {
      const sections = (r.report as any).sections ?? [];
      const body = sections
        .flatMap((sec: any) => [sec.heading, ...(sec.items ?? [])])
        .filter(Boolean)
        .join(' ');
      if (!body) continue;
      const fp = fingerprint(body);
      if (fp && seenFingerprints.has(fp)) continue;
      if (fp) seenFingerprints.add(fp);

      candidates.push({
        kind: 'report',
        id: `${r.deptId}_${fp.slice(0, 16)}`,
        title: `${r.deptId.toUpperCase()}팀 보고서 — "${(r.directive ?? '').slice(0, 40)}"`,
        body,
        score: r.confidence * 12, // confidence(0~1) → ngramScore 스케일
      });
    }
  } catch {
    // SQLite 미초기화 시 무시
  }

  // ─ 5. 점수 기준 재순위 + 예산 배분 ────────────────────────────────────────
  candidates.sort((a, b) => b.score - a.score);
  const items = candidates.slice(0, maxItems);

  const scores = items.map((c) => c.score);
  const overhead = 240 + items.length * 40; // 헤더/라벨 여유
  const bodyBudget = Math.max(400, totalCap - overhead);
  const budgets = allocateBudget(scores, bodyBudget);

  // ─ 6. 블록 렌더 ──────────────────────────────────────────────────────────
  let block = '';
  if (items.length > 0) {
    const lines = items.map((item, i) => {
      const body = truncate(item.body, budgets[i] ?? 160);
      const kindLabel =
        item.kind === 'thread' ? '스레드'
        : item.kind === 'source' ? '소스'
        : item.kind === 'report' ? '보고서'
        : '프로젝트메모리';
      return `[${kindLabel}${i + 1}] ${item.title} (관련도:${item.score.toFixed(1)})\n  ${body}`;
    });

    block = [
      '[프로젝트 통합 지식 컨텍스트]',
      '현재 프로젝트의 스레드·구조화 메모리·소스 자산·부서 보고서에서 자동 추출한 내용이다. 현재 질문에 직접 관련된 내용만 선별해 답변에 활용하라.',
      lines.join('\n'),
    ].join('\n');

    if (block.length > totalCap) block = block.slice(0, totalCap - 1) + '…';
  }

  logger.debug('[unifiedRetrieval]', {
    project_id,
    query: query.slice(0, 60),
    items: items.length,
    threads: allThreads.length,
    sources: sources.length,
    project_entries: projectBlob.length,
    reports: reportsScanned,
    block_len: block.length,
  });

  return {
    project_id,
    query,
    items,
    block,
    stats: {
      threads_scanned: allThreads.length,
      sources_scanned: sources.length,
      entries_scanned: projectBlob.length,
      reports_scanned: reportsScanned,
    },
  };
}

export function buildUnifiedContextBlock(opts: {
  project_id: string;
  query: string;
  max_items?: number;
}): string {
  return retrieveUnifiedContext(opts).block;
}
