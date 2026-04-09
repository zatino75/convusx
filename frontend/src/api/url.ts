// ── 외부 API Base URLs (프론트엔드 직접 호출용) ──
export const OPENAI_DIRECT_URL = "https://api.openai.com"

export function apiUrl(path: string): string {
  const base = String((import.meta as any).env?.VITE_API_BASE_URL ?? "").trim().replace(/\/$/, "")
  if (!base) return path
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}

/**
 * apiFetch — apiUrl() 변환 + VITE_API_TOKEN 자동 주입
 * ADMIN_API_TOKEN 없는 로컬 환경에서는 헤더 추가 없이 그대로 동작
 */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = apiUrl(path)
  const token = String((import.meta as any).env?.VITE_API_TOKEN ?? "").trim()
  if (token) {
    const headers = new Headers(init.headers)
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`)
    }
    return fetch(url, { ...init, headers })
  }
  return fetch(url, init)
}
