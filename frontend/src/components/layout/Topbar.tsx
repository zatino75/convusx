import { t } from "../../i18n";
import type { MainViewMode, WorkspaceKind } from "../../types/workspace";
import type { ConnectionState } from "../../hooks/useConnectionStatus";

type Props = {
  mode: MainViewMode;
  workspaceKind: WorkspaceKind;
  projectTitle: string;
  threadTitle?: string;
  projectMemoryEnabled?: boolean;
  onBackToHome: () => void;
  panelToggle?: React.ReactNode;
  connectionStatus?: ConnectionState;
};

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="5" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ConnectionBanner({ status }: { status: ConnectionState }) {
  if (status === "online") return null;
  const isOffline = status === "offline";
  const style: React.CSSProperties = {
    position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
    padding: "6px 16px", textAlign: "center",
    fontSize: 13, fontWeight: 600, letterSpacing: 0.2,
    background: isOffline ? "#ef4444" : "#f59e0b",
    color: "#fff",
    transition: "all 0.3s ease",
  };
  return (
    <div style={style}>
      {isOffline ? t("status.offline") : t("status.reconnecting")}
    </div>
  );
}

export default function Topbar({
  mode,
  workspaceKind,
  projectTitle,
  threadTitle,
  onBackToHome,
  panelToggle,
  connectionStatus
}: Props) {
  const isThread = mode === "thread-chat";
  const isProject = workspaceKind === "project";

  const crumbStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 4,
    fontSize: 13, fontWeight: 500, color: "var(--text-sub)",
    border: "none", background: "none", cursor: "pointer",
    padding: "2px 4px", borderRadius: 6, flexShrink: 0,
    whiteSpace: "nowrap"
  };

  const crumbActiveStyle: React.CSSProperties = {
    ...crumbStyle,
    color: "var(--text-main)", fontWeight: 600
  };

  const sepStyle: React.CSSProperties = {
    color: "var(--text-soft)", flexShrink: 0, display: "flex", alignItems: "center"
  };

  return (
    <>
    {connectionStatus && <ConnectionBanner status={connectionStatus} />}
    <header className="ui-topbar">
      <div className="ui-topbar__left" style={{ gap: 4, overflow: "hidden" }}>
        <button type="button" onClick={onBackToHome} style={crumbStyle} title={t("nav.goHome")}>
          <GridIcon />
        </button>

        {(isProject || isThread) && projectTitle && (
          <>
            <span style={sepStyle}><ChevronIcon /></span>
            <button
              type="button"
              onClick={isThread ? onBackToHome : undefined}
              style={isThread ? crumbStyle : { ...crumbStyle, cursor: "default" }}
            >
              {projectTitle}
              {!isThread && <ChevronDownIcon />}
            </button>
          </>
        )}

        {isThread && threadTitle && (
          <>
            <span style={sepStyle}><ChevronIcon /></span>
            <span style={{ ...crumbActiveStyle, overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
              {threadTitle}
            </span>
          </>
        )}

        {!isProject && !isThread && (
          <>
            <span style={sepStyle}><ChevronIcon /></span>
            <span style={crumbActiveStyle}>CORVUS X</span>
          </>
        )}
      </div>

      <div className="ui-topbar__center" />

      {/* 패널 토글 버튼 슬롯 */}
      <div className="ui-topbar__actions">
        {panelToggle ?? null}
      </div>
    </header>
    </>
  );
}
