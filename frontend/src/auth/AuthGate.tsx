import type { ReactNode } from "react"
import { useAuth } from "./useAuth"
import LoginPage from "./LoginPage"
import { t } from "../i18n"

// ──────────────────────────────────────────────────────────────────────────────
// CORVUS X — AuthGate
//
// children(=<App />) 앞에 세션 체크를 거는 래퍼.
//   - loading → 중앙 스피너
//   - authed  → children 렌더
//   - unauthed & login_enabled → LoginPage
//   - unauthed & !login_enabled → (dev 환경) children 바로 렌더
//   - error   → children 렌더 (서버 다운 시 기존 에러 플로우에 맡김)
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

  // authed 또는 error 모두 children 렌더 (error 는 기존 앱 에러 플로우가 처리)
  return <>{children}</>
}
