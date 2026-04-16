import fs from "node:fs";
import path from "node:path";
import { logger } from "../observability/logger.js";
import {
  deleteExecutiveReportSqlite,
  listExecutiveReportsSqlite,
  upsertExecutiveReportSqlite,
  type RetailExecutiveReportRecord
} from "../memory/sqliteMemory.js";

const EXEC_REPORT_PATH = "server/data/executive-reports.jsonl";
let executiveMigratedToSqlite = false;

export type ExecutiveReportEntry = {
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

function ensureDataDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJsonl<T>(filePath: string): T[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    logger.warn("[executiveReports] jsonl read failed", { filePath, error: String(error) });
    return [];
  }
}

function writeJsonl<T>(filePath: string, entries: T[]) {
  ensureDataDir(filePath);
  const content = entries.map((entry) => JSON.stringify(entry)).join("\n");
  fs.writeFileSync(filePath, content + (entries.length > 0 ? "\n" : ""), "utf-8");
}

function ensureExecutiveMigrated() {
  if (executiveMigratedToSqlite) return;
  const sqliteReports = listExecutiveReportsSqlite(1000);
  if (sqliteReports.length === 0) {
    const jsonlReports = readJsonl<ExecutiveReportEntry>(EXEC_REPORT_PATH);
    for (const report of jsonlReports) {
      upsertExecutiveReportSqlite(toRetailExecutiveRecord(report));
    }
  } else {
    writeJsonl(EXEC_REPORT_PATH, sqliteReports.map(fromRetailExecutiveRecord));
  }
  executiveMigratedToSqlite = true;
}

function toRetailExecutiveRecord(entry: ExecutiveReportEntry): RetailExecutiveReportRecord {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    sessionId: entry.sessionId,
    roundNumber: entry.roundNumber,
    topic: entry.topic,
    directive: entry.directive,
    summary: entry.summary,
    opportunities: entry.opportunities,
    risks: entry.risks,
    recommendations: entry.recommendations,
    meetingMinutes: entry.meetingMinutes ?? []
  };
}

function fromRetailExecutiveRecord(entry: RetailExecutiveReportRecord): ExecutiveReportEntry {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    sessionId: entry.sessionId,
    roundNumber: entry.roundNumber,
    topic: entry.topic,
    directive: entry.directive,
    summary: entry.summary,
    opportunities: entry.opportunities,
    risks: entry.risks,
    recommendations: entry.recommendations,
    meetingMinutes: entry.meetingMinutes ?? []
  };
}

function readExecutiveReportsFromStore(limit = 24): ExecutiveReportEntry[] {
  ensureExecutiveMigrated();
  const sqliteReports = listExecutiveReportsSqlite(limit);
  if (sqliteReports.length > 0) return sqliteReports.map(fromRetailExecutiveRecord);
  return readJsonl<ExecutiveReportEntry>(EXEC_REPORT_PATH)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

function asReportBody(raw: Record<string, unknown>): ExecutiveReportEntry | null {
  const id = String(raw.id ?? "").trim();
  if (!id) return null;

  const createdAt = String(raw.createdAt ?? new Date().toISOString());
  const sessionIdRaw = raw.sessionId;
  const sessionId = typeof sessionIdRaw === "string" && sessionIdRaw.trim() ? sessionIdRaw.trim() : null;
  const roundNumber = Number(raw.roundNumber ?? 0);
  const topic = String(raw.topic ?? "").trim() || "Executive Mission";
  const directive = String(raw.directive ?? "").trim();
  const summary = String(raw.summary ?? "").trim();
  const opportunities = Array.isArray(raw.opportunities)
    ? raw.opportunities.map((item) => String(item)).filter(Boolean).slice(0, 8)
    : [];
  const risks = Array.isArray(raw.risks)
    ? raw.risks.map((item) => String(item)).filter(Boolean).slice(0, 8)
    : [];
  const recommendations = Array.isArray(raw.recommendations)
    ? raw.recommendations.map((item) => String(item)).filter(Boolean).slice(0, 8)
    : [];
  const meetingMinutes = Array.isArray(raw.meetingMinutes)
    ? raw.meetingMinutes.map((item) => String(item)).filter(Boolean).slice(0, 16)
    : [];

  return {
    id,
    createdAt,
    sessionId,
    roundNumber: Number.isFinite(roundNumber) ? roundNumber : 0,
    topic,
    directive,
    summary,
    opportunities,
    risks,
    recommendations,
    meetingMinutes
  };
}

export async function getExecutiveReportsRoute(req: any, res: any) {
  const limit = Math.max(1, Math.min(100, Number(req?.query?.limit ?? 24)));
  const reports = readExecutiveReportsFromStore(limit);

  return res.json({ ok: true, reports });
}

export async function saveExecutiveReportRoute(req: any, res: any) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const report = asReportBody(body);

  if (!report) {
    return res.json({ ok: false, error: "invalid_report" });
  }

  ensureExecutiveMigrated();
  upsertExecutiveReportSqlite(toRetailExecutiveRecord(report));
  const next = readExecutiveReportsFromStore(240);
  writeJsonl(EXEC_REPORT_PATH, next);

  logger.info("[executiveReports] report saved", {
    id: report.id,
    sessionId: report.sessionId,
    roundNumber: report.roundNumber
  });

  return res.json({ ok: true, report, reports: next.slice(0, 24) });
}

export async function deleteExecutiveReportRoute(req: any, res: any) {
  const id = String(req?.body?.id ?? "").trim();
  if (!id) return res.json({ ok: false, error: "id_required" });

  ensureExecutiveMigrated();
  const deleted = deleteExecutiveReportSqlite(id);
  if (!deleted) {
    return res.json({ ok: false, error: "not_found" });
  }

  const next = readExecutiveReportsFromStore(240);
  writeJsonl(EXEC_REPORT_PATH, next);
  logger.info("[executiveReports] report deleted", { id });
  return res.json({ ok: true, reports: next.slice(0, 24) });
}

function buildDailyBuckets(reports: ExecutiveReportEntry[], days = 7) {
  const result: Array<{ date: string; count: number }> = [];
  const now = new Date();
  const map = new Map<string, number>();

  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    map.set(key, 0);
  }

  for (const report of reports) {
    const key = String(report.createdAt).slice(0, 10);
    if (map.has(key)) {
      map.set(key, (map.get(key) ?? 0) + 1);
    }
  }

  for (const [date, count] of map.entries()) {
    result.push({ date, count });
  }
  return result;
}

function buildTopTopics(reports: ExecutiveReportEntry[], limit = 5) {
  const counter = new Map<string, number>();
  for (const report of reports) {
    const topic = report.topic || "Executive Mission";
    counter.set(topic, (counter.get(topic) ?? 0) + 1);
  }
  return [...counter.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export async function getExecutiveReportsKpiRoute(_req: any, res: any) {
  const reports = readExecutiveReportsFromStore(1000);
  const latest = reports[0] ?? null;
  const totalReports = reports.length;
  const avgRiskCount = totalReports > 0
    ? Number((reports.reduce((sum, item) => sum + item.risks.length, 0) / totalReports).toFixed(2))
    : 0;
  const avgRecommendationCount = totalReports > 0
    ? Number((reports.reduce((sum, item) => sum + item.recommendations.length, 0) / totalReports).toFixed(2))
    : 0;
  const reports7d = buildDailyBuckets(reports, 7);
  const recent7dCount = reports7d.reduce((sum, item) => sum + item.count, 0);

  return res.json({
    ok: true,
    kpi: {
      totalReports,
      recent7dCount,
      avgRiskCount,
      avgRecommendationCount,
      latestAt: latest?.createdAt ?? null,
      latestTopic: latest?.topic ?? null
    },
    daily7d: reports7d,
    topTopics: buildTopTopics(reports, 5)
  });
}
