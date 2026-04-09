/**
 * CORVUS X — Workspace API Client
 * 서버 SQLite DB와 통신하는 프론트엔드 레이어
 */
import { apiFetch } from "./url"
import { devLog } from "../utils/helpers"

async function post(path: string, body: any) {
  try {
    const res = await apiFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
    return await res.json()
  } catch (err) {
    devLog.warn("[WorkspaceAPI] POST failed:", path, err)
    return { ok: false }
  }
}

async function del(path: string) {
  try {
    const res = await apiFetch(path, { method: "DELETE" })
    return await res.json()
  } catch (err) {
    devLog.warn("[WorkspaceAPI] DELETE failed:", path, err)
    return { ok: false }
  }
}

async function get(path: string) {
  try {
    const res = await apiFetch(path)
    return await res.json()
  } catch (err) {
    devLog.warn("[WorkspaceAPI] GET failed:", path, err)
    return { ok: false }
  }
}

// ─── 전체 스냅샷 로드 ─────────────────────────────
export async function loadWorkspaceFromServer() {
  return get("/api/workspace")
}

// ─── localStorage → 서버 마이그레이션 ─────────────
export async function importSnapshot(projects: any[], threads: any[]) {
  return post("/api/workspace/import", { projects, threads })
}

// ─── 활성 상태 동기화 (activeProjectId, activeThreadId, globalInstruction) ─
export function syncState(state: { activeProjectId?: string; activeThreadId?: string | null; globalInstruction?: string }) {
  // fire-and-forget
  post("/api/workspace/sync-state", state).catch(e => devLog.warn("[WorkspaceAPI] syncState failed:", e))
}

// ─── Project CRUD ──────────────────────────────────
export function saveProject(project: any) {
  post("/api/workspace/projects", project).catch(e => devLog.warn("[WorkspaceAPI] saveProject failed:", e))
}

export function removeProject(id: string) {
  del(`/api/workspace/projects/${id}`).catch(e => devLog.warn("[WorkspaceAPI] removeProject failed:", e))
}

// ─── Thread CRUD ───────────────────────────────────
export function saveThread(thread: any) {
  post("/api/workspace/threads", thread).catch(e => devLog.warn("[WorkspaceAPI] saveThread failed:", e))
}

export function removeThread(id: string) {
  del(`/api/workspace/threads/${id}`).catch(e => devLog.warn("[WorkspaceAPI] removeThread failed:", e))
}

// ─── Messages 일괄 저장 ───────────────────────────
export function saveMessages(threadId: string, messages: any[]) {
  post("/api/workspace/messages", { threadId, messages }).catch(e => devLog.warn("[WorkspaceAPI] saveMessages failed:", e))
}

export function removeMessage(threadId: string, messageId: string) {
  post("/api/workspace/messages", { threadId, messageId }).catch(e => devLog.warn("[WorkspaceAPI] removeMessage failed:", e))
}

// ─── Versions 저장 ─────────────────────────────────
export function saveVersions(threadId: string, messageVersions: any, activeVersionIndex: any) {
  post("/api/workspace/versions", { threadId, messageVersions, activeVersionIndex }).catch(e => devLog.warn("[WorkspaceAPI] saveVersions failed:", e))
}
