import { t } from "../../i18n";
import type { MainViewMode, WorkspaceKind } from "../../types/workspace";
import type { ConnectionState } from "../../hooks/useConnectionStatus";

type Props = {
  mode: MainViewMode;
  workspaceKind: WorkspaceKind;
  projectTitle: string;
  threadTitle?: string;
  sceneMode?: "idle" | "dispatch" | "working" | "meeting";
  projectMemoryEnabled?: boolean;
  onBackToHome: () => void;
  panelToggle?: React.ReactNode;
  connectionStatus?: ConnectionState;
  // ── 앱 모드 토글 (chat ↔ office) ───────────────────────────
  appMode?: "chat" | "office";
  onAppModeChange?: (m: "chat" | "office") => void;
  officeProgress?: { done: number; total: number } | null;
};

function ConnectionBadge({ status }: { status: ConnectionState }) {
  if (status === "online") return null;
  const label = status === "offline" ? t("status.offline") : t("status.reconnecting");
  return (
    <span className={`ui-topbar__status is-${status}`}>{label}</span>
  );
}

function phaseLabel(mode: MainViewMode, workspaceKind: WorkspaceKind) {
  if (mode === "thread-chat") return "EXECUTION";
  if (workspaceKind === "project") return "PROJECT FLOOR";
  return "HQ LOBBY";
}

function sceneStepState(sceneMode: "idle" | "dispatch" | "working" | "meeting", step: 1 | 2 | 3) {
  if (sceneMode === "idle") return "pending";
  if (sceneMode === "dispatch") return step === 1 ? "active" : "pending";
  if (sceneMode === "working") return step < 2 ? "done" : step === 2 ? "active" : "pending";
  return step < 3 ? "done" : "active";
}

function ModeToggle({
  appMode,
  onAppModeChange,
  officeProgress,
}: {
  appMode: "chat" | "office";
  onAppModeChange: (m: "chat" | "office") => void;
  officeProgress?: { done: number; total: number } | null;
}) {
  const baseStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 12px",
    fontSize: 12.5,
    fontWeight: 600,
    borderRadius: 6,
    border: "1px solid #2a2a3a",
    background: "transparent",
    color: "#888",
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: 0.2,
    transition: "all 0.15s ease",
  };
  const activeStyle: React.CSSProperties = {
    background: "#C9A84C",
    color: "#0F0A14",
    borderColor: "#C9A84C",
  };
  const dotChat: React.CSSProperties = {
    width: 6, height: 6, borderRadius: "50%",
    background: appMode === "chat" ? "#0F0A14" : "#22c55e",
  };
  const dotOffice: React.CSSProperties = {
    width: 6, height: 6, borderRadius: "50%",
    background: appMode === "office" ? "#0F0A14" : "#C9A84C",
  };
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        type="button"
        onClick={() => onAppModeChange("chat")}
        style={{ ...baseStyle, ...(appMode === "chat" ? activeStyle : {}) }}
        title="단일 에이전트 채팅 모드"
      >
        <span style={dotChat} />
        <span>🤖 AI CHAT</span>
      </button>
      <button
        type="button"
        onClick={() => onAppModeChange("office")}
        style={{ ...baseStyle, ...(appMode === "office" ? activeStyle : {}) }}
        title="Director Multi-Agent 오피스"
      >
        <span style={dotOffice} />
        <span>🏢 OFFICE</span>
        {appMode === "office" && officeProgress && officeProgress.total > 0 && (
          <span style={{
            marginLeft: 4, padding: "1px 6px", borderRadius: 8,
            background: "rgba(15,10,20,0.25)", fontSize: 10, fontWeight: 700,
          }}>
            {officeProgress.done}/{officeProgress.total}
          </span>
        )}
      </button>
    </div>
  );
}

export default function Topbar({
  mode,
  workspaceKind,
  projectTitle,
  threadTitle,
  sceneMode = "idle",
  onBackToHome,
  panelToggle,
  connectionStatus,
  appMode,
  onAppModeChange,
  officeProgress,
}: Props) {
  return (
    <div className="ui-topbar ui-topbar--game">
      <div className="ui-topbar__left ui-topbar__left--game">
        <button type="button" className="ui-topbar__home" onClick={onBackToHome}>
          HQ
        </button>
        <div className="ui-topbar__title-stack">
          <strong className="ui-topbar__project">{projectTitle || "CORVUS X"}</strong>
          <span className="ui-topbar__thread">{threadTitle || phaseLabel(mode, workspaceKind)}</span>
        </div>
        {mode !== "home" && appMode !== "office" ? (
          <div className="ui-topbar__mission-flow" aria-label="미션 진행">
            <span className={`is-${sceneStepState(sceneMode, 1)}`}>지시</span>
            <span className={`is-${sceneStepState(sceneMode, 2)}`}>실행</span>
            <span className={`is-${sceneStepState(sceneMode, 3)}`}>보고</span>
          </div>
        ) : null}
      </div>
      <div className="ui-topbar__actions" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {appMode && onAppModeChange ? (
          <ModeToggle appMode={appMode} onAppModeChange={onAppModeChange} officeProgress={officeProgress} />
        ) : null}
        {connectionStatus ? <ConnectionBadge status={connectionStatus} /> : null}
        {panelToggle ?? null}
      </div>
    </div>
  );
}
