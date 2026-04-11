// attachmentCache.ts — 연속 턴 첨부파일 캐시.
//
// 목적: 사용자가 첨부파일을 올리고 후속 턴에서 "이어서 설명해줘", "그 파일에서",
// "위에서 본" 같은 참조형 발화를 했을 때, 기존 파일을 프론트에서 재업로드받지 않고
// 서버에서 복원해 orchestra / 파이프라인에 다시 주입하기 위한 모듈.
//
// 설계:
// - thread_id 를 key 로 한 단일 레벨 Map
// - 파일 1개(primary) + 추가 파일(pending) 보관
// - 7일 TTL, 파일 단위 10MB 제한, 총 100MB 상한
// - data/attachment-cache.json 로 영속화 (프로세스 재시작 후 복원)
//
// 연속 턴 감지:
// - looksLikeContinuation() — 짧은 메시지 + 참조 키워드 패턴

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export type CachedAttachment = {
  name: string
  type: string
  base64: string
  size: number
}

type CacheEntry = {
  thread_id: string
  project_id: string
  primary: CachedAttachment | null
  pending: CachedAttachment[]
  updated_at: number
}

type AttachmentStoreType = Record<string, CacheEntry>

const DATA_DIR = path.resolve(__dirname, "../../../data")
const DATA_FILE = path.join(DATA_DIR, "attachment-cache.json")

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024          // 10MB per file
const MAX_TOTAL_CACHE_BYTES = 100 * 1024 * 1024       // 100MB total
const MAX_PENDING_PER_THREAD = 5
const TTL_MS = 7 * 24 * 60 * 60 * 1000                // 7 days

const AttachmentStore: AttachmentStoreType = loadStore()

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function loadStore(): AttachmentStoreType {
  try {
    if (!fs.existsSync(DATA_FILE)) return {}
    const raw = fs.readFileSync(DATA_FILE, "utf-8")
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}
    const now = Date.now()
    for (const [key, entry] of Object.entries(parsed as AttachmentStoreType)) {
      if (!entry || typeof entry !== "object") {
        delete (parsed as any)[key]
        continue
      }
      if (now - Number(entry.updated_at ?? 0) > TTL_MS) {
        delete (parsed as any)[key]
      }
    }
    return parsed as AttachmentStoreType
  } catch {
    return {}
  }
}

function saveStore() {
  try {
    ensureDataDir()
    fs.writeFileSync(DATA_FILE, JSON.stringify(AttachmentStore, null, 2), "utf-8")
  } catch {
    // 디스크 쓰기 실패해도 in-memory cache 는 유지 — 다음 턴 복원엔 문제 없음
  }
}

function estimateBytes(att: CachedAttachment | null | undefined): number {
  if (!att?.base64) return 0
  return Math.ceil(att.base64.length * 0.75)
}

function isTooBig(att: CachedAttachment): boolean {
  return estimateBytes(att) > MAX_FILE_SIZE_BYTES
}

function entrySizeBytes(entry: CacheEntry): number {
  let total = 0
  if (entry.primary) total += estimateBytes(entry.primary)
  for (const p of entry.pending) total += estimateBytes(p)
  return total
}

// 총 캐시 용량 초과 시 오래된 항목부터 삭제
function enforceMaxTotalSize() {
  const entries = Object.values(AttachmentStore)
  let total = 0
  for (const e of entries) total += entrySizeBytes(e)
  if (total <= MAX_TOTAL_CACHE_BYTES) return

  const sorted = Object.entries(AttachmentStore).sort(
    (a, b) => Number(a[1].updated_at ?? 0) - Number(b[1].updated_at ?? 0),
  )
  for (const [key, entry] of sorted) {
    if (total <= MAX_TOTAL_CACHE_BYTES) break
    const removed = entrySizeBytes(entry)
    delete AttachmentStore[key]
    total -= removed
  }
}

// 첨부 객체를 캐시용으로 정규화 (원본 그대로 저장하면 불필요한 필드가 딸려감)
function toCachedAttachment(att: any): CachedAttachment | null {
  const base64 = String(att?.base64 ?? "")
  if (!base64) return null
  const name = String(att?.name ?? "unknown")
  const type = String(att?.type ?? "")
  const size = Number(att?.size ?? Math.ceil(base64.length * 0.75))
  return { name, type, base64, size }
}

/**
 * 현재 턴의 첨부파일을 thread_id 기준으로 저장.
 * primary 는 attached_file, pending 은 pending_analysis_files.
 */
export function saveThreadAttachments(
  threadId: string,
  projectId: string,
  primary: any,
  pending: any[] = [],
) {
  const key = String(threadId ?? "").trim()
  if (!key) return

  const safePrimary = (() => {
    const c = toCachedAttachment(primary)
    if (!c) return null
    if (isTooBig(c)) return null
    return c
  })()

  const safePending = (pending ?? [])
    .map((p) => toCachedAttachment(p))
    .filter((c): c is CachedAttachment => c !== null && !isTooBig(c))
    .slice(0, MAX_PENDING_PER_THREAD)

  if (!safePrimary && safePending.length === 0) return

  AttachmentStore[key] = {
    thread_id: key,
    project_id: String(projectId ?? ""),
    primary: safePrimary,
    pending: safePending,
    updated_at: Date.now(),
  }

  enforceMaxTotalSize()
  saveStore()
}

/**
 * 이전 턴까지 쌓인 스레드 첨부 반환. TTL 만료 시 자동 제거.
 */
export function getThreadAttachments(threadId: string): CacheEntry | null {
  const key = String(threadId ?? "").trim()
  if (!key) return null
  const entry = AttachmentStore[key]
  if (!entry) return null
  if (Date.now() - Number(entry.updated_at ?? 0) > TTL_MS) {
    delete AttachmentStore[key]
    saveStore()
    return null
  }
  return entry
}

export function clearThreadAttachments(threadId: string) {
  const key = String(threadId ?? "").trim()
  if (!key) return
  if (AttachmentStore[key]) {
    delete AttachmentStore[key]
    saveStore()
  }
}

export function clearAllAttachmentCache() {
  for (const key of Object.keys(AttachmentStore)) {
    delete AttachmentStore[key]
  }
  saveStore()
}

// ── 연속 턴 감지 ─────────────────────────────────────────────────────────
// 사용자 메시지가 "이전에 올린 파일"을 가리키는지 heuristic 으로 판별.
// false positive 를 최소화하기 위해:
//  1) 메시지가 짧거나 (< 200자)
//  2) 참조형 키워드가 명시적으로 등장할 때만 true
// 긴 신규 질문은 continuation 이 아니라고 본다.

const CONTINUATION_PATTERNS: RegExp[] = [
  /이어서/,
  /계속(해|하여|해서)?/,
  /아까/,
  /방금/,
  /앞서|앞에서|앞에 있(는|던)/,
  /위(에서|의|에|쪽)/,
  /이전(에|의)?/,
  /저번|지난번/,
  /그\s*(거|것|파일|내용|문서|자료|보고서|이미지|사진|pdf|엑셀|워드|ppt|데이터)/i,
  /이\s*(거|것|파일|내용|문서|자료|보고서|이미지|사진|pdf|엑셀|워드|ppt|데이터)/i,
  /해당\s*(파일|문서|자료|내용|보고서)/,
  /다시\s*(설명|분석|요약|검토|정리|해석)/,
  /더\s*(자세히|깊이|상세|정리|설명)/,
  /추가(로|해서|적으로)/,
  /나머지/,
  /그런데\s*(아까|방금|그)/,
  /파일에서/,
  /문서에서/,
]

// 오히려 명확한 "신규 업로드" 신호가 있는 경우는 false 강제
const NEGATIVE_PATTERNS: RegExp[] = [
  /새\s*(파일|문서|자료|이미지|사진)/,
  /다른\s*(파일|문서|자료|이미지|사진)/,
  /업로드|첨부(했|하)/,
]

export function looksLikeContinuation(message: string): boolean {
  const text = String(message ?? "").trim()
  if (!text) return true // 빈 메시지는 이전 컨텍스트를 이어간다고 가정

  for (const neg of NEGATIVE_PATTERNS) {
    if (neg.test(text)) return false
  }

  if (text.length < 200) {
    for (const p of CONTINUATION_PATTERNS) {
      if (p.test(text)) return true
    }
  }
  return false
}
