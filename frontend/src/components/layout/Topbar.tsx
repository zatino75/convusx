import { useState } from "react";
import type { MainViewMode, WorkspaceKind } from "../../types/workspace";

type Props = {
  mode: MainViewMode;
  workspaceKind: WorkspaceKind;
  projectTitle: string;
  threadTitle?: string;
  projectMemoryEnabled?: boolean;
  onBackToHome: () => void;
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

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 5v10" />
      <path d="m8 9 4-4 4 4" />
      <path d="M5 19h14" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

export default function Topbar({
  mode,
  workspaceKind,
  projectTitle,
  threadTitle,
  onBackToHome
}: Props) {
  const [showMore, setShowMore] = useState(false);
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
      {/* 브레드크럼 */}
      <div className="ui-topbar__left" style={{ gap: 4, overflow: "hidden" }}>

        {/* □ 홈 버튼 */}
        <button type="button" onClick={onBackToHome} style={crumbStyle} title="홈으로">
          <GridIcon />
        </button>

        {/* 프로젝트명 */}
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

        {/* 스레드명 */}
        {isThread && threadTitle && (
          <>
            <span style={sepStyle}><ChevronIcon /></span>
            <span style={{ ...crumbActiveStyle, overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
              {threadTitle}
            </span>
          </>
        )}

        {/* general + home */}
        {!isProject && !isThread && (
          <>
            <span style={sepStyle}><ChevronIcon /></span>
            <span style={crumbActiveStyle}>AI Orchestra</span>
          </>
        )}
      </div>

      <div className="ui-topbar__center" />

      {/* 액션 버튼 */}
      <div className="ui-topbar__actions" style={{ position: "relative" }}>
        <button
          type="button"
          className="icon-button"
          title="공유하기"
          onClick={() => navigator.clipboard.writeText(window.location.href).catch(() => {})}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", width: "auto", fontSize: 13, fontWeight: 500, color: "var(--text-main)", border: "1px solid var(--border)", borderRadius: 10, height: 34 }}
        >
          <ShareIcon />
          공유하기
        </button>

        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="icon-button"
            onClick={() => setShowMore(v => !v)}
          >
            <MoreIcon />
          </button>

          {showMore && (
            <div
              style={{ position: "absolute", right: 0, top: 40, zIndex: 50, background: "var(--bg-surface, #fff)", border: "1px solid var(--border)", borderRadius: 12, padding: "6px 0", minWidth: 180, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}
              onMouseLeave={() => setShowMore(false)}
            >
              {[
                { label: "이름 바꾸기", action: () => {} },
                { label: "공유", action: () => navigator.clipboard.writeText(window.location.href).catch(() => {}) },
                { label: "삭제", action: () => {}, danger: true }
              ].map(item => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => { item.action(); setShowMore(false); }}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 16px", fontSize: 13, border: "none", background: "none", cursor: "pointer", color: (item as any).danger ? "#ef4444" : "var(--text-main)" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-1, #f9f9f9)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "none")}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
