/**
 * sns.ts — SNS팀 (Social Channel Strategy)
 * Primary AI: Claude Sonnet 4.6 (채널 전략 + 커뮤니티)
 * Fallback:   Gemini 2.5 Pro (SNS 트렌드 멀티모달 분석 강점)
 * Connectors: serper → perplexity (이미지/영상 제작은 design 팀 소관)
 *
 * 채널 전략·운영 전담. 실제 게시물 이미지/영상은 design 팀이 만든다.
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
- SNS KPI 지표 (도달/참여율/전환율/ROAS)

디자인팀 브리프 (각 게시물 비주얼 제작 의뢰용):
- 플랫폼별 규격 (IG 피드 1:1/4:5, 스토리 9:16, 릴스 9:16 15~60s, TikTok 9:16 15~60s)
- 톤&스타일, 포함 요소, 컬러 키 3가지
- 시리즈 연속성 (동일 템플릿 재사용 포인트)`,
  };
  return runDepartmentAgent(enrichedTask, options);
}

export default runSnsDept;
