// ── 외부 API Base URLs (프론트엔드 직접 호출용) ──
export const OPENAI_DIRECT_URL = "https://api.openai.com"

export function apiUrl(path: string): string {
  const base = String((import.meta as any).env?.VITE_API_BASE_URL ?? "").trim().replace(/\/$/, "")
  if (!base) return path
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}

/**
 * apiFetch — apiUrl() 변환 + VITE_API_TOKEN 자동 주입 + 세션 쿠키 포함
 *
 * ADMIN_API_TOKEN 없는 로컬 환경에서는 헤더 추가 없이 동작.
 * 공개 배포(app.cloudcookie.co.kr)에서는 corvus_session 쿠키가 자동 전송된다.
 * credentials: "include" 를 기본값으로 강제해 브라우저가 쿠키를 같이 보낸다.
 */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = apiUrl(path)
  const token = String((import.meta as any).env?.VITE_API_TOKEN ?? "").trim()
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
  return fetch(url, finalInit)
}
