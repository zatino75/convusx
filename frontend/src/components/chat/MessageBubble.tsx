import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Message, ProjectGroup, Thread } from "../../types/workspace";
import renderMessageContent from "./MessageRenderer";
import { FilePreviewThumbnail, FilePreviewCompact } from "./FilePreview";
import {
  CopyIcon, EditIcon, ChevronLeftIcon, ChevronRightIcon,
  ThumbUpIcon, ThumbDownIcon, RegenerateIcon
} from "./ChatIcons";
import { apiFetch } from "../../api/url";
import { copyText, devLog } from "../../utils/helpers";
import { t } from "../../i18n";
import { showToast } from "../ui/Toast";

export type MessageVersionState = {
  current: number;
  total: number;
};

/* ── 단계 분류 (Claude 스타일 뱃지용) ── */
function categorizeStep(step: string): { label: string; color: string } {
  const s = step.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "").toLowerCase();
  if (s.includes("검색") || s.includes("판례") || s.includes("조사") || s.includes("웹"))
    return { label: "검색", color: "#3b82f6" };
  if (s.includes("분석") || s.includes("평가") || s.includes("판단") || s.includes("감지") || s.includes("검토") || s.includes("비교"))
    return { label: "분석", color: "#8b5cf6" };
  if (s.includes("실행") || s.includes("파이프라인") || s.includes("오케스트라") || s.includes("라우팅"))
    return { label: "실행", color: "#d97706" };
  if (s.includes("추출") || s.includes("읽") || s.includes("파일") || s.includes("업로드") || s.includes("pdf") || s.includes("excel") || s.includes("word") || s.includes("ppt"))
    return { label: "파일", color: "#059669" };
  if (s.includes("생성") || s.includes("작성") || s.includes("렌더링") || s.includes("이미지") || s.includes("응답"))
    return { label: "생성", color: "#ec4899" };
  return { label: "처리", color: "#9ca3af" };
}

function StatusHistoryBlock({ steps, isPending }: { steps: string[]; isPending?: boolean }) {
  const [open, setOpen] = useState(true);
  const [detailOpen, setDetailOpen] = useState(true);
  if (!steps || steps.length === 0) return null;

  const lastStep = steps[steps.length - 1];
  const categorized = steps.map(s => ({ text: s, ...categorizeStep(s) }));

  const counts: Record<string, number> = {};
  categorized.forEach(c => { counts[c.label] = (counts[c.label] || 0) + 1; });
  const summaryText = Object.entries(counts).map(([l, n]) => `${l} ${n}건`).join(" · ");

  return (
    <div className="tp">
      {/* 헤더: 사고 과정 */}
      <button className="tp__header" onClick={() => setOpen(p => !p)} type="button">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"
          className="tp__chevron" style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>
          <path d="M6 3l5 5-5 5" />
        </svg>
        <span className="tp__title">{t("chat.thinkingProcess")}</span>
        {isPending && <span className="tp__spinner" />}
      </button>

      {/* 접혀있을 때: 마지막 단계 미리보기 */}
      {!open && lastStep && (
        <div className="tp__preview">{lastStep}</div>
      )}

      {/* 펼쳐졌을 때 */}
      {open && (
        <div className="tp__body">
          {/* 카운터 요약 (2단계 토글) */}
          <button className="tp__counter" onClick={() => setDetailOpen(p => !p)} type="button">
            <span>{summaryText}{isPending ? " · 진행 중" : ""}</span>
            <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2"
              className="tp__chevron" style={{ transform: detailOpen ? "rotate(90deg)" : "rotate(0deg)" }}>
              <path d="M6 3l5 5-5 5" />
            </svg>
          </button>

          {/* 개별 단계 (아이콘 + 텍스트 + 뱃지) */}
          {detailOpen && (
            <ul className="tp__list">
              {categorized.map((item, i) => (
                <li key={i} className="tp__item">
                  <svg viewBox="0 0 8 8" width="7" height="7" className="tp__dot" style={{ color: item.color }}>
                    <circle cx="4" cy="4" r="3.5" fill="currentColor" />
                  </svg>
                  <span className="tp__item-text">{item.text}</span>
                  <span className="tp__badge" style={{ background: item.color + "15", color: item.color, borderColor: item.color + "30" }}>
                    {item.label}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "";
  }
}

export function hasStructuredCopyTarget(content: string) {
  const normalized = String(content ?? "");
  return normalized.includes("```") || /\|.+\|/.test(normalized);
}


function AssistantActionToolbar({
  visible,
  onCopy,
  onRegenerate,
  onDelete,
  onFeedback
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
        transition: "opacity 0.14s ease"
      }}
    >
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? t("chat.copied") : t("chat.copy")}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "none", background: "none", cursor: "pointer", borderRadius: 6, color: copied ? "#10a37f" : "var(--text-sub)", transition: "color 0.2s" }}
        onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2, #f3f4f6)")}
        onMouseLeave={e => (e.currentTarget.style.background = "none")}
      >
        {copied ? (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7" /></svg>
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
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "none", background: "none", cursor: "pointer", borderRadius: 6, color: thumbState === "up" ? "#10b981" : "var(--text-sub)" }}
        onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2, #f3f4f6)")}
        onMouseLeave={e => (e.currentTarget.style.background = "none")}
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
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "none", background: "none", cursor: "pointer", borderRadius: 6, color: thumbState === "down" ? "#ef4444" : "var(--text-sub)" }}
        onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2, #f3f4f6)")}
        onMouseLeave={e => (e.currentTarget.style.background = "none")}
      >
        <ThumbDownIcon />
      </button>

      {onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          title={t("chat.regenerate")}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "none", background: "none", cursor: "pointer", borderRadius: 6, color: "var(--text-sub)" }}
          onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2, #f3f4f6)")}
          onMouseLeave={e => (e.currentTarget.style.background = "none")}
        >
          <RegenerateIcon />
        </button>
      )}

    </div>
  );
}

function ExportMenu({ thread }: { thread: Thread }) {
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

export function ThreadMetaStrip({ thread, project }: { thread: Thread; project: ProjectGroup | null }) {
  const chips: string[] = [];

  if (project?.meta?.memoryEnabled) chips.push("Project memory on");
  if (thread.meta?.pinned) chips.push(t("sidebar.pinned"));
  if (thread.meta?.sourceThreadIds?.length) chips.push(`Fusion ${thread.meta.sourceThreadIds.length}`);
  if (thread.meta?.labels?.length) chips.push(...thread.meta.labels.slice(0, 2));

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
      <div className="thread-meta-strip">
        {chips.length > 0 ? (
          chips.map((chip) => (
            <span key={chip} className="thread-badge">
              {chip}
            </span>
          ))
        ) : null}
      </div>
      <ExportMenu thread={thread} />
    </div>
  );
}

function UserMessageToolsRow({
  visible,
  state,
  onPrev,
  onNext,
  onCopy,
  onEdit,
  onDelete,
  onMouseEnter,
  onMouseLeave
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
        transition: "opacity 0.14s ease, transform 0.14s ease"
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
            gap: 2
          }}
        >
          <button type="button" className="message-version-nav__button" onClick={onPrev} aria-label={t("chat.prevVersion")}>
            <ChevronLeftIcon />
          </button>
          <span className="message-version-nav__label">
            {state.current}/{state.total}
          </span>
          <button type="button" className="message-version-nav__button" onClick={onNext} aria-label={t("chat.nextVersion")}>
            <ChevronRightIcon />
          </button>
        </div>
      ) : null}

      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6
        }}
      >
        <button type="button" className="user-message-tools__button" onClick={handleCopy}
          aria-label={copied ? t("chat.copied") : t("message.copyMessage")}
          title={copied ? t("chat.copied") : t("chat.copy")}
          style={{ color: copied ? "#10a37f" : undefined, transition: "color 0.2s" }}>
          {copied
            ? <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7" /></svg>
            : <CopyIcon />}
        </button>
        <button type="button" className="user-message-tools__button" onClick={onEdit} aria-label={t("message.editMessage")}>
          <EditIcon />
        </button>

      </div>
    </div>
  );
}

function AssistantInlineCopy({
  visible,
  onCopy
}: {
  visible: boolean;
  onCopy: () => void;
}) {
  // 인라인 복사 버튼 제거 (액션 툴바로 통합)
  return null;
}

function MessageEditComposer({
  value,
  isSending,
  onChange,
  onCancel,
  onSubmit
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
        minWidth: 0
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
          letterSpacing: "inherit"
        }}
      />

      <div
        className="message-edit-composer__footer"
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          padding: "0 14px 12px"
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

export default function MessageBubble({
  message,
  isEditing,
  editingDraft,
  isSending,
  versionState,
  onCopyUserMessage,
  onStartEditMessage,
  onEditingDraftChange,
  onCancelEditMessage,
  onSubmitEditMessage,
  onSelectMessageVersion,
  onCopyAssistantMessage,
  onRegenerate,
  onDeleteMessage,
  onRelatedQuestion,
  onOpenArtifact,
  onDownloadSlide
}: {
  message: Message;
  isEditing: boolean;
  editingDraft: string;
  isSending: boolean;
  versionState?: MessageVersionState;
  onCopyUserMessage?: (message: Message) => void;
  onStartEditMessage?: (message: Message) => void;
  onEditingDraftChange?: (value: string) => void;
  onCancelEditMessage?: () => void;
  onSubmitEditMessage?: (messageId: string) => void;
  onSelectMessageVersion?: (messageId: string, direction: "prev" | "next") => void;
  onCopyAssistantMessage?: (message: Message) => void;
  onRegenerate?: () => void;
  onDeleteMessage?: (messageId: string) => void;
  onRelatedQuestion?: (q: string) => void;
  onOpenArtifact?: (title: string, code: string, language: string) => void;
  onComposerAction?: (action: "deep-think" | "web-search" | "upload") => void;
  onDownloadSlide?: (slideData: any) => void;
}) {
  const isUser = message.role === "user";
  const isPending = message.status === "pending";
  const isError = message.status === "error";

  // 생각중 경과 시간 타이머
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (!isPending) { setElapsedSec(0); return; }
    setElapsedSec(0);
    const timer = setInterval(() => setElapsedSec(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, [isPending]);
  const showAssistantCopy = !isUser && hasStructuredCopyTarget(message.content);

  const msgMeta = (message.requestMeta ?? {}) as Record<string, any>;
  const orchestrationMeta = (msgMeta?.orchestration ?? msgMeta?.debug ?? null) as Record<string, any> | null;
  const provider = orchestrationMeta?.selected_provider || orchestrationMeta?.provider;
  const confidence = orchestrationMeta?.confidence;
  const conflicts = orchestrationMeta?.conflicts_count ?? orchestrationMeta?.conflicts?.length;
  const route = orchestrationMeta?.route || orchestrationMeta?.task;

  const [isBubbleHovered, setIsBubbleHovered] = useState(false);
  const [isMenuHovered, setIsMenuHovered] = useState(false);
  const hoverHideTimerRef = useRef<number | null>(null);

  function clearHoverHideTimer() {
    if (hoverHideTimerRef.current !== null) {
      window.clearTimeout(hoverHideTimerRef.current);
      hoverHideTimerRef.current = null;
    }
  }

  function openHover() {
    clearHoverHideTimer();
    setIsBubbleHovered(true);
  }

  function scheduleHoverClose() {
    clearHoverHideTimer();
    hoverHideTimerRef.current = window.setTimeout(() => {
      setIsBubbleHovered(false);
      setIsMenuHovered(false);
      hoverHideTimerRef.current = null;
    }, 600);
  }

  useEffect(() => {
    return () => {
      clearHoverHideTimer();
    };
  }, []);

  const isUserToolsVisible = isBubbleHovered || isMenuHovered;

  if (isEditing && isUser) {
    return (
      <div
        className="message message--user"
        style={{
          width: "100%"
        }}
      >
        <div
          className="message__body"
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
            width: "100%"
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "2500px",
              minWidth: 0
            }}
          >
            <div
              style={{
                width: "100%",
                minWidth: 0,
                padding: 0,
                margin: 0,
                borderRadius: 18,
                background: "#e9eef5",
                border: "1px solid rgba(15, 23, 42, 0.06)",
                boxSizing: "border-box"
              }}
            >
              <MessageEditComposer
                value={editingDraft}
                isSending={isSending}
                onChange={(value) => onEditingDraftChange?.(value)}
                onCancel={() => onCancelEditMessage?.()}
                onSubmit={() => onSubmitEditMessage?.(message.id)}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const bodyStyle = isUser
    ? {
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "flex-start"
      }
    : undefined;

  const userSurfaceStyle = isUser
    ? {
        position: "relative" as const,
        display: "inline-flex" as const,
        flexDirection: "column" as const,
        alignItems: "flex-end" as const,
        width: "auto",
        minWidth: 0,
        maxWidth: "min(80%, 760px)",
        verticalAlign: "top" as const,
        overflow: "visible"
      }
    : {
        position: "relative" as const
      };

  const statusHistoryBlock: React.ReactNode =
    !isUser && Array.isArray(message.statusHistory) && message.statusHistory.length > 0
      ? <StatusHistoryBlock steps={message.statusHistory} isPending={isPending} />
      : null;

  return (
    <div className={"message " + (isUser ? "message--user" : "message--assistant")}>
      <div className="message__body" style={bodyStyle}>
        <div
          className={"message__surface" + (isUser ? " message__surface--user" : " message__surface--assistant")}
          style={userSurfaceStyle}
          onMouseEnter={openHover}
          onMouseLeave={scheduleHoverClose}
        >
          {!isUser ? (
            <AssistantInlineCopy
              visible={showAssistantCopy}
              onCopy={() => {
                if (onCopyAssistantMessage) {
                  onCopyAssistantMessage(message);
                  return;
                }
                void copyText(message.content);
              }}
            />
          ) : null}

          <div className={isError ? "message__error-box" : ""}>
            {/* 유저 메시지 첨부파일 칩 */}
            {isUser && Array.isArray(message.attachedFiles) && message.attachedFiles.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "8px 14px 2px" }}>
                {(message.attachedFiles as { name: string; type: string; base64?: string; size: number }[]).map((f, idx) => (
                  <FilePreviewCompact
                    key={idx}
                    name={f.name}
                    type={f.type}
                    size={f.size}
                  />
                ))}
              </div>
            ) : null}
            {/* 진행과정 접기/펼치기 블록 */}
            {statusHistoryBlock}

            <div
              className={"message__text" + (isUser ? " message__text--user" : "")}
              style={{
                width: isUser ? "auto" : undefined,
                minWidth: isUser ? 0 : undefined,
                whiteSpace: isUser ? "pre-wrap" : undefined,
                wordBreak: isUser ? "break-word" : undefined,
                overflowWrap: isUser ? "anywhere" : undefined,
                padding: isUser ? "9px 14px" : undefined,
                lineHeight: isUser ? 1.45 : undefined
              }}
            >
              {message.content ? renderMessageContent(message.content, { onRelatedQuestion, onOpenArtifact }) : ""}
              {isPending && !isUser && (
                <span
                  style={{
                    display: "inline-block",
                    width: "2px",
                    height: "1em",
                    marginLeft: "2px",
                    backgroundColor: "#4b5563",
                    animation: "cursor-blink 0.8s infinite",
                    verticalAlign: "text-bottom"
                  }}
                />
              )}
              {isPending && !isUser && (
                <style>{`
                  @keyframes cursor-blink {
                    0%, 49% { opacity: 1; }
                    50%, 100% { opacity: 0; }
                  }
                `}</style>
              )}
            </div>

            {/* 슬라이드 다운로드 버튼 */}
            {!isUser && !!message.requestMeta?.slide_data && onDownloadSlide && (
              <div style={{ margin: "10px 18px 4px" }}>
                <button
                  type="button"
                  onClick={() => onDownloadSlide(message.requestMeta!.slide_data)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 7,
                    padding: "7px 14px", borderRadius: 8,
                    background: "#ffffff", color: "#374151",
                    border: "1px solid #d1d5db", cursor: "pointer",
                    fontSize: 13, fontWeight: 600,
                    boxShadow: "0 1px 3px rgba(0,0,0,0.07)"
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#f3f4f6")}
                  onMouseLeave={e => (e.currentTarget.style.background = "#ffffff")}
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  {t("message.downloadPptx")}
                </button>
              </div>
            )}

            {/* 이미지 표시 — DALL-E / Imagen / Midjourney */}
            {!isUser && !isPending && message.requestMeta?.image_url && (
              <div style={{ padding: "10px 18px 4px" }}>
                <img
                  src={message.requestMeta.image_url}
                  alt={t("message.aiImage")}
                  style={{ maxWidth: "min(480px, 90vw)", height: "auto", borderRadius: 12, display: "block", border: "1px solid var(--border)" }}
                  onError={e => {
                    const img = e.target as HTMLImageElement;
                    const fallback = document.createElement("div");
                    fallback.textContent = t("errors.imageLoadFailed");
                    fallback.style.cssText = "padding:12px 16px;border-radius:8px;background:var(--surface-1);color:var(--text-soft);font-size:12px;border:1px dashed var(--border)";
                    img.replaceWith(fallback);
                  }}
                />
                {message.requestMeta?.image_revised_prompt && (
                  <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-sub)", fontStyle: "italic", maxWidth: "min(480px, 90vw)" }}>
                    {message.requestMeta.image_revised_prompt}
                  </div>
                )}
                {(message.requestMeta?.image_urls?.length ?? 0) > 1 && (
                  <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, maxWidth: "min(480px, 90vw)" }}>
                    {(message.requestMeta.image_urls as string[]).map((url: string, idx: number) => (
                      <a key={idx} href={url} target="_blank" rel="noopener noreferrer">
                        <img
                          src={url}
                          alt={t("message.imageN").replace("{n}", String(idx + 1))}
                          style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8, display: "block", border: "1px solid var(--border)" }}
                          onError={e => {
                            const img = e.target as HTMLImageElement;
                            const fallback = document.createElement("div");
                            fallback.textContent = t("errors.imageLoadFailed");
                            fallback.style.cssText = "padding:8px;border-radius:6px;background:var(--surface-1);color:var(--text-soft);font-size:11px;border:1px dashed var(--border);text-align:center";
                            img.replaceWith(fallback);
                          }}
                        />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 비디오 표시 — Runway / Veo */}
            {!isUser && !isPending && message.requestMeta?.video_url && (
              <div style={{ padding: "10px 18px 4px" }}>
                {String(message.requestMeta.video_url).startsWith("gs://") ? (
                  <div style={{ padding: "12px 16px", borderRadius: 10, background: "var(--bg-sub, #f3f4f6)", border: "1px solid var(--border)", maxWidth: 480, fontSize: 13 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>{t("message.videoComplete")}</div>
                    <div style={{ fontSize: 11, color: "var(--text-sub)", wordBreak: "break-all" }}>
                      {message.requestMeta.video_url}
                    </div>
                    <a
                      href={message.requestMeta.video_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: "inline-block", marginTop: 8, fontSize: 12, color: "var(--accent, #6366f1)", textDecoration: "none", fontWeight: 600 }}
                    >
                      {t("message.openVideo")}
                    </a>
                  </div>
                ) : (
                  <video
                    src={message.requestMeta.video_url}
                    controls
                    style={{ maxWidth: "100%", width: 480, borderRadius: 12, display: "block", border: "1px solid var(--border)" }}
                  />
                )}
              </div>
            )}

            {isPending ? (
              <div className="message__pending">
                <span className="tp__spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
                <span style={{ fontSize: 12, color: "var(--text-sub)" }}>
                  {message.statusText || t("chat.analyzing")}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-soft, #aaa)", fontVariantNumeric: "tabular-nums", minWidth: 32 }}>
                  {elapsedSec < 60 ? `${elapsedSec}s` : `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`}
                </span>
              </div>
            ) : null}

            {!isUser && (provider || confidence !== undefined || conflicts !== undefined || route) ? (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  color: "var(--text-sub)",
                  opacity: 0.85,
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap"
                }}
              >
                {provider ? <span>{provider}</span> : null}
                {confidence !== undefined ? <span>· {typeof confidence === "number" ? confidence.toFixed(2) : confidence}</span> : null}
                {conflicts !== undefined ? <span>· conflicts {conflicts}</span> : null}
                {route ? <span>· {route}</span> : null}
              </div>
            ) : null}

          </div>
          {!isUser && !isPending ? (
            <div style={{ marginTop: 4 }}>
              <div>
                <AssistantActionToolbar
                  visible={isBubbleHovered || isMenuHovered}
                  onCopy={() => {
                    if (onCopyAssistantMessage) {
                      onCopyAssistantMessage(message);
                      return;
                    }
                    void copyText(message.content);
                  }}
                  onRegenerate={onRegenerate}
                  onDelete={onDeleteMessage ? () => onDeleteMessage(message.id) : undefined}
                  onFeedback={async (feedback) => {
                    const meta = message.requestMeta;
                    const provider = meta?.winnerProvider ?? meta?.displayWinner?.provider ?? null;
                    const task = meta?.routerTask ?? "dialogue";
                    const runnerUp = meta?.displayLosers?.[0] ?? null;
                    if (!provider) return;
                    try {
                      await apiFetch("/api/feedback", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          feedback,
                          provider,
                          task,
                          runner_up: runnerUp,
                          message_id: message.id
                        })
                      });
                    } catch (err) {
                      devLog.warn(`[MessageBubble] ${t("message.feedbackFailed")}:`, err);
                    }
                  }}
                />
              </div>
            </div>
          ) : null}

          {isUser ? (
            <UserMessageToolsRow
              visible={isUserToolsVisible}
              state={versionState}
              onPrev={() => onSelectMessageVersion?.(message.id, "prev")}
              onNext={() => onSelectMessageVersion?.(message.id, "next")}
              onCopy={() => {
                if (onCopyUserMessage) {
                  onCopyUserMessage(message);
                  return;
                }
                void copyText(message.content);
              }}
              onEdit={() => onStartEditMessage?.(message)}
              onDelete={() => onDeleteMessage?.(message.id)}
              onMouseEnter={() => {
                clearHoverHideTimer();
                setIsMenuHovered(true);
              }}
              onMouseLeave={() => {
                setIsMenuHovered(false);
                scheduleHoverClose();
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
