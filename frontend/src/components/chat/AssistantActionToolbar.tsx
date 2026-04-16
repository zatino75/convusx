import { useState } from "react";
import { CopyIcon, ThumbUpIcon, ThumbDownIcon, RegenerateIcon } from "./ChatIcons";
import { t } from "../../i18n";

export default function AssistantActionToolbar({
  visible,
  onCopy,
  onRegenerate,
  onDelete,
  onFeedback,
}: {
  visible: boolean;
  onCopy: () => void;
  onRegenerate?: () => void;
  onDelete?: () => void;
  onFeedback?: (feedback: "up" | "down") => void;
}) {
  const [thumbState, setThumbState] = useState<"up" | "down" | null>(null);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        height: 32,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 0.14s ease",
      }}
    >
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? t("chat.copied") : t("chat.copy")}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          border: "none",
          background: "none",
          cursor: "pointer",
          borderRadius: 6,
          color: copied ? "#10a37f" : "var(--text-sub)",
          transition: "color 0.2s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2, #f3f4f6)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
      >
        {copied ? (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <CopyIcon />
        )}
      </button>

      <button
        type="button"
        onClick={() => {
          const next = thumbState === "up" ? null : "up";
          setThumbState(next);
          if (next === "up") onFeedback?.("up");
        }}
        title={t("message.like")}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          border: "none",
          background: "none",
          cursor: "pointer",
          borderRadius: 6,
          color: thumbState === "up" ? "#10b981" : "var(--text-sub)",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2, #f3f4f6)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
      >
        <ThumbUpIcon />
      </button>

      <button
        type="button"
        onClick={() => {
          const next = thumbState === "down" ? null : "down";
          setThumbState(next);
          if (next === "down") onFeedback?.("down");
        }}
        title={t("message.dislike")}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          border: "none",
          background: "none",
          cursor: "pointer",
          borderRadius: 6,
          color: thumbState === "down" ? "#ef4444" : "var(--text-sub)",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2, #f3f4f6)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
      >
        <ThumbDownIcon />
      </button>

      {onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          title={t("chat.regenerate")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            border: "none",
            background: "none",
            cursor: "pointer",
            borderRadius: 6,
            color: "var(--text-sub)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2, #f3f4f6)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
        >
          <RegenerateIcon />
        </button>
      )}
    </div>
  );
}
