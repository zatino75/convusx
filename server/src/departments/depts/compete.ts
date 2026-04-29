/**
 * compete.ts — 경쟁분석팀 (Competitive Intelligence)
 * Primary AI: DepartmentRegistry 의 compete.primaryModel 참조 (런타임 조회, CLAUDE.md #25).
 * Connectors: Tavily, Perplexity, Semantic Search
 */

import type { DeptTask } from '../../director/TaskDecomposer.js';
import { runDepartmentAgent } from '../DepartmentAgent.js';
import type { AgentRunOptions, AgentRunResult } from '../DepartmentAgent.js';

export async function runCompeteDept(task: DeptTask, options: AgentRunOptions): Promise<AgentRunResult> {
  const enrichedTask = {
    ...task,
    context: `[경쟁분석팀 특화 분석]
${task.context}

분석 프레임워크:
- 경쟁사 Top5 상세 프로파일 (매출/점유율/설립연도/강약점)
- Porter 5 Forces 분석
- 포지셔닝 맵 (가격 vs 품질 / 온라인 vs 오프라인)
- 경쟁사 마케팅 전략 및 채널 분석
- SWOT 비교 분석
- 차별화 기회 및 진입 포지션 제안`,
  };
  return runDepartmentAgent(enrichedTask, options);
}

export default runCompeteDept;
