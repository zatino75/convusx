/**
 * data.ts — 데이터분석팀 (Data & Consumer Insights)
 * Primary AI: DepartmentRegistry 의 data 항목 참조 (런타임 조회, CLAUDE.md #25).
 * Connectors: PostHog, Supabase, Semantic Search
 */

import type { DeptTask } from '../../director/TaskDecomposer.js';
import { runDepartmentAgent } from '../DepartmentAgent.js';
import type { AgentRunOptions, AgentRunResult } from '../DepartmentAgent.js';

export async function runDataDept(task: DeptTask, options: AgentRunOptions): Promise<AgentRunResult> {
  const enrichedTask = {
    ...task,
    context: `[데이터분석팀 특화 분석]
${task.context}

분석 프레임워크:
- 소비자 검색 트렌드 (네이버/구글 키워드 볼륨)
- 리뷰/평점 감성 분석 (긍정/부정/중립 비율)
- 구매 패턴 분석 (구매 주기/객단가/재구매율)
- 연령대별/지역별 소비자 분포
- 온라인 커뮤니티 언급량 및 주요 이슈
- 경쟁사 대비 소비자 인지도/선호도
- 데이터 기반 기회 포착 인사이트`,
  };
  return runDepartmentAgent(enrichedTask, options);
}

export default runDataDept;
