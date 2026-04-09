import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { t } from "../../i18n";

type Props = {
  sidebar: ReactNode | ((options: { onCloseSidebar: () => void }) => ReactNode);
  topbar: ReactNode;
  main: ReactNode;
  artifact?: ReactNode;
  showPanel?: boolean;
  onTogglePanel?: () => void;
};

function HamburgerButton({ onClick, title, ariaExpanded }: { onClick: () => void; title: string; ariaExpanded?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-expanded={ariaExpanded}
      style={{
        flexShrink: 0,
        width: 44,
        height: 44,
        border: "none",
        borderRadius: 8,
        background: "transparent",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-sub)",
        padding: 0
      }}
      onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,0,0,0.06)")}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 6h18M3 12h18M3 18h18" />
      </svg>
    </button>
  );
}

export default function AppShell({ sidebar, topbar, main, artifact, showPanel = true, onTogglePanel }: Props) {
  const [panelWidth, setPanelWidth] = useState(380);
  const panelWidthRef = useRef(panelWidth);
  panelWidthRef.current = panelWidth;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  // Detect mobile viewport changes
  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 768px)");
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
    };

    // Set initial value
    setIsMobile(mediaQuery.matches);

    // Add listener
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: panelWidthRef.current };

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
  }, []);

  const hasPanel = Boolean(artifact) && showPanel;

  return (
    <div className={"app-shell" + (hasPanel ? " app-shell--with-artifact" : "")}>
      {/* Backdrop overlay for mobile */}
      {isMobile && (
        <div
          className={"sidebar-backdrop" + (sidebarOpen ? " visible" : "")}
          onClick={() => setSidebarOpen(false)}
          style={{ transition: "opacity 0.25s ease" }}
        />
      )}

      <aside
        className={"app-shell__sidebar" + ((sidebarOpen && !hasPanel) ? "" : " is-collapsed")}
        style={{ position: "relative" }}
        role="navigation"
        aria-label={t("nav.sidebar")}
      >
        {typeof sidebar === "function" ? sidebar({ onCloseSidebar: () => setSidebarOpen(false) }) : sidebar}
        <div style={{ position: "absolute", top: 8, right: 6, zIndex: 10 }}>
          <HamburgerButton onClick={() => setSidebarOpen(false)} title={t("ui.closeSidebar")} ariaExpanded={true} />
        </div>
      </aside>

      <main className="app-shell__main" role="main" aria-label={t("nav.mainContent")}>
        <header className="app-shell__topbar" role="banner">
          {!sidebarOpen && (
            <HamburgerButton onClick={() => setSidebarOpen(true)} title={t("ui.openSidebar")} ariaExpanded={false} />
          )}
          {topbar}
        </header>
        <div className="app-shell__body">
          <section className="app-shell__content" aria-label={t("nav.contentArea")}>{main}</section>

          {artifact && (
            <>
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
                  title={t("ui.dragResize")}
                />
              )}
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
