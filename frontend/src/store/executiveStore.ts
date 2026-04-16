import { apiFetch } from "../api/url";

export type ExecutiveReport = {
  id: string;
  createdAt: string;
  sessionId: string | null;
  roundNumber: number;
  topic: string;
  directive: string;
  summary: string;
  opportunities: string[];
  risks: string[];
  recommendations: string[];
  meetingMinutes: string[];
};

const STORAGE_KEY = "convusx.executive-reports.v1";

function readStorage(): ExecutiveReport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ExecutiveReport[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item === "object");
  } catch {
    return [];
  }
}

function writeStorage(items: ExecutiveReport[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore write failure
  }
}

export function listExecutiveReports(limit = 12): ExecutiveReport[] {
  return readStorage().slice(0, limit);
}

export function getLatestExecutiveReport(): ExecutiveReport | null {
  const items = readStorage();
  return items[0] ?? null;
}

export function upsertExecutiveReport(report: ExecutiveReport): ExecutiveReport[] {
  const current = readStorage();
  const deduped = current.filter((item) => item.id !== report.id);
  const next = [report, ...deduped].slice(0, 24);
  writeStorage(next);
  return next;
}

function normalizeReports(raw: unknown): ExecutiveReport[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const record = item as Record<string, unknown>;
      return {
        id: String(record.id ?? ""),
        createdAt: String(record.createdAt ?? new Date().toISOString()),
        sessionId: typeof record.sessionId === "string" ? record.sessionId : null,
        roundNumber: Number(record.roundNumber ?? 0),
        topic: String(record.topic ?? "Executive Mission"),
        directive: String(record.directive ?? ""),
        summary: String(record.summary ?? ""),
        opportunities: Array.isArray(record.opportunities) ? record.opportunities.map((value) => String(value)).slice(0, 8) : [],
        risks: Array.isArray(record.risks) ? record.risks.map((value) => String(value)).slice(0, 8) : [],
        recommendations: Array.isArray(record.recommendations) ? record.recommendations.map((value) => String(value)).slice(0, 8) : [],
        meetingMinutes: Array.isArray(record.meetingMinutes) ? record.meetingMinutes.map((value) => String(value)).slice(0, 16) : []
      };
    })
    .filter((item) => item.id);
}

export async function syncExecutiveReports(limit = 24): Promise<ExecutiveReport[]> {
  try {
    const response = await apiFetch(`/api/executive-reports?limit=${limit}`);
    const data = await response.json() as { ok?: boolean; reports?: unknown };
    if (!data.ok) throw new Error("sync_failed");
    const reports = normalizeReports(data.reports).slice(0, limit);
    writeStorage(reports);
    return reports;
  } catch {
    return listExecutiveReports(limit);
  }
}

export async function persistExecutiveReport(report: ExecutiveReport): Promise<ExecutiveReport[]> {
  try {
    const response = await apiFetch("/api/executive-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report)
    });
    const data = await response.json() as { ok?: boolean; reports?: unknown };
    if (!data.ok) throw new Error("save_failed");
    const reports = normalizeReports(data.reports);
    if (reports.length > 0) {
      writeStorage(reports);
      return reports;
    }
    return upsertExecutiveReport(report);
  } catch {
    return upsertExecutiveReport(report);
  }
}

export async function deleteExecutiveReport(reportId: string): Promise<ExecutiveReport[]> {
  if (!reportId) return listExecutiveReports(24);

  try {
    const response = await apiFetch("/api/executive-reports/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: reportId })
    });
    const data = await response.json() as { ok?: boolean; reports?: unknown };
    if (!data.ok) throw new Error("delete_failed");
    const reports = normalizeReports(data.reports);
    writeStorage(reports);
    return reports;
  } catch {
    const next = readStorage().filter((item) => item.id !== reportId);
    writeStorage(next);
    return next;
  }
}
