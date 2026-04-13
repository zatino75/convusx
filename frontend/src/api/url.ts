// ── 외부 API Base URLs (프론트엔드 직접 호출용) ──
export const OPENAI_DIRECT_URL = "https://api.openai.com"

// ── 표준화된 API 에러 클래스 ──
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

/**
 * 백엔드/외부 API 에러 응답에서 메시지를 추출한다.
 * message → error → detail → title → errors[0] 순으로 시도.
 */
function extractErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) return fallback
  const b = body as Record<string, unknown>
  for (const key of ["message", "error", "detail", "title"]) {
    const val = b[key]
    if (typeof val === "string" && val.trim()) return val.trim()
  }
  // errors 배열 첫 번째 항목 시도
  if (Array.isArray(b.errors) && b.errors.length > 0) {
    const first = b.errors[0]
    if (typeof first === "string") return first
    if (typeof first === "object" && first !== null) {
      const msg = (first as Record<string, unknown>).message ?? (first as Record<string, unknown>).detail
      if (typeof msg === "string" && msg.trim()) return msg.trim()
    }
  }
  return fallback
}

export function apiUrl(path: string): string {
  const base = String(import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/$/, "")
  if (!base) return path
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}

/**
 * apiFetch — apiUrl() 변환 + VITE_API_TOKEN 자동 주입 + 세션 쿠키 포함
 *
 * ADMIN_API_TOKEN 없는 로컬 환경에서는 헤더 추가 없이 동작.
 * 공개 배포(app.cloudcookie.co.kr)에서는 corvus_session 쿠키가 자동 전송된다.
 * credentials: "include" 를 기본값으로 강제해 브라우저가 쿠키를 같이 보낸다.
 *
 * 2xx 이외의 응답은 ApiError 를 throw 한다.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = apiUrl(path)
  const token = String(import.meta.env.VITE_API_TOKEN ?? "").trim()
  const finalInit: RequestInit = {
    // 쿠키 로그인 지원 — 호출자가 명시적으로 지정하지 않으면 include
    credentials: init.credentials ?? "include",
    ...init,
  }
  if (token) {
    const headers = new Headers(finalInit.headers)
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`)
    }
    finalInit.headers = headers
  }
  const res = await fetch(url, finalInit)
  if (!res.ok) {
    let body: unknown
    try {
      body = await res.clone().json()
    } catch {
      body = await res.clone().text().catch(() => undefined)
    }
    const fallback = `HTTP ${res.status} ${res.statusText}`
    throw new ApiError(res.status, extractErrorMessage(body, fallback), body)
  }
  return res
}
