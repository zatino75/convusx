const PENDING_WORKFORCE_MISSION_KEY = "convusx.workforce.pending.v1";

type PendingWorkforceMission = {
  directive: string;
  createdAt: string;
  source: "hq" | "thread" | "unknown";
};

function readRaw(): PendingWorkforceMission | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(PENDING_WORKFORCE_MISSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingWorkforceMission>;
    const directive = String(parsed.directive ?? "").trim();
    if (!directive) return null;
    return {
      directive,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
      source: parsed.source === "hq" || parsed.source === "thread" ? parsed.source : "unknown"
    };
  } catch {
    return null;
  }
}

export function setPendingWorkforceMission(directive: string, source: PendingWorkforceMission["source"] = "unknown") {
  if (typeof window === "undefined") return;
  const value = String(directive ?? "").trim();
  if (!value) return;
  const payload: PendingWorkforceMission = {
    directive: value,
    createdAt: new Date().toISOString(),
    source
  };
  window.localStorage.setItem(PENDING_WORKFORCE_MISSION_KEY, JSON.stringify(payload));
}

export function consumePendingWorkforceMission(): PendingWorkforceMission | null {
  if (typeof window === "undefined") return null;
  const parsed = readRaw();
  window.localStorage.removeItem(PENDING_WORKFORCE_MISSION_KEY);
  return parsed;
}

export function peekPendingWorkforceMission(): PendingWorkforceMission | null {
  return readRaw();
}
