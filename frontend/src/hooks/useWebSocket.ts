/**
 * CORVUS X — WebSocket Frontend Hook
 *
 * 서버의 ws://localhost:PORT/ws 엔드포인트에 연결하여
 * 실시간 이벤트를 프론트엔드에 전달.
 *
 * 이벤트 타입:
 *  - provider:health  — 프로바이더 상태 변경
 *  - benchmark:done   — 벤치마크 완료
 *  - scheduler:status — 스케줄러 상태 알림
 *  - system:info      — 시스템 알림
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type WsEventType = "provider:health" | "benchmark:done" | "scheduler:status" | "system:info";

export interface WsMessage {
  type: WsEventType;
  payload: Record<string, unknown>;
  timestamp: string;
}

type WsStatus = "connecting" | "connected" | "disconnected";

type UseWebSocketOptions = {
  /** 서버 포트 (기본 8000) */
  port?: number;
  /** 자동 연결 여부 (기본 true) */
  autoConnect?: boolean;
  /** 이벤트 콜백 */
  onEvent?: (message: WsMessage) => void;
  /** 재연결 딜레이 ms (기본 3000) */
  reconnectDelay?: number;
  /** 최대 재연결 시도 횟수 (기본 10) */
  maxReconnectAttempts?: number;
};

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    port = 8000,
    autoConnect = true,
    onEvent,
    reconnectDelay = 3000,
    maxReconnectAttempts = 10,
  } = options;

  const [status, setStatus] = useState<WsStatus>("disconnected");
  const [lastEvent, setLastEvent] = useState<WsMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    // 이미 연결 중이거나 연결됨 → 무시
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.hostname || "localhost";
    const url = `${protocol}//${host}:${port}/ws`;

    setStatus("connecting");

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setStatus("connected");
        reconnectCountRef.current = 0;
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const data = JSON.parse(String(event.data)) as WsMessage;
          if (data.type && data.payload) {
            setLastEvent(data);
            onEventRef.current?.(data);
          }
        } catch {
          // JSON 파싱 실패 무시 (ping 등)
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        wsRef.current = null;
        setStatus("disconnected");

        // 자동 재연결
        if (reconnectCountRef.current < maxReconnectAttempts) {
          reconnectCountRef.current += 1;
          reconnectTimerRef.current = setTimeout(() => {
            if (mountedRef.current) connect();
          }, reconnectDelay);
        }
      };

      ws.onerror = () => {
        // onclose에서 재연결 처리하므로 여기서는 무시
        ws.close();
      };
    } catch {
      setStatus("disconnected");
    }
  }, [port, reconnectDelay, maxReconnectAttempts]);

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectCountRef.current = maxReconnectAttempts; // 재연결 방지
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus("disconnected");
  }, [maxReconnectAttempts]);

  useEffect(() => {
    mountedRef.current = true;
    if (autoConnect) connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [autoConnect, connect]);

  return {
    status,
    lastEvent,
    connect,
    disconnect,
    isConnected: status === "connected",
  };
}
