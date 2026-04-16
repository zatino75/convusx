/**
 * market.ts — 시장조사팀 (Market Research)
 * Primary AI: Gemini 2.5 Pro (Google Search Grounding + 2M context)
 * Connectors: Tavily, Perplexity, Semantic Search
 */

import type { DeptTask } from '../../director/TaskDecomposer.js';
import { runDepartmentAgent } from '../DepartmentAgent.js';
import type { AgentRunOptions, AgentRunResult } from '../DepartmentAgent.js';

export async function runMarketDept(task: DeptTask, options: AgentRunOptions): Promise<AgentRunResult> {
  // 시장조사팀 특화 컨텍스트 주입
  const enrichedTask = {
    ...task,
    context: `[시장조사팀 특화 분석]
${task.context}

분석 프레임워크:
- TAM(전체 시장 규모) / SAM(유효 시장) / SOM(획득 가능 시장)
- 시장 성장률 CAGR (3년/5년)
- 주요 소비자 세그먼트별 구매 패턴
- 유통 채널 구조 (온라인/오프라인/전문채널)
- 계절성 / 지역별 편차
- 시장 성숙도 (도입기/성장기/성숙기/쇠퇴기)`,
  };

  return runDepartmentAgent(enrichedTask, options);
}

export default runMarketDept;
