/**
 * media.ts — 갤러리 라우트.
 *
 *   GET    /api/media/list             → 저장된 미디어 목록
 *   DELETE /api/media/delete  body:{ids:string[]}
 *   GET    /api/media/file/:filename   → 바이너리 본문 (인증 보호)
 *
 * 모두 /api/* 전역 인증 미들웨어로 보호됨.
 */

import { listMedia, deleteMedia, readMediaFile } from "../media/mediaStore.js"
import { logger } from "../observability/logger.js"

export async function runMediaListRoute(_req: any, res: any) {
  try {
    const items = listMedia()
    res.json({
      ok: true,
      count: items.length,
      totalSize: items.reduce((s, it) => s + it.size, 0),
      items,
    })
  } catch (err: any) {
    res.status?.(500)
    res.json({ ok: false, error: String(err?.message ?? err) })
  }
}

export async function runMediaDeleteRoute(req: any, res: any) {
  try {
    const body = req?.body ?? {}
    const ids = Array.isArray(body.ids) ? body.ids : []
    if (ids.length === 0) {
      res.status?.(400)
      return res.json({ ok: false, error: "ids_required" })
    }
    const results = ids.map((id: string) => ({ id, ...deleteMedia(id) }))
    const deleted = results.filter((r: any) => r.ok).length
    const failed = results.filter((r: any) => !r.ok)
    if (failed.length > 0) {
      logger.warn("[media] 일부 삭제 실패", { failed })
    }
    res.json({ ok: true, deleted, failed })
  } catch (err: any) {
    res.status?.(500)
    res.json({ ok: false, error: String(err?.message ?? err) })
  }
}

/**
 * raw 모드 — IncomingMessage + ServerResponse 직접 처리. 바이너리 응답을 위함.
 * index.ts 에서 router.get(path, handler, true) 로 등록한다 (3번째 인자 raw=true).
 */
export async function runMediaFileRoute(req: any, res: any) {
  const sendJson = (status: number, body: any) => {
    res.statusCode = status
    res.setHeader("Content-Type", "application/json; charset=utf-8")
    res.end(JSON.stringify(body))
  }
  try {
    const url = String(req?.url ?? "")
    const m = url.match(/\/api\/media\/file\/([^?]+)/)
    if (!m) return sendJson(404, { ok: false, error: "filename_required" })
    const filename = decodeURIComponent(m[1])
    const result = readMediaFile(filename)
    if (!result.ok || !result.data) {
      return sendJson(404, { ok: false, error: result.error ?? "not_found" })
    }
    res.statusCode = 200
    res.setHeader("Content-Type", result.mimeType ?? "application/octet-stream")
    res.setHeader("Cache-Control", "private, max-age=300")
    res.setHeader("Content-Length", String(result.data.length))
    res.end(result.data)
  } catch (err: any) {
    sendJson(500, { ok: false, error: String(err?.message ?? err) })
  }
}

export const mediaListRoute = { path: "/api/media/list", handler: runMediaListRoute }
export const mediaDeleteRoute = { path: "/api/media/delete", handler: runMediaDeleteRoute }
export const mediaFileRoute = { path: "/api/media/file", handler: runMediaFileRoute }
