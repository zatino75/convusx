import { useRef, useState } from "react";
import { sendChatStream } from "../api/stream";
import { extractDebugMeta } from "../api/chat";
import { apiUrl, OPENAI_DIRECT_URL } from "../api/url";
import { saveMessages, saveThread } from "../api/workspace";
import { t } from "../i18n";
import {
  createMessage,
  findBaseUserMessageIndex,
  findNextUserMessageIndex,
  getVisibleMessages,
  isAbortError,
  isGenericThreadTitle,
  makeThreadTitle,
  updateMessageStatus,
} from "../appMessageUtils";
import {
  GENERAL_PROJECT_ID,
  buildLiveMetaFromEvents,
  createDefaultDebugMeta,
  createVersionGroupId,
} from "../store/workspaceStore";
import type { WorkspaceState } from "../store/workspaceStore";
import { nowIso, devLog } from "../utils/helpers";
import type { DebugMeta, Message, ProviderDraft, StreamEvent, Thread } from "../types/workspace";
import type { ConnectionState } from "./useConnectionStatus";

/** 서버 에러 메시지를 사용자 친화적 메시지로 매핑 */
function mapErrorCodeToMessage(raw: string): string {
  const s = (raw ?? "").toLowerCase()
  if (s.includes("missing_api_key") || s.includes("missing api key") || s.includes("missing anthropic_api_key") || s.includes("missing openai_api_key") || s.includes("missing gemini_api_key"))
    return t("chat.errorMissingApiKey")
  if (s.includes("rate_limit") || s.includes("rate limit") || s.includes("429") || s.includes("too many"))
    return t("chat.errorRateLimit")
  if (s.includes("timeout") || s.includes("timed out") || s.includes("deadline"))
    return t("chat.errorTimeout")
  if (s.includes("network") || s.includes("econnreset") || s.includes("enotfound") || s.includes("fetch failed"))
    return t("chat.errorNetwork")
  if (s.includes("overloaded") || s.includes("capacity") || s.includes("unavailable"))
    return t("chat.errorOverloaded")
  // 매핑 안 되면 원본 그대로
  return raw ? t("chat.errorPrefix").replace("{message}", raw) : t("chat.unknownError")
}

export type SendTarget = {
  threadId: string;
  projectId: string;
  currentTitle: string;
};

export type RetryOptions = {
  replaceFromMessageId?: string | null;
};

type ActiveStreamState = {
  controller: AbortController;
  threadId: string;
  projectId: string;
  placeholderId: string;
};

type UseSendChatOptions = {
  workspace: WorkspaceState;
  globalInstruction: string;
  draft: string;
  editingDraft: string;
  resetEditingState: () => void;
  markScrollToBottom: (behavior?: ScrollBehavior) => void;
  focusComposer: () => void;
  setPanelPage: (page: number) => void;
  setShowScrollToBottom: (value: boolean) => void;
  /** 서버 연결 상태 — offline 시 전송 차단 */
  connectionStatus?: ConnectionState;
};

export function useSendChat({
  workspace,
  globalInstruction,
  draft,
  editingDraft,
  resetEditingState,
  markScrollToBottom,
  focusComposer,
  setPanelPage,
  setShowScrollToBottom,
  connectionStatus,
}: UseSendChatOptions) {
  const [isSending, setIsSending] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; type: string; base64: string; size: number }[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [debugMeta, setDebugMeta] = useState<DebugMeta>(createDefaultDebugMeta());
  const [composerOptions, setComposerOptions] = useState<{ force_pro?: boolean; deep_research?: boolean; task?: string } | null>(null);

  const activeStreamRef = useRef<ActiveStreamState | null>(null);

  // attachedFiles ref for stable closure access inside async stream
  const attachedFilesRef = useRef(attachedFiles);
  attachedFilesRef.current = attachedFiles;

  const composerOptionsRef = useRef(composerOptions);
  composerOptionsRef.current = composerOptions;

  async function sendMessageToThread(text: string, target: SendTarget, options?: RetryOptions) {
    // 오프라인 상태이면 전송 차단
    if (connectionStatus === "offline") {
      setLastError(t("chat.errorNetwork"));
      return;
    }

    const files = attachedFilesRef.current;
    const trimmed = text.trim();
    if (!trimmed && files.length === 0) return;

    // 새 메시지 전송 시 패널 탭 리셋 (코드탭 고정 방지)
    setPanelPage(0);

    // 기존 스트림 abort 후 isSending 체크
    if (activeStreamRef.current) {
      activeStreamRef.current.controller.abort();
      activeStreamRef.current = null;
    }
    if (isSending) return;

    const timestamp = nowIso();
    const replaceFromMessageId = options?.replaceFromMessageId ?? null;
    const activeThread = workspace.threads.find((thread: Thread) => thread.id === target.threadId) ?? null;
    const visibleMessages = getVisibleMessages(activeThread);

    let versionGroupId = createVersionGroupId();
    let versionIndex = 0;
    let preservedMessages = visibleMessages;
    let messageVersions = { ...(activeThread?.messageVersions ?? {}) };
    let activeVersionIndex = { ...(activeThread?.activeVersionIndex ?? {}) };

    if (replaceFromMessageId && activeThread) {
      const replaceIndex = findBaseUserMessageIndex(visibleMessages, replaceFromMessageId);
      if (replaceIndex >= 0) {
        const originalUserMessage = visibleMessages[replaceIndex];
        versionGroupId = originalUserMessage.versionGroupId ?? createVersionGroupId();

        const groupMessages = [...(messageVersions[versionGroupId] ?? [])];
        const nextExistingIndex =
          Math.max(
            -1,
            ...groupMessages
              .filter((item: Message) => item.role === "user")
              .map((item: Message) => item.versionIndex ?? 0)
          ) + 1;

        const originalAnswer =
          replaceIndex + 1 < visibleMessages.length && visibleMessages[replaceIndex + 1]?.role === "assistant"
            ? visibleMessages[replaceIndex + 1]
            : null;

        const archivedUserMessage: Message = {
          ...originalUserMessage,
          versionGroupId,
          versionIndex: originalUserMessage.versionIndex ?? 0,
          isHidden: true
        };

        const existingUserIndex = groupMessages.findIndex(
          (item: Message) =>
            item.role === "user" &&
            item.versionIndex === archivedUserMessage.versionIndex &&
            item.versionGroupId === versionGroupId
        );

        if (existingUserIndex >= 0) {
          groupMessages[existingUserIndex] = archivedUserMessage;
        } else {
          groupMessages.push(archivedUserMessage);
        }

        if (originalAnswer) {
          const archivedAnswer: Message = {
            ...originalAnswer,
            versionGroupId,
            versionIndex: archivedUserMessage.versionIndex ?? 0,
            isHidden: true
          };

          const existingAnswerIndex = groupMessages.findIndex(
            (item: Message) =>
              item.role === "assistant" &&
              item.versionIndex === archivedAnswer.versionIndex &&
              item.versionGroupId === versionGroupId
          );

          if (existingAnswerIndex >= 0) {
            groupMessages[existingAnswerIndex] = archivedAnswer;
          } else {
            groupMessages.push(archivedAnswer);
          }
        }

        versionIndex = nextExistingIndex;
        messageVersions[versionGroupId] = groupMessages;
        activeVersionIndex[versionGroupId] = versionIndex;

        const nextUserBoundary = findNextUserMessageIndex(visibleMessages, replaceIndex);
        preservedMessages =
          nextUserBoundary >= 0
            ? visibleMessages.slice(0, replaceIndex).concat(visibleMessages.slice(nextUserBoundary))
            : visibleMessages.slice(0, replaceIndex);
      }
    }

    const displayText = trimmed || (files.length > 0 ? `📎 ${files.map((f: { name: string }) => f.name).join(", ")}` : "");
    const userMessage = createMessage("user", displayText, "done", {
      versionGroupId,
      versionIndex,
      isHidden: false,
      attachedFiles: files.length > 0
        ? files.map(f => ({ name: f.name, type: f.type, size: f.size }))
        : undefined
    });

    const assistantPlaceholder = createMessage("assistant", "", "pending", {
      versionGroupId,
      versionIndex,
      isHidden: false
    });

    const nextTitle = makeThreadTitle(trimmed || (files.length > 0 ? files[0].name : t("chat.fileAnalysis")));
    const liveEvents: StreamEvent[] = [];
    let liveMeta = createDefaultDebugMeta();
    let finalTextFromEvent = "";
    let chunkAccumulator = "";
    const statusHistory: string[] = [];
    const controller = new AbortController();

    activeStreamRef.current = {
      controller,
      threadId: target.threadId,
      projectId: target.projectId,
      placeholderId: assistantPlaceholder.id
    };

    markScrollToBottom("smooth");

    workspace.updateThreadById(target.threadId, (thread: Thread) => ({
      ...thread,
      title: isGenericThreadTitle(thread.title) ? nextTitle : thread.title,
      updatedAt: timestamp,
      meta: {
        ...(thread.meta ?? {}),
        lastSummary: trimmed.slice(0, 160)
      },
      messages: [...preservedMessages, userMessage, assistantPlaceholder],
      messageVersions,
      activeVersionIndex
    }));
    workspace.touchProject(target.projectId, timestamp);

    setIsSending(true);
    // ✅ setAttachedFiles([]) 여기서 하지 않음 — 전송 실패 시 파일 유지를 위해 onDone 성공 시점에만 초기화
    setComposerOptions(null);
    setLastError(null);
    setDebugMeta(createDefaultDebugMeta());
    resetEditingState();

    try {
      // 현재 요청 직전의 스레드 메시지 수집 (현재 user/placeholder 제외)
      // ✅ status === "error" 메시지 제외: 이전 실패한 응답이 컨텍스트에 남아 오답을 유발하는 버그 수정
      const rawContextMessages = preservedMessages
        .filter((m: Message) => !m.isHidden && m.content?.trim() && !m.content.includes("[응답 오류]") && m.status !== "pending" && m.status !== "error")
        .map((m: Message) => {
          let content = m.content;
          // USER 메시지: PROJECT CONTEXT / THREAD MEMORY 블록 완전 제거 후 순수 질문만 추출
          if (m.role === "user") {
            if (content.includes("[USER INPUT]")) {
              content = content.slice(content.lastIndexOf("[USER INPUT]") + "[USER INPUT]".length).trim();
            } else if (content.includes("[PROJECT CONTEXT]")) {
              content = content.split("[PROJECT CONTEXT]")[0].trim();
            }
          }
          // ASSISTANT 메시지: 코드블록 포함 시 축약 (오염 방지)
          if (m.role === "assistant") {
            const codeBlocks = (content.match(/```/g) ?? []).length;
            if (codeBlocks >= 2 && content.length > 5000) content = content.slice(0, 5000) + "...";
            else if (content.length > 7000) content = content.slice(0, 7000) + "...";
          }
          return { role: m.role, content };
        })
        .filter((m: { role: string; content: string }) => m.content.trim().length > 0);

      // ✅ 고아 user 메시지 제거: error assistant가 제거된 후 짝 없이 남은 user 메시지를 컨텍스트에서 제외
      const threadMessages = rawContextMessages.filter((m: { role: string; content: string }, i: number, arr: { role: string; content: string }[]) => {
        if (m.role !== "user") return true;
        const nextUserIdx = arr.findIndex((x, j) => j > i && x.role === "user");
        const endIdx = nextUserIdx === -1 ? arr.length : nextUserIdx;
        return arr.slice(i + 1, endIdx).some(x => x.role === "assistant");
      });

      // 마지막 유저 메시지가 현재 전송 메시지와 동일하면 제거
      const lastMsg = threadMessages[threadMessages.length - 1];
      if (lastMsg?.role === "user" && (lastMsg.content === trimmed || lastMsg.content === trimmed.trim())) {
        threadMessages.pop();
      }

      // ── 대화 자동 압축 — 메시지 30개 초과 시 오래된 대화 요약 압축 ──────
      if (threadMessages.length > 30) {
        const KEEP_RECENT = 10;
        const toCompress = threadMessages.slice(0, threadMessages.length - KEEP_RECENT);
        const recent = threadMessages.slice(threadMessages.length - KEEP_RECENT);
        try {
          const compressText = toCompress
            .map((m: { role: string; content: string }) => "[" + (m.role === "user" ? "USER" : "AI") + "] " + String(m.content).slice(0, 400))
            .join("\n");
          const openaiKey = String((window as unknown as Record<string, string>).__OPENAI_KEY__ ?? "");
          let summary = "";
          if (openaiKey) {
            const resp = await fetch(`${OPENAI_DIRECT_URL}/v1/chat/completions`, {
              method: "POST",
              headers: { Authorization: "Bearer " + openaiKey, "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                  { role: "system", content: t("chat.compressionPrompt") },
                  { role: "user", content: compressText }
                ],
                max_tokens: 600
              })
            });
            const d = await resp.json().catch(() => ({}));
            summary = String(d?.choices?.[0]?.message?.content ?? "").trim();
          }
          if (summary) {
            const compressed = [
              { role: "user" as const, content: t("chat.compressionSummaryPrefix").replace("{count}", String(toCompress.length)) + "\n\n" + summary },
              { role: "assistant" as const, content: t("chat.compressionAck") }
            ];
            threadMessages.splice(0, threadMessages.length, ...compressed, ...recent);
          }
        } catch (e) { devLog.warn("[useSendChat] conversation compression failed", e); }
      }

      // ===== SMOOTH STREAMING HANDLER =====
      let streamingBuffer = "";
      let lastRenderTime = Date.now();
      let pendingAnimationFrame: number | null = null;
      const MIN_RENDER_INTERVAL = 16; // ~60fps
      const TARGET_CHUNK_SIZE = 4; // Render every ~4 characters for smooth effect

      const scheduleStreamingRender = (forceImmediate = false) => {
        if (pendingAnimationFrame !== null) {
          cancelAnimationFrame(pendingAnimationFrame);
        }

        const renderNow = () => {
          if (streamingBuffer.length === 0 || !activeStreamRef.current) return;

          const now = Date.now();
          const timeSinceLastRender = now - lastRenderTime;
          const shouldRender = forceImmediate ||
                              timeSinceLastRender >= MIN_RENDER_INTERVAL ||
                              streamingBuffer.length >= TARGET_CHUNK_SIZE;

          if (shouldRender && activeStreamRef.current?.placeholderId === assistantPlaceholder.id) {
            chunkAccumulator += streamingBuffer;
            streamingBuffer = "";
            lastRenderTime = now;

            workspace.updateThreadById(target.threadId, (thread: Thread) => ({
              ...thread,
              messages: updateMessageStatus(thread.messages, assistantPlaceholder.id, (msg: Message) => ({
                ...msg,
                content: chunkAccumulator,
                status: "pending" as const
              }))
            }));
          }

          if (streamingBuffer.length > 0) {
            pendingAnimationFrame = requestAnimationFrame(renderNow);
          } else {
            pendingAnimationFrame = null;
          }
        };

        pendingAnimationFrame = requestAnimationFrame(renderNow);
      };

      const currentComposerOptions = composerOptionsRef.current;

      await sendChatStream(
        {
          message: trimmed || (files.length > 0 ? t("chat.attachAnalyze").replace("{files}", files.map((f: { name: string }) => f.name).join(", ")) : ""),
          thread_id: target.threadId,
          project_id: target.projectId,
          mode: "runtime_orchestra",
          messages: threadMessages,
          global_instruction: globalInstruction?.trim() || null,
          project_instruction: workspace.activeProject?.meta?.instruction?.trim() || null,
          ...(currentComposerOptions ?? {}),
          ...(files.length > 0 ? {
            attached_files: files.map((f: { name: string; type: string; base64: string; size: number }) => ({
              name: f.name,
              type: f.type,
              base64: f.base64,
              size: f.size
            }))
          } : {})
        },
        {
          onEvent: (event) => {
            if (activeStreamRef.current?.placeholderId !== assistantPlaceholder.id) return;
            liveEvents.push(event);
            liveMeta = buildLiveMetaFromEvents(liveEvents);

            // 진행 상태 표시 (pending 상태에서 단계별 메시지)
            if (event.type === "status") {
              const statusText = String(event.content ?? "");
              if (statusText) statusHistory.push(statusText);
              workspace.updateThreadById(target.threadId, (thread: Thread) => ({
                ...thread,
                messages: updateMessageStatus(thread.messages, assistantPlaceholder.id, (msg: Message) => ({
                  ...msg,
                  statusText,
                  statusHistory: [...statusHistory],
                  status: "pending" as const
                }))
              }));
            }

            if (event.type === "provider_chunk") {
              if (!finalTextFromEvent) {
                const cp = String(event.provider ?? "").toLowerCase();
                const primary = String(liveMeta.selectedProviders?.[0] ?? "").toLowerCase();
                const isPrimary = !cp || !primary || cp === primary;
                if (isPrimary) {
                  streamingBuffer += String(event.content ?? "");
                  scheduleStreamingRender();
                }
              }
            }

            if (event.type === "chunk" || event.type === "answer_chunk") {
              streamingBuffer += String(event.content ?? "");
              scheduleStreamingRender();
            }

            if (event.type === "final") {
              // Force render any remaining buffered content
              if (streamingBuffer.length > 0) {
                scheduleStreamingRender(true);
              }

              finalTextFromEvent = String(event.content ?? "");
              liveMeta = {
                ...liveMeta,
                winnerProvider: event.provider ?? liveMeta.winnerProvider ?? null,
                displayWinner: {
                  provider: event.provider ?? liveMeta.winnerProvider ?? undefined,
                  role: liveMeta.displayWinner?.role
                }
              };

              workspace.updateThreadById(target.threadId, (thread: Thread) => ({
                ...thread,
                updatedAt: nowIso(),
                messages: updateMessageStatus(thread.messages, assistantPlaceholder.id, (message: Message) => ({
                  ...message,
                  content: finalTextFromEvent || message.content,
                  status: "pending",
                  requestMeta: liveMeta
                }))
              }));

              if (pendingAnimationFrame !== null) {
                cancelAnimationFrame(pendingAnimationFrame);
                pendingAnimationFrame = null;
              }
              setDebugMeta(liveMeta);
              return;
            }

            setDebugMeta(liveMeta);
          },
          onDone: (payload) => {
            // 슬라이드 데이터 감지 — 다운로드 버튼 메시지로 처리
            if (payload?.is_slide && payload?.slide_data) {
              const slideData = payload.slide_data;
              const slideText = String(payload?.answer?.text ?? "").trim();
              workspace.updateThreadById(target.threadId, (thread: Thread) => {
                const nextMessages = updateMessageStatus(thread.messages, assistantPlaceholder.id, (msg: Message) => ({
                  ...msg,
                  content: slideText,
                  status: "done" as const,
                  requestMeta: { ...(msg.requestMeta ?? {}), slide_data: slideData }
                }));
                const nextThread = { ...thread, updatedAt: nowIso(), messages: nextMessages };
                saveMessages(target.threadId, nextMessages);
                saveThread(nextThread);
                return nextThread;
              });
              workspace.touchProject(target.projectId);
              setIsSending(false);
              setAttachedFiles([]);
              focusComposer();
              activeStreamRef.current = null;
              return;
            }

            // 이미지 생성 결과 저장 (DALL-E / Imagen / Midjourney)
            if (payload?.is_image && payload?.image_url) {
              const imageUrl = payload.image_url;
              const imageText = String(payload?.answer?.text ?? t("chat.imageGenerated")).trim();
              workspace.updateThreadById(target.threadId, (thread: Thread) => {
                const nextMessages = updateMessageStatus(thread.messages, assistantPlaceholder.id, (msg: Message) => ({
                  ...msg,
                  content: imageText,
                  status: "done" as const,
                  requestMeta: {
                    ...(msg.requestMeta ?? {}),
                    image_url: imageUrl,
                    image_urls: payload?.image_urls ?? null,
                    image_revised_prompt: payload?.image_revised_prompt ?? null
                  }
                }));
                const nextThread = { ...thread, updatedAt: nowIso(), messages: nextMessages };
                saveMessages(target.threadId, nextMessages);
                saveThread(nextThread);
                return nextThread;
              });
              workspace.touchProject(target.projectId);
              setIsSending(false);
              setAttachedFiles([]);
              focusComposer();
              activeStreamRef.current = null;
              return;
            }

            // 비디오 생성 결과 저장 (Runway / Veo)
            if (payload?.is_video && payload?.video_url) {
              const videoUrl = payload.video_url;
              const videoText = String(payload?.answer?.text ?? t("chat.videoGenerated")).trim();
              workspace.updateThreadById(target.threadId, (thread: Thread) => {
                const nextMessages = updateMessageStatus(thread.messages, assistantPlaceholder.id, (msg: Message) => ({
                  ...msg,
                  content: videoText,
                  status: "done" as const,
                  requestMeta: {
                    ...(msg.requestMeta ?? {}),
                    video_url: videoUrl,
                    is_video: true
                  }
                }));
                const nextThread = { ...thread, updatedAt: nowIso(), messages: nextMessages };
                saveMessages(target.threadId, nextMessages);
                saveThread(nextThread);
                return nextThread;
              });
              workspace.touchProject(target.projectId);
              setIsSending(false);
              setAttachedFiles([]);
              focusComposer();
              activeStreamRef.current = null;
              return;
            }

            // ── 서버 에러 reason 감지 (aborted / error) ──
            if (payload?._reason === "error" || (payload?.ok === false && payload?._reason !== "aborted")) {
              const serverErrorMsg = payload?._errorMessage || payload?.error_message || "";
              const friendlyMsg = mapErrorCodeToMessage(serverErrorMsg);
              workspace.updateThreadById(target.threadId, (thread: Thread) => {
                const nextMessages = updateMessageStatus(thread.messages, assistantPlaceholder.id, (item: Message) => ({
                  ...item,
                  content: item.content?.trim()
                    ? `${item.content}\n\n${friendlyMsg}`
                    : friendlyMsg,
                  status: "error" as const,
                  requestMeta: liveMeta.providerDrafts?.length ? liveMeta : null
                }));
                const nextThread = { ...thread, updatedAt: nowIso(), messages: nextMessages };
                saveMessages(target.threadId, nextMessages);
                saveThread(nextThread);
                return nextThread;
              });
              workspace.touchProject(target.projectId);
              setLastError(friendlyMsg);
              if (activeStreamRef.current?.placeholderId === assistantPlaceholder.id) {
                activeStreamRef.current = null;
              }
              setIsSending(false);
              // ✅ 에러 시 setAttachedFiles([]) 하지 않음 — 파일 유지하여 재시도 가능하게
              focusComposer();
              return;
            }

            // done 시점에 이미 화면에 표시된 내용을 우선 사용
            const currentDisplayContent = (() => {
              const thread = workspace.threads.find((t: Thread) => t.id === target.threadId);
              return thread?.messages.find((m: Message) => m.id === assistantPlaceholder.id)?.content ?? "";
            })();

            const assistantText =
              finalTextFromEvent ||
              String(payload?.answer?.text ?? "").trim() ||
              chunkAccumulator ||
              currentDisplayContent ||
              liveMeta.providerDrafts?.find((item: ProviderDraft) => item.provider === liveMeta.displayWinner?.provider)?.content ||
              liveMeta.providerDrafts?.find((item: ProviderDraft) => item.provider === liveMeta.winnerProvider)?.content ||
              "";

            const rawMeta = extractDebugMeta(payload) as Record<string, any>;

            const meta = {
              ...rawMeta,
              providerDrafts: liveMeta.providerDrafts ?? [],
              displayWinner: rawMeta?.display_winner ?? null,
              displayLosers: rawMeta?.display_losers ?? [],
              hiddenFailedProviders: rawMeta?.hidden_failed_providers ?? [],
              primaryRecovered: rawMeta?.primary_recovered ?? false,
              recoveryFromModel: rawMeta?.recovery_from_model ?? null,
              recoveryToModel: rawMeta?.recovery_to_model ?? null,
              providerStatusMap: rawMeta?.provider_status_map ?? {},
              providerStreamSummary: rawMeta?.provider_stream_summary ?? {},
              timelineEvents: rawMeta?.timeline_events ?? []
            } as DebugMeta;

            const doneTask = String(payload?.internal?.task ?? (meta as Record<string, any>)?.task ?? "").toLowerCase();
            if (doneTask === "code" || doneTask === "code_implement" || doneTask === "code_debug" || doneTask === "code_refactor") {
              setPanelPage(2);
            }

            workspace.updateThreadById(target.threadId, (thread: Thread) => {
              const nextMessages: Message[] = updateMessageStatus(thread.messages, assistantPlaceholder.id, (message: Message) => ({
                ...message,
                content:
                  assistantText ||
                  message.content ||
                  t("chat.responseError"),
                status: "done",
                requestMeta: meta,
                statusHistory: statusHistory.length > 0 ? [...statusHistory] : undefined
              }));

              let nextThread: Thread = {
                ...thread,
                updatedAt: nowIso(),
                meta: {
                  ...(thread.meta ?? {}),
                  lastSummary: assistantText.slice(0, 160)
                },
                messages: nextMessages
              };

              if (replaceFromMessageId) {
                const groupId = userMessage.versionGroupId ?? "";
                const finalizedAssistant =
                  nextMessages.find((item) => item.id === assistantPlaceholder.id) ?? assistantPlaceholder;

                const mergedGroupMessages: Message[] = [
                  ...(thread.messageVersions?.[groupId] ?? []).filter(
                    (item: Message) => item.versionIndex !== userMessage.versionIndex
                  ),
                  userMessage,
                  finalizedAssistant
                ];

                nextThread.messageVersions = {
                  ...(thread.messageVersions ?? {}),
                  [groupId]: mergedGroupMessages
                };
                nextThread.activeVersionIndex = {
                  ...(thread.activeVersionIndex ?? {}),
                  [groupId]: userMessage.versionIndex ?? 0
                };
              }

              // 서버에서 생성한 thread_title 적용 (isGenericThreadTitle인 경우에만)
              if (payload?.thread_title && isGenericThreadTitle(nextThread.title)) {
                const autoTitle = String(payload.thread_title).trim().slice(0, 32);
                if (autoTitle) nextThread = { ...nextThread, title: autoTitle };
              }

              // ★ 서버 DB 영속화
              saveMessages(target.threadId, nextThread.messages);
              saveThread(nextThread);

              return nextThread;
            });

            workspace.touchProject(target.projectId);
            setDebugMeta(meta);

            // 안전망: onDone 시점에 명시적으로 isSending 해제
            if (activeStreamRef.current?.placeholderId === assistantPlaceholder.id) {
              activeStreamRef.current = null;
            }
            setIsSending(false);
            setAttachedFiles([]);
            focusComposer();
          }
        },
        {
          signal: controller.signal
        }
      );
    } catch (error) {
      if (isAbortError(error)) {
        workspace.updateThreadById(target.threadId, (thread: Thread) => {
          const nextMessages = updateMessageStatus(thread.messages, assistantPlaceholder.id, (item: Message) => ({
            ...item,
            content: item.content?.trim() ? item.content : t("chat.generationCancelled"),
            status: "done" as const,
            requestMeta: liveMeta.providerDrafts?.length ? liveMeta : item.requestMeta ?? null
          }));
          const nextThread = { ...thread, updatedAt: nowIso(), messages: nextMessages };
          saveMessages(target.threadId, nextMessages);
          saveThread(nextThread);
          return nextThread;
        });

        workspace.touchProject(target.projectId);
        setLastError(null);
      } else {
        const rawMessage = error instanceof Error ? error.message : t("chat.unknownError");
        const message = mapErrorCodeToMessage(rawMessage);

        workspace.updateThreadById(target.threadId, (thread: Thread) => {
          const nextMessages = updateMessageStatus(thread.messages, assistantPlaceholder.id, (item: Message) => ({
            ...item,
            content: item.content ? `${item.content}\n\n${message}` : message,
            status: "error" as const,
            requestMeta: liveMeta.providerDrafts?.length ? liveMeta : null
          }));
          const nextThread = { ...thread, updatedAt: nowIso(), messages: nextMessages };
          saveMessages(target.threadId, nextMessages);
          saveThread(nextThread);
          return nextThread;
        });

        workspace.touchProject(target.projectId);
        setLastError(message);
      }
    } finally {
      if (activeStreamRef.current?.placeholderId === assistantPlaceholder.id) {
        activeStreamRef.current = null;
      }
      setIsSending(false);
      // ✅ finally에서 setAttachedFiles([]) 제거 — 에러 시에도 실행되어 파일을 지우는 버그 수정
      focusComposer();
    }
  }

  async function handleSend() {
    if (!workspace.activeThread) return;
    await sendMessageToThread(draft, {
      threadId: workspace.activeThread.id,
      projectId: workspace.activeThread.projectId,
      currentTitle: workspace.activeThread.title
    });
  }

  async function handleHomeSubmit(text: string) {
    const trimmed = text.trim();
    if ((!trimmed && attachedFilesRef.current.length === 0) || isSending) return;

    if (workspace.activeProjectId === GENERAL_PROJECT_ID) {
      const threadId = workspace.createGeneralChat();
      await sendMessageToThread(trimmed, {
        threadId,
        projectId: GENERAL_PROJECT_ID,
        currentTitle: ""
      });
      // ✅ setAttachedFiles([]) 제거 — sendMessageToThread 내부 onDone 성공 시 처리됨
      return;
    }

    const projectId = workspace.activeProjectId;
    const threadId = workspace.createThreadInProject(projectId);

    await sendMessageToThread(trimmed, {
      threadId,
      projectId,
      currentTitle: ""
    });
    // ✅ setAttachedFiles([]) 제거 — sendMessageToThread 내부 onDone 성공 시 처리됨
  }

  async function handleSubmitEditMessage(messageId: string) {
    if (!workspace.activeThread) return;
    const nextText = editingDraft.trim();
    if (!nextText) return;

    await sendMessageToThread(
      nextText,
      {
        threadId: workspace.activeThread.id,
        projectId: workspace.activeThread.projectId,
        currentTitle: workspace.activeThread.title
      },
      {
        replaceFromMessageId: messageId
      }
    );
  }

  function handleStopGenerating(currentDebugMeta: DebugMeta) {
    const activeStream = activeStreamRef.current;
    if (!activeStream) return;

    activeStream.controller.abort();

    workspace.updateThreadById(activeStream.threadId, (thread: Thread) => {
      const nextMessages = updateMessageStatus(thread.messages, activeStream.placeholderId, (message: Message) => ({
        ...message,
        content: message.content?.trim() ? message.content : t("chat.generationCancelled"),
        status: "done" as const,
        requestMeta: message.requestMeta ?? currentDebugMeta
      }));
      const nextThread = { ...thread, updatedAt: nowIso(), messages: nextMessages };
      saveMessages(activeStream.threadId, nextMessages);
      saveThread(nextThread);
      return nextThread;
    });

    workspace.touchProject(activeStream.projectId);
    activeStreamRef.current = null;
    setIsSending(false);
    setLastError(null);
    setShowScrollToBottom(false);
    focusComposer();
  }

  return {
    isSending,
    attachedFiles,
    setAttachedFiles,
    lastError,
    debugMeta,
    composerOptions,
    setComposerOptions,
    sendMessageToThread,
    handleSend,
    handleHomeSubmit,
    handleSubmitEditMessage,
    handleStopGenerating,
  };
}
