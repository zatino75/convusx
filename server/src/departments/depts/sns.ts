/**
 * sns.ts — SNS팀 (Social Media & Community)
 * Primary AI: Claude Sonnet 4.6 (SNS 전략 + 커뮤니티 관리)
 * Connectors: Canva, Cloudinary, Slack
 */

import type { DeptTask } from '../../director/TaskDecomposer.js';
import { runDepartmentAgent } from '../DepartmentAgent.js';
import type { AgentRunOptions, AgentRunResult } from '../DepartmentAgent.js';

export async function runSnsDept(task: DeptTask, options: AgentRunOptions): Promise<AgentRunResult> {
  const enrichedTask = {
    ...task,
    context: `[SNS팀 특화 분석]
${task.context}

분석 프레임워크:
- 채널별 전략 (Instagram/YouTube/TikTok/Naver Blog/카카오채널)
- 팔로워 성장 목표 및 타임라인
- 포스팅 빈도 및 최적 시간대 (채널별)
- 해시태그 전략 및 SEO 키워드
- 인플루언서 협업 계획 (마이크로/매크로/메가)
- 커뮤니티 관리 가이드라인
- SNS KPI 지표 (도달/참여율/전환율/ROAS)`,
  };
  return runDepartmentAgent(enrichedTask, options);
}

export default runSnsDept;
