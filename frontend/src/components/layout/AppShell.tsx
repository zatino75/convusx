import { useCallback, useRef, useState, type ReactNode } from "react";

type Props = {
  sidebar: ReactNode;
  topbar: ReactNode;
  main: ReactNode;
  artifact?: ReactNode;
  showPanel?: boolean;
  onTogglePanel?: () => void;
};

export default function AppShell({ sidebar, topbar, main, artifact, showPanel = true, onTogglePanel }: Props) {
  const [panelWidth, setPanelWidth] = useState(380);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: panelWidth };

    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return;
      const delta = dragRef.current.startX - ev.clientX;
      const next = Math.min(600, Math.max(0, dragRef.current.startW + delta));
      setPanelWidth(next);
    }

    function onUp() {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [panelWidth]);

  const hasPanel = Boolean(artifact) && showPanel;

  return (
    <div className={"app-shell" + (hasPanel ? " app-shell--with-artifact" : "")}>
      {/* 사이드바 닫혔을 때 열기 버튼 */}
      {!sidebarOpen && (
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          title="사이드바 열기"
          style={{
            position: "fixed",
            left: 0,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 100,
            width: 20,
            height: 48,
            border: "1px solid var(--border)",
            borderLeft: "none",
            borderRadius: "0 6px 6px 0",
            background: "var(--bg-surface, #fff)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-sub)",
            padding: 0
          }}
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>
      )}
      <aside
        className={"app-shell__sidebar" + (sidebarOpen ? "" : " is-collapsed")}
        style={{ position: "relative" }}
      >
        {/* 사이드바 닫기 버튼 */}
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          title="사이드바 닫기"
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 10,
            width: 28,
            height: 28,
            border: "1px solid var(--border)",
            borderRadius: "6px",
            background: "transparent",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-sub)",
            padding: 0,
            fontSize: 14
          }}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        {sidebar}
      </aside>

      <main className="app-shell__main">
        <div className="app-shell__topbar">{topbar}</div>
        <div className="app-shell__body">
          <section className="app-shell__content">{main}</section>

          {artifact && (
            <>
              {/* 드래그 핸들 */}
              {showPanel && (
                <div
                  onMouseDown={onMouseDown}
                  style={{
                    width: 5,
                    cursor: "col-resize",
                    background: "transparent",
                    flexShrink: 0,
                    position: "relative",
                    zIndex: 10,
                    transition: "background 0.15s"
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--border)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  title="드래그하여 너비 조절"
                />
              )}

              {/* 패널 토글 탭 버튼 */}
              <button
                type="button"
                onClick={onTogglePanel}
                title={showPanel ? "패널 닫기" : "패널 열기"}
                style={{
                  position: "absolute",
                  right: showPanel ? panelWidth - 1 : 0,
                  top: "50%",
                  transform: "translateY(-50%)",
                  zIndex: 20,
                  width: 20,
                  height: 48,
                  border: "1px solid var(--border)",
                  borderRight: showPanel ? "none" : "1px solid var(--border)",
                  borderLeft: showPanel ? "1px solid var(--border)" : "none",
                  borderRadius: showPanel ? "6px 0 0 6px" : "0 6px 6px 0",
                  background: "var(--bg-surface, #fff)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-sub)",
                  padding: 0
                }}
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
                  {showPanel
                    ? <path d="m9 6 6 6-6 6" />
                    : <path d="m15 6-6 6 6 6" />}
                </svg>
              </button>

              {/* 패널 본체 */}
              <aside
                className="app-shell__artifact"
                style={{
                  width: showPanel ? panelWidth : 0,
                  minWidth: 0,
                  overflow: "hidden",
                  transition: "width 0.2s ease",
                  flexShrink: 0
                }}
              >
                {showPanel && artifact}
              </aside>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
