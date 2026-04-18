/**
 * OfficeView.tsx — Director Multi-Agent Pixel Office iframe wrapper
 *
 * /corvusx-office.html 정적 페이지를 iframe 으로 임베드.
 * postMessage 로 office.html → AppShell 진행 상태 동기화.
 */

import { useEffect, useRef } from "react";

export type OfficeProgressEvent =
  | { type: "progress"; done: number; total: number }
  | { type: "directorDone"; total: number }
  | { type: "missionStart"; topic: string };

interface Props {
  /** 부서 진행 상태 변경 콜백 (Topbar 표시용) */
  onProgress?: (e: OfficeProgressEvent) => void;
}

export default function OfficeView({ onProgress }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      // 보안: same-origin 만 허용 (app.cloudcookie.co.kr / localhost 둘 다)
      try {
        const url = new URL(event.origin);
        const here = new URL(window.location.href);
        if (url.host !== here.host) return;
      } catch {
        return;
      }
      const data = event?.data;
      if (!data || typeof data !== "object") return;
      const t = (data as any).type as string;
      if (t === "progress" || t === "directorDone" || t === "missionStart") {
        onProgress?.(data as OfficeProgressEvent);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onProgress]);

  return (
    <iframe
      ref={iframeRef}
      src="/corvusx-office.html"
      title="CORVUS X Director Office"
      allow="clipboard-write"
      style={{
        width: "100%",
        height: "100%",
        border: "none",
        display: "block",
        background: "#1a1a2e",
      }}
    />
  );
}
