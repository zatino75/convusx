/**
 * mediaStore.ts — CORVUS X 생성 미디어 영속 저장소
 *
 * 2026-04-25 신규.
 * 생성된 이미지/동영상을 디스크에 저장하고 갤러리(/api/media/list)에서 조회할 수 있게 한다.
 *
 * 저장 위치 우선순위:
 *   1. env CORVUS_MEDIA_DIR
 *   2. /opt/corvusx/server/uploads/media (server 가동 위치 기준)
 *   3. os.tmpdir()/corvusx/media (모든 mkdir 실패 시)
 *
 * 파일명: <ISO timestamp>-<short uuid>.<ext>  (예: 2026-04-25T12-30-00Z-a1b2c3.png)
 * 사이드카: <filename>.meta.json — { prompt, model, chatId, createdAt, type, mimeType }
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { logger } from "../observability/logger.js"

const MEDIA_DIR = resolveMediaDir()

function resolveMediaDir(): string {
  const envOverride = String(process.env.CORVUS_MEDIA_DIR ?? "").trim()
  const candidates = [
    envOverride || null,
    path.join(process.cwd(), "uploads", "media"),
    path.join(os.tmpdir(), "corvusx", "media"),
  ].filter((p): p is string => !!p)

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true })
      return dir
    } catch (err: any) {
      logger.warn("[mediaStore] mkdir 실패, 다음 후보 시도", { dir, error: String(err?.message ?? err) })
    }
  }
  return path.join(os.tmpdir(), "corvusx", "media")
}

export function getMediaDir(): string {
  return MEDIA_DIR
}

// ── 타입 ────────────────────────────────────────────────────────
export type MediaType = "image" | "video"

export interface MediaMeta {
  prompt?: string
  model?: string
  chatId?: string
  threadId?: string
  createdAt: string  // ISO
  type: MediaType
  mimeType: string
}

export interface MediaItem extends MediaMeta {
  id: string         // filename (확장자 포함)
  filename: string
  size: number       // bytes
  url: string        // /api/media/file/<filename>
}

// ── 파일명 생성 ──────────────────────────────────────────────────
function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "Z")
}

function shortUuid(): string {
  return crypto.randomBytes(4).toString("hex")
}

function extFromMime(mime: string, fallback = "bin"): string {
  const m = String(mime || "").toLowerCase()
  if (m.includes("png")) return "png"
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg"
  if (m.includes("webp")) return "webp"
  if (m.includes("gif")) return "gif"
  if (m.includes("mp4")) return "mp4"
  if (m.includes("webm")) return "webm"
  if (m.includes("quicktime") || m.includes("mov")) return "mov"
  return fallback
}

function typeFromMime(mime: string): MediaType {
  return String(mime || "").toLowerCase().startsWith("video/") ? "video" : "image"
}

// ── 저장 ────────────────────────────────────────────────────────
export interface SaveMediaInput {
  url?: string
  dataUri?: string         // data:image/png;base64,xxxx
  base64?: string          // raw base64 (no data: prefix)
  mimeType?: string        // raw base64 일 때 필수
  prompt?: string
  model?: string
  chatId?: string
  threadId?: string
  filenameHint?: string    // 확장자 기준 추정용
}

export interface SaveMediaResult {
  ok: boolean
  filename?: string
  url?: string             // /api/media/file/<filename>
  error?: string
}

/**
 * 외부 URL 다운로드 또는 base64 디코드 후 디스크 저장.
 * 생성 핸들러에서 호출. 실패는 non-fatal — 호출 측은 결과만 로깅하고 채팅엔 영향 없음.
 */
export async function saveMedia(input: SaveMediaInput): Promise<SaveMediaResult> {
  try {
    let buffer: Buffer
    let mimeType = String(input.mimeType ?? "").trim()

    if (input.dataUri) {
      // data:image/png;base64,xxxx
      const m = input.dataUri.match(/^data:([^;]+);base64,(.+)$/)
      if (!m) return { ok: false, error: "invalid_data_uri" }
      mimeType = mimeType || m[1]
      buffer = Buffer.from(m[2], "base64")
    } else if (input.base64) {
      if (!mimeType) return { ok: false, error: "missing_mime_type_for_base64" }
      buffer = Buffer.from(input.base64, "base64")
    } else if (input.url) {
      const res = await fetch(input.url, { signal: AbortSignal.timeout(30_000) })
      if (!res.ok) return { ok: false, error: `fetch_failed_${res.status}` }
      const arr = new Uint8Array(await res.arrayBuffer())
      buffer = Buffer.from(arr)
      mimeType = mimeType || res.headers.get("content-type") || ""
      if (!mimeType && input.filenameHint) {
        const e = path.extname(input.filenameHint).toLowerCase().slice(1)
        if (e === "png") mimeType = "image/png"
        else if (e === "jpg" || e === "jpeg") mimeType = "image/jpeg"
        else if (e === "webp") mimeType = "image/webp"
        else if (e === "mp4") mimeType = "video/mp4"
      }
      if (!mimeType) mimeType = "application/octet-stream"
    } else {
      return { ok: false, error: "no_source_provided" }
    }

    if (buffer.length === 0) return { ok: false, error: "empty_buffer" }

    const ext = extFromMime(mimeType, "bin")
    const filename = `${timestampSlug()}-${shortUuid()}.${ext}`
    const filePath = path.join(MEDIA_DIR, filename)
    const metaPath = `${filePath}.meta.json`

    fs.writeFileSync(filePath, buffer)
    const meta: MediaMeta = {
      prompt: input.prompt,
      model: input.model,
      chatId: input.chatId,
      threadId: input.threadId,
      createdAt: new Date().toISOString(),
      type: typeFromMime(mimeType),
      mimeType,
    }
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8")

    return { ok: true, filename, url: `/api/media/file/${encodeURIComponent(filename)}` }
  } catch (err: any) {
    logger.warn("[mediaStore] save 실패", { error: String(err?.message ?? err) })
    return { ok: false, error: String(err?.message ?? err) }
  }
}

// ── 조회 ────────────────────────────────────────────────────────
export function listMedia(): MediaItem[] {
  let entries: string[] = []
  try { entries = fs.readdirSync(MEDIA_DIR) } catch { return [] }

  const items: MediaItem[] = []
  for (const name of entries) {
    if (name.endsWith(".meta.json")) continue
    const filePath = path.join(MEDIA_DIR, name)
    let stat: fs.Stats
    try { stat = fs.statSync(filePath) } catch { continue }
    if (!stat.isFile()) continue

    const metaPath = `${filePath}.meta.json`
    let meta: MediaMeta | null = null
    if (fs.existsSync(metaPath)) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) } catch { meta = null }
    }
    const ext = path.extname(name).slice(1).toLowerCase()
    const inferredType: MediaType = ["mp4", "webm", "mov"].includes(ext) ? "video" : "image"
    const inferredMime = meta?.mimeType || (
      ext === "png" ? "image/png" :
      ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
      ext === "webp" ? "image/webp" :
      ext === "gif" ? "image/gif" :
      ext === "mp4" ? "video/mp4" :
      ext === "webm" ? "video/webm" :
      "application/octet-stream"
    )

    items.push({
      id: name,
      filename: name,
      size: stat.size,
      url: `/api/media/file/${encodeURIComponent(name)}`,
      prompt: meta?.prompt,
      model: meta?.model,
      chatId: meta?.chatId,
      threadId: meta?.threadId,
      createdAt: meta?.createdAt ?? stat.mtime.toISOString(),
      type: meta?.type ?? inferredType,
      mimeType: inferredMime,
    })
  }
  // 최신순 정렬
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return items
}

// ── 삭제 ────────────────────────────────────────────────────────
/**
 * 파일명 안전 검증: 디렉터리 traversal 방지.
 * MEDIA_DIR 내 일반 파일만 삭제 허용. .meta.json 도 같이 제거.
 */
export function deleteMedia(filename: string): { ok: boolean; error?: string } {
  const safe = path.basename(String(filename ?? ""))
  if (!safe || safe.includes("..") || safe.includes("/") || safe.includes("\\")) {
    return { ok: false, error: "invalid_filename" }
  }
  const filePath = path.join(MEDIA_DIR, safe)
  // 절대 경로 검증
  const realDir = path.resolve(MEDIA_DIR)
  const realFile = path.resolve(filePath)
  if (!realFile.startsWith(realDir + path.sep) && realFile !== realDir) {
    return { ok: false, error: "path_escape" }
  }
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    const metaPath = `${filePath}.meta.json`
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath)
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}

/**
 * 파일 데이터 + mime 반환 (route handler 가 응답 본문에 쓰기 위함).
 */
export function readMediaFile(filename: string): { ok: boolean; data?: Buffer; mimeType?: string; error?: string } {
  const safe = path.basename(String(filename ?? ""))
  if (!safe || safe.includes("..") || safe.includes("/") || safe.includes("\\")) {
    return { ok: false, error: "invalid_filename" }
  }
  const filePath = path.join(MEDIA_DIR, safe)
  const realDir = path.resolve(MEDIA_DIR)
  const realFile = path.resolve(filePath)
  if (!realFile.startsWith(realDir + path.sep) && realFile !== realDir) {
    return { ok: false, error: "path_escape" }
  }
  if (!fs.existsSync(filePath)) return { ok: false, error: "not_found" }
  try {
    const data = fs.readFileSync(filePath)
    const ext = path.extname(safe).slice(1).toLowerCase()
    let mime = "application/octet-stream"
    const metaPath = `${filePath}.meta.json`
    if (fs.existsSync(metaPath)) {
      try { mime = JSON.parse(fs.readFileSync(metaPath, "utf-8"))?.mimeType ?? mime } catch { /* ignore */ }
    }
    if (mime === "application/octet-stream") {
      mime = ext === "png" ? "image/png"
        : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
        : ext === "webp" ? "image/webp"
        : ext === "gif" ? "image/gif"
        : ext === "mp4" ? "video/mp4"
        : ext === "webm" ? "video/webm"
        : ext === "mov" ? "video/quicktime"
        : "application/octet-stream"
    }
    return { ok: true, data, mimeType: mime }
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}
