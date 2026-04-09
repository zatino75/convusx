/**
 * CORVUS X — Workspace REST API
 * 프론트엔드의 localStorage 대체 → SQLite 서버 저장
 */
import {
  getAllProjects,
  getProject,
  upsertProject,
  deleteProject as dbDeleteProject,
  getAllThreads,
  getThreadsByProject,
  getThread,
  upsertThread,
  deleteThread as dbDeleteThread,
  getMessagesByThread,
  upsertMessage,
  deleteMessagesByThread,
  deleteMessage as dbDeleteMessage,
  getMessageVersionsByThread,
  getActiveVersionIndex,
  saveThreadMessages,
  saveThreadVersions,
  getFullSnapshot,
  importFullSnapshot,
  getSetting,
  setSetting
} from "../db/database.js"
import { validateBody, workspaceProjectRules, workspaceThreadRules, workspaceMessageRules } from "../http/validation.js"
import type { ParsedRequest } from "../http/router.js"
import type { ExpressLikeResponse } from "../http/response.js"

/** Request with parsed JSON body */
type BodyReq = ParsedRequest
/** Request with route params (from index.ts manual construction) */
type ParamsReq = { params: { id: string } }
/** Request with query params (from index.ts manual construction) */
type QueryReq = { query: { projectId?: string; threadId?: string } }
type Res = ExpressLikeResponse

// ─── GET /api/workspace — 전체 스냅샷 로드 ────────
export function workspaceLoad(_req: unknown, res: Res) {
  const snapshot = getFullSnapshot()
  const globalInstruction = getSetting("global_instruction") ?? ""
  const activeProjectId = getSetting("active_project_id") ?? "__general__"
  const activeThreadId = getSetting("active_thread_id") ?? null

  res.status(200).json({
    ok: true,
    data: {
      ...snapshot,
      activeProjectId,
      activeThreadId,
      globalInstruction
    }
  })
}

// ─── POST /api/workspace/import — localStorage→DB 마이그레이션 ─
export function workspaceImport(req: BodyReq, res: Res) {
  const { projects, threads } = req.body as { projects?: unknown[]; threads?: unknown[] }
  if (!Array.isArray(projects) || !Array.isArray(threads)) {
    res.status(400).json({ ok: false, error: "invalid_snapshot" })
    return
  }
  importFullSnapshot({ projects, threads })
  res.status(200).json({ ok: true, imported: { projects: projects.length, threads: threads.length } })
}

// ─── POST /api/workspace/sync-state — activeProjectId/ThreadId 저장 ─
export function workspaceSyncState(req: BodyReq, res: Res) {
  const { activeProjectId, activeThreadId, globalInstruction } = req.body as {
    activeProjectId?: string
    activeThreadId?: string | null
    globalInstruction?: string
  }
  if (typeof activeProjectId === "string") setSetting("active_project_id", activeProjectId)
  if (typeof activeThreadId === "string") setSetting("active_thread_id", activeThreadId)
  else if (activeThreadId === null) setSetting("active_thread_id", "")
  if (typeof globalInstruction === "string") setSetting("global_instruction", globalInstruction)
  res.status(200).json({ ok: true })
}

// ─── Projects ──────────────────────────────────────
export function projectList(_req: unknown, res: Res) {
  res.status(200).json({ ok: true, data: getAllProjects() })
}

export function projectGet(req: ParamsReq, res: Res) {
  const id = req.params?.id ?? ""
  const project = getProject(id)
  if (!project) { res.status(404).json({ ok: false, error: "not_found" }); return }
  res.status(200).json({ ok: true, data: project })
}

export function projectUpsert(req: BodyReq, res: Res) {
  const p = req.body as Record<string, unknown>
  const validation = validateBody(p, workspaceProjectRules)
  if (!validation.ok) { res.status(400).json({ ok: false, error: validation.error }); return }
  upsertProject({
    id: p.id as string,
    title: p.title as string,
    createdAt: (p.createdAt as string) ?? new Date().toISOString(),
    updatedAt: (p.updatedAt as string) ?? new Date().toISOString(),
    meta: (p.meta as Record<string, unknown>) ?? {}
  })
  res.status(200).json({ ok: true })
}

export function projectDelete(req: ParamsReq, res: Res) {
  const id = req.params?.id ?? ""
  dbDeleteProject(id)
  res.status(200).json({ ok: true })
}

// ─── Threads ───────────────────────────────────────
export function threadList(req: QueryReq, res: Res) {
  const projectId = req.query?.projectId
  const threads = projectId ? getThreadsByProject(projectId) : getAllThreads()
  res.status(200).json({ ok: true, data: threads })
}

export function threadGet(req: ParamsReq, res: Res) {
  const id = req.params?.id ?? ""
  const thread = getThread(id)
  if (!thread) { res.status(404).json({ ok: false, error: "not_found" }); return }

  const messages = getMessagesByThread(id)
  const messageVersions = getMessageVersionsByThread(id)
  const activeVersionIndex = getActiveVersionIndex(id)

  res.status(200).json({
    ok: true,
    data: { ...thread, messages, messageVersions, activeVersionIndex }
  })
}

export function threadUpsert(req: BodyReq, res: Res) {
  const t = req.body as Record<string, unknown>
  const validation = validateBody(t, workspaceThreadRules)
  if (!validation.ok) { res.status(400).json({ ok: false, error: validation.error }); return }

  upsertThread({
    id: t.id as string,
    projectId: t.projectId as string,
    title: (t.title as string) ?? "새 채팅",
    createdAt: (t.createdAt as string) ?? new Date().toISOString(),
    updatedAt: (t.updatedAt as string) ?? new Date().toISOString(),
    meta: (t.meta as Record<string, unknown>) ?? {}
  })

  // messages가 포함된 경우 같이 저장
  if (Array.isArray(t.messages)) {
    saveThreadMessages(t.id as string, t.messages)
  }

  // versions가 포함된 경우 같이 저장
  if (t.messageVersions && typeof t.messageVersions === "object") {
    saveThreadVersions(t.id as string, t.messageVersions as Record<string, any[]>, (t.activeVersionIndex ?? {}) as Record<string, number>)
  }

  res.status(200).json({ ok: true })
}

export function threadDelete(req: ParamsReq, res: Res) {
  const id = req.params?.id ?? ""
  dbDeleteThread(id)
  res.status(200).json({ ok: true })
}

// ─── Messages ──────────────────────────────────────
export function messageList(req: ParamsReq & QueryReq, res: Res) {
  const threadId = req.params?.id ?? req.query?.threadId ?? ""
  const messages = getMessagesByThread(threadId)
  res.status(200).json({ ok: true, data: messages })
}

export function messageSave(req: BodyReq, res: Res) {
  const body = req.body as Record<string, unknown>
  const validation = validateBody(body, workspaceMessageRules)
  if (!validation.ok) { res.status(400).json({ ok: false, error: validation.error }); return }
  const { threadId, messages } = body as { threadId: string; messages: unknown[] }
  saveThreadMessages(threadId, messages)
  res.status(200).json({ ok: true })
}

export function messageDelete(req: BodyReq, res: Res) {
  const { threadId, messageId } = req.body as { threadId?: string; messageId?: string }
  if (!threadId || !messageId) { res.status(400).json({ ok: false, error: "invalid_input" }); return }
  dbDeleteMessage(threadId, messageId)
  res.status(200).json({ ok: true })
}

// ─── Versions ──────────────────────────────────────
export function versionsSave(req: BodyReq, res: Res) {
  const { threadId, messageVersions, activeVersionIndex } = req.body as {
    threadId?: string
    messageVersions?: Record<string, any[]>
    activeVersionIndex?: Record<string, number>
  }
  if (!threadId) { res.status(400).json({ ok: false, error: "invalid_input" }); return }
  saveThreadVersions(threadId, messageVersions ?? {}, activeVersionIndex ?? {})
  res.status(200).json({ ok: true })
}
