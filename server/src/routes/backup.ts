/**
 * CORVUS X — Workspace Backup / Restore API
 *
 * B1: 전체 워크스페이스(프로젝트, 스레드, 메시지, 설정, 소스자산)를 JSON으로 백업
 * B2: JSON 백업에서 복원 (가져오기)
 */

import { getFullSnapshot, importFullSnapshot, getSetting, setSetting } from "../db/database.js"
import { getProjectSourceAssets, addProjectSourceAsset } from "../memory/projectMemory.js"
import { logger } from "../observability/logger.js"
import type { ParsedRequest } from "../http/router.js"
import type { ExpressLikeResponse } from "../http/response.js"

interface BackupPayload {
  version: number
  created_at: string
  service: string
  data: {
    snapshot: ReturnType<typeof getFullSnapshot>
    settings: Record<string, string | null>
    sources: Record<string, any[]>
  }
}

const BACKUP_VERSION = 1

// ── POST /api/backup/export — 전체 백업 생성 ──
export function backupExport(_req: ParsedRequest, res: ExpressLikeResponse) {
  try {
    const snapshot = getFullSnapshot()

    // 설정 수집
    const settingKeys = ["global_instruction", "active_project_id", "active_thread_id"]
    const settings: Record<string, string | null> = {}
    for (const key of settingKeys) {
      settings[key] = getSetting(key)
    }

    // 프로젝트별 소스 자산 수집
    const sources: Record<string, any[]> = {}
    for (const project of snapshot.projects) {
      const assets = getProjectSourceAssets(project.id)
      if (assets.length > 0) {
        sources[project.id] = assets
      }
    }

    const payload: BackupPayload = {
      version: BACKUP_VERSION,
      created_at: new Date().toISOString(),
      service: "CORVUS X",
      data: { snapshot, settings, sources }
    }

    const json = JSON.stringify(payload)
    const sizeBytes = Buffer.byteLength(json, "utf-8")

    logger.info("[backup] export created", {
      projects: snapshot.projects.length,
      threads: snapshot.threads.length,
      size_bytes: sizeBytes
    })

    res.json({
      ok: true,
      backup: payload,
      meta: {
        projects: snapshot.projects.length,
        threads: snapshot.threads.length,
        size_bytes: sizeBytes
      }
    })
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e)
    logger.error("[backup] export failed", { error: errMsg })
    res.json({ ok: false, error: errMsg })
  }
}

// ── POST /api/backup/download — 파일 다운로드 형태로 백업 ──
export function backupDownload(_req: any, res: any) {
  try {
    const snapshot = getFullSnapshot()

    const settingKeys = ["global_instruction", "active_project_id", "active_thread_id"]
    const settings: Record<string, string | null> = {}
    for (const key of settingKeys) {
      settings[key] = getSetting(key)
    }

    const sources: Record<string, any[]> = {}
    for (const project of snapshot.projects) {
      const assets = getProjectSourceAssets(project.id)
      if (assets.length > 0) sources[project.id] = assets
    }

    const payload: BackupPayload = {
      version: BACKUP_VERSION,
      created_at: new Date().toISOString(),
      service: "CORVUS X",
      data: { snapshot, settings, sources }
    }

    const json = JSON.stringify(payload, null, 2)
    const timestamp = new Date().toISOString().slice(0, 10)
    const filename = `corvus-x-backup_${timestamp}.json`

    res.writeHead?.(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(Buffer.byteLength(json, "utf-8"))
    })
    res.end?.(json)
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e)
    res.writeHead?.(500, { "Content-Type": "application/json" })
    res.end?.(JSON.stringify({ ok: false, error: errMsg }))
  }
}

// ── POST /api/backup/restore — 백업에서 복원 ──
export function backupRestore(req: ParsedRequest, res: ExpressLikeResponse) {
  // X-Confirm-Reset 헤더 필수 (파괴적 작업)
  const confirmHeader = String(req?.headers?.["x-confirm-reset"] ?? "").trim().toLowerCase()
  if (confirmHeader !== "true") {
    return res.json({ ok: false, error: "missing_confirmation", message: "X-Confirm-Reset: true 헤더가 필요합니다." })
  }

  try {
    const body = req.body as Record<string, unknown>
    const backup = (body?.backup ?? body) as BackupPayload

    // 버전 체크
    if (!backup?.version || !backup?.data?.snapshot) {
      return res.json({ ok: false, error: "invalid_backup_format" })
    }

    if (backup.version > BACKUP_VERSION) {
      return res.json({ ok: false, error: "unsupported_backup_version", max_supported: BACKUP_VERSION })
    }

    const { snapshot, settings, sources } = backup.data

    // 스냅샷 복원
    if (!Array.isArray(snapshot?.projects) || !Array.isArray(snapshot?.threads)) {
      return res.json({ ok: false, error: "invalid_snapshot_data" })
    }

    importFullSnapshot(snapshot)

    // 설정 복원
    if (settings && typeof settings === "object") {
      for (const [key, value] of Object.entries(settings)) {
        if (typeof value === "string") {
          setSetting(key, value)
        }
      }
    }

    // 소스 자산 복원 (프로젝트 메모리는 별도 처리)
    let sourceCount = 0
    if (sources && typeof sources === "object") {
      for (const [projectId, assets] of Object.entries(sources)) {
        if (!Array.isArray(assets)) continue
        for (const asset of assets) {
          try {
            addProjectSourceAsset(projectId, asset)
            sourceCount++
          } catch { /* 개별 실패 무시 */ }
        }
      }
    }

    logger.info("[backup] restore completed", {
      projects: snapshot.projects.length,
      threads: snapshot.threads.length,
      sources: sourceCount,
      backup_date: backup.created_at
    })

    res.json({
      ok: true,
      restored: {
        projects: snapshot.projects.length,
        threads: snapshot.threads.length,
        sources: sourceCount,
        backup_date: backup.created_at
      }
    })
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e)
    logger.error("[backup] restore failed", { error: errMsg })
    res.json({ ok: false, error: errMsg })
  }
}
