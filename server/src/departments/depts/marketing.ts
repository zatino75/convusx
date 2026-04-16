/**
 * marketing.ts — 마케팅팀 (Brand & Marketing Strategy)
 * Primary AI: Claude Sonnet 4.6 (브랜드 전략 + 크리에이티브)
 * Connectors: Canva, Figma, Slack, Semantic Search
 */

import type { DeptTask } from '../../director/TaskDecomposer.js';
import { runDepartmentAgent } from '../DepartmentAgent.js';
import type { AgentRunOptions, AgentRunResult } from '../DepartmentAgent.js';

export async function runMarketingDept(task: DeptTask, options: AgentRunOptions): Promise<AgentRunResult> {
  const enrichedTask = {
    ...task,
    context: `[마케팅팀 특화 분석]
${task.context}

분석 프레임워크:
- 브랜드 포지셔닝 전략 (단순 명확하게)
- 핵심 타겟 페르소나 (3가지 이내)
- 브랜드 USP(핵심 차별점) 3가지
- 마케팅 채널 믹스 및 예산 배분
- 런칭 캠페인 로드맵 (D-30/D-0/D+30)
- KPI 설정 및 측정 방법
- 경쟁사 마케팅 대비 차별화 포인트`,
  };
  return runDepartmentAgent(enrichedTask, options);
}

export default runMarketingDept;
