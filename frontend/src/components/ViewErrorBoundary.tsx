import { Component, type ReactNode } from "react";
import { t } from "../i18n";
import { devLog } from "../utils/helpers";

type Props = {
  children: ReactNode;
  /** 표시할 뷰 이름 (디버그용) */
  name?: string;
  /** 에러 시 보여줄 대체 UI (없으면 기본 fallback) */
  fallback?: ReactNode;
};

type State = { hasError: boolean; error: Error | null };

/**
 * 뷰 단위 Error Boundary
 * - 글로벌 ErrorBoundary와 달리 전체 앱 크래시 없이 개별 뷰만 격리
 * - "다시 시도" 버튼으로 뷰 재렌더링 시도
 */
export default class ViewErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    devLog.error(`[ViewErrorBoundary:${this.props.name ?? "unknown"}]`, error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          role="alert"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 32,
            textAlign: "center",
            minHeight: 200,
            gap: 12,
          }}
        >
          <div style={{ fontSize: 32, color: "var(--text-soft)" }}>⚠</div>
          <p style={{ margin: 0, fontSize: 14, color: "var(--text-sub)", maxWidth: 400 }}>
            {this.props.name
              ? `${this.props.name} ${t("errors.viewCrashed")}`
              : t("errors.viewCrashed")}
          </p>
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-soft)" }}>
            {this.state.error?.message ?? ""}
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            style={{
              padding: "8px 20px",
              borderRadius: 8,
              border: "1px solid var(--border, #ddd)",
              background: "var(--bg-surface, #fff)",
              color: "var(--text-main)",
              cursor: "pointer",
              fontSize: 13,
              marginTop: 4,
              minHeight: 44,
              minWidth: 44,
            }}
          >
            {t("ui.retry")}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
