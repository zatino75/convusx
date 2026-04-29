import type { IncomingMessage, ServerResponse } from "node:http"
import { randomBytes, scryptSync } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  verifyPassword,
  isPasswordLoginEnabled,
  issueSessionToken,
  setSessionCookie,
  clearSessionCookie,
  getSessionFromRequest,
  isLocalRequest,
} from "../http/auth.js"
import { readJsonBody } from "../http/middleware.js"
import { endJson } from "../http/response.js"
import { logger } from "../observability/logger.js"
import { getEnvPath } from "../apiKeysStore.js"
import { reloadNow as reloadEnv } from "../configReloader.js"

// ──────────────────────────────────────────────────────────────────────────────
// CORVUS X — 인증 라우트
//
// /api/auth/login  — POST { password } → 성공 시 세션 쿠키 설정
// /api/auth/logout — POST               → 쿠키 삭제
// /api/auth/me     — GET                → 현재 세션 상태 반환
// ──────────────────────────────────────────────────────────────────────────────

// 간이 rate limiting — 메모리 내 시도 카운터 (IP 기준)
const attempts = new Map<string, { count: number; firstAt: number; blockedUntil: number }>()
const MAX_ATTEMPTS = 10
const WINDOW_MS = 15 * 60 * 1000 // 15분
const BLOCK_MS = 15 * 60 * 1000 // 15분

function getClientKey(req: IncomingMessage): string {
  const fwd = String(req.headers?.["x-forwarded-for"] ?? "").split(",")[0].trim()
  if (fwd) return fwd
  return String((req as any).socket?.remoteAddress ?? "unknown")
}

function checkRateLimit(req: IncomingMessage): { ok: boolean; retryAfterSec?: number } {
  const key = getClientKey(req)
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry) return { ok: true }
  if (entry.blockedUntil > now) {
    return { ok: false, retryAfterSec: Math.ceil((entry.blockedUntil - now) / 1000) }
  }
  if (now - entry.firstAt > WINDOW_MS) {
    attempts.delete(key)
    return { ok: true }
  }
  if (entry.count >= MAX_ATTEMPTS) {
    entry.blockedUntil = now + BLOCK_MS
    return { ok: false, retryAfterSec: Math.ceil(BLOCK_MS / 1000) }
  }
  return { ok: true }
}

function recordFailure(req: IncomingMessage): void {
  const key = getClientKey(req)
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now, blockedUntil: 0 })
    return
  }
  entry.count += 1
  if (entry.count >= MAX_ATTEMPTS) {
    entry.blockedUntil = now + BLOCK_MS
  }
}

function clearFailures(req: IncomingMessage): void {
  attempts.delete(getClientKey(req))
}

// ── POST /api/auth/login ────────────────────────────────────────────────────

export async function authLoginRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isPasswordLoginEnabled()) {
    endJson(res, 503, { ok: false, error: "password_login_disabled" })
    return
  }

  const rl = checkRateLimit(req)
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfterSec ?? 900))
    endJson(res, 429, { ok: false, error: "too_many_attempts", retry_after_sec: rl.retryAfterSec })
    return
  }

  let body: Record<string, unknown> = {}
  try {
    body = await readJsonBody(req)
  } catch {
    endJson(res, 400, { ok: false, error: "invalid_body" })
    return
  }

  const password = String((body as any)?.password ?? "")
  if (!password) {
    recordFailure(req)
    endJson(res, 400, { ok: false, error: "password_required" })
    return
  }

  if (!verifyPassword(password)) {
    recordFailure(req)
    logger.warn("[auth] login failed", { client: getClientKey(req) })
    endJson(res, 401, { ok: false, error: "invalid_password" })
    return
  }

  clearFailures(req)
  const token = issueSessionToken("owner")
  setSessionCookie(res, token)
  logger.info("[auth] login success", { client: getClientKey(req) })
  endJson(res, 200, { ok: true, uid: "owner" })
}

// ── POST /api/auth/logout ───────────────────────────────────────────────────

export async function authLogoutRoute(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  clearSessionCookie(res)
  endJson(res, 200, { ok: true })
}

// ── GET /api/auth/me ─────────────────────────────────────────────────────────

export async function authMeRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // localhost 는 항상 로그인 상태로 간주
  if (isLocalRequest(req)) {
    endJson(res, 200, {
      ok: true,
      authenticated: true,
      uid: "local",
      login_enabled: isPasswordLoginEnabled(),
    })
    return
  }

  const session = getSessionFromRequest(req)
  if (session) {
    endJson(res, 200, {
      ok: true,
      authenticated: true,
      uid: session.uid,
      exp: session.exp,
      login_enabled: true,
    })
    return
  }

  endJson(res, 200, {
    ok: true,
    authenticated: false,
    login_enabled: isPasswordLoginEnabled(),
  })
}

// ── POST /api/auth/change-password ──────────────────────────────────────────
// 인증된 세션이 있어야 호출 가능 (index.ts 의 /api/* 가드가 보장).
// body: { currentPassword, newPassword }
//   1) currentPassword 가 기존 해시와 일치하는지 검증
//   2) 새 비밀번호로 scrypt 해시 생성 (N=2^15)
//   3) .env 의 CORVUS_ACCESS_PASSWORD_HASH 줄을 갱신
//   4) configReloader 가 process.env 를 즉시 반영

const SCRYPT_N = 1 << 15
const SCRYPT_KEYLEN = 64

function generatePasswordHash(plain: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(plain, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: 8, p: 1 })
  return `scrypt$${SCRYPT_N}$${salt.toString("hex")}$${derived.toString("hex")}`
}

function upsertEnvLine(filePath: string, key: string, value: string): void {
  let raw = ""
  try { raw = fs.readFileSync(filePath, "utf-8") } catch { /* file may not exist yet */ }
  const lines = raw ? raw.split(/\r?\n/) : []
  const idx = lines.findIndex(l => {
    const trimmed = l.trim().replace(/^\uFEFF/, "")
    if (!trimmed || trimmed.startsWith("#")) return false
    const eq = trimmed.indexOf("=")
    return eq > 0 && trimmed.slice(0, eq).trim() === key
  })
  const newLine = `${key}=${value}`
  if (idx >= 0) lines[idx] = newLine
  else lines.push(newLine)
  fs.writeFileSync(filePath, lines.join("\n"), "utf-8")
}

export async function authChangePasswordRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isPasswordLoginEnabled()) {
    endJson(res, 503, { ok: false, error: "password_login_disabled" })
    return
  }

  const session = getSessionFromRequest(req)
  if (!session) {
    endJson(res, 401, { ok: false, error: "unauthorized" })
    return
  }

  let body: Record<string, unknown> = {}
  try { body = await readJsonBody(req) }
  catch { endJson(res, 400, { ok: false, error: "invalid_body" }); return }

  const cur = String((body as any)?.currentPassword ?? "")
  const nw  = String((body as any)?.newPassword ?? "")
  if (!cur || !nw) { endJson(res, 400, { ok: false, error: "missing_passwords" }); return }
  if (nw.length < 8) { endJson(res, 400, { ok: false, error: "weak_password" }); return }

  if (!verifyPassword(cur)) {
    logger.warn("[auth] change-password rejected — wrong current password", { client: getClientKey(req) })
    endJson(res, 401, { ok: false, error: "wrong_password" })
    return
  }

  try {
    const newHash = generatePasswordHash(nw)
    const envPath = getEnvPath()
    upsertEnvLine(envPath, "CORVUS_ACCESS_PASSWORD_HASH", newHash)
    process.env.CORVUS_ACCESS_PASSWORD_HASH = newHash
    try { reloadEnv() } catch { /* ignore */ }
    logger.info("[auth] password changed", { client: getClientKey(req), envPath })
    endJson(res, 200, { ok: true })
  } catch (e: any) {
    logger.error("[auth] password write failed", { error: String(e?.message ?? e) })
    endJson(res, 500, { ok: false, error: "write_failed" })
  }
}
