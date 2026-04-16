/**
 * CeoBriefing.ts — CORVUS X CEO 브리핑 생성기
 *
 * 9개 부서 보고서 완료 후 Claude Opus 4.6으로 통합 경영 브리핑 생성
 * 출력: 핵심 기회 3개 / 핵심 리스크 3개 / 즉시 실행 권고 / 통합 신뢰도 점수
 * SQLite ceo_briefings 테이블에 자동 저장
 */

import type { DeptReport } from './ProjectSession.js';
import type { DeptId } from './TaskDecomposer.js';
import type { CriticReviewResult } from './CriticReview.js';
import { logger } from '../observability/logger.js';

export interface CeoBriefingResult {
  sessionId: string;
  roundNumber: number;
  directive: string;
  opportunities: string[];        // 핵심 기회 (최대 5개)
  risks: string[];                // 핵심 리스크 (최대 5개)
  recommendations: string[];      // 즉시 실행 권고 (최대 5개)
  conflictingSignals: string[];   // 부서간 상충 신호 (최대 3개)
  overallConfidence: number;      // 0~1 통합 신뢰도
  summary: string;                // 2~3문장 핵심 요약
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

// ─── Claude Opus 4.6 호출 ─────────────────────────────────────────────────────
async function callClaudeForBriefing(systemPrompt: string, userPrompt: string): Promise<string> {
  try {
    const { callClaude } = await import('../adapters/wrappers.js');
    // CEO 브리핑은 thinking 비활성 — 빠른 synthesis 우선
    return await callClaude(systemPrompt, userPrompt, 4096);
  } catch (err) {
    logger.error({ err }, '[CeoBriefing] Claude 호출 실패');
    throw err;
  }
}

// ─── 브리핑 시스템 프롬프트 ───────────────────────────────────────────────────
const BRIEFING_SYSTEM_PROMPT = `당신은 CORVUS X의 최고경영자(CEO) 전담 AI 브리핑 어시스턴트입니다.

역할:
- 9개 전문 AI 부서(시장분석/경쟁정보/법무컴플라이언스/재무전략/마케팅/R&D/데이터인텔리전스/콘텐츠/SNS)의 분석 결과를 CEO 시각에서 통합합니다.
- 부서간 상충되거나 일치하는 신호를 감지합니다.
- CEO가 즉시 의사결정에 활용할 수 있는 핵심 통찰을 추출합니다.

출력 형식 (반드시 아래 JSON 구조로만 응답):
{
  "opportunities": ["기회1", "기회2", "기회3"],
  "risks": ["리스크1", "리스크2", "리스크3"],
  "recommendations": ["권고1", "권고2", "권고3"],
  "conflictingSignals": ["상충1", "상충2"],
  "overallConfidence": 0.85,
  "summary": "핵심 요약 2~3문장"
}

주의:
- JSON 외 다른 텍스트는 절대 출력하지 마십시오.
- 각 항목은 한국어로 작성하되 구체적이고 실행 가능해야 합니다.
- overallConfidence는 0~1 사이 소수점 2자리 숫자입니다.
- 기회/리스크/권고는 각 최소 2개, 최대 5개입니다.`;

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

  return `## CEO 지시사항
${directive}

## 9개 부서 분석 결과
${reportBlocks}
${criticBlock}

위 부서 보고서들을 통합하여 CEO 브리핑을 JSON 형식으로 생성하십시오.`;
}

// ─── 브리핑 파싱 ─────────────────────────────────────────────────────────────
function parseBriefingJson(text: string, reports: DeptReportEntry[]): Omit<CeoBriefingResult, 'sessionId' | 'roundNumber' | 'directive' | 'deptScores' | 'generatedAt'> {
  // JSON 블록 추출 (```json ... ``` 또는 직접 { })
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]+?)```/) ?? text.match(/(\{[\s\S]+\})/);

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      return {
        opportunities: Array.isArray(parsed.opportunities) ? parsed.opportunities.slice(0, 5) : [],
        risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 5) : [],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 5) : [],
        conflictingSignals: Array.isArray(parsed.conflictingSignals) ? parsed.conflictingSignals.slice(0, 3) : [],
        overallConfidence: typeof parsed.overallConfidence === 'number'
          ? Math.max(0, Math.min(1, parsed.overallConfidence))
          : calcAverageConfidence(reports),
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
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
  return {
    opportunities: opportunities.length > 0 ? opportunities : ['부서 분석 결과를 확인하십시오'],
    risks: risks.length > 0 ? risks : ['상세 리스크는 각 부서 보고서 참조'],
    recommendations: recommendations.length > 0 ? recommendations : ['각 부서 보고서의 핵심 결론을 실행 계획에 반영하십시오'],
    conflictingSignals: [],
    overallConfidence: conf,
    summary: `${reports.length}개 부서 분석 완료. 평균 신뢰도 ${(conf * 100).toFixed(0)}%.`,
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
  logger.info({ sessionId, roundNumber, deptCount: deptReports.length }, '[CeoBriefing] 브리핑 생성 시작');

  const deptScores: Partial<Record<DeptId, number>> = {};
  for (const { deptId, report } of deptReports) {
    deptScores[deptId] = report.confidence;
  }

  let briefingData: Omit<CeoBriefingResult, 'sessionId' | 'roundNumber' | 'directive' | 'deptScores' | 'generatedAt'>;

  try {
    const userPrompt = buildBriefingPrompt(directive, deptReports, criticReview);
    const rawText = await callClaudeForBriefing(BRIEFING_SYSTEM_PROMPT, userPrompt);
    briefingData = parseBriefingJson(rawText, deptReports);
  } catch (err) {
    logger.error({ err }, '[CeoBriefing] AI 호출 실패 — fallback 브리핑 사용');
    briefingData = buildFallbackBriefing('', deptReports);
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
