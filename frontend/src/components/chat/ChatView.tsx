import { useMemo, useState, type RefObject } from "react";
import type { Message, ProjectGroup, Thread } from "../../types/workspace";
import MessageBubble, { ThreadMetaStrip } from "./MessageBubble";
import type { MessageVersionState } from "./MessageBubble";
import Composer from "./ChatComposer";
import { ScrollDownIcon } from "./ChatIcons";
import { t } from "../../i18n";
import { showToast } from "../ui/Toast";

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
  onComposerAction?: (action: "deep-think" | "web-search" | "upload" | "parallel-ensemble") => void;
  composerMode?: "deep-think" | "web-search" | "parallel-ensemble" | null;
  onClearComposerMode?: () => void;
  messageVersionMap?: Record<string, MessageVersionState>;
  onSelectMessageVersion?: (messageId: string, direction: "prev" | "next") => void;
  showScrollToBottom?: boolean;
  onScrollToBottom?: () => void;
  onDownloadSlide?: (slideData: any) => void;
  attachedFiles?: { name: string; type: string; base64: string; size: number }[];
  onAttachFiles?: (files: { name: string; type: string; base64: string; size: number }[]) => void;
};

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
  onScrollToBottom,
  onDownloadSlide,
  attachedFiles,
  onAttachFiles
}: Props) {
  const [isDragging, setIsDragging] = useState(false);

  const visibleMessages = useMemo(
    () => (activeThread?.messages ?? []).filter((message) => !message.isHidden),
    [activeThread?.messages]
  );

  // ── 전체 대화창 드래그 앤 드롭 ─────────────────────────────────────────
  async function handleGlobalDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;
    const maxSize = 20 * 1024 * 1024;
    const current = attachedFiles ?? [];
    const remaining = 10 - current.length;
    if (remaining <= 0) { showToast(t("chat.maxAttachments").replace("{max}", "10"), "warning"); return; }
    const toProcess = files.slice(0, remaining).filter(f => f.size <= maxSize);
    const results = await Promise.all(toProcess.map(file => new Promise<{ name: string; type: string; base64: string; size: number }>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1] ?? result;
        resolve({ name: file.name, type: file.type, base64, size: file.size });
      };
      reader.readAsDataURL(file);
    })));
    onAttachFiles?.([...current, ...results]);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    // 자식 요소로 이동할 때는 무시 — 실제로 영역을 벗어날 때만 오버레이 제거
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }

  if (!activeThread) return null;

  // 드래그 중 전체 화면 오버레이
  const dragOverlay = isDragging ? (
    <div
      style={{
        position: "absolute", inset: 0, zIndex: 50,
        background: "rgba(59,130,246,0.06)",
        border: "2px dashed var(--accent, #3b82f6)",
        borderRadius: 12,
        pointerEvents: "none",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div style={{
        padding: "12px 24px", borderRadius: 10,
        background: "var(--bg-main, #fff)",
        border: "1px solid var(--accent, #3b82f6)",
        fontSize: 14, fontWeight: 600,
        color: "var(--accent, #3b82f6)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
      }}>
        {t("chat.dropFiles")}
      </div>
    </div>
  ) : null;

  if (visibleMessages.length === 0) {
    return (
      <div
        className="chat-view"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleGlobalDrop}
        style={{ position: "relative" }}
      >
        {dragOverlay}
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
                onComposerAction={onComposerAction}
                composerMode={composerMode}
                onClearComposerMode={onClearComposerMode}
                attachedFiles={attachedFiles}
                onAttachFiles={onAttachFiles}
              />
            </div>

            <div className="chat-footer-note">{t("app.disclaimer")}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="chat-view"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleGlobalDrop}
      style={{ position: "relative" }}
    >
      {dragOverlay}

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
              onDownloadSlide={onDownloadSlide}
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
              aria-label={t("chat.scrollToBottom")}
              title={t("chat.scrollToBottom")}
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
            attachedFiles={attachedFiles}
            onAttachFiles={onAttachFiles}
          />

          <div className="chat-footer-note">{t("app.disclaimer")}</div>
        </div>
      </div>
    </div>
  );
}
