/**
 * mediaStore.ts — CORVUS X 생성 미디어 영속 저장소.
 *
 * 2026-04-25 신규 + Phase 8 확장:
 *   - 저장 경로(쓰기): MEDIA_DIR 단일 (env CORVUS_MEDIA_DIR > server/uploads/media > tmp)
 *   - 조회 경로(읽기): MEDIA_DIR + 추가 후보(server/uploads, server/public/generated, server/data/media)
 *     중 존재하는 모든 디렉토리를 스캔, 결과 병합.
 *
 * URL 형식: /api/media/file/<filename>
 * 동일 파일명 충돌 시 첫번째 후보 디렉토리 우선.
 *
 * 사이드카: <filename>.meta.json — { prompt, model, chatId, createdAt, type, mimeType }
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { logger } from "../observability/logger.js"

// ── 디렉토리 결정 ─────────────────────────────────────────────────
const SUPPORTED_EXTS = new Set([
  "png", "jpg", "jpeg", "webp", "gif",
  "mp4", "webm", "mov",
])

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

const MEDIA_DIR = resolveMediaDir()

/** 모든 조회 후보 디렉토리. 중복 제거 + 존재하는 것만. */
function listSearchDirs(): string[] {
  const candidates = [
    MEDIA_DIR,
    path.join(process.cwd(), "uploads"),
    path.join(process.cwd(), "public", "generated"),
    path.join(process.cwd(), "data", "media"),
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of candidates) {
    let real: string
    try { real = fs.realpathSync(c) } catch { continue }
    if (seen.has(real)) continue
    seen.add(real)
    out.push(c)
  }
  return out
}

export function getMediaDir(): string { return MEDIA_DIR }
export function getSearchDirs(): string[] { return listSearchDirs() }

// ── 타입 ─────────────────────────────────────────────────────────
export type MediaType = "image" | "video"

export interface MediaMeta {
  prompt?: string
  model?: string
  chatId?: string
  threadId?: string
  createdAt: string
  type: MediaType
  mimeType: string
}

export interface MediaItem extends MediaMeta {
  id: string
  filename: string
  size: number
  url: string
  /** 어느 디렉토리에서 발견됐는지 (디버그/삭제용). */
  sourceDir: string
}

// ── 파일명 / mime 헬퍼 ───────────────────────────────────────────
function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "Z")
}
function shortUuid(): string { return crypto.randomBytes(4).toString("hex") }

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
function mimeFromExt(ext: string): string {
  const e = ext.toLowerCase()
  if (e === "png") return "image/png"
  if (e === "jpg" || e === "jpeg") return "image/jpeg"
  if (e === "webp") return "image/webp"
  if (e === "gif") return "image/gif"
  if (e === "mp4") return "video/mp4"
  if (e === "webm") return "video/webm"
  if (e === "mov") return "video/quicktime"
  return "application/octet-stream"
}

// ── 저장 (변경 없음) ──────────────────────────────────────────────
export interface SaveMediaInput {
  url?: string
  dataUri?: string
  base64?: string
  mimeType?: string
  prompt?: string
  model?: string
  chatId?: string
  threadId?: string
  filenameHint?: string
}
export interface SaveMediaResult { ok: boolean; filename?: string; url?: string; error?: string }

export async function saveMedia(input: SaveMediaInput): Promise<SaveMediaResult> {
  try {
    let buffer: Buffer
    let mimeType = String(input.mimeType ?? "").trim()

    if (input.dataUri) {
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
        mimeType = mimeFromExt(e)
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

// ── 조회 (다중 디렉토리 스캔) ─────────────────────────────────────
export function listMedia(): MediaItem[] {
  const dirs = listSearchDirs()
  const items: MediaItem[] = []
  const seenFilenames = new Set<string>()

  for (const dir of dirs) {
    let entries: string[] = []
    try { entries = fs.readdirSync(dir) } catch { continue }
    for (const name of entries) {
      if (name.endsWith(".meta.json")) continue
      const ext = path.extname(name).slice(1).toLowerCase()
      if (!SUPPORTED_EXTS.has(ext)) continue
      if (seenFilenames.has(name)) continue
      seenFilenames.add(name)

      const filePath = path.join(dir, name)
      let stat: fs.Stats
      try { stat = fs.statSync(filePath) } catch { continue }
      if (!stat.isFile()) continue

      const metaPath = `${filePath}.meta.json`
      let meta: MediaMeta | null = null
      if (fs.existsSync(metaPath)) {
        try { meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) } catch { meta = null }
      }
      const inferredType: MediaType = ["mp4", "webm", "mov"].includes(ext) ? "video" : "image"
      const inferredMime = meta?.mimeType || mimeFromExt(ext)

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
        sourceDir: dir,
      })
    }
  }
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return items
}

// ── 헬퍼: 파일명 → 실제 경로 (search dirs 순회) ───────────────────
function findFilePath(filename: string): { filePath: string; dir: string } | null {
  const safe = path.basename(String(filename ?? ""))
  if (!safe || safe.includes("..") || safe.includes("/") || safe.includes("\\")) return null
  for (const dir of listSearchDirs()) {
    const filePath = path.join(dir, safe)
    if (!fs.existsSync(filePath)) continue
    const realDir = path.resolve(dir)
    const realFile = path.resolve(filePath)
    if (!realFile.startsWith(realDir + path.sep) && realFile !== realDir) continue
    return { filePath, dir }
  }
  return null
}

// ── 삭제 ─────────────────────────────────────────────────────────
export function deleteMedia(filename: string): { ok: boolean; error?: string } {
  const safe = path.basename(String(filename ?? ""))
  if (!safe || safe.includes("..") || safe.includes("/") || safe.includes("\\")) {
    return { ok: false, error: "invalid_filename" }
  }
  const found = findFilePath(safe)
  if (!found) return { ok: false, error: "not_found" }
  try {
    fs.unlinkSync(found.filePath)
    const metaPath = `${found.filePath}.meta.json`
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath)
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}

// ── 바이너리 읽기 ─────────────────────────────────────────────────
export function readMediaFile(filename: string): { ok: boolean; data?: Buffer; mimeType?: string; error?: string } {
  const safe = path.basename(String(filename ?? ""))
  if (!safe || safe.includes("..") || safe.includes("/") || safe.includes("\\")) {
    return { ok: false, error: "invalid_filename" }
  }
  const found = findFilePath(safe)
  if (!found) return { ok: false, error: "not_found" }
  try {
    const data = fs.readFileSync(found.filePath)
    const ext = path.extname(safe).slice(1).toLowerCase()
    let mime = "application/octet-stream"
    const metaPath = `${found.filePath}.meta.json`
    if (fs.existsSync(metaPath)) {
      try { mime = JSON.parse(fs.readFileSync(metaPath, "utf-8"))?.mimeType ?? mime } catch { /* ignore */ }
    }
    if (mime === "application/octet-stream") mime = mimeFromExt(ext)
    return { ok: true, data, mimeType: mime }
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}
