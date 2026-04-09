/**
 * CORVUS X — Offline Queue Hook
 *
 * 서버 오프라인 상태에서 사용자 액션을 큐에 저장하고
 * 온라인 복귀 시 자동 재시도.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionState } from "./useConnectionStatus";

export type QueuedAction = {
  id: string;
  type: "chat" | "feedback" | "workspace";
  payload: unknown;
  createdAt: string;
  retryCount: number;
};

type OfflineQueueOptions = {
  connectionStatus: ConnectionState;
  /** 큐 처리 함수 — 성공 시 true 반환 */
  processAction: (action: QueuedAction) => Promise<boolean>;
  /** 최대 재시도 횟수 */
  maxRetries?: number;
};

export function useOfflineQueue({ connectionStatus, processAction, maxRetries = 3 }: OfflineQueueOptions) {
  const [queue, setQueue] = useState<QueuedAction[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);

  const enqueue = useCallback((type: QueuedAction["type"], payload: unknown) => {
    const action: QueuedAction = {
      id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      payload,
      createdAt: new Date().toISOString(),
      retryCount: 0,
    };
    setQueue(prev => [...prev, action]);
    return action.id;
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    setQueue(prev => prev.filter(a => a.id !== id));
  }, []);

  const clearQueue = useCallback(() => {
    setQueue([]);
  }, []);

  // 온라인 복귀 시 큐 처리
  useEffect(() => {
    if (connectionStatus !== "online" || queue.length === 0 || processingRef.current) return;

    async function processQueue() {
      processingRef.current = true;
      setIsProcessing(true);

      const currentQueue = [...queue];
      const failed: QueuedAction[] = [];

      for (const action of currentQueue) {
        try {
          const success = await processAction(action);
          if (!success && action.retryCount < maxRetries) {
            failed.push({ ...action, retryCount: action.retryCount + 1 });
          }
          // maxRetries 초과 시 자동 제거
        } catch {
          if (action.retryCount < maxRetries) {
            failed.push({ ...action, retryCount: action.retryCount + 1 });
          }
        }
      }

      setQueue(failed);
      processingRef.current = false;
      setIsProcessing(false);
    }

    processQueue();
  }, [connectionStatus, queue, processAction, maxRetries]);

  return {
    queue,
    queueLength: queue.length,
    isProcessing,
    enqueue,
    removeFromQueue,
    clearQueue,
    isOffline: connectionStatus === "offline",
  };
}
