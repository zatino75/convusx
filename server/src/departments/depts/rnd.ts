/**
 * rnd.ts — R&D팀 (Research & Product Development)
 * Primary AI: Claude Sonnet 4.6 (기술 분석 + 제품 기획)
 * Connectors: PubMed, Drug DB, Clinical Trials, Hugging Face, Tavily
 */

import type { DeptTask } from '../../director/TaskDecomposer.js';
import { runDepartmentAgent } from '../DepartmentAgent.js';
import type { AgentRunOptions, AgentRunResult } from '../DepartmentAgent.js';

export async function runRndDept(task: DeptTask, options: AgentRunOptions): Promise<AgentRunResult> {
  const enrichedTask = {
    ...task,
    context: `[R&D팀 특화 분석]
${task.context}

분석 프레임워크:
- 핵심 성분/원료 분석 (안전성/효능/규제 상태)
- 기술 타당성 평가 (현재 기술 수준 vs 요구 기술)
- 특허 현황 분석 (선행특허/블록특허/특허 공백)
- 제품 개발 로드맵 (컨셉/프로토타입/임상/양산)
- 제조 공정 요건 (GMP/HACCP/ISO 등)
- 품질 기준 및 테스트 방법론
- 개발 비용 및 소요 기간 추정`,
  };
  return runDepartmentAgent(enrichedTask, options);
}

export default runRndDept;
