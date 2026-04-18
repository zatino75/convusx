/**
 * directorStream.ts — CORVUS X 디렉터 SSE 스트리밍 라우트
 *
 * GET /api/director/stream?directive=...&sessionId=...&projectName=...
 *   → Server-Sent Events 스트림 (text/event-stream)
 *   → 이벤트: mission_start / pmo_plan / dept_* / critic_review / ceo_briefing / all_done / error
 *
 * POST /api/director/stream
 *   Body: { directive, sessionId?, projectName?, connectors? }
 *   → 동일한 SSE 스트림 (POST body로 긴 지시 전달 가능)
 */

import { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody } from '../http/middleware.js';
import { runDirector } from '../director/DirectorAgent.js';
import { logger } from '../observability/logger.js';
import { registerSseClient } from '../http/sseRegistry.js';

// ─── SSE 헬퍼 ─────────────────────────────────────────────────────────────────

function sseWrite(res: ServerResponse, event: string, data: unknown) {
  const json = JSON.stringify(data);
  res.write(`event: ${event}\ndata: ${json}\n\n`);
}

function sseError(res: ServerResponse, message: string) {
  sseWrite(res, 'error', { message });
  res.end();
}

function setupSseHeaders(res: ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',          // nginx 버퍼링 비활성화
    'Access-Control-Allow-Origin': '*',
  });
  // 즉시 플러시 (헤더 전송)
  res.write(':ok\n\n');
}

// ─── GET /api/director/stream ─────────────────────────────────────────────────
export async function directorStreamGetRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost`);
  const directive = url.searchParams.get('directive')?.trim() ?? '';
  const sessionId = url.searchParams.get('sessionId') ?? undefined;
  const projectName = url.searchParams.get('projectName') ?? '신규 프로젝트';
  const connectorsParam = url.searchParams.get('connectors') ?? '';
  const connectors = connectorsParam ? connectorsParam.split(',').filter(Boolean) : [];

  if (!directive) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '지시사항(directive)이 필요합니다' }));
    return;
  }

  await _handleStream(req, res, { directive, sessionId, projectName, connectors });
}

// ─── POST /api/director/stream ────────────────────────────────────────────────
export async function directorStreamPostRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
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

    await _handleStream(req, res, { directive, sessionId, projectName, connectors });
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '요청 파싱 실패' }));
    }
  }
}

// ─── 핵심 스트림 핸들러 ───────────────────────────────────────────────────────
async function _handleStream(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    directive: string;
    sessionId?: string;
    projectName: string;
    connectors: string[];
  }
) {
  const { directive, sessionId, projectName, connectors } = opts;

  setupSseHeaders(res);
  logger.info({ directive: directive.slice(0, 100), sessionId }, '[DirectorStream] 미션 시작');

  // 클라이언트 연결 종료 감지
  let clientDisconnected = false;
  req.on('close', () => {
    clientDisconnected = true;
    logger.info('[DirectorStream] 클라이언트 연결 종료');
  });

  // ─ SSE 레지스트리 등록 — 같은 sessionId 재연결 시 기존 연결 자동 종료 ─
  // sessionId 가 없으면 임시 키 부여 (중복 등록 방지)
  const sseKey = sessionId ?? `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sseHandle = registerSseClient('director', sseKey, res, req);

  // sseRegistry 가 자체 25s heartbeat 를 갖지만, director 는 더 보수적으로 30s 추가
  const heartbeatTimer = setInterval(() => {
    if (!res.destroyed) {
      res.write(':heartbeat\n\n');
    }
  }, 30_000);

  try {
    await runDirector(directive, {
      sessionId,
      projectName,
      userId: (req as any).userId ?? 'anonymous',
      availableConnectors: connectors,
      onEvent: (event: any) => {
        if (clientDisconnected || res.destroyed) return;
        try {
          sseWrite(res, event.type ?? 'director_event', event);
        } catch (e) {
          logger.warn('[DirectorStream] SSE write 실패', e);
        }
      },
    });

    if (!clientDisconnected && !res.destroyed) {
      // 완료 신호
      sseWrite(res, 'stream_end', { ok: true, timestamp: new Date().toISOString() });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '알 수 없는 오류';
    logger.error({ err }, '[DirectorStream] 미션 실패');
    if (!clientDisconnected && !res.destroyed) {
      sseError(res, msg);
      return;
    }
  } finally {
    clearInterval(heartbeatTimer);
    sseHandle.close();
    if (!res.destroyed) res.end();
  }
}

// ─── CORS Preflight ────────────────────────────────────────────────────────────
export function directorStreamOptionsRoute(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  });
  res.end();
}
