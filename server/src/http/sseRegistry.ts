/**
 * sseRegistry.ts — 스레드/세션 키 기반 SSE 연결 관리자
 *
 * 목적:
 *  - 같은 키로 새 연결이 오면 기존 연결을 끊고 교체 (좀비 방지)
 *  - 25s heartbeat 로 nginx idle 60s 타임아웃 회피
 *  - close 이벤트에서 자동 해제 (메모리 누수 방지)
 *
 * 사용:
 *  const handle = registerSseClient(threadId, res, abortController);
 *  // ... writeSse(res, ...) 호출은 기존대로
 *  // close 시 자동 해제됨. 명시적으로 끊고 싶으면 handle.close() 호출.
 */

import type { ServerResponse, IncomingMessage } from "node:http";
import { logger } from "../observability/logger.js";

const HEARTBEAT_INTERVAL_MS = 25000;

interface SseClientEntry {
  key: string;
  res: ServerResponse;
  heartbeat: ReturnType<typeof setInterval>;
  abortController?: AbortController;
  startedAt: number;
}

type Scope = "chat" | "director";

const clients: Record<Scope, Map<string, SseClientEntry>> = {
  chat: new Map(),
  director: new Map(),
};

function dropClient(scope: Scope, key: string, reason: string) {
  const entry = clients[scope].get(key);
  if (!entry) return;
  clearInterval(entry.heartbeat);
  try { entry.abortController?.abort(); } catch { /* ignore */ }
  try { entry.res.end?.(); } catch { /* ignore */ }
  clients[scope].delete(key);
  logger.info(
    { scope, key, age_ms: Date.now() - entry.startedAt, reason },
    "[sseRegistry] client released"
  );
}

export interface SseHandle {
  /** 명시적으로 연결을 끊는다 (정상 완료 시 호출). 내부 close 이벤트에서도 자동 호출됨. */
  close: () => void;
  /** 현재 키로 활성 상태인지 */
  isActive: () => boolean;
}

/**
 * 새 SSE 연결을 등록한다.
 * 같은 (scope, key) 가 이미 있으면 기존 연결을 끊고 교체한다.
 *
 * @returns SseHandle — close() 호출로 명시적 해제 가능
 */
export function registerSseClient(
  scope: Scope,
  key: string,
  res: ServerResponse,
  req?: IncomingMessage,
  abortController?: AbortController,
): SseHandle {
  // 기존 연결이 있으면 강제 종료
  if (clients[scope].has(key)) {
    dropClient(scope, key, "replaced_by_new_connection");
  }

  const heartbeat = setInterval(() => {
    try {
      // SSE 주석 라인 — 클라이언트는 무시하지만 nginx idle timer 가 리셋됨
      res.write?.(": ping\n\n");
    } catch {
      dropClient(scope, key, "heartbeat_write_failed");
    }
  }, HEARTBEAT_INTERVAL_MS);

  const entry: SseClientEntry = {
    key,
    res,
    heartbeat,
    abortController,
    startedAt: Date.now(),
  };
  clients[scope].set(key, entry);

  // close 이벤트에서 자동 해제 — req 또는 res 양쪽 다 시도
  const onClose = () => dropClient(scope, key, "client_closed");
  try { req?.on?.("close", onClose); } catch { /* ignore */ }
  try { (res as any)?.on?.("close", onClose); } catch { /* ignore */ }

  logger.info({ scope, key }, "[sseRegistry] client registered");

  return {
    close: () => dropClient(scope, key, "explicit_close"),
    isActive: () => clients[scope].get(key) === entry,
  };
}

/** scope 별 활성 연결 수 (관측용) */
export function getSseClientCount(scope: Scope): number {
  return clients[scope].size;
}

/** 헬스체크/디버그용 — 모든 키 목록 */
export function listSseClients(scope: Scope): string[] {
  return [...clients[scope].keys()];
}
