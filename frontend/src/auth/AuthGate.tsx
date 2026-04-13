import type { ReactNode } from "react"
import { useAuth } from "./useAuth"
import LoginPage from "./LoginPage"
import { t } from "../i18n"

// ──────────────────────────────────────────────────────────────────────────────
// CORVUS X — AuthGate
//
// children(=<App />) 앞에 세션 체크를 거는 래퍼.
//   - loading              → 중앙 스피너
//   - authed               → children 렌더
//   - unauthed & login_enabled  → LoginPage
//   - unauthed & !login_enabled → (dev 환경) children 바로 렌더
//   - error & login_enabled     → 인증 서버 연결 실패 화면 + 재시도 버튼 (보안: children 차단)
//   - error & !login_enabled    → children 렌더 (login 비활성 환경은 인증 없음)
//
// main.tsx 에서 <AuthGate><App /></AuthGate> 형태로 감싸 사용.
// 기존 App.tsx 는 건드리지 않음.
// ──────────────────────────────────────────────────────────────────────────────

export interface AuthGateProps {
  children: ReactNode
}

export default function AuthGate({ children }: AuthGateProps) {
  const auth = useAuth()

  if (auth.status === "loading") {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg, #0b0d10)",
          color: "var(--text-soft, #8a94a6)",
          fontSize: 14,
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        {t("auth.loading")}
      </div>
    )
  }

  // 로그인 비활성(=localhost dev 또는 ENV 미설정) → 바로 앱 표시
  if (auth.status === "unauthed" && !auth.loginEnabled) {
    return <>{children}</>
  }

  if (auth.status === "unauthed") {
    return <LoginPage onSubmit={auth.login} />
  }

  // error 상태 — loginEnabled 환경에서는 보호 화면 노출 차단
  if (auth.status === "error" && auth.loginEnabled) {
    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          background: "var(--bg, #0b0d10)",
          color: "var(--text-soft, #8a94a6)",
          fontSize: 14,
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <span style={{ color: "var(--danger, #f87171)" }}>
          {t("auth.error")}
        </span>
        <button
          onClick={() => void auth.refresh()}
          style={{
            padding: "8px 20px",
            borderRadius: 6,
            border: "1px solid var(--border, #2a2d35)",
            background: "var(--surface, #16181d)",
            color: "var(--text, #e2e8f0)",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          {t("auth.retry")}
        </button>
      </div>
    )
  }

  // error & \!loginEnabled → 인증 없는 dev 환경, children 허용
  if (auth.status === "error") {
    return <>{children}</>
  }

  // authed
  return <>{children}</>
}
