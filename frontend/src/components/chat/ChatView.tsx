import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import type { Message, ProjectGroup, Thread } from "../../types/workspace";
import renderMessageContent from "./MessageRenderer";

type MessageVersionState = {
  current: number;
  total: number;
};

type ComposerMenuAction = "upload" | "deep-think" | "web-search";

type Props = {
  activeProject: ProjectGroup | null;
  activeThread: Thread | null;
  draft: string;
  isSending: boolean;
  lastError: string | null;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onStopGenerating?: () => void;
  onBackToProject: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  debugMeta?: any;
  editingMessageId?: string | null;
  editingDraft?: string;
  onEditingDraftChange?: (value: string) => void;
  onStartEditMessage?: (message: Message) => void;
  onCancelEditMessage?: () => void;
  onSubmitEditMessage?: (messageId: string) => void;
  onCopyUserMessage?: (message: Message) => void;
  onCopyAssistantMessage?: (message: Message) => void;
  onDeleteMessage?: (messageId: string) => void;
  onRelatedQuestion?: (q: string) => void;
  onOpenArtifact?: (title: string, code: string, language: string) => void;
  onComposerAction?: (action: "deep-think" | "web-search" | "upload") => void;
  composerMode?: "deep-think" | "web-search" | null;
  onClearComposerMode?: () => void;
  messageVersionMap?: Record<string, MessageVersionState>;
  onSelectMessageVersion?: (messageId: string, direction: "prev" | "next") => void;
  showScrollToBottom?: boolean;
  onScrollToBottom?: () => void;
};

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "";
  }
}

function hasStructuredCopyTarget(content: string) {
  const normalized = String(content ?? "");
  return normalized.includes("```") || /\|.+\|/.test(normalized);
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M5 15V7a2 2 0 0 1 2-2h8" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 1 0-4-4L4.5 16v4z" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 18 9 12l6-6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 16V5" />
      <path d="m7 10 5-5 5 5" />
      <path d="M5 19h14" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
  );
}

function ScrollDownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v12" />
      <path d="m7 12 5 5 5-5" />
    </svg>
  );
}

function ThumbUpIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" />
      <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
    </svg>
  );
}

function ThumbDownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z" />
      <path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
    </svg>
  );
}

function RegenerateIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  );
}

function AssistantActionToolbar({
  visible,
  onCopy,
  onRegenerate,
  onDelete
}: {
  visible: boolean;
  onCopy: () => void;
  onRegenerate?: () => void;
  onDelete?: () => void;
}) {
  const [thumbState, setThumbState] = useState<"up" | "down" | null>(null);

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
        onClick={onCopy}
        title="복사"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "none", background: "none", cursor: "pointer", borderRadius: 6, color: "var(--text-sub)" }}
        onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2, #f3f4f6)")}
        onMouseLeave={e => (e.currentTarget.style.background = "none")}
      >
        <CopyIcon />
      </button>

      <button
        type="button"
        onClick={() => setThumbState(s => s === "up" ? null : "up")}
        title="좋아요"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "none", background: "none", cursor: "pointer", borderRadius: 6, color: thumbState === "up" ? "#10b981" : "var(--text-sub)" }}
        onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2, #f3f4f6)")}
        onMouseLeave={e => (e.currentTarget.style.background = "none")}
      >
        <ThumbUpIcon />
      </button>

      <button
        type="button"
        onClick={() => setThumbState(s => s === "down" ? null : "down")}
        title="별로예요"
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
          title="다시 생성"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "none", background: "none", cursor: "pointer", borderRadius: 6, color: "var(--text-sub)" }}
          onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2, #f3f4f6)")}
          onMouseLeave={e => (e.currentTarget.style.background = "none")}
        >
          <RegenerateIcon />
        </button>
      )}

      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          title="메시지 삭제"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "none", background: "none", cursor: "pointer", borderRadius: 6, color: "var(--text-sub)" }}
          onMouseEnter={e => { e.currentTarget.style.background = "var(--surface-2, #f3f4f6)"; e.currentTarget.style.color = "#ef4444"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-sub)"; }}
        >
          <DeleteIcon />
        </button>
      )}
    </div>
  );
}

function ThreadMetaStrip({ thread, project }: { thread: Thread; project: ProjectGroup | null }) {
  const chips: string[] = [];

  if (project?.meta?.memoryEnabled) chips.push("Project memory on");
  if (thread.meta?.pinned) chips.push("Pinned");
  if (thread.meta?.sourceThreadIds?.length) chips.push(`Fusion ${thread.meta.sourceThreadIds.length}`);
  if (thread.meta?.labels?.length) chips.push(...thread.meta.labels.slice(0, 2));

  if (!chips.length) return null;

  return (
    <div className="thread-meta-strip">
      {chips.map((chip) => (
        <span key={chip} className="thread-badge">
          {chip}
        </span>
      ))}
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
          <button type="button" className="message-version-nav__button" onClick={onPrev} aria-label="이전 버전">
            <ChevronLeftIcon />
          </button>
          <span className="message-version-nav__label">
            {state.current}/{state.total}
          </span>
          <button type="button" className="message-version-nav__button" onClick={onNext} aria-label="다음 버전">
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
        <button type="button" className="user-message-tools__button" onClick={onCopy} aria-label="메시지 복사">
          <CopyIcon />
        </button>
        <button type="button" className="user-message-tools__button" onClick={onEdit} aria-label="메시지 편집">
          <EditIcon />
        </button>
        <button type="button" className="user-message-tools__button" onClick={onDelete} aria-label="메시지 삭제" style={{ color: "var(--text-sub)" }}>
          <DeleteIcon />
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
          취소
        </button>
        <button
          type="button"
          className="message-edit-composer__primary"
          onClick={onSubmit}
          disabled={isSending || !value.trim()}
        >
          보내기
        </button>
      </div>
    </div>
  );
}

function MessageBubble({
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
  onOpenArtifact
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
}) {
  const isUser = message.role === "user";
  const isPending = message.status === "pending";
  const isError = message.status === "error";
  const showAssistantCopy = !isUser && hasStructuredCopyTarget(message.content);

  const orchestrationMeta = (message as any)?.meta?.orchestration ?? (message as any)?.meta?.debug ?? null;
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
    }, 140);
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
              {message.content ? renderMessageContent(message.content, { onRelatedQuestion, onOpenArtifact }) : isPending ? "응답 생성 중..." : ""}
            </div>

            {isPending ? (
              <div className="message__pending">
                <span className="message__pending-dot" />
                생성 중...
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

function ComposerMenu({
  open,
  onClose,
  onAction
}: {
  open: boolean;
  onClose: () => void;
  onAction: (action: ComposerMenuAction) => void;
}) {
  if (!open) return null;

  return (
    <div className="composer-menu" data-composer-menu-root>
      <button
        type="button"
        className="composer-menu__item"
        onClick={() => {
          onAction("upload");
          onClose();
        }}
      >
        <span className="composer-menu__icon">
          <UploadIcon />
        </span>
        <span className="composer-menu__text">사진 및 파일 업로드</span>
      </button>

      <button
        type="button"
        className="composer-menu__item"
        onClick={() => {
          onAction("deep-think");
          onClose();
        }}
      >
        <span className="composer-menu__icon">
          <SparkleIcon />
        </span>
        <span className="composer-menu__stack">
          <span className="composer-menu__text">심층리서치</span>
          <span className="composer-menu__meta">GPT-5.4 Pro / Claude Opus 4.6 바로 생각하기</span>
        </span>
      </button>

      <button
        type="button"
        className="composer-menu__item"
        onClick={() => {
          onAction("web-search");
          onClose();
        }}
      >
        <span className="composer-menu__icon">
          <SearchIcon />
        </span>
        <span className="composer-menu__stack">
          <span className="composer-menu__text">웹검색</span>
          <span className="composer-menu__meta">Gemini 3.1 Pro Preview로 바로 웹검색</span>
        </span>
      </button>
    </div>
  );
}

function Composer({
  draft,
  isSending,
  onDraftChange,
  onSend,
  onStopGenerating,
  textareaRef,
  onComposerAction,
  composerMode,
  onClearComposerMode
}: {
  draft: string;
  isSending: boolean;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onStopGenerating?: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onComposerAction?: (action: ComposerMenuAction) => void;
  composerMode?: "deep-think" | "web-search" | null;
  onClearComposerMode?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    el.style.height = "0px";
    const nextHeight = Math.min(el.scrollHeight, 480);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > 480 ? "auto" : "hidden";
  }, [draft, textareaRef]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (menuRootRef.current?.contains(target ?? null)) return;
      setMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!isSending) {
        onSend();
      }
    }
  }

  function handleMenuAction(action: ComposerMenuAction) {
    onComposerAction?.(action);
    setMenuOpen(false);
  }

  return (
    <div className="chat-composer">
      {composerMode && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px 0" }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "3px 10px", borderRadius: 20,
            background: composerMode === "deep-think" ? "rgba(99,102,241,0.1)" : "rgba(16,185,129,0.1)",
            color: composerMode === "deep-think" ? "#6366f1" : "#10b981",
            fontSize: 12, fontWeight: 600
          }}>
            {composerMode === "deep-think" ? "⚡ 심층리서치 (GPT-5.4 Pro + Claude Opus)" : "🔍 웹검색 (Perplexity Scout)"}
            <button type="button" onClick={onClearComposerMode}
              style={{ display: "flex", alignItems: "center", border: "none", background: "none", cursor: "pointer", padding: 0, color: "inherit", opacity: 0.7 }}>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </span>
        </div>
      )}
      <div className="chat-composer__row">
        <div ref={menuRootRef} className="chat-composer__menu-anchor">
          <button
            type="button"
            className="chat-composer__icon-btn"
            aria-label="도구"
            onClick={() => setMenuOpen((current) => !current)}
          >
            <PlusIcon />
          </button>

          <ComposerMenu open={menuOpen} onClose={() => setMenuOpen(false)} onAction={handleMenuAction} />
        </div>

        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="무엇이든 물어보세요"
          className="chat-composer__textarea"
        />

        <div className="chat-composer__actions">
          <button
            type="button"
            onClick={() => {
              if (isSending) {
                onStopGenerating?.();
                return;
              }
              onSend();
            }}
            disabled={!isSending && !draft.trim()}
            className="chat-composer__send"
            aria-label={isSending ? "정지" : "전송"}
            title={isSending ? "생성 중지" : "전송"}
          >
            {isSending ? (
              <StopIcon />
            ) : (
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14" />
                <path d="m13 5 7 7-7 7" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChatView({
  activeProject,
  activeThread,
  draft,
  isSending,
  lastError,
  onDraftChange,
  onSend,
  onStopGenerating,
  textareaRef,
  scrollRef,
  editingMessageId = null,
  editingDraft = "",
  onEditingDraftChange,
  onStartEditMessage,
  onCancelEditMessage,
  onSubmitEditMessage,
  onCopyUserMessage,
  onCopyAssistantMessage,
  onDeleteMessage,
  onRelatedQuestion,
  onOpenArtifact,
  onComposerAction,
  composerMode,
  onClearComposerMode,
  messageVersionMap = {},
  onSelectMessageVersion,
  showScrollToBottom = false,
  onScrollToBottom
}: Props) {
  const visibleMessages = useMemo(
    () => (activeThread?.messages ?? []).filter((message) => !message.isHidden),
    [activeThread?.messages]
  );

  if (!activeThread) return null;

  if (visibleMessages.length === 0) {
    return (
      <div className="chat-view">
        <div className="chat-empty">
          <div className="chat-empty__inner">
            <div className="chat-empty__composer-shell">
              <Composer
                draft={draft}
                isSending={isSending}
                onDraftChange={onDraftChange}
                onSend={onSend}
                onStopGenerating={onStopGenerating}
                textareaRef={textareaRef}
              />
            </div>

            <div className="chat-footer-note">AI Orchestra는 실수를 할 수 있습니다. 중요한 정보는 확인하십시오.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="chat-view"
      style={{
        position: "relative"
      }}
    >
      <div ref={scrollRef} className="chat-view__scroll">
        <div className="chat-view__messages">
          <ThreadMetaStrip thread={activeThread} project={activeProject} />

          {visibleMessages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              isEditing={editingMessageId === message.id}
              editingDraft={editingDraft}
              isSending={isSending}
              versionState={messageVersionMap[message.id]}
              onCopyUserMessage={onCopyUserMessage}
              onStartEditMessage={onStartEditMessage}
              onEditingDraftChange={onEditingDraftChange}
              onCancelEditMessage={onCancelEditMessage}
              onSubmitEditMessage={onSubmitEditMessage}
              onSelectMessageVersion={onSelectMessageVersion}
              onCopyAssistantMessage={onCopyAssistantMessage}
              onRegenerate={message.role === "assistant" && !isSending ? onSend : undefined}
              onDeleteMessage={onDeleteMessage}
              onRelatedQuestion={onRelatedQuestion}
              onOpenArtifact={onOpenArtifact}
            />
          ))}

          {lastError ? <div className="error-banner">{lastError}</div> : null}
        </div>
      </div>

      <div className="chat-view__composer-shell">
        <div className="chat-view__composer-inner" style={{ position: "relative" }}>
          {showScrollToBottom ? (
            <button
              type="button"
              className="scroll-to-bottom-btn"
              onClick={onScrollToBottom}
              aria-label="맨 아래로 이동"
              title="맨 아래로 이동"
              style={{
                position: "absolute",
                left: "50%",
                top: -44,
                transform: "translateX(-50%)",
                zIndex: 30,
                width: 36,
                height: 36,
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: "#ffffff",
                color: "var(--text-sub)",
                boxShadow: "0 10px 26px rgba(15, 23, 42, 0.14)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "transform 0.18s ease, box-shadow 0.18s ease"
              }}
            >
              <ScrollDownIcon />
            </button>
          ) : null}

          <Composer
            draft={draft}
            isSending={isSending}
            onDraftChange={onDraftChange}
            onSend={onSend}
            onStopGenerating={onStopGenerating}
            onComposerAction={onComposerAction}
            composerMode={composerMode}
            onClearComposerMode={onClearComposerMode}
            textareaRef={textareaRef}
          />

          <div className="chat-footer-note">AI Orchestra는 실수를 할 수 있습니다. 중요한 정보는 확인하십시오.</div>
        </div>
      </div>
    </div>
  );
}
