/**
 * design.ts — 디자인팀 (Visual Assets & Creative Production)
 * Primary AI: Claude Sonnet 4.6 (크리에이티브 프롬프트 + 컨셉 설계)
 * Fallback:   Gemini 2.5 Pro (멀티모달/이미지 분석 강점)
 * Connectors: nano_banana → midjourney → canva (→ runway/veo 영상 시 확장)
 *
 * 비주얼 에셋 전담 부서.
 * 이미지/영상/3D/로고/배너/포스터/인테리어/무드보드 등 시각 결과물을 책임진다.
 * marketing/content/sns 가 전략/기획을 담당하고, design 이 실제 비주얼을 제작한다.
 */

import type { DeptTask } from '../../director/TaskDecomposer.js';
import { runDepartmentAgent } from '../DepartmentAgent.js';
import type { AgentRunOptions, AgentRunResult } from '../DepartmentAgent.js';

export async function runDesignDept(task: DeptTask, options: AgentRunOptions): Promise<AgentRunResult> {
  const enrichedTask = {
    ...task,
    context: `[디자인팀 특화 제작 브리프]
${task.context}

제작 프레임워크:
- 크리에이티브 컨셉 (1줄 헤드라인 + 무드 키워드 5개)
- 비주얼 방향 (스타일/색감/레퍼런스 이미지 지시)
- 사용 도구 체인 (nano_banana / midjourney / canva / runway / veo 중 선택 + 이유)
- 도구별 프롬프트 초안 (한국어 + 영문)
- 규격 명세 (이미지: 해상도·비율 / 영상: 길이·fps / 3D: 포맷·폴리곤 수)
- 제작 일정 (M+0 컨셉 → M+1 초안 → M+2 확정)
- 대안 A/B (분위기 다른 버전 2개 제시)
- 브랜드 가이드 준수 (골드 #C9A84C, 버건디 #922C40, 다크 #0F0A14)`,
  };
  return runDepartmentAgent(enrichedTask, options);
}

export default runDesignDept;
