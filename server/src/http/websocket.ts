/**
 * CORVUS X — WebSocket Real-time Notifications (B4)
 *
 * 순수 Node.js WebSocket 서버 (외부 라이브러리 없음).
 * HTTP 서버의 'upgrade' 이벤트를 이용해 WS 연결 처리.
 *
 * 지원 이벤트:
 *  - provider:health  — Provider 상태 변경 알림
 *  - benchmark:done   — 벤치마크 완료 알림
 *  - scheduler:status — 스케줄러 작업 완료 알림
 *  - system:info      — 시스템 알림 (서버 재시작, 유지보수 등)
 */

import { createHash } from "node:crypto"
import type { IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import { logger } from "../observability/logger.js"

// ── 타입 ──

export type WsEventType =
  | "provider:health"
  | "benchmark:done"
  | "scheduler:status"
  | "system:info"
  | "director:event"
  | "dept:levelup"

interface WsMessage {
  event: WsEventType
  data: unknown
  timestamp: string
}

// ── 클라이언트 관리 ──

const clients = new Set<Duplex>()
const PING_INTERVAL_MS = 30_000
let pingTimer: ReturnType<typeof setInterval> | null = null

export function getConnectedClients(): number {
  return clients.size
}

// ── WebSocket 프레임 유틸 ──

function encodeFrame(data: string): Buffer {
  const payload = Buffer.from(data, "utf-8")
  const length = payload.length

  let header: Buffer
  if (length < 126) {
    header = Buffer.alloc(2)
    header[0] = 0x81 // FIN + TEXT
    header[1] = length
  } else if (length < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x81
    header[1] = 127
    header.writeBigUInt64BE(BigInt(length), 2)
  }

  return Buffer.concat([header, payload])
}

function encodePingFrame(): Buffer {
  const header = Buffer.alloc(2)
  header[0] = 0x89 // FIN + PING
  header[1] = 0
  return header
}

// ── 핸드셰이크 ──

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

function computeAcceptKey(key: string): string {
  return createHash("sha1").update(key + WS_MAGIC).digest("base64")
}

// ── upgrade 핸들러 ──

export function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  const wsKey = req.headers["sec-websocket-key"]
  if (!wsKey) {
    socket.destroy()
    return
  }

  // URL 경로 체크 — /ws 만 허용
  const path = (req.url ?? "").split("?")[0]
  if (path !== "/ws") {
    socket.destroy()
    return
  }

  const acceptKey = computeAcceptKey(wsKey)

  const responseHeaders = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${acceptKey}`,
    "",
    ""
  ].join("\r\n")

  socket.write(responseHeaders)

  // head 버퍼에 초기 데이터가 있을 수 있음
  if (head.length > 0) {
    // 초기 프레임은 무시 (클라이언트 → 서버 메시지 수신 불필요)
  }

  clients.add(socket)
  logger.info("[WS] client connected", { total: clients.size })

  // 연결 환영 메시지
  const welcome: WsMessage = {
    event: "system:info",
    data: { message: "connected to CORVUS X WebSocket" },
    timestamp: new Date().toISOString()
  }
  safeSend(socket, JSON.stringify(welcome))

  socket.on("close", () => {
    clients.delete(socket)
    logger.info("[WS] client disconnected", { total: clients.size })
  })

  socket.on("error", () => {
    clients.delete(socket)
  })
}

// ── 브로드캐스트 ──

function safeSend(socket: Duplex, data: string) {
  try {
    if (!socket.destroyed) {
      socket.write(encodeFrame(data))
    }
  } catch {
    clients.delete(socket)
  }
}

export function broadcast(event: WsEventType, data: unknown) {
  const msg = {
    event,
    type: event,  // 프론트엔드 useWebSocket 호환 (type 필드)
    data,
    payload: data, // 프론트엔드 useWebSocket 호환 (payload 필드)
    timestamp: new Date().toISOString()
  }
  const payload = JSON.stringify(msg)

  for (const socket of clients) {
    safeSend(socket, payload)
  }
}

// ── Keep-alive Ping ──

export function startWsPing() {
  if (pingTimer) return
  pingTimer = setInterval(() => {
    const frame = encodePingFrame()
    for (const socket of clients) {
      try {
        if (!socket.destroyed) socket.write(frame)
        else clients.delete(socket)
      } catch {
        clients.delete(socket)
      }
    }
  }, PING_INTERVAL_MS)
  pingTimer.unref()
}

export function stopWsPing() {
  if (pingTimer) {
    clearInterval(pingTimer)
    pingTimer = null
  }
}

// ── 클린업 ──

export function closeAllClients() {
  stopWsPing()
  for (const socket of clients) {
    try {
      const closeFrame = Buffer.alloc(4)
      closeFrame[0] = 0x88 // FIN + CLOSE
      closeFrame[1] = 2
      closeFrame.writeUInt16BE(1001, 2) // Going Away
      socket.write(closeFrame)
      socket.end()
    } catch { /* ignore */ }
  }
  clients.clear()
}
