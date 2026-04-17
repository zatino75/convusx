/**
 * DirectorAgent.ts
 * 디렉터 에이전트 — 사용자 지시를 받아 PMO 계획 → 9개 부서 실행 → Critic 검증 → CEO 브리핑까지 집계
 * WebSocket / SSE onEvent 콜백을 통해 실시간 진행 상황을 프론트엔드로 스트리밍
 *
 * 변경 이력:
 *  - WebSocket 'ws' 패키지 의존 제거 (순수 onEvent 콜백으로 통합)
 *  - SQLite 부서 보고서 자동 저장 (sqliteMemory.saveDeptReport)
 *  - CEO 브리핑 자동 생성 (all_done 후 generateCeoBriefing)
 */

import { decomposeMission } from './TaskDecomposer.js';
import type { DecomposedMission, DeptId } from './TaskDecomposer.js';
import {
  createSession,
  getSession,
  startRound,
  updateDeptStatus,
  serializeRound,
} from './ProjectSession.js';
import type { ProjectSession, DeptReport } from './ProjectSession.js';
import { runDepartmentAgent } from '../departments/DepartmentAgent.js';
import type { AgentRunOptions } from '../departments/DepartmentAgent.js';
import { generateCeoBriefing } from './CeoBriefing.js';
import type { CeoBriefingResult } from './CeoBriefing.js';
import { buildPmoPlan } from './PmoCoordinator.js';
import type { PmoPlan } from './PmoCoordinator.js';
import { runCriticReview } from './CriticReview.js';
import type { CriticReviewResult } from './CriticReview.js';
import { runEnsemble, detectHighValue } from './EnsembleRunner.js';
import type { EnsembleEvent } from './EnsembleRunner.js';
import { logger } from '../observability/logger.js';
import { awardXp } from '../departments/deptXp.js';

// ─── WebSocket 이벤트 타입 ────────────────────────────────────────────────────
export type WsEvent =
  | { type: 'mission_start'; missionId: string; topic: string; domain: string; deptCount: number }
  | { type: 'pmo_plan'; sessionId: string; roundNumber: number; plan: PmoPlan }
  | { type: 'dept_start'; deptId: DeptId; objective: string; model: string }
  | { type: 'dept_progress'; deptId: DeptId; message: string; percent: number }
  | { type: 'dept_done'; deptId: DeptId; report: object; model: string; connectors: string[]; durationMs: number }
  | { type: 'dept_error'; deptId: DeptId; error: string }
  | { type: 'ensemble_start'; deptId: DeptId; reason: string }
  | { type: 'ensemble_voice'; deptId: DeptId; model: string; message: string; durationMs?: number }
  | { type: 'ensemble_done'; deptId: DeptId; verdict: string; summary: string }
  | { type: 'critic_review'; review: CriticReviewResult }
  | { type: 'ceo_briefing'; briefing: CeoBriefingResult }
  | { type: 'all_done'; sessionId: string; roundNumber: number; summary: object; briefing?: CeoBriefingResult; critic?: CriticReviewResult }
  | { type: 'error'; message: string };

export interface DirectorOptions {
  userId?: string;
  sessionId?: string;            // 기존 세션에 라운드 추가 시
  projectName?: string;
  availableConnectors?: string[];
  onEvent?: (event: WsEvent) => void;
}

// ─── SQLite 저장 헬퍼 ─────────────────────────────────────────────────────────
async function persistDeptReport(
  sessionId: string,
  roundNumber: number,
  deptId: DeptId,
  report: DeptReport,
  model: string,
  connectors: string[]
): Promise<void> {
  try {
    const { saveDeptReport } = await import('../memory/sqliteMemory.js');
    await saveDeptReport(sessionId, roundNumber, deptId, report, model, connectors);
  } catch (err) {
    logger.warn({ err, deptId }, '[Director] SQLite 저장 실패 (무시)');
  }
}

async function persistSession(session: ProjectSession): Promise<void> {
  try {
    const { saveSession } = await import('../memory/sqliteMemory.js');
    await saveSession(session.sessionId, session);
  } catch (err) {
    logger.warn({ err }, '[Director] 세션 SQLite 저장 실패 (무시)');
  }
}

// ─── 메인 실행 ────────────────────────────────────────────────────────────────
export async function runDirector(
  directive: string,
  options: DirectorOptions = {}
): Promise<{ sessionId: string; roundNumber: number }> {
  const { onEvent, availableConnectors = [] } = options;
  const connectorSet = new Set(availableConnectors);
  const send = (e: WsEvent) => { try { onEvent?.(e); } catch { /* ignore */ } };

  // ─ 세션 생성 or 재사용 ──────────────────────────────────────────────────────
  let session: ProjectSession;
  if (options.sessionId) {
    const existing = getSession(options.sessionId);
    if (!existing) throw new Error(`세션 없음: ${options.sessionId}`);
    session = existing;
  } else {
    session = createSession(
      options.projectName ?? '신규 프로젝트',
      options.userId ?? 'anonymous'
    );
  }

  // ─ 미션 분해 ────────────────────────────────────────────────────────────────
  let mission: DecomposedMission;
  try {
    mission = await decomposeMission(directive, session.currentRound + 1);
  } catch (err) {
    send({ type: 'error', message: `미션 분해 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}` });
    throw err;
  }

  // ─ 라운드 시작 ──────────────────────────────────────────────────────────────
  const round = startRound(session, mission);

  send({
    type: 'mission_start',
    missionId: mission.missionId,
    topic: mission.topic,
    domain: mission.domain,
    deptCount: mission.tasks.length,
  });

  const pmoPlan = buildPmoPlan(directive, mission);
  send({
    type: 'pmo_plan',
    sessionId: session.sessionId,
    roundNumber: round.roundNumber,
    plan: pmoPlan,
  });

  // ─ 완료된 보고서 수집 (CEO 브리핑 생성용) ───────────────────────────────────
  const completedReports: Array<{ deptId: DeptId; report: DeptReport }> = [];

  // ─ 부서별 에이전트 병렬 실행 ─────────────────────────────────────────────────
  const agentPromises = mission.tasks.map(async (task) => {
    updateDeptStatus(session, round.roundNumber, task.deptId, {
      status: 'working',
      startedAt: new Date(),
    });

    const { getDept } = await import('../departments/DepartmentRegistry.js');
    const dept = getDept(task.deptId);
    const modelName = dept?.primaryModel ?? 'claude-sonnet-4-6';

    send({ type: 'dept_start', deptId: task.deptId, objective: task.objective, model: modelName });

    const agentOpts: AgentRunOptions = {
      sessionId: session.sessionId,
      roundNumber: round.roundNumber,
      availableConnectors: connectorSet,
      onProgress: (deptId, message, percent) => {
        send({ type: 'dept_progress', deptId, message, percent });
      },
    };

    try {
      // ─ 고가치 부서 → 3-AI 병렬 앙상블 사전 가시화 ─
      if (detectHighValue(directive, task.deptId)) {
        try {
          await runEnsemble({
            deptId: task.deptId,
            objective: task.objective,
            reason: `${task.deptId} — 고가치 3-AI 앙상블`,
            systemPrompt: `당신은 ${task.deptId} 부서 전문가입니다. CEO 지시: ${directive.slice(0,500)}`,
            userPrompt: `목표: ${task.objective}\n\n3-5문장 핵심 분석을 작성하세요.`,
            onEvent: (e: EnsembleEvent) => {
              if (e.type === 'ensemble_start') send({ type: 'ensemble_start', deptId: task.deptId, reason: e.reason || '' });
              else if (e.type === 'ensemble_voice') send({ type: 'ensemble_voice', deptId: task.deptId, model: e.model || '', message: e.message || '', durationMs: e.durationMs });
              else if (e.type === 'ensemble_done') send({ type: 'ensemble_done', deptId: task.deptId, verdict: e.verdict || 'consensus', summary: e.summary || '' });
            },
          });
        } catch (ensembleErr) {
          logger.warn({ err: ensembleErr, deptId: task.deptId }, '[Director] 앙상블 실패, 단독 모델로 진행');
        }
      }

      const result = await runDepartmentAgent(task, agentOpts);

      updateDeptStatus(session, round.roundNumber, task.deptId, {
        status: 'done',
        completedAt: new Date(),
        report: result.report,
        aiModel: result.modelUsed,
        connectorsUsed: result.connectorsUsed,
      });

      send({
        type: 'dept_done',
        deptId: task.deptId,
        report: result.report,
        model: result.modelUsed,
        connectors: result.connectorsUsed,
        durationMs: result.durationMs,
      });

      // Phase 5 — 부서 XP 누적 (fire-and-forget, 실패해도 실행 흐름 영향 없음)
      awardXp(task.deptId, 'success', result.costUsd ?? 0).catch(() => {});

      // SQLite 비동기 저장 (결과 차단 안 함)
      persistDeptReport(
        session.sessionId,
        round.roundNumber,
        task.deptId,
        result.report,
        result.modelUsed,
        result.connectorsUsed
      ).catch(() => {});

      // 보고서 수집
      completedReports.push({ deptId: task.deptId, report: result.report });

      return { deptId: task.deptId, success: true, result };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : '알 수 없는 오류';

      updateDeptStatus(session, round.roundNumber, task.deptId, {
        status: 'error',
        completedAt: new Date(),
        error: errMsg,
      });

      send({ type: 'dept_error', deptId: task.deptId, error: errMsg });
      // Phase 5 — 실패도 소량 XP (학습 인정)
      awardXp(task.deptId, 'error', 0).catch(() => {});
      return { deptId: task.deptId, success: false, error: errMsg };
    }
  });

  // ─ 전체 완료 대기 ────────────────────────────────────────────────────────────
  await Promise.allSettled(agentPromises);

  // ─ 세션 SQLite 저장 (라운드 포함) ────────────────────────────────────────────
  persistSession(session).catch(() => {});

  // ─ CEO 브리핑 생성 ────────────────────────────────────────────────────────────
  let briefing: CeoBriefingResult | undefined;
  let criticReview: CriticReviewResult | undefined;
  if (completedReports.length > 0) {
    try {
      criticReview = await runCriticReview(directive, completedReports);
      send({ type: 'critic_review', review: criticReview });
    } catch (err) {
      logger.error({ err }, '[Director] Critic 검토 실패');
    }
  }

  if (completedReports.length > 0) {
    try {
      briefing = await generateCeoBriefing(
        session.sessionId,
        round.roundNumber,
        directive,
        completedReports,
        criticReview
      );
      send({ type: 'ceo_briefing', briefing });
    } catch (err) {
      logger.error({ err }, '[Director] CEO 브리핑 생성 실패');
    }
  }

  // ─ 종합 요약 전송 ────────────────────────────────────────────────────────────
  const serialized = serializeRound(round);
  send({
    type: 'all_done',
    sessionId: session.sessionId,
    roundNumber: round.roundNumber,
    summary: serialized,
    briefing,
    critic: criticReview,
  });

  logger.info(
    { sessionId: session.sessionId, roundNumber: round.roundNumber, deptsDone: completedReports.length },
    '[Director] 전체 완료'
  );

  return { sessionId: session.sessionId, roundNumber: round.roundNumber };
}

// ─── HTTP 응답용 래퍼 (SSE 없이 전체 결과 반환) ──────────────────────────────
export async function runDirectorSync(
  directive: string,
  options: DirectorOptions
): Promise<{ sessionId: string; roundNumber: number; round: object; briefing?: CeoBriefingResult; critic?: CriticReviewResult }> {
  let capturedBriefing: CeoBriefingResult | undefined;
  let capturedCritic: CriticReviewResult | undefined;
  const originalOnEvent = options.onEvent;

  const result = await runDirector(directive, {
    ...options,
    onEvent: (e) => {
      if (e.type === 'ceo_briefing') capturedBriefing = e.briefing;
      if (e.type === 'critic_review') capturedCritic = e.review;
      originalOnEvent?.(e);
    },
  });

  const session = getSession(result.sessionId)!;
  const round = session.rounds[result.roundNumber - 1];
  return {
    sessionId: result.sessionId,
    roundNumber: result.roundNumber,
    round: serializeRound(round),
    briefing: capturedBriefing,
    critic: capturedCritic,
  };
}
