import type { IncomingMessage, ServerResponse } from "node:http"
import { createHmac, randomBytes, timingSafeEqual, scryptSync } from "node:crypto"

// ──────────────────────────────────────────────────────────────────────────────
// CORVUS X — 인증 모듈
//
// 기존 구조(ADMIN_API_TOKEN + localhost 허용)는 그대로 유지하고,
// 공개 배포용(단일 유저) 비밀번호 로그인 + 세션 쿠키를 추가한다.
//
// 인증 우선순위:
//   1) localhost (개발 환경) → 항상 통과
//   2) Authorization: Bearer <ADMIN_API_TOKEN> → 통과
//   3) ?token=<ADMIN_API_TOKEN> → 통과
//   4) Cookie: corvus_session=<HMAC 서명 토큰> → 통과 (공개 배포 경로)
//
// 세션 쿠키는 서버 측 상태 없이 HMAC 서명으로 위조를 막는 stateless 방식이다.
//   payload = `${userId}.${expiresAt}` (millis)
//   sig = HMAC-SHA256(payload, CORVUS_SESSION_SECRET)
//   cookie = base64url(`${payload}.${sig}`)
// ──────────────────────────────────────────────────────────────────────────────

const SESSION_COOKIE_NAME = "corvus_session"
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000 // 30일

function getAdminToken(): string {
  return String(process.env.ADMIN_API_TOKEN ?? "").trim()
}

// 개발 환경 fallback — 프로세스 시작 시점의 랜덤값 (재시작 시 세션 무효화)
const _devFallbackSecret = randomBytes(32).toString("hex")

function getSessionSecret(): string {
  const s = String(process.env.CORVUS_SESSION_SECRET ?? "").trim()
  if (!s) return _devFallbackSecret
  return s
}

function getPasswordHash(): string {
  return String(process.env.CORVUS_ACCESS_PASSWORD_HASH ?? "").trim()
}

function getPlainPassword(): string {
  // 단순 배포용 fallback — CORVUS_ACCESS_PASSWORD_HASH 미설정 시 평문 비교
  return String(process.env.CORVUS_ACCESS_PASSWORD ?? "").trim()
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function base64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64")
}

// ── Localhost 판별 ────────────────────────────────────────────────────────────

export function isLocalRequest(req: IncomingMessage): boolean {
  // DISABLED 2026-04-11: nginx 리버스 프록시 환경에서는 모든 요청이 127.0.0.1 에서
  // 오므로 "로컬 자동 통과" 분기가 인증 자체를 무력화시킨다. 항상 false 를 반환해
  // 개발/프로덕션 양쪽에서 반드시 scrypt+HMAC 세션 쿠키 검증을 거치도록 강제한다.
  // 과거 구현은 git history 참조.
  void req
  return false
}

// ── 비밀번호 검증 ─────────────────────────────────────────────────────────────

/**
 * 비밀번호 검증. 두 가지 모드 지원:
 *   (a) CORVUS_ACCESS_PASSWORD_HASH 설정 시 → scrypt 해시 비교 (권장)
 *       형식: `scrypt$<N>$<saltHex>$<hashHex>`
 *   (b) CORVUS_ACCESS_PASSWORD 설정 시 → 평문 비교 (단순 배포용)
 * 둘 다 미설정 시 false (기본적으로 공개 로그인은 비활성화)
 */
export function verifyPassword(plain: string): boolean {
  const input = String(plain ?? "")
  if (!input) return false

  const hashEnv = getPasswordHash()
  if (hashEnv) {
    try {
      const parts = hashEnv.split("$")
      if (parts.length !== 4 || parts[0] !== "scrypt") return false
      const N = Number(parts[1])
      const salt = Buffer.from(parts[2], "hex")
      const expected = Buffer.from(parts[3], "hex")
      const actual = scryptSync(input, salt, expected.length, { N, r: 8, p: 1 })
      return expected.length === actual.length && timingSafeEqual(expected, actual)
    } catch {
      return false
    }
  }

  const plainEnv = getPlainPassword()
  if (plainEnv) {
    // timing-safe 비교
    const a = Buffer.from(input)
    const b = Buffer.from(plainEnv)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  }

  return false
}

export function isPasswordLoginEnabled(): boolean {
  return Boolean(getPasswordHash() || getPlainPassword())
}

// ── 세션 토큰 발급/검증 ───────────────────────────────────────────────────────

export interface SessionPayload {
  uid: string
  exp: number // millis epoch
}

export function issueSessionToken(uid: string = "owner", ttlMs: number = SESSION_DURATION_MS): string {
  const exp = Date.now() + ttlMs
  const payload = `${uid}.${exp}`
  const sig = createHmac("sha256", getSessionSecret()).update(payload).digest()
  const token = base64url(Buffer.from(`${payload}.${sig.toString("hex")}`, "utf8"))
  return token
}

export function verifySessionToken(token: string): SessionPayload | null {
  if (!token) return null
  try {
    const decoded = base64urlDecode(token).toString("utf8")
    const lastDot = decoded.lastIndexOf(".")
    if (lastDot < 0) return null
    const payload = decoded.slice(0, lastDot)
    const sigHex = decoded.slice(lastDot + 1)
    const expected = createHmac("sha256", getSessionSecret()).update(payload).digest()
    const given = Buffer.from(sigHex, "hex")
    if (expected.length !== given.length) return null
    if (!timingSafeEqual(expected, given)) return null

    const firstDot = payload.indexOf(".")
    if (firstDot < 0) return null
    const uid = payload.slice(0, firstDot)
    const exp = Number(payload.slice(firstDot + 1))
    if (!uid || !Number.isFinite(exp)) return null
    if (Date.now() > exp) return null

    return { uid, exp }
  } catch {
    return null
  }
}

// ── 쿠키 추출 ─────────────────────────────────────────────────────────────────

export function getCookie(req: IncomingMessage, name: string): string {
  const raw = String(req.headers?.cookie ?? "")
  if (!raw) return ""
  const parts = raw.split(";")
  for (const p of parts) {
    const [k, ...rest] = p.trim().split("=")
    if (k === name) return rest.join("=").trim()
  }
  return ""
}

export function getSessionFromRequest(req: IncomingMessage): SessionPayload | null {
  const cookieVal = getCookie(req, SESSION_COOKIE_NAME)
  if (!cookieVal) return null
  return verifySessionToken(cookieVal)
}

// ── 쿠키 설정/삭제 헬퍼 ───────────────────────────────────────────────────────

function buildCookie(name: string, value: string, opts: {
  maxAgeSec?: number
  secure?: boolean
  domain?: string
  sameSite?: "Lax" | "Strict" | "None"
}): string {
  const parts: string[] = [`${name}=${value}`]
  parts.push("Path=/")
  parts.push("HttpOnly")
  parts.push(`SameSite=${opts.sameSite ?? "Lax"}`)
  if (opts.secure) parts.push("Secure")
  if (opts.domain) parts.push(`Domain=${opts.domain}`)
  if (typeof opts.maxAgeSec === "number") parts.push(`Max-Age=${opts.maxAgeSec}`)
  return parts.join("; ")
}

function resolveSecureFlag(): boolean {
  const raw = String(process.env.CORVUS_COOKIE_SECURE ?? "auto").toLowerCase()
  if (raw === "true" || raw === "1" || raw === "yes") return true
  if (raw === "false" || raw === "0" || raw === "no") return false
  // auto: production 이면 true, 아니면 false
  return String(process.env.NODE_ENV ?? "").toLowerCase() === "production"
}

export function setSessionCookie(res: ServerResponse, token: string): void {
  const domain = String(process.env.CORVUS_COOKIE_DOMAIN ?? "").trim() || undefined
  const cookie = buildCookie(SESSION_COOKIE_NAME, token, {
    maxAgeSec: Math.floor(SESSION_DURATION_MS / 1000),
    secure: resolveSecureFlag(),
    domain,
    sameSite: "Lax",
  })
  res.setHeader("Set-Cookie", cookie)
}

export function clearSessionCookie(res: ServerResponse): void {
  const domain = String(process.env.CORVUS_COOKIE_DOMAIN ?? "").trim() || undefined
  const cookie = buildCookie(SESSION_COOKIE_NAME, "", {
    maxAgeSec: 0,
    secure: resolveSecureFlag(),
    domain,
    sameSite: "Lax",
  })
  res.setHeader("Set-Cookie", cookie)
}

// ── 인증 판정 ─────────────────────────────────────────────────────────────────

export function isAuthenticated(req: IncomingMessage): boolean {
  // 1) localhost 우회 (개발 환경 편의)
  if (isLocalRequest(req)) return true

  // 2) Bearer 토큰
  const adminToken = getAdminToken()
  if (adminToken) {
    const authHeader = String(req.headers?.authorization ?? "").trim()
    if (authHeader.startsWith("Bearer ") && authHeader.slice(7).trim() === adminToken) {
      return true
    }
    const url = new URL(req.url ?? "/", "http://localhost")
    if (url.searchParams.get("token") === adminToken) {
      return true
    }
  }

  // 3) 세션 쿠키
  const session = getSessionFromRequest(req)
  if (session) return true

  return false
}

export function requireAuth(req: IncomingMessage): { ok: boolean; error?: string } {
  if (isAuthenticated(req)) return { ok: true }
  return { ok: false, error: "unauthorized" }
}

// ── Whitelist (인증 없이 통과시킬 경로) ──────────────────────────────────────

const AUTH_WHITELIST = new Set<string>([
  "/api/health",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
])

export function isAuthWhitelisted(path: string): boolean {
  return AUTH_WHITELIST.has(path)
}
