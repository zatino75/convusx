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
      <aside className="app-shell__sidebar">{sidebar}</aside>

      <main className="app-shell__main">
        <div className="app-shell__topbar">{topbar}</div>
        <div className="app-shell__body" style={{ position: "relative" }}>
          <section className="app-shell__content">{main}</section>

          {artifact && (
            <>
              {showPanel && (
                <div
                  onMouseDown={onMouseDown}
                  style={{ width: 5, cursor: "col-resize", background: "transparent", flexShrink: 0, zIndex: 10 }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--border)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                />
              )}

              <button
                type="button"
                onClick={onTogglePanel}
                title={showPanel ? "패널 닫기" : "패널 열기"}
                style={{
                  position: "absolute",
                  right: showPanel ? panelWidth : 0,
                  top: "50%",
                  transform: "translateY(-50%)",
                  zIndex: 20,
                  width: 20,
                  height: 48,
                  border: "1px solid var(--border)",
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
                  {showPanel ? <path d="m9 6 6 6-6 6" /> : <path d="m15 6-6 6 6 6" />}
                </svg>
              </button>

              <aside
                className="app-shell__artifact"
                style={{ width: showPanel ? panelWidth : 0, minWidth: 0, overflow: "hidden", transition: "width 0.2s ease", flexShrink: 0 }}
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