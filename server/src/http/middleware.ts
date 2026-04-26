import type { IncomingMessage, ServerResponse } from "node:http"

// CORS 허용 도메인 목록 (빈 배열 = "*" 전체 허용)
let _corsOrigins: string[] = []

/** 서버 시작 시 환경변수에서 CORS 도메인 설정 */
export function initCorsOrigins(origins: string[]): void {
  _corsOrigins = origins
}

export function setCorsHeaders(res: ServerResponse, req?: IncomingMessage) {
  const origin = String(req?.headers?.origin ?? "").trim()
  let originSet = false

  if (_corsOrigins.length === 0) {
    // 화이트리스트 미설정 → 전체 허용 (개발 환경)
    // credentials 쿠키 사용 시 "*"는 브라우저가 거부하므로 origin 을 그대로 반사
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin)
      res.setHeader("Vary", "Origin")
    } else {
      res.setHeader("Access-Control-Allow-Origin", "*")
    }
    originSet = true
  } else if (origin && _corsOrigins.includes(origin)) {
    // 화이트리스트 매치 → 해당 origin만 허용
    res.setHeader("Access-Control-Allow-Origin", origin)
    res.setHeader("Vary", "Origin")
    originSet = true
  } else if (origin) {
    // 화이트리스트에 없는 origin → 허용 안 함 (헤더 미설정)
    return
  } else {
    // origin 헤더 없음 (same-origin 또는 비브라우저) → 첫 번째 도메인
    res.setHeader("Access-Control-Allow-Origin", _corsOrigins[0])
    res.setHeader("Vary", "Origin")
    originSet = true
  }

  // credentials(쿠키) 허용 — 단일 유저 세션 쿠키 지원에 필요
  // 단, Origin 이 "*" 인 경우에는 브라우저가 거부하므로 반사된 경우에만 설정
  if (originSet && res.getHeader("Access-Control-Allow-Origin") !== "*") {
    res.setHeader("Access-Control-Allow-Credentials", "true")
  }

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Correlation-Id, X-Confirm-Reset, Cookie"
  )
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
}

export function setSecurityHeaders(res: ServerResponse) {
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("X-Frame-Options", "DENY")
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'"
  )
}

export function handleOptions(req: IncomingMessage, res: ServerResponse): boolean {
  if (String(req.method ?? "GET").toUpperCase() === "OPTIONS") {
    setCorsHeaders(res, req)
    res.statusCode = 204
    res.end()
    return true
  }
  return false
}

const MAX_BODY_SIZE = 50 * 1024 * 1024 // 50MB

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let totalSize = 0

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalSize += buf.length
    if (totalSize > MAX_BODY_SIZE) {
      // 즉시 차단 — 나머지 바디를 메모리에 올리지 않음
      req.destroy()
      throw new Error("request_body_too_large")
    }
    chunks.push(buf)
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim()

  if (!raw) return {}

  try {
    return JSON.parse(raw)
  } catch {
    return { __raw: raw }
  }
}

export function normalizePath(urlValue: string | undefined): string {
  return String(urlValue ?? "").split("?")[0] || "/"
}
