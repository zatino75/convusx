/**
 * CORVUS X — SQLite 데이터베이스 레이어
 * better-sqlite3 기반, 동기식 (서버 성능에 유리)
 */
import Database from "better-sqlite3"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { mkdirSync } from "node:fs"
import { logger } from "../observability/logger.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// DB 파일 위치: 프로젝트 루트/data/corvus.db
const DATA_DIR = resolve(__dirname, "../../../data")
mkdirSync(DATA_DIR, { recursive: true })

const DB_PATH = resolve(DATA_DIR, "corvus.db")
const db = new Database(DB_PATH)

// WAL 모드: 읽기/쓰기 동시성 향상
db.pragma("journal_mode = WAL")
db.pragma("foreign_keys = ON")

// ─── 스키마 초기화 ─────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '새 프로젝트',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    meta        TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS threads (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '새 채팅',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    meta        TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id                TEXT PRIMARY KEY,
    thread_id         TEXT NOT NULL,
    role              TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content           TEXT NOT NULL DEFAULT '',
    created_at        TEXT NOT NULL,
    status            TEXT DEFAULT 'done',
    request_meta      TEXT,
    attached_files    TEXT,
    version_group_id  TEXT,
    version_index     INTEGER,
    is_hidden         INTEGER NOT NULL DEFAULT 0,
    sort_order        INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS message_versions (
    id                TEXT PRIMARY KEY,
    thread_id         TEXT NOT NULL,
    group_id          TEXT NOT NULL,
    version_index     INTEGER NOT NULL DEFAULT 0,
    role              TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content           TEXT NOT NULL DEFAULT '',
    created_at        TEXT NOT NULL,
    status            TEXT DEFAULT 'done',
    request_meta      TEXT,
    attached_files    TEXT,
    is_hidden         INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS active_version_index (
    thread_id   TEXT NOT NULL,
    group_id    TEXT NOT NULL,
    version_idx INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (thread_id, group_id),
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_threads_project ON threads(project_id);
  CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
  CREATE INDEX IF NOT EXISTS idx_messages_thread_sort ON messages(thread_id, sort_order);
  CREATE INDEX IF NOT EXISTS idx_msg_versions_thread_group ON message_versions(thread_id, group_id);
`)

// ─── 마이그레이션 실행 (스키마 업그레이드) ───
import { runMigrations } from "./migrations.js"
runMigrations(db)

// ─── __general__ 프로젝트 보장 (일반 채팅용 가상 프로젝트) ───
db.prepare(`
  INSERT OR IGNORE INTO projects (id, title, created_at, updated_at, meta)
  VALUES ('__general__', '일반', @now, @now, '{}')
`).run({ now: new Date().toISOString() })

// ─── 헬퍼 ─────────────────────────────────────────
function jsonParse(raw: string | null | undefined, fallback: any = {}): any {
  if (!raw) return fallback
  try { return JSON.parse(raw) } catch { return fallback }
}

function jsonStr(value: any): string {
  return JSON.stringify(value ?? {})
}

// ─── Projects CRUD ─────────────────────────────────
export function getAllProjects() {
  const rows = db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as any[]
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    meta: jsonParse(r.meta)
  }))
}

export function getProject(id: string) {
  const r = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as any
  if (!r) return null
  return {
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    meta: jsonParse(r.meta)
  }
}

export function upsertProject(project: { id: string; title: string; createdAt: string; updatedAt: string; meta?: any }) {
  db.prepare(`
    INSERT INTO projects (id, title, created_at, updated_at, meta)
    VALUES (@id, @title, @createdAt, @updatedAt, @meta)
    ON CONFLICT(id) DO UPDATE SET
      title = @title,
      updated_at = @updatedAt,
      meta = @meta
  `).run({
    id: project.id,
    title: project.title,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    meta: jsonStr(project.meta)
  })
}

export function deleteProject(id: string) {
  db.prepare("DELETE FROM projects WHERE id = ?").run(id)
}

// ─── Threads CRUD ──────────────────────────────────
export function getThreadsByProject(projectId: string) {
  const rows = db.prepare("SELECT * FROM threads WHERE project_id = ? ORDER BY updated_at DESC").all(projectId) as any[]
  return rows.map(mapThread)
}

export function getAllThreads() {
  const rows = db.prepare("SELECT * FROM threads ORDER BY updated_at DESC").all() as any[]
  return rows.map(mapThread)
}

export function getThread(id: string) {
  const r = db.prepare("SELECT * FROM threads WHERE id = ?").get(id) as any
  if (!r) return null
  return mapThread(r)
}

function mapThread(r: any) {
  return {
    id: r.id,
    title: r.title,
    projectId: r.project_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    meta: jsonParse(r.meta)
  }
}

export function upsertThread(thread: { id: string; projectId: string; title: string; createdAt: string; updatedAt: string; meta?: any }) {
  db.prepare(`
    INSERT INTO threads (id, project_id, title, created_at, updated_at, meta)
    VALUES (@id, @projectId, @title, @createdAt, @updatedAt, @meta)
    ON CONFLICT(id) DO UPDATE SET
      project_id = @projectId,
      title = @title,
      updated_at = @updatedAt,
      meta = @meta
  `).run({
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    meta: jsonStr(thread.meta)
  })
}

export function deleteThread(id: string) {
  db.prepare("DELETE FROM threads WHERE id = ?").run(id)
}

// ─── Messages CRUD ─────────────────────────────────
export function getMessagesByThread(threadId: string) {
  const rows = db.prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY sort_order ASC, created_at ASC").all(threadId) as any[]
  return rows.map(mapMessage)
}

function mapMessage(r: any) {
  return {
    id: r.id,
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
    status: r.status ?? "done",
    requestMeta: jsonParse(r.request_meta, null),
    attachedFiles: jsonParse(r.attached_files, undefined),
    versionGroupId: r.version_group_id ?? undefined,
    versionIndex: r.version_index ?? undefined,
    isHidden: Boolean(r.is_hidden)
  }
}

// 안전 coercer: corvusx-office.html 의 메시지 모델(kind/body/ts) 을 DB 스키마로 변환.
// messages 테이블은 role IN ('user','assistant') CHECK 제약이 있어 낯선 값이 들어오면 INSERT 실패.
// 프론트가 누락/이름 차이로 잘못 보내도 500 이 나지 않도록 서버에서 한 번 더 정규화한다.
function coerceMessageForInsert(msg: any): {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string | number;
  status: string;
  requestMeta: any;
  attachedFiles: any;
  versionGroupId: string | null;
  versionIndex: number | null;
  isHidden: 0 | 1;
} {
  const rawRole = String(msg?.role ?? "").trim().toLowerCase()
  const kind = String(msg?.kind ?? "").trim().toLowerCase()
  const role: 'user' | 'assistant' =
    rawRole === 'user' ? 'user'
    : rawRole === 'assistant' ? 'assistant'
    : kind === 'user' ? 'user'
    : 'assistant'

  const rawContent = msg?.content ?? msg?.body ?? ""
  const content = typeof rawContent === "string" ? rawContent : String(rawContent)

  const createdAt = msg?.createdAt ?? (typeof msg?.ts === 'number' ? new Date(msg.ts).toISOString() : new Date().toISOString())

  const requestMeta = msg?.requestMeta ?? (kind || msg?.who || msg?.deptId || msg?.html !== undefined
    ? { kind: kind || undefined, who: msg?.who ?? undefined, deptId: msg?.deptId ?? undefined, html: msg?.html ?? undefined }
    : null)

  const attachedFiles = msg?.attachedFiles ?? (Array.isArray(msg?.attachments) && msg.attachments.length ? msg.attachments : null)

  const id = String(msg?.id ?? "").trim() || `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`

  return {
    id,
    role,
    content,
    createdAt,
    status: msg?.status ?? "done",
    requestMeta: requestMeta ? jsonStr(requestMeta) : null,
    attachedFiles: attachedFiles ? jsonStr(attachedFiles) : null,
    versionGroupId: msg?.versionGroupId ?? null,
    versionIndex: msg?.versionIndex ?? null,
    isHidden: msg?.isHidden ? 1 : 0,
  }
}

export function upsertMessage(threadId: string, msg: any, sortOrder: number) {
  const normalized = coerceMessageForInsert(msg)
  db.prepare(`
    INSERT INTO messages (id, thread_id, role, content, created_at, status, request_meta, attached_files, version_group_id, version_index, is_hidden, sort_order)
    VALUES (@id, @threadId, @role, @content, @createdAt, @status, @requestMeta, @attachedFiles, @versionGroupId, @versionIndex, @isHidden, @sortOrder)
    ON CONFLICT(id) DO UPDATE SET
      content = @content,
      status = @status,
      request_meta = @requestMeta,
      attached_files = @attachedFiles,
      version_group_id = @versionGroupId,
      version_index = @versionIndex,
      is_hidden = @isHidden,
      sort_order = @sortOrder
  `).run({
    ...normalized,
    threadId,
    sortOrder,
  })
}

export function deleteMessagesByThread(threadId: string) {
  db.prepare("DELETE FROM messages WHERE thread_id = ?").run(threadId)
}

export function deleteMessage(threadId: string, messageId: string) {
  db.prepare("DELETE FROM messages WHERE id = ? AND thread_id = ?").run(messageId, threadId)
}

// ─── Message Versions ──────────────────────────────
export function getMessageVersionsByThread(threadId: string) {
  const rows = db.prepare("SELECT * FROM message_versions WHERE thread_id = ? ORDER BY group_id, version_index").all(threadId) as any[]
  const groups: Record<string, any[]> = {}
  for (const r of rows) {
    if (!groups[r.group_id]) groups[r.group_id] = []
    groups[r.group_id].push({
      id: r.id,
      role: r.role,
      content: r.content,
      createdAt: r.created_at,
      status: r.status ?? "done",
      requestMeta: jsonParse(r.request_meta, null),
      attachedFiles: jsonParse(r.attached_files, undefined),
      versionGroupId: r.group_id,
      versionIndex: r.version_index,
      isHidden: Boolean(r.is_hidden)
    })
  }
  return groups
}

export function upsertMessageVersion(threadId: string, groupId: string, msg: any) {
  db.prepare(`
    INSERT INTO message_versions (id, thread_id, group_id, version_index, role, content, created_at, status, request_meta, attached_files, is_hidden)
    VALUES (@id, @threadId, @groupId, @versionIndex, @role, @content, @createdAt, @status, @requestMeta, @attachedFiles, @isHidden)
    ON CONFLICT(id) DO UPDATE SET
      content = @content,
      status = @status,
      request_meta = @requestMeta,
      is_hidden = @isHidden
  `).run({
    id: msg.id,
    threadId,
    groupId,
    versionIndex: msg.versionIndex ?? 0,
    role: msg.role,
    content: msg.content ?? "",
    createdAt: msg.createdAt,
    status: msg.status ?? "done",
    requestMeta: msg.requestMeta ? jsonStr(msg.requestMeta) : null,
    attachedFiles: msg.attachedFiles ? jsonStr(msg.attachedFiles) : null,
    isHidden: msg.isHidden ? 1 : 0
  })
}

export function deleteMessageVersionsByThread(threadId: string) {
  db.prepare("DELETE FROM message_versions WHERE thread_id = ?").run(threadId)
}

// ─── Active Version Index ──────────────────────────
export function getActiveVersionIndex(threadId: string): Record<string, number> {
  const rows = db.prepare("SELECT group_id, version_idx FROM active_version_index WHERE thread_id = ?").all(threadId) as any[]
  const result: Record<string, number> = {}
  for (const r of rows) {
    result[r.group_id] = r.version_idx
  }
  return result
}

export function setActiveVersionIndex(threadId: string, groupId: string, versionIdx: number) {
  db.prepare(`
    INSERT INTO active_version_index (thread_id, group_id, version_idx)
    VALUES (@threadId, @groupId, @versionIdx)
    ON CONFLICT(thread_id, group_id) DO UPDATE SET version_idx = @versionIdx
  `).run({ threadId, groupId, versionIdx })
}

export function deleteActiveVersionsByThread(threadId: string) {
  db.prepare("DELETE FROM active_version_index WHERE thread_id = ?").run(threadId)
}

// ─── Settings (globalInstruction 등) ───────────────
export function getSetting(key: string): string | null {
  const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as any
  return r?.value ?? null
}

export function setSetting(key: string, value: string) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET value = @value
  `).run({ key, value })
}

// ─── 일괄 저장 (프론트엔드 sync용) ────────────────
const saveThreadMessages = db.transaction((threadId: string, messages: any[]) => {
  deleteMessagesByThread(threadId)
  messages.forEach((msg, i) => upsertMessage(threadId, msg, i))
})

const saveThreadVersions = db.transaction((threadId: string, versions: Record<string, any[]>, activeIdx: Record<string, number>) => {
  deleteMessageVersionsByThread(threadId)
  deleteActiveVersionsByThread(threadId)

  for (const [groupId, msgs] of Object.entries(versions)) {
    for (const msg of msgs) {
      upsertMessageVersion(threadId, groupId, msg)
    }
  }
  for (const [groupId, idx] of Object.entries(activeIdx)) {
    setActiveVersionIndex(threadId, groupId, idx)
  }
})

export { saveThreadMessages, saveThreadVersions }

// ─── Full workspace snapshot (마이그레이션용) ──────
export const importFullSnapshot = db.transaction((snapshot: {
  projects: any[]
  threads: any[]
}) => {
  // __general__ 프로젝트 보장
  const now = new Date().toISOString()
  upsertProject({ id: "__general__", title: "일반", createdAt: now, updatedAt: now, meta: {} })

  for (const p of snapshot.projects) {
    upsertProject(p)
  }
  for (const t of snapshot.threads) {
    upsertThread({
      id: t.id,
      projectId: t.projectId,
      title: t.title,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      meta: t.meta
    })
    // messages
    if (Array.isArray(t.messages)) {
      saveThreadMessages(t.id, t.messages)
    }
    // versions
    if (t.messageVersions && typeof t.messageVersions === "object") {
      saveThreadVersions(t.id, t.messageVersions, t.activeVersionIndex ?? {})
    }
  }
})

export function getFullSnapshot() {
  const projects = getAllProjects()
  const threadRows = getAllThreads()

  const threads = threadRows.map(t => ({
    ...t,
    messages: getMessagesByThread(t.id),
    messageVersions: getMessageVersionsByThread(t.id),
    activeVersionIndex: getActiveVersionIndex(t.id)
  }))

  return { projects, threads }
}

// ─── DB 닫기 (graceful shutdown) ──────────────────
export function closeDb() {
  db.close()
}

logger.info(`[DB] SQLite initialized at ${DB_PATH}`)

export default db
