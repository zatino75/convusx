/**
 * finance.ts — 재무팀 (Financial Analysis)
 * Primary AI: GPT-5.4-pro (재무 모델링 + 수치 계산)
 * Connectors: Tavily, Perplexity, Supabase
 */

import type { DeptTask } from '../../director/TaskDecomposer.js';
import { runDepartmentAgent } from '../DepartmentAgent.js';
import type { AgentRunOptions, AgentRunResult } from '../DepartmentAgent.js';

export async function runFinanceDept(task: DeptTask, options: AgentRunOptions): Promise<AgentRunResult> {
  const enrichedTask = {
    ...task,
    context: `[재무팀 특화 분석]
${task.context}

분석 프레임워크:
- 초기 투자비용 상세 내역 (설비/인력/마케팅/법무/인허가)
- 월별 손익 시뮬레이션 (12개월)
- BEP(손익분기점) 산출 — 단위당/기간 기준
- ROI 시나리오 (보수/기본/낙관) 3년
- 현금흐름 분석 (운전자본 소요)
- 자금 조달 방안 (자체/투자/대출/정부지원)
- 주요 재무 리스크 (환율/원자재/규제 변화)`,
  };
  return runDepartmentAgent(enrichedTask, options);
}

export default runFinanceDept;
