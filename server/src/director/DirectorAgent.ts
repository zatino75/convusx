/**
 * DirectorAgent.ts
 * 디렉터 에이전트 — 사용자 지시를 받아 PMO 계획 → 10개 부서 실행 → Critic 검증 → CEO 브리핑까지 집계
 * WebSocket / SSE onEvent 콜백을 통해 실시간 진행 상황을 프론트엔드로 스트리밍
 *
 * 변경 이력:
 *  - WebSocket 'ws' 패키지 의존 제거 (순수 onEvent 콜백으로 통합)
 *  - SQLite 부서 보고서 자동 저장 (sqliteMemory.saveDeptReport)
 *  - CEO 브리핑 자동 생성 (all_done 후 generateCeoBriefing)
 */

import { decomposeMission, detectMissionDomain } from './TaskDecomposer.js';
import type { DecomposedMission, DeptId, DeptTask } from './TaskDecomposer.js';
import { runExecutiveGate } from './ExecutiveGate.js';
import type { ExecutiveGateResult, GateDomain } from './ExecutiveGate.js';
import {
  createSession,
  getSession,
  getOrCreateSession,
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
  | { type: 'executive_gate_start'; directive: string; domain: GateDomain }
  | { type: 'executive_gate_done'; action: ExecutiveGateResult['action']; complexity: ExecutiveGateResult['complexity']; departments: ExecutiveGateResult['departments']; reason: string }
  | { type: 'executive_gate_redirect'; reason: string }
  | { type: 'mission_start'; missionId: string; topic: string; domain: string; deptCount: number }
  | { type: 'pmo_plan'; sessionId: string; roundNumber: number; plan: PmoPlan }
  | { type: 'dept_start'; deptId: DeptId; objective: string; model: string }
  | { type: 'dept_progress'; deptId: DeptId; message: string; percent: number }
  | { type: 'dept_done'; deptId: DeptId; report: object; model: string; connectors: string[]; durationMs: number }
  | { type: 'dept_error'; deptId: DeptId; error: string }
  | { type: 'ensemble_start'; deptId: DeptId; reason: string }
  | { type: 'ensemble_voice'; deptId: DeptId; model: string; message: string; durationMs?: number; confidence?: number }
  | { type: 'ensemble_done'; deptId: DeptId; verdict: string; summary: string; synthesis?: string; similarity?: number }
  | { type: 'critic_start' }
  | { type: 'critic_done'; review: CriticReviewResult }
  | { type: 'critic_rework'; rework: DeptId[]; rework_reason: Partial<Record<DeptId, string>> }
  | { type: 'dept_rework_start'; deptId: DeptId; reason: string }
  | { type: 'dept_rework_done'; deptId: DeptId; report: object; model: string; connectors: string[]; durationMs: number; regression?: boolean; oldConfidence?: number; newConfidence?: number }
  | { type: 'critic_review'; review: CriticReviewResult }  // 하위호환
  | { type: 'ceo_briefing'; briefing: CeoBriefingResult }
  | { type: 'all_done'; sessionId: string; roundNumber: number; summary: object; briefing?: CeoBriefingResult; critic?: CriticReviewResult }
  | { type: 'error'; message: string };

export interface DirectorOptions {
  userId?: string;
  sessionId?: string;            // 기존 세션에 라운드 추가 시
  projectName?: string;
  availableConnectors?: string[];
  onEvent?: (event: WsEvent) => void;
  /** 상위 층에서 이미 ExecutiveGate 를 돌렸으면 결과를 주입해 게이트 중복 호출을 건너뛴다. */
  preloadedGate?: ExecutiveGateResult;
  /** ExecutiveGate 자체를 건너뛴다 (예: 테스트·레거시 경로). 기본 false. */
  skipExecutiveGate?: boolean;
}

export interface DirectorRunResult {
  sessionId: string;
  roundNumber: number;
  redirectedToSingleAgent?: boolean;
  gate?: ExecutiveGateResult;
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
): Promise<DirectorRunResult> {
  const { onEvent, availableConnectors = [] } = options;
  const connectorSet = new Set(availableConnectors);
  const send = (e: WsEvent) => { try { onEvent?.(e); } catch { /* ignore */ } };

  // ─ 세션 생성 or 재사용 (프론트 threadId를 sessionId로 자동 등록) ──────────
  let session: ProjectSession;
  if (options.sessionId) {
    session = getOrCreateSession(
      options.sessionId,
      options.projectName ?? '신규 프로젝트',
      options.userId ?? 'anonymous'
    );
  } else {
    session = createSession(
      options.projectName ?? '신규 프로젝트',
      options.userId ?? 'anonymous'
    );
  }

  // ─ 상무 게이트 ───────────────────────────────────────────────────────────────
  let gate: ExecutiveGateResult | undefined = options.preloadedGate;
  if (!gate && !options.skipExecutiveGate) {
    const domain = detectMissionDomain(directive) as GateDomain;
    send({ type: 'executive_gate_start', directive: directive.slice(0, 200), domain });
    gate = await runExecutiveGate(directive, domain);
    logger.info({ action: gate.action, deptCount: gate.departments.length, reason: gate.reason }, '[Director] gate done');
    send({
      type: 'executive_gate_done',
      action: gate.action,
      complexity: gate.complexity,
      departments: gate.departments,
      reason: gate.reason,
    });
  }

  if (gate && gate.action === 'single_agent') {
    send({
      type: 'executive_gate_redirect',
      reason: gate.reason || 'gate_chose_single_agent',
    });
    logger.info({ sessionId: session.sessionId, reason: gate.reason }, '[Director] gate → single_agent redirect');
    // 상위 층이 단일 에이전트로 실제 응답을 생성하도록 즉시 반환.
    return {
      sessionId: session.sessionId,
      roundNumber: session.currentRound,
      redirectedToSingleAgent: true,
      gate,
    };
  }

  // ─ 미션 분해 (TaskDecomposer = gate 실패 시 fallback 경로) ───────────────────
  let mission: DecomposedMission;
  try {
    mission = await decomposeMission(directive, session.currentRound + 1);
  } catch (err) {
    send({ type: 'error', message: `미션 분해 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}` });
    throw err;
  }

  // ─ gate 결과가 있으면 tasks 를 gate 기준으로 재구성 ─────────────────────────
  if (gate && gate.action === 'director' && gate.departments.length > 0) {
    const ordered: DeptTask[] = [];
    for (const gd of gate.departments) {
      const existing = mission.tasks.find((t) => t.deptId === gd.id);
      if (existing) {
        ordered.push({ ...existing, instruction: gd.instruction });
      } else {
        ordered.push({
          deptId: gd.id,
          priority: 'high',
          objective: gd.instruction,
          context: `ExecutiveGate 추가 지정 부서 — domain: ${detectMissionDomain(directive)}`,
          deliverable: '핵심 분석 결과',
          estimatedMinutes: 8,
          instruction: gd.instruction,
        });
      }
    }
    mission = { ...mission, tasks: ordered };
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
  const taskByDept = new Map(mission.tasks.map((t) => [t.deptId, t] as const));

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
          const ensembleResult = await runEnsemble({
            deptId: task.deptId,
            objective: task.objective,
            reason: `${task.deptId} — 고가치 3-AI 앙상블`,
            systemPrompt: `당신은 ${task.deptId} 부서 전문가입니다. CEO 지시: ${directive.slice(0,500)}`,
            userPrompt: `목표: ${task.objective}\n\n구체적 수치/근거를 포함한 5-8문장 분석을 작성하세요.`,
            onEvent: (e: EnsembleEvent) => {
              // ensemble_done 은 아래에서 synthesis 와 함께 한 번만 보낸다 (중복 방지)
              if (e.type === 'ensemble_start') send({ type: 'ensemble_start', deptId: task.deptId, reason: e.reason || '' });
              else if (e.type === 'ensemble_voice') send({ type: 'ensemble_voice', deptId: task.deptId, model: e.model || '', message: e.message || '', durationMs: e.durationMs, confidence: e.confidence });
            },
          });
          // 풀 synthesis + similarity 를 포함해 ensemble_done 한 번에 emit
          send({
            type: 'ensemble_done',
            deptId: task.deptId,
            verdict: ensembleResult.verdict,
            summary: ensembleResult.summary,
            synthesis: ensembleResult.synthesis,
            similarity: ensembleResult.similarity,
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

  logger.info({ sessionId: session.sessionId, taskCount: mission.tasks.length, depts: mission.tasks.map(t => t.deptId) }, '[Director] 부서 병렬 실행 시작');

  // ─ 전체 완료 대기 ────────────────────────────────────────────────────────────
  const results = await Promise.allSettled(agentPromises);
  const settled = results.map((r, i) => ({ dept: mission.tasks[i]?.deptId, status: r.status, ...(r.status === 'rejected' ? { reason: String((r as any).reason?.message ?? (r as any).reason ?? '').slice(0, 200) } : {}) }));
  logger.info({ sessionId: session.sessionId, settled, completedReports: completedReports.length }, '[Director] 부서 병렬 실행 종료');

  // ─ 세션 SQLite 저장 (라운드 포함) ────────────────────────────────────────────
  persistSession(session).catch(() => {});

  // ─ 상무 3단계 검토 + 보강 루프 (1회 한정) ───────────────────────────────────
  let briefing: CeoBriefingResult | undefined;
  let criticReview: CriticReviewResult | undefined;
  if (completedReports.length > 0) {
    try {
      send({ type: 'critic_start' });
      criticReview = await runCriticReview(directive, completedReports);
      send({ type: 'critic_done', review: criticReview });
      // 하위호환 이벤트 — 기존 프론트가 'critic_review' 를 듣고 있음
      send({ type: 'critic_review', review: criticReview });

      // 보강 요청 있으면 해당 부서만 재실행 (1회 한정)
      if (
        criticReview.verdict === 'needs_rework' &&
        criticReview.rework &&
        criticReview.rework.length > 0
      ) {
        send({
          type: 'critic_rework',
          rework: criticReview.rework,
          rework_reason: criticReview.rework_reason ?? {},
        });

        await Promise.allSettled(
          criticReview.rework.map(async (deptId) => {
            const originalTask = taskByDept.get(deptId);
            if (!originalTask) return;
            const reason = criticReview?.rework_reason?.[deptId] ?? '이전 분석의 근거가 부족하여 보강이 필요합니다.';

            send({ type: 'dept_rework_start', deptId, reason });
            updateDeptStatus(session, round.roundNumber, deptId, { status: 'working' });

            // 기존 보고 + rework_reason 을 context 에 주입한 보강 task
            const existingReportEntry = completedReports.find((r) => r.deptId === deptId);
            const existingContext = existingReportEntry
              ? `\n\n이전 분석 요약: ${existingReportEntry.report.structured?.summary ?? existingReportEntry.report.title}`
              : '';
            const reworkTask = {
              ...originalTask,
              objective: `[보강] ${originalTask.objective}`,
              context: `${originalTask.context}${existingContext}\n\n[상무 보완 지시] ${reason}. 보완하세요.`,
            };

            const reworkOpts: AgentRunOptions = {
              sessionId: session.sessionId,
              roundNumber: round.roundNumber,
              availableConnectors: connectorSet,
              onProgress: (dId, message, percent) => {
                send({ type: 'dept_progress', deptId: dId, message, percent });
              },
            };

            try {
              const result = await runDepartmentAgent(reworkTask, reworkOpts);

              // 점수 퇴보 가드: 보강 후 confidence 가 원본보다 낮으면 원본 유지
              // Why: rework 가 항상 개선을 보장하지 않음 — 모델이 과도하게 단순화하거나
              // 새 컨텍스트에 휘둘려 더 빈약한 답을 낼 때 원본 자료를 보존해야 한다.
              const oldConfidence = existingReportEntry?.report.confidence ?? 0;
              const newConfidence = result.report.confidence ?? 0;
              if (existingReportEntry && newConfidence < oldConfidence) {
                logger.warn(
                  { deptId, oldConfidence, newConfidence },
                  '[Director] 보강 결과 confidence 하락 → 원본 유지'
                );
                updateDeptStatus(session, round.roundNumber, deptId, {
                  status: 'done',
                  completedAt: new Date(),
                  report: existingReportEntry.report,
                  aiModel: existingReportEntry.report.aiModel,
                  connectorsUsed: existingReportEntry.report.connectorsUsed,
                });
                send({
                  type: 'dept_rework_done',
                  deptId,
                  report: existingReportEntry.report,
                  model: existingReportEntry.report.aiModel ?? result.modelUsed,
                  connectors: existingReportEntry.report.connectorsUsed ?? result.connectorsUsed,
                  durationMs: result.durationMs,
                  regression: true,
                  oldConfidence,
                  newConfidence,
                });
                // completedReports 변경 안 함 — 원본이 이미 들어 있음
                // awardXp 도 호출하지 않음 (보강 실패로 간주)
                return;
              }

              updateDeptStatus(session, round.roundNumber, deptId, {
                status: 'done',
                completedAt: new Date(),
                report: result.report,
                aiModel: result.modelUsed,
                connectorsUsed: result.connectorsUsed,
              });
              send({
                type: 'dept_rework_done',
                deptId,
                report: result.report,
                model: result.modelUsed,
                connectors: result.connectorsUsed,
                durationMs: result.durationMs,
                oldConfidence,
                newConfidence,
              });
              // 기존 보고 교체
              const idx = completedReports.findIndex((r) => r.deptId === deptId);
              if (idx >= 0) completedReports[idx] = { deptId, report: result.report };
              else completedReports.push({ deptId, report: result.report });
              awardXp(deptId, 'success', result.costUsd ?? 0).catch(() => {});
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : '알 수 없는 오류';
              logger.warn({ err, deptId }, '[Director] 보강 재실행 실패');
              send({ type: 'dept_error', deptId, error: `보강 실패: ${errMsg}` });
            }
          })
        );
      }
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

  return { sessionId: session.sessionId, roundNumber: round.roundNumber, gate };
}

// ─── HTTP 응답용 래퍼 (SSE 없이 전체 결과 반환) ──────────────────────────────
export async function runDirectorSync(
  directive: string,
  options: DirectorOptions
): Promise<{ sessionId: string; roundNumber: number; round: object | null; briefing?: CeoBriefingResult; critic?: CriticReviewResult; redirectedToSingleAgent?: boolean; gate?: ExecutiveGateResult }> {
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

  // 상무 게이트가 single_agent 로 보냈으면 round 가 없음 → null 반환.
  if (result.redirectedToSingleAgent) {
    return {
      sessionId: result.sessionId,
      roundNumber: result.roundNumber,
      round: null,
      briefing: capturedBriefing,
      critic: capturedCritic,
      redirectedToSingleAgent: true,
      gate: result.gate,
    };
  }

  const session = getSession(result.sessionId)!;
  const round = session.rounds[result.roundNumber - 1];
  return {
    sessionId: result.sessionId,
    roundNumber: result.roundNumber,
    round: serializeRound(round),
    briefing: capturedBriefing,
    critic: capturedCritic,
    gate: result.gate,
  };
}
