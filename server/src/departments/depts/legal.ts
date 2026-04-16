/**
 * legal.ts — 법무팀 (Legal & Compliance)
 * Primary AI: Claude Sonnet 4.6 (정밀 법규 해석 + 규제 리스크 분류)
 * Connectors: Tavily (법령 검색), Perplexity (최신 규제 동향)
 * 특화: 자동 법규 캐시(regulationWatcher) → 실시간 최신 규제 주입
 */

import type { DeptTask } from '../../director/TaskDecomposer.js';
import { runDepartmentAgent } from '../DepartmentAgent.js';
import type { AgentRunOptions, AgentRunResult } from '../DepartmentAgent.js';

/** 도메인별 규제 카테고리 매핑 */
const DOMAIN_CATEGORY_MAP: Record<string, string> = {
  ecig:     'ecig',
  food:     'food',
  cosmetic: 'cosmetic',
  general:  'general',
};

/** 자동 법규 캐시에서 해당 도메인 최신 규제 로드 */
async function loadRegulationContext(domain: string): Promise<string> {
  try {
    const { getSnapshotsByCategory } = await import('../../regulation/regulationCache.js');
    const category = DOMAIN_CATEGORY_MAP[domain] ?? 'general';
    const snapshots = getSnapshotsByCategory(category as any);

    if (snapshots.length === 0) return '';

    const recent = snapshots
      .sort((a, b) => (b.fetched_at ?? 0) - (a.fetched_at ?? 0))
      .slice(0, 4);

    const lines = recent.map(s => {
      const date = s.fetched_at
        ? new Date(s.fetched_at * 1000).toLocaleDateString('ko-KR')
        : '날짜 불명';
      return `- [${s.source_id}] (갱신: ${date})\n  ${s.latest_answer?.slice(0, 500) ?? '내용 없음'}`;
    });

    return `## 자동 수집 최신 법규 캐시 (${category})\n${lines.join('\n')}`;
  } catch {
    return '';
  }
}

export async function runLegalDept(task: DeptTask, options: AgentRunOptions): Promise<AgentRunResult> {
  const domainFromContext = task.context.match(/도메인:\s*(\w+)/)?.[1]?.toLowerCase() ?? 'general';
  // 자동 법규 캐시 로드
  const regulationContext = await loadRegulationContext(domainFromContext);

  const enrichedTask = {
    ...task,
    context: `[법무팀 특화 분석]
${task.context}

${regulationContext ? regulationContext + '\n' : ''}
분석 프레임워크:
- 필수 인허가 목록 (품목허가/신고/등록/인증) — 각 기관명 및 소요기간 포함
- 규제 리스크 등급 분류 (HIGH/MEDIUM/LOW) + 근거 법령 명시
- 준수 체크리스트 — 항목별 현재 상태 및 필요 조치
- 최근 3년 내 규제 변경사항 및 예정 개정 일정
- 위반 시 제재 수준 (벌금액/영업정지 기간/형사처벌 수준)
- 해외 수출 시 추가 규제 (FDA PMTA/EU TPD/국가별 인증)
- 자체 법무 vs 외부 법무법인 의뢰 판단 매트릭스
- 위험 시나리오별 대응 플랜 (3가지 이상)`,
  };

  return runDepartmentAgent(enrichedTask, options);
}

export default runLegalDept;
