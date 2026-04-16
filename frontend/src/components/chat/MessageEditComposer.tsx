import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { t } from "../../i18n";

export default function MessageEditComposer({
  value,
  isSending,
  onChange,
  onCancel,
  onSubmit,
}: {
  value: string;
  isSending: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const [localRef, setLocalRef] = useState<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!localRef) return;
    localRef.style.height = "0px";
    const nextHeight = Math.min(localRef.scrollHeight, 280);
    localRef.style.height = `${nextHeight}px`;
    localRef.style.overflowY = localRef.scrollHeight > 280 ? "auto" : "hidden";
  }, [value, localRef]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }

    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <div
      className="message-edit-composer"
      style={{
        width: "100%",
        minWidth: 0,
      }}
    >
      <textarea
        ref={setLocalRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        className="message-edit-composer__textarea"
        style={{
          width: "100%",
          minWidth: 0,
          boxSizing: "border-box",
          padding: "10px 14px 8px",
          textAlign: "left",
          lineHeight: 1.45,
          font: "inherit",
          color: "inherit",
          letterSpacing: "inherit",
        }}
      />

      <div
        className="message-edit-composer__footer"
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          padding: "0 14px 12px",
        }}
      >
        <button type="button" className="message-edit-composer__secondary" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="message-edit-composer__primary"
          onClick={onSubmit}
          disabled={isSending || !value.trim()}
        >
          {t("chat.sendEdit")}
        </button>
      </div>
    </div>
  );
}
