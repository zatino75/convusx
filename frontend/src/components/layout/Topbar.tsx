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

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
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

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.4">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export default function Topbar({
  mode,
  workspaceKind,
  projectTitle,
  threadTitle,
  projectMemoryEnabled,
  onBackToHome
}: Props) {
  const [showMore, setShowMore] = useState(false);

  const isThread = mode === "thread-chat";
  const isProject = workspaceKind === "project";
  const isHome = mode === "home";

  function handleShare() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href).catch(() => {});
    }
  }

  return (
    <header className="ui-topbar">
      {/* Left — breadcrumb */}
      <div className="ui-topbar__left">
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>

          {/* Home / grid icon */}
          <button
            type="button"
            onClick={onBackToHome}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "none", background: "none", cursor: "pointer", color: "var(--text-sub)", borderRadius: 6 }}
            title="홈으로"
          >
            <GridIcon />
          </button>

          {/* Project name */}
          {(isProject || isThread) && projectTitle ? (
            <>
              <ChevronIcon />
              <button
                type="button"
                onClick={isThread ? onBackToHome : undefined}
                style={{ display: "flex", alignItems: "center", gap: 4, border: "none", background: "none", cursor: isThread ? "pointer" : "default", color: isThread ? "var(--text-sub)" : "var(--text-main)", fontSize: 14, fontWeight: isThread ? 400 : 600, borderRadius: 6, padding: "2px 6px" }}
              >
                {projectTitle}
                {!isThread && isProject && (
                  <ChevronDownIcon />
                )}
              </button>
            </>
          ) : null}

          {/* Thread title */}
          {isThread && threadTitle ? (
            <>
              <ChevronIcon />
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-main)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "2px 4px" }}>
                {threadTitle}
              </span>
            </>
          ) : null}

          {/* General home */}
          {isHome && workspaceKind === "general" && (
            <>
              <ChevronIcon />
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-main)", padding: "2px 4px" }}>
                ChatGPT
              </span>
              <button
                type="button"
                style={{ display: "flex", alignItems: "center", border: "none", background: "none", cursor: "pointer", color: "var(--text-sub)", padding: "2px 2px" }}
              >
                <ChevronDownIcon />
              </button>
            </>
          )}

          {/* Memory badge */}
          {projectMemoryEnabled && isProject && (
            <span style={{ fontSize: 10, color: "#6366f1", background: "rgba(99,102,241,0.1)", borderRadius: 4, padding: "1px 6px", marginLeft: 4, fontWeight: 500 }}>
              메모리 ON
            </span>
          )}
        </div>
      </div>

      <div className="ui-topbar__center" />

      {/* Right — actions */}
      <div className="ui-topbar__actions" style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          type="button"
          onClick={handleShare}
          style={{ display: "flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 8, background: "transparent", cursor: "pointer", fontSize: 13, color: "var(--text-main)", fontWeight: 500 }}
        >
          <ShareIcon />
          <span>공유하기</span>
        </button>

        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setShowMore(v => !v)}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, border: "1px solid var(--border)", borderRadius: 8, background: "transparent", cursor: "pointer", color: "var(--text-sub)" }}
          >
            <MoreIcon />
          </button>

          {showMore && (
            <div
              style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 50, minWidth: 160, background: "var(--bg-main, #fff)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.1)", padding: 4 }}
              onClick={() => setShowMore(false)}
            >
              {[
                { label: "대화 내보내기", action: () => {} },
                { label: "링크 복사", action: handleShare },
                { label: "새 창으로 열기", action: () => window.open(window.location.href, "_blank") }
              ].map(item => (
                <button
                  key={item.label}
                  type="button"
                  onClick={item.action}
                  style={{ display: "block", width: "100%", padding: "8px 12px", border: "none", background: "none", cursor: "pointer", fontSize: 13, textAlign: "left", color: "var(--text-main)", borderRadius: 6 }}
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