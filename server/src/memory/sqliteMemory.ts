/**
 * sqliteMemory.ts
 * better-sqlite3 + FTS5 기반 프로젝트 메모리
 * 한국어 N-gram 토크나이저(tri-gram) 적용 → 한국어 검색 정확도 극대화
 *
 * 기존 threadMemory.ts / projectMemory.ts JSON 파일을 대체하는 SQLite 레이어.
 * 두 시스템은 공존 가능 — 이 파일은 Director Agent / 부서 보고서 저장에 사용.
 *
 * 2026-04-15: node:sqlite (Node 22+ 전용) → better-sqlite3 (Node 20 호환) 로 교체.
 *   서버는 Node 20.20.2 이므로 node:sqlite 는 ERR_UNKNOWN_BUILTIN_MODULE 발생.
 *   better-sqlite3 는 이미 src/db/database.ts 에서 사용 중이라 서버에 설치되어 있음.
 */

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_DIR = resolve(__dirname, '../../../data');
const DB_PATH = resolve(DB_DIR, 'corvusx-memory.db');

// ─── 한국어 N-gram 토크나이저 ─────────────────────────────────────────────────
function koreanNgram(text: string, n = 2): string[] {
  if (!text) return [];
  // 한글 + 영문 + 숫자 유지, 나머지 공백으로 정규화
  const normalized = text
    .toLowerCase()
    .replace(/[^\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318Fa-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = new Set<string>();

  // 공백 분리 토큰 (영문/숫자 단어)
  for (const word of normalized.split(' ')) {
    if (word.length >= 1) tokens.add(word);
    // 영문/숫자는 그대로도 추가
  }

  // 한글 N-gram (bi-gram + tri-gram)
  const chars = [...normalized.replace(/\s/g, '')];
  for (let i = 0; i < chars.length - 1; i++) {
    // bi-gram
    const bi = chars[i] + chars[i + 1];
    if (bi.trim()) tokens.add(bi);
    // tri-gram
    if (i + 2 < chars.length) {
      const tri = chars[i] + chars[i + 1] + chars[i + 2];
      if (tri.trim()) tokens.add(tri);
    }
  }

  return [...tokens].filter(t => t.length >= 2);
}

// ─── DB 초기화 ────────────────────────────────────────────────────────────────
let _db: any = null;

function getDb(): any {
  if (_db) return _db;

  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });

  _db = new Database(DB_PATH);
  _db.exec(`PRAGMA journal_mode = WAL;`);
  _db.exec(`PRAGMA synchronous = NORMAL;`);

  // 부서 보고서 테이블
  _db.exec(`
    CREATE TABLE IF NOT EXISTS dept_reports (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL,
      round_num   INTEGER NOT NULL,
      dept_id     TEXT NOT NULL,
      project_name TEXT,
      directive   TEXT,
      report_json TEXT NOT NULL,
      model_used  TEXT,
      connectors  TEXT,
      duration_ms INTEGER,
      confidence  REAL,
      tokens_text TEXT,   -- FTS용 ngram 토큰
      created_at  INTEGER DEFAULT (unixepoch())
    );
  `);

  // 프로젝트 세션 테이블
  _db.exec(`
    CREATE TABLE IF NOT EXISTS project_sessions (
      session_id   TEXT PRIMARY KEY,
      project_name TEXT,
      user_id      TEXT,
      directive    TEXT,
      domain       TEXT,
      rounds_json  TEXT,
      created_at   INTEGER DEFAULT (unixepoch()),
      updated_at   INTEGER DEFAULT (unixepoch())
    );
  `);

  // FTS5 가상 테이블 (한국어 N-gram 검색)
  _db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS reports_fts USING fts5(
      id UNINDEXED,
      dept_id,
      directive,
      content,
      content='dept_reports',
      content_rowid='rowid',
      tokenize='unicode61'
    );
  `);

  // 트리거: 보고서 삽입 시 FTS 자동 업데이트
  _db.exec(`
    CREATE TRIGGER IF NOT EXISTS reports_ai AFTER INSERT ON dept_reports BEGIN
      INSERT INTO reports_fts(rowid, id, dept_id, directive, content)
      VALUES (new.rowid, new.id, new.dept_id, new.directive, new.tokens_text);
    END;
  `);

  // CEO 브리핑 테이블
  _db.exec(`
    CREATE TABLE IF NOT EXISTS ceo_briefings (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL,
      round_num   INTEGER NOT NULL,
      briefing    TEXT NOT NULL,
      created_at  INTEGER DEFAULT (unixepoch())
    );
  `);

  // Retail — 매출 엔트리
  _db.exec(`
    CREATE TABLE IF NOT EXISTS sales_entries (
      id          TEXT PRIMARY KEY,
      date        TEXT NOT NULL,
      platform    TEXT NOT NULL,
      revenue     INTEGER NOT NULL,
      orders      INTEGER NOT NULL,
      memo        TEXT,
      created_at  TEXT NOT NULL
    );
  `);

  // Retail — POS 트랜잭션 원본(JSON)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS pos_transactions (
      id           TEXT PRIMARY KEY,
      created_at   TEXT NOT NULL,
      tx_date      TEXT NOT NULL,
      store_id     TEXT,
      store_name   TEXT,
      status       TEXT,
      total        INTEGER,
      item_count   INTEGER,
      payload_json TEXT NOT NULL
    );
  `);

  // Retail — Executive Report
  _db.exec(`
    CREATE TABLE IF NOT EXISTS executive_reports (
      id                   TEXT PRIMARY KEY,
      created_at           TEXT NOT NULL,
      session_id           TEXT,
      round_num            INTEGER NOT NULL,
      topic                TEXT NOT NULL,
      directive            TEXT NOT NULL,
      summary              TEXT NOT NULL,
      opportunities_json   TEXT NOT NULL,
      risks_json           TEXT NOT NULL,
      recommendations_json TEXT NOT NULL,
      meeting_minutes_json TEXT NOT NULL
    );
  `);

  // Retail — 일/주/월 스냅샷
  _db.exec(`
    CREATE TABLE IF NOT EXISTS retail_snapshots (
      id            TEXT PRIMARY KEY,
      scope         TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      payload_json  TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );
  `);

  _db.exec(`CREATE INDEX IF NOT EXISTS idx_sales_entries_date ON sales_entries(date);`);
  _db.exec(`CREATE INDEX IF NOT EXISTS idx_pos_transactions_date ON pos_transactions(tx_date, created_at);`);
  _db.exec(`CREATE INDEX IF NOT EXISTS idx_executive_reports_created ON executive_reports(created_at);`);
  _db.exec(`CREATE INDEX IF NOT EXISTS idx_retail_snapshots_scope_date ON retail_snapshots(scope, snapshot_date);`);

  return _db;
}

// ─── 보고서 저장 ──────────────────────────────────────────────────────────────
export interface DeptReportRecord {
  sessionId: string;
  roundNum: number;
  deptId: string;
  projectName?: string;
  directive?: string;
  report: object;
  modelUsed?: string;
  connectors?: string[];
  durationMs?: number;
  confidence?: number;
}

function normalizeDeptReportInput(
  recOrSessionId: DeptReportRecord | string,
  roundNum?: number,
  deptId?: string,
  report?: object,
  modelUsed?: string,
  connectors?: string[],
): DeptReportRecord {
  if (typeof recOrSessionId !== 'string') {
    return recOrSessionId;
  }

  return {
    sessionId: recOrSessionId,
    roundNum: roundNum ?? 0,
    deptId: deptId ?? 'unknown',
    projectName: '',
    directive: '',
    report: report ?? {},
    modelUsed,
    connectors: connectors ?? [],
    confidence: typeof (report as any)?.confidence === 'number'
      ? (report as any).confidence
      : undefined,
  };
}

export function saveDeptReport(rec: DeptReportRecord): string;
export function saveDeptReport(
  sessionId: string,
  roundNum: number,
  deptId: string,
  report: object,
  modelUsed?: string,
  connectors?: string[],
): string;
export function saveDeptReport(
  recOrSessionId: DeptReportRecord | string,
  roundNum?: number,
  deptId?: string,
  report?: object,
  modelUsed?: string,
  connectors?: string[],
): string {
  const rec = normalizeDeptReportInput(recOrSessionId, roundNum, deptId, report, modelUsed, connectors);
  const db = getDb();
  const id = createHash('sha256')
    .update(`${rec.sessionId}:${rec.roundNum}:${rec.deptId}:${Date.now()}`)
    .digest('hex')
    .slice(0, 16);

  // FTS용 텍스트 추출
  const reportText = extractTextFromReport(rec.report);
  const ngrams = koreanNgram(`${rec.directive} ${reportText}`).join(' ');

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO dept_reports
      (id, session_id, round_num, dept_id, project_name, directive, report_json, model_used, connectors, duration_ms, confidence, tokens_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id, rec.sessionId, rec.roundNum, rec.deptId, rec.projectName ?? '',
    rec.directive ?? '', JSON.stringify(rec.report),
    rec.modelUsed ?? '', JSON.stringify(rec.connectors ?? []),
    rec.durationMs ?? 0, rec.confidence ?? 0.8, ngrams
  );

  return id;
}

// ─── FTS 검색 ────────────────────────────────────────────────────────────────
export interface SearchResult {
  id: string;
  sessionId: string;
  deptId: string;
  directive: string;
  report: object;
  confidence: number;
  createdAt: number;
  rank: number;
}

export function searchReports(query: string, limit = 10): SearchResult[] {
  const db = getDb();

  // N-gram으로 쿼리 토큰화
  const tokens = koreanNgram(query);
  if (tokens.length === 0) return [];

  // FTS5 쿼리 빌드
  const ftsQuery = tokens.slice(0, 10).map(t => `"${t}"`).join(' OR ');

  try {
    const stmt = db.prepare(`
      SELECT dr.id, dr.session_id, dr.dept_id, dr.directive, dr.report_json,
             dr.confidence, dr.created_at, fts.rank
      FROM reports_fts fts
      JOIN dept_reports dr ON dr.rowid = fts.rowid
      WHERE reports_fts MATCH ?
      ORDER BY fts.rank
      LIMIT ?
    `);

    const rows = stmt.all(ftsQuery, limit) as any[];
    return rows.map(r => ({
      id: r.id,
      sessionId: r.session_id,
      deptId: r.dept_id,
      directive: r.directive,
      report: JSON.parse(r.report_json ?? '{}'),
      confidence: r.confidence,
      createdAt: r.created_at,
      rank: r.rank,
    }));
  } catch {
    // FTS 실패 시 LIKE 폴백
    const stmt = db.prepare(`
      SELECT id, session_id, dept_id, directive, report_json, confidence, created_at
      FROM dept_reports WHERE directive LIKE ? OR tokens_text LIKE ? LIMIT ?
    `);
    const like = `%${query.slice(0, 50)}%`;
    const rows = stmt.all(like, like, limit) as any[];
    return rows.map((r, i) => ({
      id: r.id, sessionId: r.session_id, deptId: r.dept_id,
      directive: r.directive, report: JSON.parse(r.report_json ?? '{}'),
      confidence: r.confidence, createdAt: r.created_at, rank: -i,
    }));
  }
}

// ─── 세션 저장/조회 ──────────────────────────────────────────────────────────
function serializeRoundsForDb(rounds: unknown[]): object[] {
  return rounds.map((round: any) => ({
    ...round,
    deptResults: round?.deptResults instanceof Map
      ? Object.fromEntries(round.deptResults)
      : round?.deptResults,
  }));
}

function deriveDirective(data: any): string {
  const latest = Array.isArray(data?.rounds) ? data.rounds[data.rounds.length - 1] : null;
  return String(data?.directive ?? latest?.mission?.originalDirective ?? latest?.mission?.topic ?? '');
}

function deriveDomain(data: any): string {
  const latest = Array.isArray(data?.rounds) ? data.rounds[data.rounds.length - 1] : null;
  return String(data?.domain ?? latest?.mission?.domain ?? 'general');
}

export function saveSession(sessionId: string, data: {
  projectName: string;
  userId: string;
  directive?: string;
  domain?: string;
  rounds: unknown[];
}): void {
  const db = getDb();
  const rounds = serializeRoundsForDb(Array.isArray(data.rounds) ? data.rounds : []);
  const directive = deriveDirective(data);
  const domain = deriveDomain(data);
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO project_sessions
      (session_id, project_name, user_id, directive, domain, rounds_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, unixepoch())
  `);
  stmt.run(
    sessionId,
    data.projectName ?? '',
    data.userId ?? 'anonymous',
    directive,
    domain,
    JSON.stringify(rounds),
  );
}

export function loadSession(sessionId: string): any | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM project_sessions WHERE session_id = ?`);
  const row = stmt.get(sessionId) as any;
  if (!row) return null;
  return { ...row, rounds: JSON.parse(row.rounds_json ?? '[]') };
}

// ─── CEO 브리핑 저장/조회 ─────────────────────────────────────────────────────
export function saveCeoBriefing(sessionId: string, roundNum: number, briefing: string | object): void {
  const db = getDb();
  const id = `brief-${sessionId}-${roundNum}`;
  const serialized = typeof briefing === 'string' ? briefing : JSON.stringify(briefing);
  db.prepare(`INSERT OR REPLACE INTO ceo_briefings (id, session_id, round_num, briefing) VALUES (?,?,?,?)`)
    .run(id, sessionId, roundNum, serialized);
}

export function loadCeoBriefing(sessionId: string, roundNum: number): string | null {
  const db = getDb();
  const row = db.prepare(`SELECT briefing FROM ceo_briefings WHERE session_id=? AND round_num=?`).get(sessionId, roundNum) as any;
  return row?.briefing ?? null;
}

// ─── 최근 보고서 목록 ─────────────────────────────────────────────────────────
export function getRecentReports(limit = 20): SearchResult[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, session_id, dept_id, directive, report_json, confidence, created_at
    FROM dept_reports ORDER BY created_at DESC LIMIT ?
  `).all(limit) as any[];
  return rows.map((r, i) => ({
    id: r.id, sessionId: r.session_id, deptId: r.dept_id, directive: r.directive,
    report: JSON.parse(r.report_json ?? '{}'), confidence: r.confidence,
    createdAt: r.created_at, rank: -i,
  }));
}

// ─── Retail DB 접근 ──────────────────────────────────────────────────────────
export function getMemoryDb(): any {
  return getDb();
}

export interface RetailSalesEntryRecord {
  id: string;
  date: string;
  platform: "smartstore" | "coupang" | "own" | "other";
  revenue: number;
  orders: number;
  memo?: string;
  createdAt: string;
}

export function upsertSalesEntrySqlite(entry: RetailSalesEntryRecord): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO sales_entries
      (id, date, platform, revenue, orders, memo, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    entry.id,
    String(entry.date),
    String(entry.platform),
    Math.round(Number(entry.revenue ?? 0)),
    Math.round(Number(entry.orders ?? 0)),
    entry.memo ? String(entry.memo) : null,
    String(entry.createdAt),
  );
}

export function listSalesEntriesSqlite(): RetailSalesEntryRecord[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, date, platform, revenue, orders, memo, created_at
    FROM sales_entries
    ORDER BY date DESC, created_at DESC
  `).all() as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.id ?? ""),
    date: String(row.date ?? ""),
    platform: String(row.platform ?? "other") as RetailSalesEntryRecord["platform"],
    revenue: Number(row.revenue ?? 0),
    orders: Number(row.orders ?? 0),
    memo: row.memo ? String(row.memo) : undefined,
    createdAt: String(row.created_at ?? new Date().toISOString()),
  })).filter((row) => Boolean(row.id));
}

export function deleteSalesEntrySqlite(id: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM sales_entries WHERE id = ?`).run(String(id));
  const changes = Number((result as { changes?: number })?.changes ?? 0);
  return changes > 0;
}

export interface RetailExecutiveReportRecord {
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
}

export function upsertExecutiveReportSqlite(report: RetailExecutiveReportRecord): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO executive_reports
      (id, created_at, session_id, round_num, topic, directive, summary, opportunities_json, risks_json, recommendations_json, meeting_minutes_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    report.id,
    String(report.createdAt),
    report.sessionId ? String(report.sessionId) : null,
    Number(report.roundNumber ?? 0),
    String(report.topic ?? "Executive Mission"),
    String(report.directive ?? ""),
    String(report.summary ?? ""),
    JSON.stringify(Array.isArray(report.opportunities) ? report.opportunities.slice(0, 8) : []),
    JSON.stringify(Array.isArray(report.risks) ? report.risks.slice(0, 8) : []),
    JSON.stringify(Array.isArray(report.recommendations) ? report.recommendations.slice(0, 8) : []),
    JSON.stringify(Array.isArray(report.meetingMinutes) ? report.meetingMinutes.slice(0, 16) : []),
  );
}

export function listExecutiveReportsSqlite(limit = 24): RetailExecutiveReportRecord[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, created_at, session_id, round_num, topic, directive, summary, opportunities_json, risks_json, recommendations_json, meeting_minutes_json
    FROM executive_reports
    ORDER BY created_at DESC
    LIMIT ?
  `).all(Number(limit)) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.id ?? ""),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    sessionId: row.session_id ? String(row.session_id) : null,
    roundNumber: Number(row.round_num ?? 0),
    topic: String(row.topic ?? "Executive Mission"),
    directive: String(row.directive ?? ""),
    summary: String(row.summary ?? ""),
    opportunities: parseStringArray(row.opportunities_json, 8),
    risks: parseStringArray(row.risks_json, 8),
    recommendations: parseStringArray(row.recommendations_json, 8),
    meetingMinutes: parseStringArray(row.meeting_minutes_json, 16),
  })).filter((row) => Boolean(row.id));
}

export function deleteExecutiveReportSqlite(id: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM executive_reports WHERE id = ?`).run(String(id));
  const changes = Number((result as { changes?: number })?.changes ?? 0);
  return changes > 0;
}

export interface RetailPosTransactionRecord {
  id: string;
  createdAt: string;
  date: string;
  storeId?: string;
  storeName?: string;
  status?: string;
  total?: number;
  itemCount?: number;
  payload: Record<string, unknown>;
}

export function upsertPosTransactionSqlite(record: RetailPosTransactionRecord): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO pos_transactions
      (id, created_at, tx_date, store_id, store_name, status, total, item_count, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    record.id,
    String(record.createdAt),
    String(record.date),
    record.storeId ? String(record.storeId) : null,
    record.storeName ? String(record.storeName) : null,
    record.status ? String(record.status) : null,
    Number(record.total ?? 0),
    Number(record.itemCount ?? 0),
    JSON.stringify(record.payload ?? {}),
  );
}

export function listPosTransactionsSqlite(limit = 0): Record<string, unknown>[] {
  const db = getDb();
  const sql = limit > 0
    ? `SELECT payload_json FROM pos_transactions ORDER BY created_at DESC LIMIT ?`
    : `SELECT payload_json FROM pos_transactions ORDER BY created_at DESC`;
  const rows = (limit > 0
    ? db.prepare(sql).all(Number(limit))
    : db.prepare(sql).all()) as Array<Record<string, unknown>>;

  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    const payloadRaw = row.payload_json;
    if (typeof payloadRaw !== "string") continue;
    try {
      const payload = JSON.parse(payloadRaw) as Record<string, unknown>;
      if (payload && typeof payload === "object") out.push(payload);
    } catch {
      // skip broken row
    }
  }
  return out;
}

export interface RetailSnapshotRecord {
  id: string;
  scope: string;
  snapshotDate: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export function upsertRetailSnapshotSqlite(input: {
  scope: string;
  snapshotDate: string;
  payload: Record<string, unknown>;
  createdAt?: string;
}): RetailSnapshotRecord {
  const db = getDb();
  const createdAt = input.createdAt ?? new Date().toISOString();
  const id = `${String(input.scope)}:${String(input.snapshotDate)}`;
  db.prepare(`
    INSERT OR REPLACE INTO retail_snapshots
      (id, scope, snapshot_date, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id,
    String(input.scope),
    String(input.snapshotDate),
    JSON.stringify(input.payload ?? {}),
    createdAt,
  );

  return {
    id,
    scope: String(input.scope),
    snapshotDate: String(input.snapshotDate),
    payload: input.payload ?? {},
    createdAt,
  };
}

export function listRetailSnapshotsSqlite(scope: string, limit = 30): RetailSnapshotRecord[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, scope, snapshot_date, payload_json, created_at
    FROM retail_snapshots
    WHERE scope = ?
    ORDER BY snapshot_date DESC, created_at DESC
    LIMIT ?
  `).all(String(scope), Number(limit)) as Array<Record<string, unknown>>;

  const out: RetailSnapshotRecord[] = [];
  for (const row of rows) {
    const payloadRaw = row.payload_json;
    let payload: Record<string, unknown> = {};
    if (typeof payloadRaw === "string") {
      try {
        const parsed = JSON.parse(payloadRaw) as Record<string, unknown>;
        payload = parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        payload = {};
      }
    }
    out.push({
      id: String(row.id ?? ""),
      scope: String(row.scope ?? ""),
      snapshotDate: String(row.snapshot_date ?? ""),
      payload,
      createdAt: String(row.created_at ?? new Date().toISOString()),
    });
  }
  return out.filter((item) => Boolean(item.id));
}

function parseStringArray(raw: unknown, limit: number): string[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item)).filter(Boolean).slice(0, limit);
  } catch {
    return [];
  }
}

// ─── 보고서 텍스트 추출 (FTS 인덱싱용) ──────────────────────────────────────
function extractTextFromReport(report: any): string {
  if (!report) return '';
  const parts: string[] = [];
  if (report.title) parts.push(report.title);
  for (const section of report.sections ?? []) {
    if (section.heading) parts.push(section.heading);
    for (const item of section.items ?? []) {
      parts.push(String(item).slice(0, 200));
    }
  }
  return parts.join(' ');
}

