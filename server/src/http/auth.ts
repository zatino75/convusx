// auth.ts — CORVUS X 인증 미들웨어
//
// 로그인 방식: 자체 세션 쿠키 (scrypt 비밀번호 해시 + HMAC-SHA256 서명)
// CORVUS_ACCESS_PASSWORD_HASH — scrypt$N$saltHex$hashHex
// CORVUS_SESSION_SECRET       — 48 byte hex
//
// 중요: isLocalRequest() 는 항상 false 반환
// (nginx 리버스 프록시 환경에서 모든 요청이 127.0.0.1 에서 오므로
//  localhost 자동 통과 분기는 인증 전체를 무력화한다 — CLAUDE.md 절대 재도입 금지)

import type { IncomingMessage, ServerResponse } from "node:http"
import { createHmac, timingSafeEqual, scryptSync } from "node:crypto"

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000
const COOKIE_NAME = "corvus_session"

// ── isLocalRequest — 항상 false ──────────────────────────────────────────────
export function isLocalRequest(_req: IncomingMessage): boolean {
  return false
}

// ── 비밀번호 검증 ─────────────────────────────────────────────────────────────
function parsePasswordHash(hash: string): { N: number; salt: Buffer; stored: Buffer } | null {
  const parts = hash.split("$")
  if (parts.length !== 4 || parts[0] !== "scrypt") return null
  try {
    const N = parseInt(parts[1], 10)
    const salt = Buffer.from(parts[2], "hex")
    const stored = Buffer.from(parts[3], "hex")
    if (!Number.isFinite(N) || N < 1024) return null
    if (salt.length < 16 || stored.length < 32) return null
    return { N, salt, stored }
  } catch {
    return null
  }
}

export function verifyPassword(plain: string): boolean {
  const hashEnv = process.env.CORVUS_ACCESS_PASSWORD_HASH
  if (!hashEnv) return false
  const parsed = parsePasswordHash(hashEnv.trim())
  if (!parsed) return false
  try {
    const derived = scryptSync(plain, parsed.salt, parsed.stored.length, { N: parsed.N, r: 8, p: 1 })
    return timingSafeEqual(derived, parsed.stored)
  } catch {
    return false
  }
}

export function isPasswordLoginEnabled(): boolean {
  return Boolean(process.env.CORVUS_ACCESS_PASSWORD_HASH?.trim())
}

// ── 세션 토큰 ─────────────────────────────────────────────────────────────────
export interface SessionPayload {
  uid: string
  iat: number
  exp: number
}

function getSessionSecret(): string {
  const secret = process.env.CORVUS_SESSION_SECRET
  if (!secret || secret.trim().length < 32) {
    return "corvus-insecure-dev-secret-do-not-use-in-production-set-CORVUS_SESSION_SECRET"
  }
  return secret.trim()
}

function signPayload(payload: SessionPayload): string {
  const secret = getSessionSecret()
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const sig = createHmac("sha256", secret).update(data).digest("base64url")
  return `${data}.${sig}`
}

function verifySignature(token: string): SessionPayload | null {
  const secret = getSessionSecret()
  const dotIdx = token.lastIndexOf(".")
  if (dotIdx < 0) return null
  const data = token.slice(0, dotIdx)
  const sig = token.slice(dotIdx + 1)
  const expected = createHmac("sha256", secret).update(data).digest("base64url")
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  } catch {
    return null
  }
  try {
    return JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as SessionPayload
  } catch {
    return null
  }
}

export function issueSessionToken(uid: string = "owner", ttlMs: number = SESSION_DURATION_MS): string {
  const now = Date.now()
  return signPayload({ uid, iat: now, exp: now + ttlMs })
}

export function verifySessionToken(token: string): SessionPayload | null {
  const payload = verifySignature(token)
  if (!payload) return null
  if (Date.now() > payload.exp) return null
  return payload
}

// ── 쿠키 ─────────────────────────────────────────────────────────────────────
export function getCookie(req: IncomingMessage, name: string): string {
  const header = String(req.headers["cookie"] ?? "")
  for (const cookie of header.split(";")) {
    const eqIdx = cookie.indexOf("=")
    if (eqIdx < 0) continue
    if (cookie.slice(0, eqIdx).trim() === name) {
      return decodeURIComponent(cookie.slice(eqIdx + 1).trim())
    }
  }
  return ""
}

export function getSessionFromRequest(req: IncomingMessage): SessionPayload | null {
  const cookieToken = getCookie(req, COOKIE_NAME)
  if (cookieToken) {
    const p = verifySessionToken(cookieToken)
    if (p) return p
  }

  const authHeader = String(req.headers["authorization"] ?? "")
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const p = verifySessionToken(authHeader.slice(7).trim())
    if (p) return p
  }

  const adminToken = process.env.CORVUS_ADMIN_TOKEN
  if (adminToken) {
    try {
      const url = new URL(req.url ?? "/", "http://localhost")
      if (url.searchParams.get("token") === adminToken) {
        return { uid: "admin_token", iat: Date.now(), exp: Date.now() + SESSION_DURATION_MS }
      }
    } catch { /* ignore */ }
  }

  return null
}

export function setSessionCookie(res: ServerResponse, token: string): void {
  const maxAge = Math.floor(SESSION_DURATION_MS / 1000)
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Max-Age=${maxAge}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
  ]
  if (process.env.NODE_ENV === "production") parts.push("Secure")
  res.setHeader("Set-Cookie", parts.join("; "))
}

export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict`)
}

// ── 인증 ─────────────────────────────────────────────────────────────────────
export function isAuthenticated(req: IncomingMessage): boolean {
  return getSessionFromRequest(req) !== null
}

export function requireAuth(req: IncomingMessage): { ok: boolean; error?: string } {
  if (isAuthenticated(req)) return { ok: true }
  return { ok: false, error: "unauthorized" }
}

// ── 화이트리스트 ──────────────────────────────────────────────────────────────
const AUTH_WHITELIST = new Set<string>([
  "/api/health",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
])

const AUTH_WHITELIST_PREFIXES: string[] = [
  "/api/external/",
]

export function isAuthWhitelisted(path: string): boolean {
  if (AUTH_WHITELIST.has(path)) return true
  return AUTH_WHITELIST_PREFIXES.some(prefix => path.startsWith(prefix))
}
