import { Component, type ReactNode } from "react";
import { t } from "../i18n";
import { devLog } from "../utils/helpers";

type Props = { children: ReactNode };
type State = { hasError: boolean; error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    devLog.error("[ErrorBoundary] caught:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", height: "100vh", padding: 32,
          fontFamily: "system-ui, sans-serif", color: "var(--text-main, #333)",
          background: "var(--bg-main, #fafafa)", textAlign: "center",
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>!</div>
          <h2 style={{ margin: "0 0 12px", fontSize: 20, fontWeight: 600 }}>
            {t("errors.errorOccurred")}
          </h2>
          <p style={{ margin: "0 0 20px", fontSize: 14, color: "var(--text-sub, #888)", maxWidth: 480 }}>
            {this.state.error?.message ?? t("errors.unknownError")}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            style={{
              padding: "8px 20px", borderRadius: 8, border: "1px solid var(--border, #ddd)",
              background: "var(--bg-card, #fff)", color: "var(--text-main, #333)", cursor: "pointer",
              fontSize: 14,
            }}
          >
            {t("ui.refresh")}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
