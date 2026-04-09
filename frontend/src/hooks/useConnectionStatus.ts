import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api/url";

export type ConnectionState = "online" | "offline" | "reconnecting";

const HEALTH_INTERVAL_MS = 30_000; // 30초 주기
const RECONNECT_INTERVAL_MS = 5_000; // 오프라인 시 5초 주기

/**
 * 서버 /api/health 엔드포인트를 주기적으로 체크하여 연결 상태를 반환.
 * - online: 정상
 * - offline: 서버 응답 없음 (처음 감지)
 * - reconnecting: offline 후 재시도 중
 *
 * C5: navigator.onLine 이벤트와 통합하여 브라우저 레벨 오프라인도 감지.
 */
export function useConnectionStatus(): ConnectionState {
  const [status, setStatus] = useState<ConnectionState>(
    typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "online"
  );
  const failCountRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let mounted = true;

    async function checkHealth() {
      // 브라우저가 오프라인이면 서버 체크 스킵
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        failCountRef.current = 2;
        if (mounted) setStatus("offline");
        return;
      }

      try {
        const res = await apiFetch("/api/health", {
          method: "GET",
          signal: AbortSignal.timeout(5000),
        });
        if (!mounted) return;
        if (res.ok) {
          failCountRef.current = 0;
          setStatus("online");
        } else {
          failCountRef.current += 1;
          setStatus(failCountRef.current >= 2 ? "offline" : "reconnecting");
        }
      } catch {
        if (!mounted) return;
        failCountRef.current += 1;
        setStatus(failCountRef.current >= 2 ? "offline" : "reconnecting");
      }
    }

    function startPolling() {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        checkHealth();
      }, status === "online" ? HEALTH_INTERVAL_MS : RECONNECT_INTERVAL_MS);
    }

    // 브라우저 online/offline 이벤트 리스너 (C5)
    function handleOnline() {
      // 브라우저가 온라인 복귀 → 즉시 서버 체크
      failCountRef.current = 0;
      if (mounted) setStatus("reconnecting");
      checkHealth();
    }

    function handleOffline() {
      failCountRef.current = 2;
      if (mounted) setStatus("offline");
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // 초기 체크
    checkHealth();
    startPolling();

    return () => {
      mounted = false;
      if (timerRef.current) clearInterval(timerRef.current);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  // status가 변경되면 polling 간격 재설정
  }, [status]);

  return status;
}
