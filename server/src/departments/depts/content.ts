/**
 * content.ts — 콘텐츠팀 (Content Strategy & Writing)
 * Primary / Fallback: DepartmentRegistry 의 content 항목 참조 (런타임 조회, CLAUDE.md #25).
 * Connectors: serper → perplexity (비주얼 도구는 design 팀 소관)
 *
 * 텍스트 콘텐츠 전담. 이미지/영상/인포그래픽 등 시각 자산은 design 팀 담당.
 */

import type { DeptTask } from '../../director/TaskDecomposer.js';
import { runDepartmentAgent } from '../DepartmentAgent.js';
import type { AgentRunOptions, AgentRunResult } from '../DepartmentAgent.js';

export async function runContentDept(task: DeptTask, options: AgentRunOptions): Promise<AgentRunResult> {
  const enrichedTask = {
    ...task,
    context: `[콘텐츠팀 특화 분석]
${task.context}

분석 프레임워크:
- 브랜드 톤&매너 정의 (감성 키워드 5가지)
- 콘텐츠 유형 전략 (블로그/기사/카피/스크립트 비중)
- 핵심 콘텐츠 테마 및 시리즈 기획
- 카피라이팅 초안 (헤드라인/본문/CTA)
- 월별 콘텐츠 캘린더 (첫 3개월)
- SEO/SEM 키워드 전략
- 콘텐츠 성과 측정 지표

디자인팀 브리프 (비주얼 수반 콘텐츠):
- 각 콘텐츠 슬롯별 비주얼 무드/레이아웃 방향
- 포함 요소(제품/인물/배경) + 색감 + 비율·해상도`,
  };
  return runDepartmentAgent(enrichedTask, options);
}

export default runContentDept;
