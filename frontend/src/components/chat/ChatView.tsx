import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import type { Thread } from "../../types/workspace";
import { copyText } from "../../utils/helpers";
import { ScrollDownIcon } from "./ChatIcons";
import MessageBubble from "./MessageBubble";
import { t } from "../../i18n";
import { showToast } from "../ui/Toast";

type AttachedFile = { name: string; type: string; base64: string; size: number };

type Props = {
  activeThread: Thread | null;
  isSending: boolean;
  lastError: string | null;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  onStop: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  showScrollToBottom?: boolean;
  onScrollToBottom?: () => void;
  attachedFiles?: AttachedFile[];
  onAttachFiles?: (files: AttachedFile[]) => void;
  onOpenArtifact?: (title: string, code: string, language: string) => void;
  onDownloadSlide?: (slideData: Record<string, unknown>) => void;
};

function phaseLabel(phase: "idle" | "dispatch" | "working" | "meeting") {
  if (phase === "dispatch") return "지시 전달";
  if (phase === "working") return "부서 실행";
  if (phase === "meeting") return "미팅룸 보고";
  return "대기";
}

function trimDirective(content: string) {
  const value = content.trim();
  if (!value) return "대표이사 지시를 입력하면 CEO→부서→검증→최종보고 루프가 시작됩니다.";
  return value.length > 110 ? `${value.slice(0, 110)}...` : value;
}

function toBase64File(file: File): Promise<AttachedFile> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? result;
      resolve({ name: file.name, type: file.type, base64, size: file.size });
    };
    reader.readAsDataURL(file);
  });
}

export default function ChatView({
  activeThread,
  isSending,
  lastError,
  draft,
  onDraftChange,
  onSend,
  onStop,
  scrollRef,
  showScrollToBottom = false,
  onScrollToBottom,
  attachedFiles,
  onAttachFiles,
  onOpenArtifact,
  onDownloadSlide
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const visibleMessages = useMemo(
    () => (activeThread?.messages ?? []).filter((message) => !message.isHidden),
    [activeThread?.messages]
  );

  const latestDirective = useMemo(() => {
    const latestUser = [...visibleMessages].reverse().find((message) => message.role === "user");
    return latestUser?.content ?? "";
  }, [visibleMessages]);

  const officePhase = useMemo<"idle" | "dispatch" | "working" | "meeting">(() => {
    if (visibleMessages.length === 0) return "idle";
    if (isSending) {
      return visibleMessages.some((message) => message.role === "assistant" && message.status === "pending")
        ? "working"
        : "dispatch";
    }
    const tail = visibleMessages[visibleMessages.length - 1];
    return tail.role === "assistant" ? "meeting" : "dispatch";
  }, [visibleMessages, isSending]);

  const currentFiles = attachedFiles ?? [];
  const quickPrompts = [
    "방금 결과를 기준으로 리스크 우선순위를 재정렬해줘",
    "근거가 부족한 항목만 추가조사해서 보완해줘",
    "대표 보고용 1페이지 요약으로 다시 정리해줘",
  ];

  async function appendFiles(inputFiles: File[]) {
    if (!onAttachFiles) return;
    if (inputFiles.length === 0) return;
    const maxSize = 20 * 1024 * 1024;
    const remaining = 10 - currentFiles.length;
    if (remaining <= 0) {
      showToast(t("chat.maxAttachments").replace("{max}", "10"), "warning");
      return;
    }

    const filtered = inputFiles.filter((file) => file.size <= maxSize).slice(0, remaining);
    if (filtered.length === 0) return;

    const converted = await Promise.all(filtered.map(toBase64File));
    onAttachFiles([...currentFiles, ...converted]);
  }

  async function handleGlobalDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    await appendFiles(Array.from(event.dataTransfer.files ?? []));
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!isDragging) setIsDragging(true);
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    await appendFiles(files);
    event.currentTarget.value = "";
  }

  function handleRemoveFile(index: number) {
    if (!onAttachFiles) return;
    onAttachFiles(currentFiles.filter((_, idx) => idx !== index));
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (isSending) {
      onStop();
      return;
    }
    if (!draft.trim() && currentFiles.length === 0) return;
    void onSend();
  }

  if (!activeThread) return null;

  return (
    <div
      className="chat-view office-stage-view"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleGlobalDrop}
      style={{ position: "relative" }}
    >
      {isDragging ? (
        <div className="chat-drag-overlay">
          <div className="chat-drag-overlay__badge">{t("chat.dropFiles")}</div>
        </div>
      ) : null}

      <div ref={scrollRef} className="chat-view__scroll">
        <div className="chat-view__messages">
          <section className="office-mission-strip">
            <header className="office-mission-strip__head">
              <span className={`office-mission-strip__phase is-${officePhase}`}>{phaseLabel(officePhase)}</span>
              <strong>CEO WORKFLOW</strong>
            </header>
            <p>{trimDirective(latestDirective)}</p>
          </section>

          {visibleMessages.length === 0 ? (
            <section className="chat-empty__mission-board" aria-label="대화 시작 안내">
              <article>
                <span>FLOW</span>
                <strong>CEO 지시 → PMO 분해 → 부서 실행 → Critic 검증 → 상무 보고</strong>
              </article>
              <article>
                <span>TIP</span>
                <strong>하단 입력창에서 지시를 바로 입력하면 대화형으로 진행됩니다.</strong>
              </article>
            </section>
          ) : (
            visibleMessages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                isEditing={false}
                editingDraft=""
                isSending={isSending}
                onCopyUserMessage={async (target) => {
                  await copyText(target.content);
                  showToast(t("chat.copied"), "success");
                }}
                onCopyAssistantMessage={async (target) => {
                  await copyText(target.content);
                  showToast(t("chat.copied"), "success");
                }}
                onOpenArtifact={onOpenArtifact}
                onDownloadSlide={onDownloadSlide}
              />
            ))
          )}

          {lastError ? <div className="error-banner">{lastError}</div> : null}
        </div>
      </div>

      <div className="chat-view__composer-shell">
        <div className="chat-view__composer-inner chat-view__composer-inner--floating">
          <div className="chat-composer">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="chat-composer__icon-btn"
                  style={{ width: "auto", height: 28, borderRadius: 999, padding: "0 10px", marginBottom: 0 }}
                  onClick={() => onDraftChange(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>

            {currentFiles.length > 0 ? (
              <div
                className="chat-composer__files"
                style={{ display: "flex", gap: 8, marginBottom: 10, overflowX: "auto", paddingBottom: 4 }}
              >
                {currentFiles.map((file, index) => (
                  <div
                    key={`${file.name}-${index}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      border: "1px solid var(--hud-line, rgba(120,160,240,.3))",
                      borderRadius: 10,
                      padding: "4px 8px",
                      background: "rgba(24, 44, 80, 0.5)",
                      color: "var(--text-main)"
                    }}
                  >
                    <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>{file.name}</span>
                    <button type="button" onClick={() => handleRemoveFile(index)} aria-label="첨부 제거">×</button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="chat-composer__row">
              <button
                type="button"
                className="chat-composer__icon-btn"
                title={t("chat.attachFile")}
                onClick={() => fileInputRef.current?.click()}
              >
                +
              </button>
              <textarea
                className="chat-composer__textarea"
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                rows={1}
                placeholder={t("chat.placeholder")}
              />
              <div className="chat-composer__actions">
                {isSending ? (
                  <button
                    type="button"
                    className="chat-composer__send"
                    title={t("chat.stopTitle")}
                    onClick={onStop}
                  >
                    ■
                  </button>
                ) : (
                  <button
                    type="button"
                    className="chat-composer__send"
                    title={t("chat.send")}
                    onClick={() => void onSend()}
                    disabled={!draft.trim() && currentFiles.length === 0}
                  >
                    ↗
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {showScrollToBottom ? (
        <button
          type="button"
          className="scroll-to-bottom-btn"
          onClick={onScrollToBottom}
          aria-label={t("chat.scrollToBottom")}
          title={t("chat.scrollToBottom")}
        >
          <ScrollDownIcon />
        </button>
      ) : null}
    </div>
  );
}
