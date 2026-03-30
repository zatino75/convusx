import type { MainViewMode, WorkspaceKind } from "../../types/workspace";

type Props = {
  mode: MainViewMode;
  workspaceKind: WorkspaceKind;
  projectTitle: string;
  threadTitle?: string;
  projectMemoryEnabled?: boolean;
  onBackToHome: () => void;
  panelToggle?: React.ReactNode;
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

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export default function Topbar({
  mode,
  workspaceKind,
  projectTitle,
  threadTitle,
  onBackToHome,
  panelToggle
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
    <header className="ui-topbar">
      <div className="ui-topbar__left" style={{ gap: 4, overflow: "hidden" }}>
        <button type="button" onClick={onBackToHome} style={crumbStyle} title="홈으로">
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
            <span style={crumbActiveStyle}>AI Orchestra</span>
          </>
        )}
      </div>

      <div className="ui-topbar__center" />

      {/* 패널 토글 버튼 슬롯 */}
      <div className="ui-topbar__actions">
        {panelToggle ?? null}
      </div>
    </header>
  );
}
