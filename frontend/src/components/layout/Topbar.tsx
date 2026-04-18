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

export default function Topbar({
  mode,
  workspaceKind,
  projectTitle,
  threadTitle,
  sceneMode = "idle",
  onBackToHome,
  panelToggle,
  connectionStatus
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
        {mode !== "home" ? (
          <div className="ui-topbar__mission-flow" aria-label="미션 진행">
            <span className={`is-${sceneStepState(sceneMode, 1)}`}>지시</span>
            <span className={`is-${sceneStepState(sceneMode, 2)}`}>실행</span>
            <span className={`is-${sceneStepState(sceneMode, 3)}`}>보고</span>
          </div>
        ) : null}
      </div>
      <div className="ui-topbar__actions">
        {connectionStatus ? <ConnectionBadge status={connectionStatus} /> : null}
        {panelToggle ?? null}
      </div>
    </div>
  );
}
