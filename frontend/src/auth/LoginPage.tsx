import { useState, type FormEvent } from "react"
import { t } from "../i18n"

// ──────────────────────────────────────────────────────────────────────────────
// CORVUS X — 로그인 페이지
//
// 단일 유저 비밀번호 로그인. useAuth.login(password) 를 호출하고
// 성공 시 부모가 자동으로 <App /> 으로 전환한다.
// ──────────────────────────────────────────────────────────────────────────────

export interface LoginPageProps {
  onSubmit: (password: string) => Promise<{ ok: boolean; error?: string }>
}

export default function LoginPage({ onSubmit }: LoginPageProps) {
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!password || submitting) return
    setSubmitting(true)
    setErrorKey(null)
    const r = await onSubmit(password)
    setSubmitting(false)
    if (!r.ok) {
      setErrorKey(r.error ?? "login_failed")
      setPassword("")
      return
    }
  }

  function errorText(key: string): string {
    switch (key) {
      case "invalid_password":
        return t("auth.errorInvalidPassword")
      case "password_required":
        return t("auth.errorPasswordRequired")
      case "too_many_attempts":
        return t("auth.errorTooManyAttempts")
      case "password_login_disabled":
        return t("auth.errorDisabled")
      default:
        return t("auth.errorGeneric")
    }
  }

  return (
    <div
      role="main"
      aria-label="CORVUS X login"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg, #0b0d10)",
        color: "var(--text, #e7eaee)",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        padding: 20,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: 380,
          background: "var(--panel, #14181d)",
          border: "1px solid var(--border, #262b33)",
          borderRadius: 12,
          padding: "32px 28px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              marginBottom: 6,
            }}
          >
            CORVUS X
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-soft, #8a94a6)",
            }}
          >
            {t("auth.subtitle")}
          </div>
        </div>

        <label
          htmlFor="corvus-pw"
          style={{
            display: "block",
            fontSize: 13,
            marginBottom: 8,
            color: "var(--text-soft, #8a94a6)",
          }}
        >
          {t("auth.passwordLabel")}
        </label>
        <input
          id="corvus-pw"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "12px 14px",
            fontSize: 15,
            background: "var(--bg-deep, #0b0d10)",
            color: "var(--text, #e7eaee)",
            border: "1px solid var(--border, #262b33)",
            borderRadius: 8,
            outline: "none",
            marginBottom: 16,
          }}
        />

        {errorKey && (
          <div
            role="alert"
            style={{
              fontSize: 13,
              color: "#ff6b6b",
              marginBottom: 14,
              padding: "8px 12px",
              background: "rgba(255,107,107,0.08)",
              border: "1px solid rgba(255,107,107,0.25)",
              borderRadius: 6,
            }}
          >
            {errorText(errorKey)}
          </div>
        )}

        <button
          type="submit"
          disabled={!password || submitting}
          style={{
            width: "100%",
            padding: "12px 16px",
            fontSize: 15,
            fontWeight: 600,
            background: submitting || !password ? "var(--panel-weak, #1a1f26)" : "var(--accent, #4a90ff)",
            color: submitting || !password ? "var(--text-soft, #8a94a6)" : "#fff",
            border: "none",
            borderRadius: 8,
            cursor: submitting || !password ? "not-allowed" : "pointer",
            transition: "background 0.15s",
          }}
        >
          {submitting ? t("auth.submitting") : t("auth.submit")}
        </button>

        <div
          style={{
            marginTop: 20,
            textAlign: "center",
            fontSize: 11,
            color: "var(--text-weak, #565d6b)",
          }}
        >
          {t("auth.footer")}
        </div>
      </form>
    </div>
  )
}
