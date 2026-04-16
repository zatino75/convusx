/**
 * director.ts — CORVUS X 디렉터 에이전트 HTTP/WebSocket 라우트
 *
 * POST /api/director/start
 *   Body: { directive: string, sessionId?: string, projectName?: string, connectors?: string[] }
 *   → 동기 응답 (세션ID + 완료 결과 반환)
 *
 * GET /api/director/session/:sessionId 또는 /api/director/session?sessionId=...
 *   → 세션 현재 상태 조회
 *
 * GET /api/director/connectors
 *   → 사용 가능한 커넥터 목록 반환
 *
 * WebSocket 실시간 이벤트는 기존 /ws 엔드포인트로 전달됨
 */

import { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody } from '../http/middleware.js';
import { runDirectorSync } from '../director/DirectorAgent.js';
import { getSession, serializeRound } from '../director/ProjectSession.js';
import { pluginManager } from '../plugins/pluginManager.js';
import { broadcast } from '../http/websocket.js';
import { logger } from '../observability/logger.js';
import { loadCeoBriefing } from '../memory/sqliteMemory.js';

// ─── POST /api/director/start ─────────────────────────────────────────────────
export async function directorStartRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readJsonBody(req) as any;
    const directive = String(body?.directive ?? '').trim();
    if (!directive) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '지시사항(directive)이 필요합니다' }));
      return;
    }

    const sessionId = body?.sessionId as string | undefined;
    const projectName = String(body?.projectName ?? '신규 프로젝트');
    const connectors = Array.isArray(body?.connectors) ? body.connectors : [];

    logger.info({ directive: directive.slice(0, 100), sessionId }, '[Director] 미션 시작');

    // WebSocket 브로드캐스트 래퍼
    const onEvent = (event: any) => {
      try {
        broadcast('director:event', event);
      } catch { /* ignore */ }
    };

    const result = await runDirectorSync(directive, {
      sessionId,
      projectName,
      userId: (req as any).userId ?? 'anonymous',
      availableConnectors: connectors,
      onEvent,
    });

    logger.info({ sessionId: result.sessionId, roundNumber: result.roundNumber }, '[Director] 미션 완료');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      sessionId: result.sessionId,
      roundNumber: result.roundNumber,
      round: result.round,
      critic: result.critic,
      briefing: result.briefing,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : '알 수 없는 오류';
    logger.error({ err }, '[Director] 미션 실패');
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: msg }));
  }
}

// ─── GET /api/director/session/:sessionId ────────────────────────────────────
export async function directorSessionRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathParts = url.pathname.split('/').filter(Boolean);
  const fromPath = pathParts[3] ?? '';
  const fromQuery = url.searchParams.get('sessionId')?.trim() ?? '';
  const sessionId = (fromPath || fromQuery).trim();

  if (!sessionId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'sessionId가 필요합니다' }));
    return;
  }

  const session = getSession(sessionId);

  if (!session) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '세션 없음' }));
    return;
  }

  const currentRound = session.rounds[session.currentRound - 1];
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    sessionId: session.sessionId,
    projectName: session.projectName,
    currentRound: session.currentRound,
    totalRounds: session.rounds.length,
    lastActiveAt: session.lastActiveAt,
    currentRoundData: currentRound ? serializeRound(currentRound) : null,
  }));
}

// ─── GET /api/director/briefing/:sessionId/:round ────────────────────────────
// CEO 브리핑 조회 — sqliteMemory에서 저장된 브리핑을 불러와 반환
export async function directorBriefingRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = req.url ?? '';
    // 경로: /api/director/briefing/:sessionId/:round
    const pathname = url.split('?')[0];
    const parts = pathname.split('/').filter(Boolean);
    // ['api','director','briefing',':sessionId',':round']
    const sessionId = parts[3] ?? '';
    const roundStr = parts[4] ?? '';
    const roundNumber = parseInt(roundStr, 10);

    if (!sessionId || !Number.isFinite(roundNumber) || roundNumber <= 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'sessionId와 round(정수)가 필요합니다' }));
      return;
    }

    const briefing = await loadCeoBriefing(sessionId, roundNumber);
    if (!briefing) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: '해당 브리핑을 찾을 수 없습니다' }));
      return;
    }

    // briefing은 문자열(JSON)으로 저장되어 있을 수 있음 — JSON 파싱 시도
    let parsed: any = briefing;
    if (typeof briefing === 'string') {
      try {
        parsed = JSON.parse(briefing);
      } catch {
        parsed = { raw: briefing };
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, sessionId, round: roundNumber, briefing: parsed }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : '알 수 없는 오류';
    logger.error({ err }, '[Director] 브리핑 조회 실패');
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: msg }));
  }
}

// ─── GET /api/director/connectors ────────────────────────────────────────────
export async function directorConnectorsRoute(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const summary = await pluginManager.getSummary();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ connectors: summary }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '커넥터 목록 조회 실패' }));
  }
}

