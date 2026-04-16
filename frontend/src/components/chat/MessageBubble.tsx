import { useEffect, useRef, useState } from "react";
import type { Message } from "../../types/workspace";
import renderMessageContent from "./MessageRenderer";
import { FilePreviewCompact } from "./FilePreview";
import ToolCallTimeline, { type ToolCallTimelineEntry } from "./ToolCallTimeline";
import EnsembleCompareView, { type EnsembleCompareData } from "./EnsembleCompareView";
import AssistantActionToolbar from "./AssistantActionToolbar";
import UserMessageToolsRow, { type MessageVersionState } from "./UserMessageToolsRow";
import MessageEditComposer from "./MessageEditComposer";
import MessageMediaPreviews from "./MessageMediaPreviews";
import { apiFetch } from "../../api/url";
import { copyText, devLog } from "../../utils/helpers";
import { t } from "../../i18n";

export type { MessageVersionState };
export { default as ThreadMetaStrip } from "./ThreadMetaStrip";

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
  const [open, setOpen] = useState(isPending !== false);
  if (!steps || steps.length === 0) return null;

  const lastStep = steps[steps.length - 1];

  return (
    <div className="tp">
      <button className="tp__header" onClick={() => setOpen(p => !p)} type="button">
        {!open && isPending && <span className="tp__spinner" />}
        {!open && (
          <span className="tp__title">
            {isPending ? lastStep : t("chat.thinkingProcess")}
          </span>
        )}
        {open && isPending && <span className="tp__spinner" />}
        <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2"
          className="tp__chevron" style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>
          <path d="M6 3l5 5-5 5" />
        </svg>
      </button>

      {!open && !isPending && lastStep && (
        <div className="tp__preview">{lastStep}</div>
      )}

      {open && (
        <div className="tp__body">
          {steps.map((step, i) => {
            const cat = categorizeStep(step);
            return (
              <div key={i} className="tp__line">
                <svg viewBox="0 0 6 6" width="5" height="5" className="tp__dot-small" style={{ color: cat.color }}>
                  <circle cx="3" cy="3" r="2.5" fill="currentColor" />
                </svg>
                <span className="tp__step-text">{step}</span>
              </div>
            );
          })}
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
  onDownloadSlide?: (slideData: any) => void;
}) {
  const isUser = message.role === "user";
  const isPending = message.status === "pending";
  const isError = message.status === "error";

  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (!isPending) { setElapsedSec(0); return; }
    setElapsedSec(0);
    const timer = setInterval(() => setElapsedSec(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, [isPending]);

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
      <div className="message message--user" style={{ width: "100%" }}>
        <div
          className="message__body"
          style={{ display: "flex", justifyContent: "center", alignItems: "flex-start", width: "100%" }}
        >
          <div style={{ width: "100%", maxWidth: "2500px", minWidth: 0 }}>
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
    ? { display: "flex", justifyContent: "flex-end", alignItems: "flex-start" }
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
    : { position: "relative" as const };

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
          <div className={isError ? "message__error-box" : ""}>
            {isUser && Array.isArray(message.attachedFiles) && message.attachedFiles.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "8px 14px 2px" }}>
                {(message.attachedFiles as { name: string; type: string; base64?: string; size: number }[]).map((f, idx) => (
                  <FilePreviewCompact key={idx} name={f.name} type={f.type} size={f.size} />
                ))}
              </div>
            ) : null}

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

            {isPending && statusHistoryBlock}

            {!isUser &&
              Array.isArray((message.requestMeta as any)?.toolTimeline) &&
              ((message.requestMeta as any).toolTimeline as ToolCallTimelineEntry[]).length > 0 && (
                <div style={{ margin: "6px 18px 0" }}>
                  <ToolCallTimeline
                    entries={(message.requestMeta as any).toolTimeline as ToolCallTimelineEntry[]}
                    compact={isPending}
                  />
                </div>
              )}

            {!isUser && !isPending && (message.requestMeta as any)?.ensembleData && (
              <div style={{ margin: "0 18px" }}>
                <EnsembleCompareView data={(message.requestMeta as any).ensembleData as EnsembleCompareData} />
              </div>
            )}

            {!isUser && !isPending && (
              <MessageMediaPreviews message={message} onDownloadSlide={onDownloadSlide} />
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
