// ── Correlation ID 미들웨어 ──
// 모든 요청에 고유 ID를 부여하여 로그 추적을 가능하게 함

import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"

const store = new AsyncLocalStorage<string>()

/** 현재 요청의 correlation ID 반환 (없으면 "unknown") */
export function getCorrelationId(): string {
  return store.getStore() ?? "unknown"
}

/**
 * 요청 처리를 correlation ID 컨텍스트 내에서 실행.
 * X-Correlation-Id 헤더가 있으면 재사용, 없으면 새로 생성.
 * 응답 헤더에도 자동 추가.
 */
export function withCorrelationId(
  req: IncomingMessage,
  res: ServerResponse,
  fn: () => Promise<void>
): Promise<void> {
  const incoming = String(req.headers["x-correlation-id"] ?? "").trim()
  const id = incoming || randomUUID()
  res.setHeader("X-Correlation-Id", id)
  return store.run(id, fn)
}
