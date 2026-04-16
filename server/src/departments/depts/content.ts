/**
 * content.ts — 콘텐츠팀 (Content Strategy & Creative)
 * Primary AI: Claude Sonnet 4.6 (크리에이티브 + 콘텐츠 기획)
 * Connectors: Canva, Cloudinary, Figma, Gamma
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
- 콘텐츠 유형 전략 (영상/이미지/텍스트/인터랙티브 비중)
- 핵심 콘텐츠 테마 및 시리즈 기획
- 비주얼 아이덴티티 방향 (색상/폰트/디자인 코드)
- 월별 콘텐츠 캘린더 (첫 3개월)
- 콘텐츠 제작 리소스 및 외주 계획
- 콘텐츠 성과 측정 지표`,
  };
  return runDepartmentAgent(enrichedTask, options);
}

export default runContentDept;
