import { useCallback, useEffect, useState } from "react"
import { apiFetch } from "../api/url"

// ──────────────────────────────────────────────────────────────────────────────
// CORVUS X — 프론트 인증 훅
//
// 서버 /api/auth/me 로 현재 세션 상태를 조회한다.
//   - authenticated=true  → 메인 앱 표시
//   - authenticated=false → LoginPage 표시
//   - login_enabled=false → 서버가 비밀번호 로그인을 비활성 (dev/localhost)
// ──────────────────────────────────────────────────────────────────────────────

export type AuthStatus = "loading" | "authed" | "unauthed" | "error"

export interface AuthState {
  status: AuthStatus
  loginEnabled: boolean
  uid: string | null
  error: string | null
}

export interface AuthActions {
  login: (password: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

export function useAuth(): AuthState & AuthActions {
  const [status, setStatus] = useState<AuthStatus>("loading")
  const [loginEnabled, setLoginEnabled] = useState<boolean>(false)
  const [uid, setUid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await apiFetch("/api/auth/me", {
        method: "GET",
        credentials: "include",
      })
      if (!r.ok) {
        setStatus("error")
        setError(`auth_me_failed_${r.status}`)
        return
      }
      const data = await r.json().catch(() => null) as any
      if (!data || data.ok !== true) {
        setStatus("error")
        setError("auth_me_invalid")
        return
      }
      setLoginEnabled(Boolean(data.login_enabled))
      if (data.authenticated) {
        setUid(typeof data.uid === "string" ? data.uid : "owner")
        setStatus("authed")
        setError(null)
      } else {
        setUid(null)
        setStatus("unauthed")
        setError(null)
      }
    } catch (e: any) {
      setStatus("error")
      setError(String(e?.message ?? e))
    }
  }, [])

  const login = useCallback(async (password: string) => {
    try {
      const r = await apiFetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const data = await r.json().catch(() => null) as any
      if (!r.ok || !data || data.ok !== true) {
        const err = String(data?.error ?? `login_failed_${r.status}`)
        return { ok: false, error: err }
      }
      await refresh()
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) }
    }
  }, [refresh])

  const logout = useCallback(async () => {
    try {
      await apiFetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      })
    } catch {
      /* 무시 — 쿠키는 서버에서 만료 처리 */
    }
    setStatus("unauthed")
    setUid(null)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    status,
    loginEnabled,
    uid,
    error,
    login,
    logout,
    refresh,
  }
}
