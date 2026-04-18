/**
 * useThreadSSE.ts — 스레드별 독립 SSE 연결 관리 훅
 *
 * 목적:
 *  - 채팅 fetch-stream 또는 EventSource 를 threadId 별로 분리해 추적/취소
 *  - 스레드 전환 시 이전 연결을 background 로 유지 (활성 ≤ MAX_CONCURRENT)
 *  - 컴포넌트 언마운트 시 disconnectAll
 *
 * 사용:
 *  const { connect, disconnect, disconnectAll, isConnected } = useThreadSSE();
 *  const ctrl = connect(threadId);                  // AbortController 반환
 *  fetch('/api/chat/stream', { signal: ctrl.signal, ... });
 *  // 또는 EventSource:
 *  const handle = connectEventSource(threadId, '/api/director/stream?sessionId=' + threadId);
 *
 * 백엔드 sseRegistry 와 페어 — 같은 threadId 키로 새 연결 시 이전 연결을 자동 종료.
 */

import { useCallback, useEffect, useRef } from "react";

const MAX_CONCURRENT = 3;

interface ConnEntry {
  threadId: string;
  controller: AbortController;
  eventSource?: EventSource;
  startedAt: number;
}

// 모듈 수준 싱글톤 — 모든 useThreadSSE 인스턴스가 같은 Map 을 공유한다.
const _connections = new Map<string, ConnEntry>();
const _subscribers = new Set<() => void>();

function notify() {
  _subscribers.forEach((fn) => fn());
}

function evictOldestIfNeeded() {
  if (_connections.size <= MAX_CONCURRENT) return;
  let oldestKey: string | null = null;
  let oldestTime = Infinity;
  for (const [k, v] of _connections.entries()) {
    if (v.startedAt < oldestTime) { oldestTime = v.startedAt; oldestKey = k; }
  }
  if (oldestKey) closeConn(oldestKey, "evicted_for_max_concurrent");
}

function closeConn(threadId: string, _reason: string) {
  const entry = _connections.get(threadId);
  if (!entry) return;
  try { entry.controller.abort(); } catch { /* ignore */ }
  try { entry.eventSource?.close(); } catch { /* ignore */ }
  _connections.delete(threadId);
  notify();
}

export function useThreadSSE() {
  const ownedRef = useRef<Set<string>>(new Set());

  /** 새 fetch-stream 용 AbortController. 같은 threadId 가 있으면 기존 abort 후 교체. */
  const connect = useCallback((threadId: string): AbortController => {
    if (!threadId) {
      // threadId 없으면 익명 — 캘리는 단발성으로 처리
      return new AbortController();
    }
    closeConn(threadId, "replaced_by_new_connect");
    const controller = new AbortController();
    _connections.set(threadId, { threadId, controller, startedAt: Date.now() });
    ownedRef.current.add(threadId);
    evictOldestIfNeeded();
    notify();
    return controller;
  }, []);

  /** EventSource 연결 (Director SSE 같은 GET 스트림). same threadId 재진입 시 이전 close 후 재생성. */
  const connectEventSource = useCallback((threadId: string, url: string): EventSource | null => {
    if (!threadId || typeof window === "undefined") return null;
    closeConn(threadId, "replaced_by_new_eventsource");
    try {
      const es = new EventSource(url, { withCredentials: true });
      const controller = new AbortController();
      _connections.set(threadId, { threadId, controller, eventSource: es, startedAt: Date.now() });
      ownedRef.current.add(threadId);
      evictOldestIfNeeded();
      notify();
      return es;
    } catch {
      return null;
    }
  }, []);

  const disconnect = useCallback((threadId: string) => {
    closeConn(threadId, "explicit_disconnect");
    ownedRef.current.delete(threadId);
  }, []);

  const disconnectAll = useCallback(() => {
    for (const k of [..._connections.keys()]) closeConn(k, "disconnect_all");
    ownedRef.current.clear();
  }, []);

  const isConnected = useCallback((threadId: string): boolean => {
    return _connections.has(threadId);
  }, []);

  // 컴포넌트 언마운트 시 — 이 인스턴스가 직접 만든 연결만 정리 (다른 컴포넌트 공유 가능성 고려해 전체 close 안 함)
  useEffect(() => {
    return () => {
      for (const tid of [...ownedRef.current]) closeConn(tid, "component_unmount");
      ownedRef.current.clear();
    };
  }, []);

  return { connect, connectEventSource, disconnect, disconnectAll, isConnected };
}

/** 외부 모듈에서도 활성 스레드 목록을 조회할 수 있게 노출 */
export function getActiveStreamingThreads(): string[] {
  return [..._connections.keys()];
}
