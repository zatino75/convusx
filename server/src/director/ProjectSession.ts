/**
 * ProjectSession.ts
 * 프로젝트 세션 상태 관리 — 라운드별 진행 상황 추적
 */

import type { DecomposedMission, DeptId } from './TaskDecomposer.js';

export type DeptStatus = 'idle' | 'working' | 'done' | 'error';

export interface DeptResult {
  deptId: DeptId;
  status: DeptStatus;
  report?: DeptReport;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  aiModel?: string;
  connectorsUsed?: string[];
}

export interface DeptStructuredOutput {
  summary: string;
  keyFindings: string[];
  risks: string[];
  assumptions: string[];
  needsFollowup: string[];
  confidence: number;
  citations?: string[];
}

export interface DeptReport {
  title: string;
  sections: Array<{
    heading: string;
    items: string[];
  }>;
  confidence: number;  // 0-1
  sources?: string[];
  structured?: DeptStructuredOutput;
}

export interface ProjectRound {
  roundNumber: number;
  mission: DecomposedMission;
  deptResults: Map<DeptId, DeptResult>;
  startedAt: Date;
  completedAt?: Date;
  allDone: boolean;
}

export interface ProjectSession {
  sessionId: string;
  projectName: string;
  userId: string;
  rounds: ProjectRound[];
  currentRound: number;
  createdAt: Date;
  lastActiveAt: Date;
}

// In-memory session store (실제 배포시 Redis 또는 SQLite로 교체)
const sessions = new Map<string, ProjectSession>();

export function createSession(projectName: string, userId: string, externalId?: string): ProjectSession {
  const sessionId = externalId ?? `SESSION-${Date.now()}`;
  const session: ProjectSession = {
    sessionId,
    projectName,
    userId,
    rounds: [],
    currentRound: 0,
    createdAt: new Date(),
    lastActiveAt: new Date(),
  };
  sessions.set(sessionId, session);
  return session;
}

export function getSession(sessionId: string): ProjectSession | undefined {
  return sessions.get(sessionId);
}

/** 세션이 없으면 자동 생성하여 반환 */
export function getOrCreateSession(sessionId: string, projectName: string, userId: string): ProjectSession {
  const existing = sessions.get(sessionId);
  if (existing) {
    existing.lastActiveAt = new Date();
    return existing;
  }
  return createSession(projectName, userId, sessionId);
}

export function startRound(session: ProjectSession, mission: DecomposedMission): ProjectRound {
  const round: ProjectRound = {
    roundNumber: session.rounds.length + 1,
    mission,
    deptResults: new Map(),
    startedAt: new Date(),
    allDone: false,
  };

  // Initialize all dept results as idle
  for (const task of mission.tasks) {
    round.deptResults.set(task.deptId, {
      deptId: task.deptId,
      status: 'idle',
    });
  }

  session.rounds.push(round);
  session.currentRound = round.roundNumber;
  session.lastActiveAt = new Date();
  return round;
}

export function updateDeptStatus(
  session: ProjectSession,
  roundNumber: number,
  deptId: DeptId,
  update: Partial<DeptResult>
): void {
  const round = session.rounds[roundNumber - 1];
  if (!round) return;

  const existing = round.deptResults.get(deptId) || { deptId, status: 'idle' as DeptStatus };
  round.deptResults.set(deptId, { ...existing, ...update });
  session.lastActiveAt = new Date();

  // Check if all done
  const allDone = Array.from(round.deptResults.values()).every(r => r.status === 'done' || r.status === 'error');
  if (allDone) {
    round.allDone = true;
    round.completedAt = new Date();
  }
}

export function getCurrentRound(session: ProjectSession): ProjectRound | undefined {
  return session.rounds[session.currentRound - 1];
}

export function serializeRound(round: ProjectRound): object {
  return {
    roundNumber: round.roundNumber,
    mission: round.mission,
    deptResults: Object.fromEntries(round.deptResults),
    startedAt: round.startedAt,
    completedAt: round.completedAt,
    allDone: round.allDone,
  };
}
