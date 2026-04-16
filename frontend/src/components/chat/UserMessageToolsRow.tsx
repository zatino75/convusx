import { useState } from "react";
import { CopyIcon, EditIcon, ChevronLeftIcon, ChevronRightIcon } from "./ChatIcons";
import { t } from "../../i18n";

export type MessageVersionState = {
  current: number;
  total: number;
};

export default function UserMessageToolsRow({
  visible,
  state,
  onPrev,
  onNext,
  onCopy,
  onEdit,
  onDelete,
  onMouseEnter,
  onMouseLeave,
}: {
  visible: boolean;
  state?: MessageVersionState;
  onPrev: () => void;
  onNext: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "absolute",
        right: 8,
        top: "100%",
        marginTop: 10,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        zIndex: 20,
        pointerEvents: visible ? "auto" : "none",
        whiteSpace: "nowrap",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(-2px)",
        transition: "opacity 0.14s ease, transform 0.14s ease",
      }}
    >
      {state && state.total > 1 ? (
        <div
          style={{
            minHeight: 28,
            padding: "0 6px",
            border: "1px solid var(--border)",
            borderRadius: 999,
            background: "rgba(255,255,255,0.98)",
            boxShadow: "0 4px 14px rgba(15,23,42,0.08)",
            display: "inline-flex",
            alignItems: "center",
            gap: 2,
          }}
        >
          <button
            type="button"
            className="message-version-nav__button"
            onClick={onPrev}
            aria-label={t("chat.prevVersion")}
          >
            <ChevronLeftIcon />
          </button>
          <span className="message-version-nav__label">
            {state.current}/{state.total}
          </span>
          <button
            type="button"
            className="message-version-nav__button"
            onClick={onNext}
            aria-label={t("chat.nextVersion")}
          >
            <ChevronRightIcon />
          </button>
        </div>
      ) : null}

      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <button
          type="button"
          className="user-message-tools__button"
          onClick={handleCopy}
          aria-label={copied ? t("chat.copied") : t("message.copyMessage")}
          title={copied ? t("chat.copied") : t("chat.copy")}
          style={{ color: copied ? "#10a37f" : undefined, transition: "color 0.2s" }}
        >
          {copied ? (
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <CopyIcon />
          )}
        </button>
        <button
          type="button"
          className="user-message-tools__button"
          onClick={onEdit}
          aria-label={t("message.editMessage")}
        >
          <EditIcon />
        </button>
      </div>
    </div>
  );
}
