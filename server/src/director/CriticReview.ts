/**
 * CriticReview.ts — 상무(Critic) 취합 로직
 *
 * 2026-04-17 재작성: 3단계 판정
 *   1) 관련성 낮은 부서 → exclude
 *   2) 근거 부족/모호 → rework (보강 요청)
 *   3) 수치/견해 불일치 → conflicts 기록
 *
 * Primary: DeepSeek V3.2 (deepseek-chat), 30s
 * Fallback 1: Claude Haiku (claude-haiku-4-5-20251001), 30s
 * Fallback 2: Gemini 2.5 Flash, 25s
 */

import type { DeptReport } from "./ProjectSession.js";
import type { DeptId } from "./TaskDecomposer.js";
import { logger } from "../observability/logger.js";
import { callDeepSeek } from "../adapters/deepseek.js";

/** 부서별 1~10 점 품질 점수 (구체성3 + 실행가능성3 + 데이터근거2 + 명확성2) */
export interface DeptQualityScore {
  total: number;          // 1~10 합산
  specificity: number;    // 0~3
  actionability: number;  // 0~3
  evidence: number;       // 0~2
  clarity: number;        // 0~2
}

export interface CriticReviewResult {
  verdict: "pass" | "needs_rework";
  /** 최종 보고에 포함할 부서 */
  include: DeptId[];
  /** 관련성 낮아 제외할 부서 */
  exclude: DeptId[];
  /** 보강 요청 부서 (점수 < 6) */
  rework: DeptId[];
  /** 보강 이유 — deptId → reason (구체적 액션 가이드) */
  rework_reason: Partial<Record<DeptId, string>>;
  /** 부서간 상충 */
  conflicts: Array<{ depts: DeptId[]; issue: string }>;
  /** 핵심 3줄 요약 */
  summary: string;
  /** 부서별 1~10 점수 — 새 필드 (2026-04-18) */
  scores: Partial<Record<DeptId, DeptQualityScore>>;

  /* ── 하위 호환 필드 (기존 호출부/UI 용) ─────────────────── */
  keyIssues: string[];
  contradictions: string[];
  verificationNeeded: string[];
  confidence: number;
  /** UI 워크 애니메이션 타깃 — rework[0] 자동 산출 */
  targetDeptId?: DeptId;
}

/** 점수 6점 미만 → rework gate */
const REWORK_THRESHOLD = 6;

interface DeptReportEntry {
  deptId: DeptId;
  report: DeptReport;
}

const ALL_DEPT_IDS: DeptId[] = [
  'market', 'compete', 'legal', 'finance',
  'marketing', 'rnd', 'data', 'content', 'sns',
];

const PRIMARY_TIMEOUT_MS = 30000;
const FALLBACK_TIMEOUT_MS = 25000;
const PRIMARY_MAX_TOKENS = 1500;

const CRITIC_SYSTEM_PROMPT = `당신은 CORVUS X의 상무(Critic)입니다.
부서 보고를 1~10 점으로 채점하고 3단계 판정하세요.

【점수 항목 (총 10점)】
- specificity (0~3점): 수치/근거/구체적 사례 포함 정도
- actionability (0~3점): CEO가 즉시 의사결정/실행 가능한지
- evidence (0~2점): 외부 데이터·법령·통계 인용 여부
- clarity (0~2점): 구조와 표현의 명확성

【판정 기준】
- 점수 6점 미만 부서는 반드시 rework
- 지시와 관련성 낮은 부서는 exclude
- 부서간 중복 결론이면 더 강한 쪽만 include
- 수치/견해 불일치는 conflicts 에 기록

【rework_reason 작성 규칙】
"다시 작성하세요" 같은 모호한 지시는 금지.
어떤 항목이 부족한지 + 무엇을 추가해야 하는지 구체적으로 명시.
예시: "구체적 수치 데이터가 부족합니다. 시장 규모(원), 경쟁사 점유율(%), CAGR을 포함해 재작성하세요."

JSON만 반환 (다른 텍스트 금지):
{
  "scores": {
    "deptId": {"specificity": 0-3, "actionability": 0-3, "evidence": 0-2, "clarity": 0-2}
  },
  "include": ["deptId"],
  "exclude": ["deptId"],
  "rework": ["deptId"],
  "rework_reason": {"deptId": "구체적 보강 가이드"},
  "conflicts": [{"depts": ["a","b"], "issue": "상충 내용"}],
  "summary": "핵심 3줄 요약",
  "verdict": "pass" 또는 "needs_rework"
}`;

function compressSummary(report: DeptReport, limit = 200): string {
  const st = report.structured;
  let text = '';
  if (st?.summary) text = st.summary;
  else if (report.sections?.length) {
    const first = report.sections[0];
    text = `${first.heading}: ${(first.items || []).slice(0, 2).join(' | ')}`;
  } else {
    text = report.title || '(보고 내용 없음)';
  }
  return text.length > limit ? text.slice(0, limit) + '...' : text;
}

function buildUserPrompt(directive: string, reports: DeptReportEntry[]): string {
  const reportBlocks = reports
    .map((r) => `- ${r.deptId}: ${compressSummary(r.report, 200)}`)
    .join('\n');

  return [
    `지시: ${directive}`,
    '',
    '부서 보고:',
    reportBlocks,
    '',
    '위 기준으로 판정 JSON 을 반환하세요.',
  ].join('\n');
}

function tryParseJson(text: string): Record<string, unknown> | null {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = codeBlock?.[1] ?? text.match(/(\{[\s\S]*\})/)?.[1] ?? "";
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

function pickDeptIds(arr: unknown): DeptId[] {
  if (!Array.isArray(arr)) return [];
  const seen = new Set<DeptId>();
  for (const x of arr) {
    const id = String(x).trim().toLowerCase() as DeptId;
    if (ALL_DEPT_IDS.includes(id)) seen.add(id);
  }
  return [...seen];
}

function pickReworkReasons(obj: unknown): Partial<Record<DeptId, string>> {
  if (!obj || typeof obj !== 'object') return {};
  const out: Partial<Record<DeptId, string>> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const id = String(k).trim().toLowerCase() as DeptId;
    if (!ALL_DEPT_IDS.includes(id)) continue;
    const reason = String(v ?? '').trim();
    if (reason) out[id] = reason.slice(0, 400);
  }
  return out;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function pickScores(obj: unknown): Partial<Record<DeptId, DeptQualityScore>> {
  if (!obj || typeof obj !== 'object') return {};
  const out: Partial<Record<DeptId, DeptQualityScore>> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const id = String(k).trim().toLowerCase() as DeptId;
    if (!ALL_DEPT_IDS.includes(id)) continue;
    if (!v || typeof v !== 'object') continue;
    const score = v as Record<string, unknown>;
    const specificity = clampInt(score.specificity, 0, 3, 1);
    const actionability = clampInt(score.actionability, 0, 3, 1);
    const evidence = clampInt(score.evidence, 0, 2, 1);
    const clarity = clampInt(score.clarity, 0, 2, 1);
    const total = specificity + actionability + evidence + clarity;
    out[id] = { total, specificity, actionability, evidence, clarity };
  }
  return out;
}

function pickConflicts(arr: unknown): Array<{ depts: DeptId[]; issue: string }> {
  if (!Array.isArray(arr)) return [];
  const out: Array<{ depts: DeptId[]; issue: string }> = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const depts = pickDeptIds((item as any).depts);
    const issue = String((item as any).issue ?? '').trim();
    if (depts.length >= 1 && issue) {
      out.push({ depts, issue: issue.slice(0, 400) });
      if (out.length >= 5) break;
    }
  }
  return out;
}

// ─── Primary: DeepSeek V3.2 ──────────────────────────────────────────────────
async function callDeepSeekCritic(userPrompt: string): Promise<string | null> {
  return callDeepSeek(
    "deepseek-chat",
    [
      { role: "system", content: CRITIC_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    { timeoutMs: PRIMARY_TIMEOUT_MS, maxTokens: PRIMARY_MAX_TOKENS, temperature: 0.2 },
  );
}

// ─── Fallback 1: Claude Haiku 4.5 ────────────────────────────────────────────
async function callHaikuCritic(userPrompt: string): Promise<string | null> {
  const apiKey = String((globalThis as any)?.process?.env?.ANTHROPIC_API_KEY ?? '').trim();
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PRIMARY_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: PRIMARY_MAX_TOKENS,
        system: CRITIC_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, '[CriticReview] Haiku 응답 실패');
      return null;
    }
    const data: any = await res.json();
    return Array.isArray(data?.content)
      ? data.content.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('').trim()
      : '';
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[CriticReview] Haiku 호출 오류');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Fallback 2: Gemini 2.5 Flash ────────────────────────────────────────────
async function callGeminiFlashCritic(userPrompt: string): Promise<string | null> {
  const apiKey = String((globalThis as any)?.process?.env?.GEMINI_API_KEY ?? '').trim();
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FALLBACK_TIMEOUT_MS);
  try {
    const { GEMINI_FLASH_MODEL_ID, GEMINI_BASE } = await import('../config/defaults.js');
    const res = await fetch(
      `${GEMINI_BASE}/models/${GEMINI_FLASH_MODEL_ID}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: CRITIC_SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { maxOutputTokens: PRIMARY_MAX_TOKENS, temperature: 0.2 },
        }),
        signal: controller.signal,
      }
    );
    if (!res.ok) {
      logger.warn({ status: res.status }, '[CriticReview] Gemini Flash 응답 실패');
      return null;
    }
    const data: any = await res.json();
    const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
    let text = '';
    for (const c of candidates) {
      const parts = c?.content?.parts;
      if (Array.isArray(parts)) {
        for (const p of parts) if (typeof p?.text === 'string') text += p.text;
      }
    }
    return text.trim();
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[CriticReview] Gemini Flash 호출 오류');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function buildFallbackReview(reports: DeptReportEntry[]): CriticReviewResult {
  const allIds = reports.map((r) => r.deptId);
  const low = reports.filter((r) => (r.report.confidence ?? 0) < 0.6).map((r) => r.deptId);
  const include = allIds.filter((id) => !low.includes(id));
  const verdict: CriticReviewResult['verdict'] = low.length > 0 ? 'needs_rework' : 'pass';
  const rework_reason: Partial<Record<DeptId, string>> = {};
  for (const id of low) rework_reason[id] = '신뢰도 60% 미만 — 데이터 근거(외부 인용/수치) 보강 필요';

  // 휴리스틱 점수: confidence × 10 → 4.0~9.5 범위
  const scores: Partial<Record<DeptId, DeptQualityScore>> = {};
  for (const r of reports) {
    const t = Math.max(1, Math.min(10, Math.round((r.report.confidence ?? 0.5) * 10)));
    const evid = Math.min(2, Math.floor(t * 0.2));
    const spec = Math.min(3, Math.floor(t * 0.3));
    const act  = Math.min(3, Math.floor(t * 0.3));
    const cl   = Math.min(2, t - evid - spec - act);
    scores[r.deptId] = { total: spec + act + evid + Math.max(0, cl), specificity: spec, actionability: act, evidence: evid, clarity: Math.max(0, cl) };
  }

  return {
    verdict,
    include,
    exclude: [],
    rework: low,
    rework_reason,
    conflicts: [],
    summary: low.length > 0
      ? `${low.length}개 부서 보고의 신뢰도가 낮아 보강이 필요합니다.`
      : '모든 부서 보고가 최소 신뢰도를 충족합니다.',
    scores,
    keyIssues: low.map((id) => `${id} 부서 신뢰도 낮음`),
    contradictions: [],
    verificationNeeded: low.length > 0 ? ['핵심 수치의 외부 데이터 교차검증'] : [],
    confidence: low.length > 0 ? 0.6 : 0.78,
    targetDeptId: low[0],
  };
}

function parseCriticJson(text: string, reports: DeptReportEntry[]): CriticReviewResult | null {
  const parsed = tryParseJson(text);
  if (!parsed) return null;

  const allIds = reports.map((r) => r.deptId);
  const include = pickDeptIds(parsed.include);
  const exclude = pickDeptIds(parsed.exclude);
  const llmRework = pickDeptIds(parsed.rework);
  let rework_reason = pickReworkReasons(parsed.rework_reason);
  const conflicts = pickConflicts(parsed.conflicts);
  const summary = String(parsed.summary ?? '').trim() || 'Critic 검토 완료';
  const scores = pickScores(parsed.scores);

  // ─── 점수 < 6 부서를 강제 rework — LLM 의 rework 판정과 합집합 ────────────
  const lowScoreDepts: DeptId[] = [];
  for (const [id, s] of Object.entries(scores)) {
    if (s && s.total < REWORK_THRESHOLD) lowScoreDepts.push(id as DeptId);
  }
  // 합집합 (중복 제거)
  const reworkSet = new Set<DeptId>([...llmRework, ...lowScoreDepts]);
  const rework = [...reworkSet];

  // 점수 미달인데 LLM 이 rework_reason 안 줬으면 자동 생성
  for (const id of lowScoreDepts) {
    if (rework_reason[id]) continue;
    const s = scores[id];
    if (!s) continue;
    const gaps: string[] = [];
    if (s.specificity <= 1) gaps.push('수치/구체적 사례 부족');
    if (s.actionability <= 1) gaps.push('실행 가능한 액션 부재');
    if (s.evidence === 0) gaps.push('외부 데이터/근거 미인용');
    if (s.clarity === 0) gaps.push('구조/표현 불명확');
    rework_reason = { ...rework_reason, [id]: `점수 ${s.total}/10 (낮음). 보강 필요: ${gaps.join(', ')}.` };
  }

  // verdict — rework 가 있으면 needs_rework 강제
  const verdict: CriticReviewResult['verdict'] = rework.length > 0
    ? 'needs_rework'
    : (parsed.verdict === 'needs_rework' || parsed.verdict === 'needs_followup' ? 'needs_rework' : 'pass');

  // include 가 비어 있으면 exclude/rework 에 안 들어간 부서를 기본 include
  const exSet = new Set([...exclude, ...rework]);
  const effectiveInclude = include.length > 0
    ? include.filter((id) => !exSet.has(id))
    : allIds.filter((id) => !exSet.has(id));

  const keyIssues: string[] = [];
  for (const [id, reason] of Object.entries(rework_reason)) {
    if (reason) keyIssues.push(`${id}: ${reason}`);
  }
  const contradictions = conflicts.map((c) => `${c.depts.join(' vs ')}: ${c.issue}`);

  // confidence 평균 점수 기반 (10점=1.0, 0점=0.3)
  const totals = Object.values(scores).map((s) => s?.total ?? 0).filter((n) => n > 0);
  const avgScore = totals.length > 0 ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
  const confidence = totals.length > 0
    ? Math.max(0.3, Math.min(1, 0.3 + (avgScore / 10) * 0.7))
    : (verdict === 'pass' ? 0.8 : 0.62);

  return {
    verdict,
    include: effectiveInclude,
    exclude,
    rework,
    rework_reason,
    conflicts,
    summary,
    scores,
    keyIssues: keyIssues.slice(0, 8),
    contradictions: contradictions.slice(0, 5),
    verificationNeeded: conflicts.slice(0, 5).map((c) => `${c.depts.join(',')} 상충 해소: ${c.issue}`),
    confidence: Math.round(confidence * 100) / 100,
    targetDeptId: rework[0],
  };
}

export async function runCriticReview(
  directive: string,
  reports: DeptReportEntry[],
): Promise<CriticReviewResult> {
  if (reports.length === 0) {
    return {
      verdict: 'needs_rework',
      include: [],
      exclude: [],
      rework: [],
      rework_reason: {},
      conflicts: [],
      summary: '검토 가능한 부서 보고서가 없어 평가를 완료할 수 없습니다.',
      scores: {},
      keyIssues: ['부서 보고 없음'],
      contradictions: [],
      verificationNeeded: ['최소 1개 이상의 부서 결과 확보 후 재평가'],
      confidence: 0.3,
    };
  }

  const userPrompt = buildUserPrompt(directive, reports);

  // Primary: DeepSeek V3.2
  const deepseekText = await callDeepSeekCritic(userPrompt);
  if (deepseekText) {
    const parsed = parseCriticJson(deepseekText, reports);
    if (parsed) return parsed;
    logger.warn('[CriticReview] DeepSeek JSON 파싱 실패 → Haiku');
  } else {
    logger.warn('[CriticReview] DeepSeek 응답 없음 → Haiku');
  }

  // Fallback 1: Claude Haiku
  const haikuText = await callHaikuCritic(userPrompt);
  if (haikuText) {
    const parsed = parseCriticJson(haikuText, reports);
    if (parsed) return parsed;
    logger.warn('[CriticReview] Haiku JSON 파싱 실패 → Gemini Flash');
  } else {
    logger.warn('[CriticReview] Haiku 응답 없음 → Gemini Flash');
  }

  // Fallback 2: Gemini Flash
  const flashText = await callGeminiFlashCritic(userPrompt);
  if (flashText) {
    const parsed = parseCriticJson(flashText, reports);
    if (parsed) return parsed;
  }

  logger.warn('[CriticReview] 3단계 모두 실패 → fallback review');
  return buildFallbackReview(reports);
}
