import { useEffect, useState } from "react";

const MISSION_RUNTIME_KEY = "convusx.mission-runtime.v1";
const MISSION_RUNTIME_EVENT = "convusx:mission-runtime";

export type MissionRuntimePhase =
  | "idle"
  | "dispatch"
  | "working"
  | "meeting"
  | "review"
  | "done"
  | "error";

export type MissionRuntimeDepartment = {
  status: "idle" | "queued" | "working" | "meeting" | "done" | "error";
  progress: number;
};

export type MissionRuntimeWorkflowNotes = {
  pmo: string;
  critic: string;
  ceo: string;
};

export type MissionRuntimeState = {
  missionId: string | null;
  directive: string;
  phase: MissionRuntimePhase;
  source: "hq" | "thread" | "workforce" | "system";
  topic: string;
  summary: string;
  decision: "pending" | "approved" | "rejected" | "redispatched" | null;
  departments: Record<string, MissionRuntimeDepartment>;
  workflowNotes: MissionRuntimeWorkflowNotes;
  updatedAt: string;
};

const DEFAULT_STATE: MissionRuntimeState = {
  missionId: null,
  directive: "",
  phase: "idle",
  source: "system",
  topic: "",
  summary: "",
  decision: null,
  departments: {},
  workflowNotes: { pmo: "", critic: "", ceo: "" },
  updatedAt: new Date(0).toISOString()
};

function buildMissionId() {
  return `mission_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function emitMissionRuntimeChange(next: MissionRuntimeState) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<MissionRuntimeState>(MISSION_RUNTIME_EVENT, { detail: next }));
}

function sanitizePhase(value: unknown): MissionRuntimePhase {
  if (
    value === "idle" ||
    value === "dispatch" ||
    value === "working" ||
    value === "meeting" ||
    value === "review" ||
    value === "done" ||
    value === "error"
  ) return value;
  return "idle";
}

function sanitizeDepartment(input: unknown): MissionRuntimeDepartment | null {
  if (typeof input !== "object" || input === null) return null;
  const record = input as Partial<MissionRuntimeDepartment>;
  const progress = Number(record.progress ?? 0);
  const status = record.status;
  if (
    status !== "idle" &&
    status !== "queued" &&
    status !== "working" &&
    status !== "meeting" &&
    status !== "done" &&
    status !== "error"
  ) return null;
  return {
    status,
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : 0
  };
}

function sanitizeWorkflowNotes(input: unknown): MissionRuntimeWorkflowNotes {
  if (typeof input !== "object" || input === null) return { pmo: "", critic: "", ceo: "" };
  const record = input as Partial<MissionRuntimeWorkflowNotes>;
  return {
    pmo: typeof record.pmo === "string" ? record.pmo : "",
    critic: typeof record.critic === "string" ? record.critic : "",
    ceo: typeof record.ceo === "string" ? record.ceo : "",
  };
}

export function readMissionRuntimeState(): MissionRuntimeState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  const raw = window.localStorage.getItem(MISSION_RUNTIME_KEY);
  if (!raw) return DEFAULT_STATE;
  try {
    const parsed = JSON.parse(raw) as Partial<MissionRuntimeState>;
    const departmentsRaw = (parsed.departments && typeof parsed.departments === "object") ? parsed.departments : {};
    const departments: Record<string, MissionRuntimeDepartment> = {};
    for (const [key, value] of Object.entries(departmentsRaw)) {
      const normalized = sanitizeDepartment(value);
      if (!normalized) continue;
      departments[key] = normalized;
    }

    return {
      missionId: typeof parsed.missionId === "string" ? parsed.missionId : null,
      directive: typeof parsed.directive === "string" ? parsed.directive : "",
      phase: sanitizePhase(parsed.phase),
      source:
        parsed.source === "hq" ||
        parsed.source === "thread" ||
        parsed.source === "workforce" ||
        parsed.source === "system"
          ? parsed.source
          : "system",
      topic: typeof parsed.topic === "string" ? parsed.topic : "",
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      decision:
        parsed.decision === "pending" ||
        parsed.decision === "approved" ||
        parsed.decision === "rejected" ||
        parsed.decision === "redispatched"
          ? parsed.decision
          : null,
      departments,
      workflowNotes: sanitizeWorkflowNotes(parsed.workflowNotes),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString()
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function writeMissionRuntimeState(next: MissionRuntimeState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MISSION_RUNTIME_KEY, JSON.stringify(next));
  emitMissionRuntimeChange(next);
}

export function patchMissionRuntimeState(
  patch: Partial<MissionRuntimeState> | ((prev: MissionRuntimeState) => Partial<MissionRuntimeState>)
) {
  const prev = readMissionRuntimeState();
  const nextPatch = typeof patch === "function" ? patch(prev) : patch;
  const next: MissionRuntimeState = {
    ...prev,
    ...nextPatch,
    phase: sanitizePhase(nextPatch.phase ?? prev.phase),
    updatedAt: new Date().toISOString()
  };
  writeMissionRuntimeState(next);
  return next;
}

export function startMissionRuntime(directive: string, source: MissionRuntimeState["source"] = "hq") {
  const nextDirective = String(directive ?? "").trim();
  if (!nextDirective) return readMissionRuntimeState();
  const next: MissionRuntimeState = {
    ...DEFAULT_STATE,
    missionId: buildMissionId(),
    directive: nextDirective,
    source,
    phase: "dispatch",
    decision: "pending",
    updatedAt: new Date().toISOString()
  };
  writeMissionRuntimeState(next);
  return next;
}

export function setMissionRuntimePhase(phase: MissionRuntimePhase) {
  return patchMissionRuntimeState({ phase });
}

export function syncMissionRuntimeDepartments(
  departments: Array<{ id: string; status: MissionRuntimeDepartment["status"]; progress: number }>
) {
  const nextDepartments: Record<string, MissionRuntimeDepartment> = {};
  for (const item of departments) {
    if (!item?.id) continue;
    nextDepartments[item.id] = {
      status: item.status,
      progress: Number.isFinite(item.progress) ? Math.max(0, Math.min(100, Math.round(item.progress))) : 0
    };
  }
  return patchMissionRuntimeState({ departments: nextDepartments });
}

export function finishMissionRuntime(summary: string, decision: MissionRuntimeState["decision"] = "approved") {
  return patchMissionRuntimeState((prev) => ({
    phase: "done",
    summary: String(summary ?? "").trim(),
    decision: decision ?? prev.decision
  }));
}

export function resetMissionRuntimeState() {
  writeMissionRuntimeState({
    ...DEFAULT_STATE,
    updatedAt: new Date().toISOString()
  });
}

export function useMissionRuntimeState() {
  const [state, setState] = useState<MissionRuntimeState>(() => readMissionRuntimeState());

  useEffect(() => {
    function syncFromStorage(event: StorageEvent) {
      if (event.key !== MISSION_RUNTIME_KEY) return;
      setState(readMissionRuntimeState());
    }

    function syncFromCustomEvent(event: Event) {
      const custom = event as CustomEvent<MissionRuntimeState>;
      if (custom.detail) {
        setState(custom.detail);
        return;
      }
      setState(readMissionRuntimeState());
    }

    window.addEventListener("storage", syncFromStorage);
    window.addEventListener(MISSION_RUNTIME_EVENT, syncFromCustomEvent);
    return () => {
      window.removeEventListener("storage", syncFromStorage);
      window.removeEventListener(MISSION_RUNTIME_EVENT, syncFromCustomEvent);
    };
  }, []);

  return state;
}
