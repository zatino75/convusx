/**
 * instructionsStore.ts — 글로벌/프로젝트 별 시스템 지침 저장 (SQLite).
 *
 * 2026-04-29 신규.
 * - scope: 'global'             → 모든 대화에 자동 주입
 * - scope: 'project:<projectId>' → 해당 프로젝트 대화에만 주입
 *
 * 호출처:
 *   - routes/settings.ts: 지침 CRUD
 *   - agentLoop.buildSystemPrompt: getActiveInstructions() 로 활성 지침 자동 주입
 *   - DepartmentAgent.callPrimaryModel: 부서 system prompt 에 추가
 */

import { corvusxDb } from "./db/corvusxDb.js"
import { logger } from "./observability/logger.js"

export interface Instruction {
  id: number
  scope: string          // 'global' | 'project:<projectId>'
  content: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

const stmtList = corvusxDb.prepare(`
  SELECT id, scope, content, enabled, created_at AS createdAt, updated_at AS updatedAt
  FROM instructions WHERE scope = ?
  ORDER BY id ASC
`)

const stmtListEnabled = corvusxDb.prepare(`
  SELECT content FROM instructions WHERE scope = ? AND enabled = 1
  ORDER BY id ASC
`)

const stmtInsert = corvusxDb.prepare(`
  INSERT INTO instructions (scope, content, enabled, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
`)

const stmtGet = corvusxDb.prepare(`
  SELECT id, scope, content, enabled, created_at AS createdAt, updated_at AS updatedAt
  FROM instructions WHERE id = ?
`)

const stmtUpdate = corvusxDb.prepare(`
  UPDATE instructions SET content = ?, updated_at = ? WHERE id = ?
`)

const stmtToggle = corvusxDb.prepare(`
  UPDATE instructions SET enabled = ?, updated_at = ? WHERE id = ?
`)

const stmtDelete = corvusxDb.prepare(`DELETE FROM instructions WHERE id = ?`)

function rowToInstruction(row: any): Instruction {
  return {
    id: Number(row.id),
    scope: String(row.scope),
    content: String(row.content),
    enabled: Number(row.enabled) === 1,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  }
}

export function projectScope(projectId: string): string {
  return `project:${String(projectId).trim()}`
}

/** 글로벌 지침 목록 (활성 + 비활성 모두). */
export function listGlobal(): Instruction[] {
  const rows = stmtList.all("global") as any[]
  return rows.map(rowToInstruction)
}

/** 프로젝트 지침 목록. */
export function listProject(projectId: string): Instruction[] {
  if (!projectId) return []
  const rows = stmtList.all(projectScope(projectId)) as any[]
  return rows.map(rowToInstruction)
}

/** 단일 entry 조회. */
export function getById(id: number): Instruction | null {
  const row = stmtGet.get(id) as any
  return row ? rowToInstruction(row) : null
}

export interface CreateOptions {
  scope: string
  content: string
  enabled?: boolean
}

export function create(opts: CreateOptions): Instruction {
  const scope = String(opts.scope).trim()
  const content = String(opts.content ?? "").trim()
  if (!scope) throw new Error("scope_required")
  if (!content) throw new Error("content_required")
  if (content.length > 8000) throw new Error("content_too_long")
  const enabled = opts.enabled === false ? 0 : 1
  const now = Date.now()
  const result = stmtInsert.run(scope, content, enabled, now, now)
  const id = Number(result.lastInsertRowid)
  logger.info("[instructionsStore] create", { id, scope, length: content.length, enabled: !!enabled })
  return getById(id)!
}

export function update(id: number, content: string): Instruction {
  const c = String(content ?? "").trim()
  if (!c) throw new Error("content_required")
  if (c.length > 8000) throw new Error("content_too_long")
  const existing = getById(id)
  if (!existing) throw new Error("not_found")
  stmtUpdate.run(c, Date.now(), id)
  logger.info("[instructionsStore] update", { id, length: c.length })
  return getById(id)!
}

export function toggle(id: number, enabled: boolean): Instruction {
  const existing = getById(id)
  if (!existing) throw new Error("not_found")
  stmtToggle.run(enabled ? 1 : 0, Date.now(), id)
  logger.info("[instructionsStore] toggle", { id, enabled })
  return getById(id)!
}

export function remove(id: number): void {
  const existing = getById(id)
  if (!existing) throw new Error("not_found")
  stmtDelete.run(id)
  logger.info("[instructionsStore] delete", { id })
}

/**
 * 활성화된 지침 텍스트 배열 반환.
 * projectId 가 있으면 글로벌 + 해당 프로젝트, 없으면 글로벌만.
 */
export function getActiveInstructions(projectId?: string): { global: string[]; project: string[] } {
  const globalRows = stmtListEnabled.all("global") as Array<{ content: string }>
  const global = globalRows.map(r => String(r.content))
  let project: string[] = []
  if (projectId) {
    const projectRows = stmtListEnabled.all(projectScope(projectId)) as Array<{ content: string }>
    project = projectRows.map(r => String(r.content))
  }
  return { global, project }
}

/** 시스템 프롬프트에 주입할 단일 텍스트 블록. 활성 지침이 없으면 빈 문자열. */
export function buildInstructionsBlock(projectId?: string): string {
  const { global, project } = getActiveInstructions(projectId)
  if (global.length === 0 && project.length === 0) return ""
  const parts: string[] = []
  for (const g of global)  parts.push(`[글로벌 지침] ${g}`)
  for (const p of project) parts.push(`[프로젝트 지침] ${p}`)
  return parts.join("\n\n")
}
