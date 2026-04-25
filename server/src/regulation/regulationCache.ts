// regulationCache.ts — CORVUS X Regulation Cache (Phase 4-B)
//
// 법규 갱신 스냅샷을 메모리 + 파일(JSON)에 영속 저장한다.
// regulationWatcher 가 주기적으로 업데이트하며, legal_review / *_regulation_check
// 도구 호출 시 빠르게 조회할 수 있게 한다.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { logger } from "../observability/logger.js"
import type { RegulationCategory } from "./regulationSources.js"

// ── 타입 정의 ──────────────────────────────────────────────────────────────
export type RegulationSnapshot = {
  source_id: string
  category: RegulationCategory
  fetched_at: number           // epoch ms
  content_hash: string         // sha256 of latest_answer
  last_change_at: number       // 마지막으로 content_hash 가 바뀐 시각
  latest_answer: string        // Perplexity 가 반환한 최근 상태 요약
  citations: string[]          // 출처 URL 배열
  ok: boolean
  error?: string
}

// ── 저장 경로 ─────────────────────────────────────────────────────────────
// 2026-04-25 Phase 3: cwd 기반 .cache 가 EACCES 로 실패하는 환경(서버 systemd) 대응.
// 우선순위: env var → cwd/.cache → /tmp/corvusx/regulation. 첫 mkdir 성공 경로를 사용.
const CACHE_DIR = resolveCacheDir()
const CACHE_FILE = path.join(CACHE_DIR, "regulation_cache.json")

function resolveCacheDir(): string {
  const envOverride = String(process.env.CORVUS_REGULATION_CACHE_DIR ?? "").trim()
  const candidates = [
    envOverride || null,
    path.join(process.cwd(), ".cache", "regulation"),
    path.join(os.tmpdir(), "corvusx", "regulation"),
  ].filter((p): p is string => !!p)

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true })
      return dir
    } catch (error: any) {
      logger.warn("[regulationCache] mkdir 실패, 다음 경로 시도", {
        dir,
        error: String(error?.message ?? error),
      })
    }
  }
  // 모든 후보 실패 시 tmpdir 반환 (이후 fs 작업이 다시 실패해도 catch 됨)
  return path.join(os.tmpdir(), "corvusx", "regulation")
}

// ── 메모리 캐시 ────────────────────────────────────────────────────────────
const memoryCache = new Map<string, RegulationSnapshot>()
let loaded = false

function ensureDir() {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true })
  } catch (error: any) {
    logger.warn("[regulationCache] mkdir failed", { error: String(error?.message ?? error) })
  }
}

export function loadCacheFromDisk(): void {
  if (loaded) return
  loaded = true
  ensureDir()
  if (!fs.existsSync(CACHE_FILE)) return
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf-8")
    const parsed = JSON.parse(raw) as RegulationSnapshot[]
    if (Array.isArray(parsed)) {
      for (const snap of parsed) {
        if (snap?.source_id) memoryCache.set(snap.source_id, snap)
      }
      logger.info("[regulationCache] loaded", { count: memoryCache.size })
    }
  } catch (error: any) {
    logger.warn("[regulationCache] load failed", { error: String(error?.message ?? error) })
  }
}

export function persistCacheToDisk(): void {
  ensureDir()
  try {
    const arr = [...memoryCache.values()]
    fs.writeFileSync(CACHE_FILE, JSON.stringify(arr, null, 2), "utf-8")
  } catch (error: any) {
    logger.warn("[regulationCache] persist failed", { error: String(error?.message ?? error) })
  }
}

// ── 접근자 ────────────────────────────────────────────────────────────────
export function getSnapshot(source_id: string): RegulationSnapshot | null {
  loadCacheFromDisk()
  return memoryCache.get(source_id) ?? null
}

export function getSnapshotsByCategory(category: RegulationCategory): RegulationSnapshot[] {
  loadCacheFromDisk()
  return [...memoryCache.values()].filter((s) => s.category === category)
}

export function getAllSnapshots(): RegulationSnapshot[] {
  loadCacheFromDisk()
  return [...memoryCache.values()]
}

export function hashContent(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex")
}

/**
 * 새 스냅샷을 upsert 한다. content_hash 가 달라지면 last_change_at 을 갱신.
 * 반환값: { changed: boolean, previous: RegulationSnapshot | null }
 */
export function upsertSnapshot(snap: Omit<RegulationSnapshot, "last_change_at"> & { last_change_at?: number }) {
  loadCacheFromDisk()
  const existing = memoryCache.get(snap.source_id) ?? null
  const now = snap.fetched_at ?? Date.now()
  let last_change_at = existing?.last_change_at ?? now
  let changed = false
  if (!existing || existing.content_hash !== snap.content_hash) {
    last_change_at = now
    changed = true
  }
  const finalSnap: RegulationSnapshot = {
    ...snap,
    last_change_at,
  }
  memoryCache.set(snap.source_id, finalSnap)
  persistCacheToDisk()
  return { changed, previous: existing, current: finalSnap }
}

/** 특정 source 의 캐시를 삭제 */
export function clearSnapshot(source_id: string): boolean {
  loadCacheFromDisk()
  const deleted = memoryCache.delete(source_id)
  if (deleted) persistCacheToDisk()
  return deleted
}

/** 전체 캐시 초기화 (디버그/테스트용) */
export function clearAllSnapshots(): void {
  memoryCache.clear()
  persistCacheToDisk()
}

/** 캐시 메타 요약 (UI/설정 화면용) */
export function getCacheSummary() {
  loadCacheFromDisk()
  const snaps = [...memoryCache.values()]
  const byCategory: Record<string, number> = {}
  let lastChangeAt = 0
  let lastFetchAt = 0
  for (const s of snaps) {
    byCategory[s.category] = (byCategory[s.category] ?? 0) + 1
    if (s.last_change_at > lastChangeAt) lastChangeAt = s.last_change_at
    if (s.fetched_at > lastFetchAt) lastFetchAt = s.fetched_at
  }
  return {
    total: snaps.length,
    byCategory,
    last_change_at: lastChangeAt || null,
    last_fetch_at: lastFetchAt || null,
  }
}
