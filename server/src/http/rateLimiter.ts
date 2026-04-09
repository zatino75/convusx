/**
 * CORVUS X — Token Bucket Rate Limiter
 *
 * IP 기반 요청 제한. 엔드포인트 그룹별 별도 버킷 운영.
 * - chat: /api/chat, /api/chat/stream → 분당 30회 (burst 5)
 * - general: 기타 API → 분당 120회 (burst 20)
 *
 * SQLite 영속화: 서버 시작 시 복원, 종료 시 저장.
 * 런타임은 인메모리 Map으로 동작 (성능 유지).
 */

import type { IncomingMessage, ServerResponse } from "node:http"
import { logger } from "../observability/logger.js"
import {
  RATE_LIMIT_CHAT_RPM,
  RATE_LIMIT_CHAT_BURST,
  RATE_LIMIT_GENERAL_RPM,
  RATE_LIMIT_GENERAL_BURST,
  RATE_LIMIT_WINDOW_MS,
} from "../config/defaults.js"

type BucketConfig = {
  maxTokens: number   // 버킷 최대 토큰 (burst 허용량)
  refillRate: number  // 밀리초당 토큰 리필량
}

type Bucket = {
  tokens: number
  lastRefill: number
}

const buckets = new Map<string, Bucket>()

// 오래된 버킷 정리 주기 (5분)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const BUCKET_EXPIRY_MS = 10 * 60 * 1000

// ── SQLite 영속화 ──
// db 인스턴스를 매개변수로 받아 순환 import 방지

function hasRateLimitTable(db: any): boolean {
  try {
    return Boolean(db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='rate_limit_buckets'"
    ).get())
  } catch { return false }
}

/** 서버 시작 시 SQLite에서 버킷 복원 (index.ts에서 호출) */
export function restoreBucketsFromDb(db: any): void {
  try {
    if (!hasRateLimitTable(db)) return
    const now = Date.now()
    const rows = db.prepare(
      "SELECT bucket_id, tokens, last_refill FROM rate_limit_buckets WHERE updated_at > ?"
    ).all(now - BUCKET_EXPIRY_MS) as { bucket_id: string; tokens: number; last_refill: number }[]

    for (const row of rows) {
      buckets.set(row.bucket_id, { tokens: row.tokens, lastRefill: row.last_refill })
    }
    if (rows.length > 0) {
      logger.debug("rate limiter restored from db", { count: rows.length })
    }
  } catch {
    // DB 접근 실패 시 무시 — 인메모리로 진행
  }
}

/** 서버 종료 시 현재 버킷 상태를 SQLite에 저장 (index.ts shutdown에서 호출) */
export function persistBucketsToDb(db: any): void {
  try {
    if (!hasRateLimitTable(db)) return
    const now = Date.now()
    const upsert = db.prepare(`
      INSERT INTO rate_limit_buckets (bucket_id, tokens, last_refill, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(bucket_id) DO UPDATE SET tokens = ?, last_refill = ?, updated_at = ?
    `)
    const saveAll = db.transaction(() => {
      db.prepare("DELETE FROM rate_limit_buckets WHERE updated_at < ?").run(now - BUCKET_EXPIRY_MS)
      for (const [id, bucket] of buckets) {
        upsert.run(id, bucket.tokens, bucket.lastRefill, now, bucket.tokens, bucket.lastRefill, now)
      }
    })
    saveAll()
    logger.debug("rate limiter persisted to db", { count: buckets.size })
  } catch {
    // 저장 실패 시 무시
  }
}

function getBucketConfig(path: string): { key: string; config: BucketConfig } {
  const isChatRoute = path === "/api/chat" || path === "/api/chat/stream"

  if (isChatRoute) {
    return {
      key: "chat",
      config: {
        maxTokens: RATE_LIMIT_CHAT_BURST,
        refillRate: RATE_LIMIT_CHAT_RPM / (60 * 1000), // RPM → 밀리초당
      },
    }
  }

  return {
    key: "general",
    config: {
      maxTokens: RATE_LIMIT_GENERAL_BURST,
      refillRate: RATE_LIMIT_GENERAL_RPM / (60 * 1000),
    },
  }
}

function getClientIp(req: IncomingMessage): string {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim()
  if (forwarded) return forwarded
  return String((req as any).socket?.remoteAddress ?? "unknown")
}

function consume(bucketId: string, config: BucketConfig): boolean {
  const now = Date.now()
  let bucket = buckets.get(bucketId)

  if (!bucket) {
    bucket = { tokens: config.maxTokens, lastRefill: now }
    buckets.set(bucketId, bucket)
  }

  // 리필
  const elapsed = now - bucket.lastRefill
  bucket.tokens = Math.min(
    config.maxTokens,
    bucket.tokens + elapsed * config.refillRate
  )
  bucket.lastRefill = now

  // 소비
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1
    return true
  }

  return false
}

/**
 * Rate limit 체크. 초과 시 429 응답 전송하고 true 반환.
 * 통과 시 false 반환.
 */
export function checkRateLimit(req: IncomingMessage, res: ServerResponse, path: string): boolean {
  const ip = getClientIp(req)
  const { key, config } = getBucketConfig(path)
  const bucketId = `${ip}:${key}`

  if (consume(bucketId, config)) {
    return false // 통과
  }

  // 초과
  const retryAfterSec = Math.ceil(1 / (config.refillRate * 1000))
  res.setHeader("Retry-After", String(retryAfterSec))
  res.setHeader("X-RateLimit-Limit", String(config.maxTokens))
  res.setHeader("X-RateLimit-Remaining", "0")
  res.statusCode = 429
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify({ ok: false, error: "rate_limit_exceeded", retry_after_seconds: retryAfterSec }))

  logger.warn("rate limit exceeded", { ip, bucket: key, path })
  return true // 차단됨
}

// ── 주기적 버킷 정리 (메모리 누수 방지) ──
setInterval(() => {
  const now = Date.now()
  let cleaned = 0
  for (const [id, bucket] of buckets) {
    if (now - bucket.lastRefill > BUCKET_EXPIRY_MS) {
      buckets.delete(id)
      cleaned++
    }
  }
  if (cleaned > 0) {
    logger.debug("rate limiter cleanup", { cleaned, remaining: buckets.size })
  }
}, CLEANUP_INTERVAL_MS).unref()
