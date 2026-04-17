import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { t } from "../../i18n";
import OfficeWorld from "./OfficeWorld";

type Props = {
  sidebar: ReactNode | ((options: { onCloseSidebar: () => void }) => ReactNode);
  topbar: ReactNode;
  main: ReactNode;
  hud?: ReactNode;
  artifact?: ReactNode;
  showPanel?: boolean;
  onTogglePanel?: () => void;
  sceneMode?: "idle" | "dispatch" | "working" | "meeting";
  sceneDirective?: string;
};

const SIDEBAR_PREF_KEY = "convusx.shell.sidebar.v1";
const HUD_PREF_KEY = "convusx.shell.hud.v1";

function readBoolPreference(key: string): boolean | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  if (raw === "1") return true;
  if (raw === "0") return false;
  return null;
}

function writeBoolPreference(key: string, value: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value ? "1" : "0");
}

function MenuButton({
  onClick,
  title,
  expanded
}: {
  onClick: () => void;
  title: string;
  expanded: boolean;
}) {
  return (
    <button
      type="button"
      className="game-shell__menu-btn"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-expanded={expanded}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 6h18M3 12h18M3 18h18" />
      </svg>
    </button>
  );
}

function PanelButton({
  onClick,
  title,
  expanded
}: {
  onClick: () => void;
  title: string;
  expanded: boolean;
}) {
  return (
    <button
      type="button"
      className="game-shell__panel-btn"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-expanded={expanded}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M14 4v16" />
      </svg>
    </button>
  );
}

export default function AppShell({
  sidebar,
  topbar,
  main,
  hud,
  artifact,
  showPanel = true,
  onTogglePanel,
  sceneMode = "idle",
  sceneDirective = ""
}: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [hudOpen, setHudOpen] = useState(false);
  const [hudDocked, setHudDocked] = useState(true);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [sidebarWidth, setSidebarWidth] = useState(306);
  const [hudWidth, setHudWidth] = useState(312);
  const initializedRef = useRef(false);
  const sidebarPrefRef = useRef<boolean | null>(readBoolPreference(SIDEBAR_PREF_KEY));
  const hudPrefRef = useRef<boolean | null>(readBoolPreference(HUD_PREF_KEY));
  const sidebarRef = useRef<HTMLElement | null>(null);
  const hudRef = useRef<HTMLElement | null>(null);

  void onTogglePanel;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 980px)");
    const handleChange = (target: MediaQueryList | MediaQueryListEvent) => {
      const next = target.matches;
      setIsMobile(next);
      if (!initializedRef.current) {
        initializedRef.current = true;
        setSidebarOpen(next ? false : (sidebarPrefRef.current ?? true));
        setHudOpen(false);
        setHudDocked(hudPrefRef.current ?? true);
        return;
      }
      if (next) {
        setSidebarOpen(false);
        setHudOpen(false);
      } else {
        setSidebarOpen(sidebarPrefRef.current ?? true);
        setHudDocked(hudPrefRef.current ?? true);
      }
    };

    handleChange(mediaQuery);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    function handleResize() {
      setViewportWidth(window.innerWidth);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const sidebarEl = sidebarRef.current;
    const hudEl = hudRef.current;
    if (!sidebarEl || !hudEl || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === sidebarEl) {
          setSidebarWidth(Math.round(entry.contentRect.width));
        }
        if (entry.target === hudEl) {
          setHudWidth(Math.round(entry.contentRect.width));
        }
      }
    });

    observer.observe(sidebarEl);
    observer.observe(hudEl);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isMobile) return;
    writeBoolPreference(SIDEBAR_PREF_KEY, sidebarOpen);
    sidebarPrefRef.current = sidebarOpen;
  }, [sidebarOpen, isMobile]);

  useEffect(() => {
    if (isMobile) return;
    writeBoolPreference(HUD_PREF_KEY, hudDocked);
    hudPrefRef.current = hudDocked;
  }, [hudDocked, isMobile]);

  useEffect(() => {
    function handleLayoutShortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key === "\\") {
        event.preventDefault();
        setSidebarOpen((prev) => !prev);
        return;
      }
      if (event.key === "]" && !isMobile && hud) {
        event.preventDefault();
        setHudDocked((prev) => !prev);
      }
    }

    window.addEventListener("keydown", handleLayoutShortcut);
    return () => window.removeEventListener("keydown", handleLayoutShortcut);
  }, [isMobile, hud]);

  const renderedSidebar =
    typeof sidebar === "function"
      ? sidebar({ onCloseSidebar: () => setSidebarOpen(false) })
      : sidebar;

  const panelVisible = Boolean(artifact) && showPanel;
  const leftInsetDesktop = sidebarOpen ? 14 + sidebarWidth + 14 : 14;
  const rightInsetDesktopCollapsed = 14;
  const rightInsetDesktopExpanded = 14 + hudWidth + 12;
  const minCenterWidth = sidebarOpen ? 760 : 700;
  const centerWidthWhenHudExpanded = viewportWidth - leftInsetDesktop - rightInsetDesktopExpanded;
  const forcedHudCollapse =
    !isMobile &&
    Boolean(hud) &&
    hudDocked &&
    centerWidthWhenHudExpanded < minCenterWidth;
  const hudVisibleDesktop = Boolean(hud) && !isMobile && hudDocked && !forcedHudCollapse;
  const rightInsetDesktop = hudVisibleDesktop ? rightInsetDesktopExpanded : rightInsetDesktopCollapsed;

  const shellInsets = {
    "--shell-top": isMobile ? "66px" : "68px",
    "--shell-right": isMobile ? "8px" : `${rightInsetDesktop}px`,
    "--shell-bottom": isMobile ? "8px" : "14px",
    "--shell-left": isMobile ? "8px" : `${leftInsetDesktop}px`
  } as CSSProperties;

  return (
    <div className="game-shell" style={shellInsets}>
      <OfficeWorld mode={sceneMode} directive={sceneDirective} />
      <div className="game-shell__overlay" />

      <div className="game-shell__topbar-wrap" role="banner">
        <div className="game-shell__topbar-controls">
          <MenuButton
            onClick={() => setSidebarOpen((prev) => !prev)}
            title={`${sidebarOpen ? t("ui.closeSidebar") : t("ui.openSidebar")} (Ctrl+\\)`}
            expanded={sidebarOpen}
          />
          {!isMobile && hud ? (
            <PanelButton
              onClick={() => setHudDocked((prev) => !prev)}
              title={`${hudDocked ? "우측 패널 닫기" : "우측 패널 열기"} (Ctrl+])`}
              expanded={hudDocked && !forcedHudCollapse}
            />
          ) : null}
          {!isMobile && hud && hudDocked && forcedHudCollapse ? (
            <span className="game-shell__hud-hint" title="중앙 화면 가독성을 위해 우측 패널이 자동으로 숨겨졌습니다.">
              HUD 자동 축소
            </span>
          ) : null}
        </div>
        <div className="game-shell__topbar-slot">{topbar}</div>
      </div>

      <aside
        ref={sidebarRef}
        className={`game-shell__sidebar${sidebarOpen ? " is-open" : ""}`}
        role="navigation"
        aria-label={t("nav.sidebar")}
      >
        {renderedSidebar}
      </aside>

      {isMobile && sidebarOpen ? (
        <button
          type="button"
          className="game-shell__sidebar-backdrop"
          aria-label={t("ui.closeSidebar")}
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      {isMobile && hud ? (
        <button
          type="button"
          className={`game-shell__hud-toggle${hudOpen ? " is-open" : ""}`}
          aria-label={hudOpen ? "미션 패널 닫기" : "미션 패널 열기"}
          onClick={() => setHudOpen((prev) => !prev)}
        >
          {hudOpen ? "MISSION CLOSE" : "MISSION"}
        </button>
      ) : null}

      {isMobile && hudOpen ? (
        <button
          type="button"
          className="game-shell__hud-backdrop"
          aria-label="미션 패널 닫기"
          onClick={() => setHudOpen(false)}
        />
      ) : null}

      <main
        className="game-shell__content"
        role="main"
        aria-label={t("nav.mainContent")}
      >
        {main}
      </main>

      {hud ? (
        <aside
          ref={hudRef}
          className={`game-shell__hud${isMobile && hudOpen ? " is-open-mobile" : ""}${!isMobile && (!hudDocked || forcedHudCollapse) ? " is-collapsed-desktop" : ""}`}
          aria-label="Mission Studio"
        >
          {hud}
        </aside>
      ) : null}

      {artifact ? (
        <aside className={`game-shell__artifact${panelVisible ? " is-open" : ""}`}>
          {artifact}
        </aside>
      ) : null}
    </div>
  );
}
