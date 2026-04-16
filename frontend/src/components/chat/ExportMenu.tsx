import { useEffect, useRef, useState } from "react";
import type { Thread } from "../../types/workspace";
import { apiFetch } from "../../api/url";
import { devLog } from "../../utils/helpers";
import { t } from "../../i18n";
import { showToast } from "../ui/Toast";

/**
 * Phase 4 분해 — 이전에는 MessageBubble.tsx 내부에 인라인됐던 컴포넌트.
 * 스레드 대화 전체를 markdown 또는 txt 로 내려받는 드롭다운 메뉴.
 */
export default function ExportMenu({ thread }: { thread: Thread }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  async function handleExport(format: "markdown" | "text") {
    setIsExporting(true);
    try {
      const response = await apiFetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: thread.id, format })
      });

      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const timestamp = new Date().toISOString().slice(0, 10);
      const sanitized = thread.title.replace(/[^a-zA-Z0-9\uAC00-\uD7AF_-]/g, "_").slice(0, 100);
      link.href = url;
      link.download = `CORVUS-X_${sanitized}_${timestamp}.${format === "markdown" ? "md" : "txt"}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setIsOpen(false);
    } catch (err) {
      devLog.error("[MessageBubble] export error:", err);
      showToast(t("message.exportFailed"), "error");
    } finally {
      setIsExporting(false);
    }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div ref={menuRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isExporting}
        title={t("message.export")}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: 32,
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: "rgba(255,255,255,0.6)",
          cursor: isExporting ? "not-allowed" : "pointer",
          opacity: isExporting ? 0.6 : 1,
          transition: "all 0.2s ease",
          color: "var(--text-sub)",
          fontSize: 16,
          padding: 0,
          marginLeft: 8
        }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>

      {isOpen && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 8px)",
          right: 0,
          background: "rgba(255,255,255,0.98)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          boxShadow: "0 4px 12px rgba(15,23,42,0.15)",
          zIndex: 50,
          minWidth: 200,
          overflow: "hidden"
        }}>
          <button
            type="button"
            onClick={() => handleExport("markdown")}
            disabled={isExporting}
            style={{
              display: "block",
              width: "100%",
              padding: "8px 12px",
              textAlign: "left",
              border: "none",
              background: "transparent",
              cursor: isExporting ? "not-allowed" : "pointer",
              color: "var(--text-main)",
              fontSize: 13,
              transition: "background 0.15s ease",
              opacity: isExporting ? 0.6 : 1
            }}
            onMouseEnter={(e) => !isExporting && (e.currentTarget.style.background = "var(--surface-2)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            {t("message.exportMarkdown")}
          </button>
          <button
            type="button"
            onClick={() => handleExport("text")}
            disabled={isExporting}
            style={{
              display: "block",
              width: "100%",
              padding: "8px 12px",
              textAlign: "left",
              border: "none",
              background: "transparent",
              cursor: isExporting ? "not-allowed" : "pointer",
              color: "var(--text-main)",
              fontSize: 13,
              transition: "background 0.15s ease",
              opacity: isExporting ? 0.6 : 1,
              borderTop: "1px solid var(--border)"
            }}
            onMouseEnter={(e) => !isExporting && (e.currentTarget.style.background = "var(--surface-2)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            {t("message.exportText")}
          </button>
        </div>
      )}
    </div>
  );
}
