/**
 * CeoBriefing.ts — CORVUS X CEO 브리핑 생성기
 *
 * 10개 부서 보고서 완료 후 Anthropic Claude (Haiku primary, Sonnet/Gemini fallback) 으로
 * 통합 경영 브리핑 생성. 모델 ID 는 런타임 조회 (CLAUDE.md #25).
 * 출력: 핵심 기회 3개 / 핵심 리스크 3개 / 즉시 실행 권고 / 통합 신뢰도 점수
 * SQLite ceo_briefings 테이블에 자동 저장
 */

import type { DeptReport } from './ProjectSession.js';
import type { DeptId } from './TaskDecomposer.js';
import type { CriticReviewResult } from './CriticReview.js';
import { logger } from '../observability/logger.js';

/** 부서별 핵심 발견 — 신호등(red/yellow/green) 으로 위험도 표현 */
export interface DeptFinding {
  dept: DeptId;
  finding: string;          // 한 줄 핵심 발견
  signal: "red" | "yellow" | "green";
}

/** 즉시 실행 권고 — 담당 부서 명시 필수 */
export interface PriorityAction {
  rank: number;             // 1~3
  action: string;           // 구체적 액션
  owner: DeptId | "ceo";    // 담당 부서
  deadline?: string;        // 권장 시한 (예: "이번주", "30일내")
}

export interface CeoBriefingResult {
  sessionId: string;
  roundNumber: number;
  directive: string;

  // ── 새 필드 (2026-04-18) ─────────────────────────────────────────────
  executiveSummary: string;        // 3줄 이내 — 가장 먼저 노출
  deptFindings: DeptFinding[];     // 부서별 핵심 발견 + 신호등
  priorityActions: PriorityAction[]; // Top-3 즉시 실행 권고 (담당 부서 명시)
  followUpItems: string[];         // 후속 모니터링 항목 (최대 5개)

  // ── 기존 필드 유지 (UI 하위호환) ──────────────────────────────────────
  opportunities: string[];        // 핵심 기회 (최대 5개)
  risks: string[];                // 핵심 리스크 (최대 5개)
  recommendations: string[];      // 즉시 실행 권고 (최대 5개) — priorityActions 의 action 추출
  conflictingSignals: string[];   // 부서간 상충 신호 (최대 3개)
  overallConfidence: number;      // 0~1 통합 신뢰도
  summary: string;                // 2~3문장 핵심 요약 — executiveSummary 와 동일
  deptScores: Partial<Record<DeptId, number>>;  // 부서별 confidence
  critic?: {
    verdict: CriticReviewResult["verdict"];
    keyIssues: string[];
    confidence: number;
  };
  generatedAt: string;
}

interface DeptReportEntry {
  deptId: DeptId;
  report: DeptReport;
}

// ─── 타임아웃 ────────────────────────────────────────────────────────────────
const PRIMARY_TIMEOUT_MS = 30000;   // Claude Haiku primary
const SONNET_TIMEOUT_MS = 40000;    // Claude Sonnet 1차 폴백
const GEMINI_TIMEOUT_MS = 60000;    // Gemini 2.5 Pro 최종 폴백
const BRIEFING_MAX_TOKENS = 3000;

function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

// ─── Primary: Claude Haiku ───────────────────────────────────────────────────
async function callHaikuForBriefing(systemPrompt: string, userPrompt: string): Promise<string> {
  const { callClaudeHaiku } = await import('../adapters/wrappers.js');
  return withDeadline(
    callClaudeHaiku(systemPrompt, userPrompt, BRIEFING_MAX_TOKENS),
    PRIMARY_TIMEOUT_MS,
    'ceo_briefing_haiku',
  );
}

// ─── Fallback 1: Claude Sonnet ───────────────────────────────────────────────
async function callSonnetForBriefing(systemPrompt: string, userPrompt: string): Promise<string> {
  const { callClaude } = await import('../adapters/wrappers.js');
  return withDeadline(
    callClaude(systemPrompt, userPrompt, BRIEFING_MAX_TOKENS),
    SONNET_TIMEOUT_MS,
    'ceo_briefing_sonnet',
  );
}

// ─── Fallback 2: Gemini 2.5 Pro ──────────────────────────────────────────────
async function callGeminiForBriefing(systemPrompt: string, userPrompt: string): Promise<string> {
  const { callGemini } = await import('../adapters/wrappers.js');
  return withDeadline(
    callGemini(systemPrompt, userPrompt, GEMINI_TIMEOUT_MS),
    GEMINI_TIMEOUT_MS,
    'ceo_briefing_gemini',
  );
}

// ─── 브리핑 시스템 프롬프트 ───────────────────────────────────────────────────
const BRIEFING_SYSTEM_PROMPT = `당신은 CORVUS X 의 CEO 전담 전략 브리핑 어시스턴트입니다.
당신의 역할은 여러 부서의 개별 분석 보고서를 경영진이 즉시 의사결정할 수 있는 수준의 통합 브리핑으로 변환하는 것입니다.

【당신의 판단 기준】
1. "So What?" 테스트 — 모든 문장은 "그래서 우리가 뭘 해야 하는데?"에 답해야 함. 단순 사실 나열 금지.
2. 숫자로 말하라 — 시장 규모, 점유율, 매출 영향, 기간, 비용을 반드시 포함. 부서 보고서에 수치가 있으면 인용.
3. 상충 신호 포착 — 부서 간 모순되는 주장이 있으면 양쪽을 병기하고 CEO 판단 포인트로 제시.
4. 리스크는 확률×영향도 순으로 정렬 — 가장 위험한 것부터.
5. 실행 권고는 "누가, 무엇을, 언제까지" 3요소 필수. 모호한 권고 금지.

【출력 구조 — 반드시 아래 JSON 만 출력】
{
  "executiveSummary": "3줄 이내. 첫 줄=핵심 결론(수치 포함), 둘째줄=최대 기회, 셋째줄=최대 리스크. CEO가 이것만 읽고 회의 방향을 잡을 수 있어야 함.",

  "deptFindings": [
    {"dept": "market", "finding": "수치 포함 한 줄 핵심 발견. 예: '국내 시장 연 12% 성장, 경쟁사 A 점유율 3%p 하락'", "signal": "red|yellow|green"},
    ...
  ],

  "priorityActions": [
    {"rank": 1, "action": "구체적 액션 (수치/기한 포함)", "owner": "marketing", "deadline": "이번주"},
    {"rank": 2, "action": "...", "owner": "legal", "deadline": "30일내"},
    {"rank": 3, "action": "...", "owner": "rnd"}
  ],

  "followUpItems": ["다음 라운드에서 추적할 KPI/이벤트 (수치 기준 명시)", "..."],

  "opportunities": ["기회 (시장규모/성장률 등 수치 포함)"],
  "risks": ["리스크 (발생확률·영향도 언급)"],
  "recommendations": ["[담당부서] 구체적 액션 (기한)"],
  "conflictingSignals": ["A부서는 X 주장 vs B부서는 Y 주장 — CEO 판단 필요"],
  "overallConfidence": 0.85
}

【규칙】
- JSON 외 텍스트 절대 금지. 코드블록(\`\`\`)으로 감싸지 말 것.
- executiveSummary 는 3줄 이내. CEO 가 첫 줄만 읽어도 핵심 방향을 잡을 수 있어야 함. 수치 필수.
- deptFindings 는 보고된 모든 부서를 포함. signal 기준:
   red = 즉시 대응 필요 (매출 감소, 법적 리스크, 경쟁사 위협 등)
   yellow = 주의 관찰 / 추가 데이터 필요 / 불확실성 높음
   green = 순풍 / 기회 신호 / 계획대로 진행 중
- priorityActions 는 정확히 3개. "누가(owner), 무엇을(action), 언제까지(deadline)" 3요소 충족.
   owner 는 10개 부서 ID 중 하나 또는 "ceo" (market/compete/legal/finance/marketing/rnd/data/content/sns/design/ceo)
- followUpItems 는 최대 5개. 측정 가능한 지표/이벤트 위주.
- opportunities/risks/recommendations 는 UI 호환용 — deptFindings/priorityActions 의 핵심을 한 줄로 추출
- conflictingSignals — 부서 간 상충이 없으면 빈 배열. 억지로 만들지 말 것.
- 모든 값은 한국어. 전문 용어는 영문 병기 가능.`;

// ─── 사용자 프롬프트 빌더 ─────────────────────────────────────────────────────
function buildBriefingPrompt(
  directive: string,
  reports: DeptReportEntry[],
  criticReview?: CriticReviewResult,
): string {
  const deptNames: Record<DeptId, string> = {
    market: '시장분석',
    compete: '경쟁정보',
    legal: '법무컴플라이언스',
    finance: '재무전략',
    marketing: '마케팅',
    rnd: 'R&D',
    data: '데이터인텔리전스',
    content: '콘텐츠',
    sns: 'SNS',
    design: '디자인',
  };

  const reportBlocks = reports.map(({ deptId, report }) => {
    const name = deptNames[deptId] ?? deptId;
    const sectionsText = report.sections
      .map(s => `### ${s.heading}\n${s.items.map(i => `- ${i}`).join('\n')}`)
      .join('\n\n');
    return `## [${name} 부서] 신뢰도: ${(report.confidence * 100).toFixed(0)}%\n**${report.title}**\n\n${sectionsText}`;
  }).join('\n\n---\n\n');

  const criticBlock = criticReview
    ? `\n## Critic 검증 결과\n- verdict: ${criticReview.verdict}\n- summary: ${criticReview.summary}\n- key issues:\n${criticReview.keyIssues.map((item) => `  - ${item}`).join('\n') || '  - 없음'}\n- verification needed:\n${criticReview.verificationNeeded.map((item) => `  - ${item}`).join('\n') || '  - 없음'}`
    : '';

  const conflictsBlock = criticReview && criticReview.conflicts && criticReview.conflicts.length > 0
    ? `\n## 부서간 상충 의견 (상무 지적)\n${criticReview.conflicts.map((c) => `- [${c.depts.join(' vs ')}] ${c.issue}`).join('\n')}`
    : '';

  return `## CEO 지시사항
${directive}

## 부서 분석 결과 (상무 include 필터링 적용)
${reportBlocks}
${criticBlock}${conflictsBlock}

위 부서 보고서들을 통합하여 CEO 브리핑을 JSON 형식으로 생성하십시오.
상충 의견이 있다면 conflictingSignals 필드에 반드시 반영하십시오.`;
}

// ─── 신호등/owner 정규화 ──────────────────────────────────────────────────────
const VALID_DEPT_IDS: ReadonlySet<string> = new Set([
  'market', 'compete', 'legal', 'finance',
  'marketing', 'rnd', 'data', 'content', 'sns',
]);

function normalizeSignal(v: unknown): "red" | "yellow" | "green" {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'red' || s === '🔴' || s === 'high' || s === '위험') return 'red';
  if (s === 'green' || s === '🟢' || s === 'low' || s === '양호') return 'green';
  return 'yellow';
}

function normalizeOwner(v: unknown): DeptId | "ceo" {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'ceo') return 'ceo';
  if (VALID_DEPT_IDS.has(s)) return s as DeptId;
  return 'ceo';
}

function pickDeptFindings(arr: unknown, reports: DeptReportEntry[]): DeptFinding[] {
  if (!Array.isArray(arr)) return [];
  const seen = new Set<DeptId>();
  const out: DeptFinding[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const dept = String((item as any).dept ?? '').trim().toLowerCase();
    if (!VALID_DEPT_IDS.has(dept)) continue;
    if (seen.has(dept as DeptId)) continue;
    const finding = String((item as any).finding ?? '').trim();
    if (!finding) continue;
    out.push({
      dept: dept as DeptId,
      finding: finding.slice(0, 200),
      signal: normalizeSignal((item as any).signal),
    });
    seen.add(dept as DeptId);
    if (out.length >= 10) break;
  }
  // 누락 부서가 있으면 confidence 기반으로 자동 채움
  if (out.length < reports.length) {
    for (const r of reports) {
      if (seen.has(r.deptId)) continue;
      const conf = r.report.confidence ?? 0.5;
      const signal: DeptFinding['signal'] = conf >= 0.75 ? 'green' : conf >= 0.5 ? 'yellow' : 'red';
      const finding = r.report.structured?.summary?.slice(0, 200)
                   ?? r.report.sections?.[0]?.items?.[0]?.slice(0, 200)
                   ?? '(자동 추출 결과 없음)';
      out.push({ dept: r.deptId, finding, signal });
      if (out.length >= 10) break;
    }
  }
  return out;
}

function pickPriorityActions(arr: unknown): PriorityAction[] {
  if (!Array.isArray(arr)) return [];
  const out: PriorityAction[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const action = String((item as any).action ?? '').trim();
    if (!action) continue;
    const rank = Math.max(1, Math.min(3, Math.round(Number((item as any).rank) || (out.length + 1))));
    const owner = normalizeOwner((item as any).owner);
    const deadlineRaw = String((item as any).deadline ?? '').trim();
    out.push({
      rank,
      action: action.slice(0, 280),
      owner,
      ...(deadlineRaw ? { deadline: deadlineRaw.slice(0, 60) } : {}),
    });
    if (out.length >= 3) break;
  }
  // rank 1, 2, 3 으로 재정규화
  return out
    .sort((a, b) => a.rank - b.rank)
    .map((a, i) => ({ ...a, rank: i + 1 }));
}

// ─── 브리핑 파싱 ─────────────────────────────────────────────────────────────
function parseBriefingJson(text: string, reports: DeptReportEntry[]): Omit<CeoBriefingResult, 'sessionId' | 'roundNumber' | 'directive' | 'deptScores' | 'generatedAt'> {
  // JSON 블록 추출 (```json ... ``` 또는 직접 { })
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]+?)```/) ?? text.match(/(\{[\s\S]+\})/);

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());

      const executiveSummary = String(parsed.executiveSummary ?? parsed.summary ?? '').trim();
      const deptFindings = pickDeptFindings(parsed.deptFindings, reports);
      const priorityActions = pickPriorityActions(parsed.priorityActions);
      const followUpItems = Array.isArray(parsed.followUpItems)
        ? parsed.followUpItems.map((x: any) => String(x ?? '').trim()).filter(Boolean).slice(0, 5)
        : [];

      // recommendations 는 priorityActions 에서 추출 (UI 호환)
      const recsFromPriority = priorityActions.map((a) => `[${a.owner.toUpperCase()}] ${a.action}${a.deadline ? ` (${a.deadline})` : ''}`);
      const recommendations = recsFromPriority.length >= 3
        ? recsFromPriority
        : (Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 5) : recsFromPriority);

      return {
        executiveSummary: executiveSummary || `${reports.length}개 부서 분석 완료.`,
        deptFindings,
        priorityActions,
        followUpItems,
        opportunities: Array.isArray(parsed.opportunities) ? parsed.opportunities.slice(0, 5) : [],
        risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 5) : [],
        recommendations,
        conflictingSignals: Array.isArray(parsed.conflictingSignals) ? parsed.conflictingSignals.slice(0, 3) : [],
        overallConfidence: typeof parsed.overallConfidence === 'number'
          ? Math.max(0, Math.min(1, parsed.overallConfidence))
          : calcAverageConfidence(reports),
        summary: executiveSummary || (typeof parsed.summary === 'string' ? parsed.summary : ''),
      };
    } catch {
      // JSON 파싱 실패 → fallback
    }
  }

  // Fallback: 텍스트에서 섹션 추출
  return buildFallbackBriefing(text, reports);
}

function buildFallbackBriefing(text: string, reports: DeptReportEntry[]): Omit<CeoBriefingResult, 'sessionId' | 'roundNumber' | 'directive' | 'deptScores' | 'generatedAt'> {
  const lines = text.split('\n').filter(l => l.trim());
  const opportunities: string[] = [];
  const risks: string[] = [];
  const recommendations: string[] = [];

  let mode = '';
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes('기회') || lower.includes('opportunit')) mode = 'opp';
    else if (lower.includes('리스크') || lower.includes('risk') || lower.includes('위험')) mode = 'risk';
    else if (lower.includes('권고') || lower.includes('recommend') || lower.includes('실행')) mode = 'rec';
    else if (line.trim().startsWith('-') || line.trim().match(/^\d+\./)) {
      const item = line.trim().replace(/^[-•\d+.]\s*/, '');
      if (mode === 'opp' && opportunities.length < 5) opportunities.push(item);
      else if (mode === 'risk' && risks.length < 5) risks.push(item);
      else if (mode === 'rec' && recommendations.length < 5) recommendations.push(item);
    }
  }

  const conf = calcAverageConfidence(reports);
  // fallback deptFindings — confidence 기반 신호등
  const deptFindings: DeptFinding[] = reports.map((r) => {
    const c = r.report.confidence ?? 0.5;
    const signal: DeptFinding['signal'] = c >= 0.75 ? 'green' : c >= 0.5 ? 'yellow' : 'red';
    const finding = r.report.structured?.summary?.slice(0, 200)
                 ?? r.report.sections?.[0]?.items?.[0]?.slice(0, 200)
                 ?? '(자동 추출 실패)';
    return { dept: r.deptId, finding, signal };
  });
  const priorityActions: PriorityAction[] = recommendations.slice(0, 3).map((rec, i) => ({
    rank: i + 1,
    action: rec,
    owner: 'ceo',
  }));
  while (priorityActions.length < 3) {
    priorityActions.push({
      rank: priorityActions.length + 1,
      action: '각 부서 보고서를 검토하고 실행 계획을 수립하십시오',
      owner: 'ceo',
    });
  }
  const summaryText = `${reports.length}개 부서 분석 완료. 평균 신뢰도 ${(conf * 100).toFixed(0)}%.`;
  return {
    executiveSummary: summaryText,
    deptFindings,
    priorityActions,
    followUpItems: [],
    opportunities: opportunities.length > 0 ? opportunities : ['부서 분석 결과를 확인하십시오'],
    risks: risks.length > 0 ? risks : ['상세 리스크는 각 부서 보고서 참조'],
    recommendations: recommendations.length > 0 ? recommendations : ['각 부서 보고서의 핵심 결론을 실행 계획에 반영하십시오'],
    conflictingSignals: [],
    overallConfidence: conf,
    summary: summaryText,
  };
}

function calcAverageConfidence(reports: DeptReportEntry[]): number {
  if (reports.length === 0) return 0.5;
  const sum = reports.reduce((acc, r) => acc + (r.report.confidence ?? 0.5), 0);
  return Math.round((sum / reports.length) * 100) / 100;
}

// ─── SQLite 저장 ──────────────────────────────────────────────────────────────
async function persistBriefing(briefing: CeoBriefingResult): Promise<void> {
  try {
    const { saveCeoBriefing } = await import('../memory/sqliteMemory.js');
    await saveCeoBriefing(briefing.sessionId, briefing.roundNumber, briefing);
    logger.info({ sessionId: briefing.sessionId }, '[CeoBriefing] SQLite 저장 완료');
  } catch (err) {
    // SQLite 미가용 시 로그만 출력, 브리핑 결과는 반환
    logger.warn({ err }, '[CeoBriefing] SQLite 저장 실패 (무시)');
  }
}

// ─── 메인 함수 ────────────────────────────────────────────────────────────────
export async function generateCeoBriefing(
  sessionId: string,
  roundNumber: number,
  directive: string,
  deptReports: DeptReportEntry[],
  criticReview?: CriticReviewResult,
): Promise<CeoBriefingResult> {
  const startTime = Date.now();

  // 상무 include 필터링 — include 지정 시 해당 부서만 CEO 에 전달
  const includeSet = criticReview && criticReview.include && criticReview.include.length > 0
    ? new Set(criticReview.include)
    : null;
  const filteredReports = includeSet
    ? deptReports.filter((r) => includeSet.has(r.deptId))
    : deptReports;
  const effectiveReports = filteredReports.length > 0 ? filteredReports : deptReports;

  logger.info({
    sessionId, roundNumber,
    deptCount: effectiveReports.length,
    excludedCount: deptReports.length - effectiveReports.length,
  }, '[CeoBriefing] 브리핑 생성 시작');

  const deptScores: Partial<Record<DeptId, number>> = {};
  for (const { deptId, report } of effectiveReports) {
    deptScores[deptId] = report.confidence;
  }

  let briefingData: Omit<CeoBriefingResult, 'sessionId' | 'roundNumber' | 'directive' | 'deptScores' | 'generatedAt'>;

  const userPrompt = buildBriefingPrompt(directive, effectiveReports, criticReview);
  try {
    const rawText = await callHaikuForBriefing(BRIEFING_SYSTEM_PROMPT, userPrompt);
    briefingData = parseBriefingJson(rawText, effectiveReports);
  } catch (haikuErr) {
    logger.warn({ err: haikuErr }, '[CeoBriefing] Haiku primary 실패 → Sonnet fallback');
    try {
      const rawText = await callSonnetForBriefing(BRIEFING_SYSTEM_PROMPT, userPrompt);
      briefingData = parseBriefingJson(rawText, effectiveReports);
    } catch (sonnetErr) {
      logger.warn({ err: sonnetErr }, '[CeoBriefing] Sonnet fallback 실패 → Gemini Pro fallback');
      try {
        const rawText = await callGeminiForBriefing(BRIEFING_SYSTEM_PROMPT, userPrompt);
        briefingData = parseBriefingJson(rawText, effectiveReports);
      } catch (geminiErr) {
        logger.error({ err: geminiErr }, '[CeoBriefing] Gemini fallback 실패 — 휴리스틱 브리핑');
        briefingData = buildFallbackBriefing('', effectiveReports);
      }
    }
  }

  const result: CeoBriefingResult = {
    sessionId,
    roundNumber,
    directive,
    ...briefingData,
    deptScores,
    critic: criticReview ? {
      verdict: criticReview.verdict,
      keyIssues: criticReview.keyIssues.slice(0, 5),
      confidence: criticReview.confidence,
    } : undefined,
    generatedAt: new Date().toISOString(),
  };

  logger.info({ sessionId, durationMs: Date.now() - startTime }, '[CeoBriefing] 브리핑 생성 완료');

  // 비동기 SQLite 저장 (결과 반환 차단 안 함)
  persistBriefing(result).catch(() => {});

  return result;
}

// ─── 로드 함수 ────────────────────────────────────────────────────────────────
export async function loadCeoBriefingResult(sessionId: string, roundNumber: number): Promise<CeoBriefingResult | null> {
  try {
    const { loadCeoBriefing } = await import('../memory/sqliteMemory.js');
    const raw = await loadCeoBriefing(sessionId, roundNumber);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CeoBriefingResult;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}
