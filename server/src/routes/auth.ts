import type { IncomingMessage, ServerResponse } from "node:http"
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
