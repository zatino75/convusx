import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { extractDebugMeta } from "./api/chat";
import ChatView from "./components/chat/ChatView";
import HomeView from "./components/chat/HomeView";
import AppShell from "./components/layout/AppShell";
import Sidebar from "./components/layout/Sidebar";
import Topbar from "./components/layout/Topbar";
import {
  GENERAL_PROJECT_ID,
  buildLiveMetaFromEvents,
  createDefaultDebugMeta,
  createVersionGroupId,
  nowIso,
  useWorkspaceState
} from "./store/workspaceStore";
import type {
  DebugMeta,
  MainViewMode,
  Message,
  MessageStatus,
  StreamEvent,
  Thread,
  WorkspaceKind
} from "./types/workspace";

async function sendChatStream(
  payload: {
    message: string;
    thread_id: string;
    project_id: string;
    mode: string;
  },
  handlers: {
    onEvent?: (event: StreamEvent) => void;
    onDone?: (payload: any) => void;
  },
  options?: {
    signal?: AbortSignal;
  }
) {
  const response = await fetch("http://localhost:8000/api/chat/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: options?.signal
  });

  if (!response.ok || !response.body) {
    throw new Error(`스트림 연결 실패 (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (options?.signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      while (buffer.includes("\n\n")) {
        const splitIndex = buffer.indexOf("\n\n");
        const rawEvent = buffer.slice(0, splitIndex);
        buffer = buffer.slice(splitIndex + 2);

        const dataLines = rawEvent
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim());

        if (dataLines.length === 0) continue;

        const json = dataLines.join("\n");
        const event = JSON.parse(json) as StreamEvent;

        if (event.type === "done") {
          handlers.onDone?.(event.payload);
        } else {
          handlers.onEvent?.(event);
        }

        if (event.type === "error") {
          throw new Error(event.error || "unknown_error");
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      return;
    }
  }
}

function createMessage(
  role: "user" | "assistant",
  content: string,
  status?: MessageStatus,
  extra?: Partial<Message>
): Message {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    role,
    content,
    createdAt: nowIso(),
    status,
    requestMeta: null,
    ...extra
  };
}

function normalizeThreadTitle(input: string | null | undefined) {
  return String(input ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isGenericThreadTitle(input: string | null | undefined) {
  const normalized = normalizeThreadTitle(input);

  if (!normalized) return true;

  const genericTitles = new Set([
    "새 채팅",
    "새채팅",
    "new chat",
    "untitled",
    "chat",
    "thread",
    "global chat",
    "globalchat",
    "글로벌채팅",
    "글로벌 채팅",
    "일반채팅",
    "일반 채팅",
    "general chat"
  ]);

  return genericTitles.has(normalized);
}

function makeThreadTitle(input: string) {
  const oneLine = input.replace(/\s+/g, " ").trim();
  if (!oneLine) return "새 채팅";
  return oneLine.slice(0, 32);
}

function getVisibleMessages(thread: Thread | null) {
  return (thread?.messages ?? []).filter((message) => !message.isHidden);
}

function findBaseUserMessageIndex(messages: Message[], messageId: string) {
  return messages.findIndex((item) => item.id === messageId);
}

function findNextUserMessageIndex(messages: Message[], startIndex: number) {
  for (let index = startIndex + 1; index < messages.length; index += 1) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }
  return -1;
}

function updateMessageStatus(
  messages: Message[],
  targetId: string,
  updater: (message: Message) => Message
): Message[] {
  return messages.map((message) => (message.id === targetId ? updater(message) : message));
}

function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function ProjectCreateModal({
  open,
  value,
  onChange,
  onClose,
  onSubmit
}: {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="project-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="project-modal__header">
          <div className="project-modal__title">새 프로젝트</div>

          <div className="project-modal__actions">
            <button type="button" className="project-modal__icon-btn" onClick={onClose} aria-label="닫기">
              <CloseIcon />
            </button>
          </div>
        </div>

        <div className="project-modal__label">프로젝트 이름</div>

        <div className="project-modal__input-wrap">
          <span className="project-modal__input-icon">
            <FolderIcon />
          </span>
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmit();
              }
            }}
            className="project-modal__input"
            placeholder="예: AI ORCHESTRA UI 리디자인"
          />
        </div>

        <div className="project-modal__chips">
          <button type="button" className="project-modal__chip" onClick={() => onChange("AI ORCHESTRA")}>
            AI ORCHESTRA
          </button>
          <button type="button" className="project-modal__chip" onClick={() => onChange("멀티 AI 리서치")}>
            멀티 AI 리서치
          </button>
          <button type="button" className="project-modal__chip" onClick={() => onChange("UI 고도화")}>
            UI 고도화
          </button>
        </div>

        <div className="project-modal__notice">
          프로젝트를 만들면 프로젝트 홈과 스레드 구조가 분리되어 관리됩니다.
        </div>

        <div className="project-modal__footer">
          <button
            type="button"
            className="project-modal__submit"
            onClick={onSubmit}
            disabled={!value.trim()}
          >
            생성
          </button>
        </div>
      </div>
    </div>
  );
}

type SendTarget = {
  threadId: string;
  projectId: string;
  currentTitle: string;
};

type RetryOptions = {
  replaceFromMessageId?: string | null;
};

type ActiveStreamState = {
  controller: AbortController;
  threadId: string;
  projectId: string;
  placeholderId: string;
};

export default function App() {
  const workspace = useWorkspaceState();

  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [debugMeta, setDebugMeta] = useState<DebugMeta>(createDefaultDebugMeta());
  const [sidebarView, setSidebarView] = useState<"default" | "search" | "images">("default");
  const [artifactContent, setArtifactContent] = useState<{ title: string; code: string; language: string } | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");

  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [projectTitleDraft, setProjectTitleDraft] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoStickRef = useRef(true);
  const pendingScrollBehaviorRef = useRef<ScrollBehavior | null>("auto");
  const activeStreamRef = useRef<ActiveStreamState | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      setShowScrollToBottom(false);
      return;
    }

    const updateStickiness = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const isNearBottom = distanceFromBottom <= 96;
      shouldAutoStickRef.current = isNearBottom;
      setShowScrollToBottom(distanceFromBottom > 120);
    };

    updateStickiness();
    el.addEventListener("scroll", updateStickiness, { passive: true });

    return () => {
      el.removeEventListener("scroll", updateStickiness);
    };
  }, [workspace.activeThreadId, sidebarView]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (!shouldAutoStickRef.current && pendingScrollBehaviorRef.current === null) return;

    const behavior = pendingScrollBehaviorRef.current ?? "auto";

    requestAnimationFrame(() => {
      const latest = scrollRef.current;
      if (!latest) return;

      latest.scrollTo({
        top: latest.scrollHeight,
        behavior
      });

      const distanceFromBottom = latest.scrollHeight - latest.scrollTop - latest.clientHeight;
      setShowScrollToBottom(distanceFromBottom > 120);
      pendingScrollBehaviorRef.current = null;
    });
  }, [workspace.threads, workspace.activeThreadId, isSending]);

  const workspaceKind: WorkspaceKind =
    workspace.activeProjectId === GENERAL_PROJECT_ID ? "general" : "project";
  const mode: MainViewMode = workspace.activeThreadId ? "thread-chat" : "home";

  const messageVersionMap = useMemo(() => {
    const thread = workspace.activeThread;
    if (!thread) return {};

    const versions = thread.messageVersions ?? {};
    const activeVersionIndex = thread.activeVersionIndex ?? {};
    const result: Record<string, { current: number; total: number }> = {};

    for (const [groupId, messages] of Object.entries(versions)) {
      if (!Array.isArray(messages) || messages.length <= 1) continue;

      const visibleUserMessage = thread.messages.find(
        (item) => item.role === "user" && !item.isHidden && item.versionGroupId === groupId
      );

      if (!visibleUserMessage) continue;

      result[visibleUserMessage.id] = {
        current: (activeVersionIndex[groupId] ?? 0) + 1,
        total: messages.filter((item) => item.role === "user").length || messages.length
      };
    }

    return result;
  }, [workspace.activeThread]);

  function focusComposer() {
    queueMicrotask(() => textareaRef.current?.focus());
  }

  function markScrollToBottom(behavior: ScrollBehavior = "auto") {
    shouldAutoStickRef.current = true;
    pendingScrollBehaviorRef.current = behavior;
    setShowScrollToBottom(false);
  }

  function resetEditingState() {
    setEditingMessageId(null);
    setEditingDraft("");
  }

  function openProjectModal() {
    setProjectTitleDraft("");
    setIsProjectModalOpen(true);
  }

  function closeProjectModal() {
    setIsProjectModalOpen(false);
    setProjectTitleDraft("");
  }

  function handleSubmitProjectModal() {
    const nextTitle = projectTitleDraft.trim();
    if (!nextTitle) return;

    workspace.createNamedProject(nextTitle);
    setDraft("");
    setLastError(null);
    setDebugMeta(createDefaultDebugMeta());
    setSidebarView("default");
    resetEditingState();
    markScrollToBottom("auto");
    closeProjectModal();
  }

  function handleOpenGeneralHome() {
    workspace.openGeneralHome();
    setDraft("");
    setLastError(null);
    setSidebarView("default");
    resetEditingState();
    markScrollToBottom("auto");
  }

  function handleSelectProject(projectId: string) {
    workspace.selectProject(projectId);
    setDraft("");
    setLastError(null);
    setSidebarView("default");
    resetEditingState();
    markScrollToBottom("auto");
  }

  function handleOpenThread(threadId: string) {
    workspace.openThread(threadId);
    setDraft("");
    setLastError(null);
    setSidebarView("default");
    resetEditingState();
    markScrollToBottom("auto");
    focusComposer();
  }

  function handleOpenSearch() {
    workspace.setActiveThreadId(null);
    setSidebarView("search");
    setLastError(null);
    resetEditingState();
    markScrollToBottom("auto");
  }

  function handleOpenImages() {
    workspace.setActiveThreadId(null);
    setSidebarView("images");
    setLastError(null);
    resetEditingState();
    markScrollToBottom("auto");
  }

  function handleCreateNamedProject() {
    openProjectModal();
  }

  function handleCreateThreadInProject(projectId: string) {
    workspace.createThreadInProject(projectId);
    setDraft("");
    setLastError(null);
    setDebugMeta(createDefaultDebugMeta());
    setSidebarView("default");
    resetEditingState();
    markScrollToBottom("auto");
    focusComposer();
  }

  function handleToggleProjectMemory(projectId: string) {
    const project = workspace.projects.find((item) => item.id === projectId);
    if (!project) return;

    workspace.updateProjectMeta(projectId, {
      memoryEnabled: !project.meta?.memoryEnabled
    });
  }

  function handleRenameThreadFromHome(threadId: string, nextTitle: string) {
    const safeTitle = nextTitle.trim();
    if (!safeTitle) return;

    workspace.updateThreadById(threadId, (thread) => ({
      ...thread,
      title: safeTitle,
      updatedAt: nowIso()
    }));

    const targetThread = workspace.threads.find((thread) => thread.id === threadId);
    if (targetThread) {
      workspace.touchProject(targetThread.projectId, nowIso());
    }
  }

  function handleMoveThreadFromHome(threadId: string, nextProjectId: string) {
    if (!nextProjectId) return;
    workspace.moveThread(threadId, nextProjectId);
  }

  function backToHome() {
    workspace.setActiveThreadId(null);
    setLastError(null);
    setSidebarView("default");
    resetEditingState();
    markScrollToBottom("auto");
  }

  function handleScrollToBottom() {
    const el = scrollRef.current;
    if (!el) return;

    el.scrollTo({
      top: el.scrollHeight,
      behavior: "smooth"
    });

    shouldAutoStickRef.current = true;
    setShowScrollToBottom(false);
  }

  function handleStopGenerating() {
    const activeStream = activeStreamRef.current;
    if (!activeStream) return;

    activeStream.controller.abort();

    workspace.updateThreadById(activeStream.threadId, (thread) => ({
      ...thread,
      updatedAt: nowIso(),
      messages: updateMessageStatus(thread.messages, activeStream.placeholderId, (message) => ({
        ...message,
        content: message.content?.trim() ? message.content : "생성이 중단되었습니다.",
        status: "done",
        requestMeta: message.requestMeta ?? debugMeta
      }))
    }));

    workspace.touchProject(activeStream.projectId);
    activeStreamRef.current = null;
    setIsSending(false);
    setLastError(null);
    setShowScrollToBottom(false);
    focusComposer();
  }

  async function sendMessageToThread(text: string, target: SendTarget, options?: RetryOptions) {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;

    const timestamp = nowIso();
    const replaceFromMessageId = options?.replaceFromMessageId ?? null;
    const activeThread = workspace.threads.find((thread) => thread.id === target.threadId) ?? null;
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
              .filter((item) => item.role === "user")
              .map((item) => item.versionIndex ?? 0)
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
          (item) =>
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
            (item) =>
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

    const userMessage = createMessage("user", trimmed, "done", {
      versionGroupId,
      versionIndex,
      isHidden: false
    });

    const assistantPlaceholder = createMessage("assistant", "", "pending", {
      versionGroupId,
      versionIndex,
      isHidden: false
    });

    const nextTitle = makeThreadTitle(trimmed);
    const liveEvents: StreamEvent[] = [];
    let liveMeta = createDefaultDebugMeta();
    let finalTextFromEvent = "";
    const controller = new AbortController();

    activeStreamRef.current = {
      controller,
      threadId: target.threadId,
      projectId: target.projectId,
      placeholderId: assistantPlaceholder.id
    };

    markScrollToBottom("smooth");

    workspace.updateThreadById(target.threadId, (thread) => ({
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

    setDraft("");
    setIsSending(true);
    setLastError(null);
    setDebugMeta(createDefaultDebugMeta());
    resetEditingState();

    try {
      await sendChatStream(
        {
          message: trimmed,
          thread_id: target.threadId,
          project_id: target.projectId,
          mode: "runtime_orchestra"
        },
        {
          onEvent: (event) => {
            liveEvents.push(event);
            liveMeta = buildLiveMetaFromEvents(liveEvents);

            if (event.type === "provider_chunk") {
              const winnerProvider =
                liveMeta.displayWinner?.provider ??
                liveMeta.winnerProvider ??
                liveMeta.selectedProviders[0] ??
                event.provider;

              const currentWinnerDraft =
                liveMeta.providerDrafts?.find((item) => item.provider === winnerProvider)?.content ?? "";

              workspace.updateThreadById(target.threadId, (thread) => ({
                ...thread,
                updatedAt: nowIso(),
                messages: updateMessageStatus(thread.messages, assistantPlaceholder.id, (message) => ({
                  ...message,
                  content: currentWinnerDraft,
                  status: "pending",
                  requestMeta: liveMeta
                }))
              }));

              setDebugMeta(liveMeta);
              return;
            }

            if (event.type === "answer_chunk") {
              workspace.updateThreadById(target.threadId, (thread) => ({
                ...thread,
                updatedAt: nowIso(),
                messages: updateMessageStatus(thread.messages, assistantPlaceholder.id, (message) => ({
                  ...message,
                  content: `${message.content}${event.content ?? ""}`,
                  status: "pending",
                  requestMeta: liveMeta
                }))
              }));

              setDebugMeta(liveMeta);
              return;
            }

            if (event.type === "final") {
              finalTextFromEvent = String(event.content ?? "");
              liveMeta = {
                ...liveMeta,
                winnerProvider: event.provider ?? liveMeta.winnerProvider ?? null,
                displayWinner: {
                  provider: event.provider ?? liveMeta.winnerProvider ?? undefined,
                  role: liveMeta.displayWinner?.role
                }
              };

              workspace.updateThreadById(target.threadId, (thread) => ({
                ...thread,
                updatedAt: nowIso(),
                messages: updateMessageStatus(thread.messages, assistantPlaceholder.id, (message) => ({
                  ...message,
                  content: finalTextFromEvent || message.content,
                  status: "pending",
                  requestMeta: liveMeta
                }))
              }));

              setDebugMeta(liveMeta);
              return;
            }

            setDebugMeta(liveMeta);
          },
          onDone: (payload) => {
            const assistantText =
              String(payload?.answer?.text ?? "").trim() ||
              finalTextFromEvent ||
              liveMeta.providerDrafts?.find((item) => item.provider === liveMeta.displayWinner?.provider)?.content ||
              liveMeta.providerDrafts?.find((item) => item.provider === liveMeta.winnerProvider)?.content ||
              "";

            const rawMeta = extractDebugMeta(payload) as any;

            const meta: DebugMeta = {
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
            };

            workspace.updateThreadById(target.threadId, (thread) => {
              const nextMessages: Message[] = updateMessageStatus(thread.messages, assistantPlaceholder.id, (message) => ({
                ...message,
                content:
                  assistantText ||
                  message.content ||
                  "응답은 왔지만 표시 가능한 final_answer를 찾지 못했습니다.",
                status: "done",
                requestMeta: meta
              }));

              const nextThread: Thread = {
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
                    (item) => item.versionIndex !== userMessage.versionIndex
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

              return nextThread;
            });

            workspace.touchProject(target.projectId);
            setDebugMeta(meta);
          }
        },
        {
          signal: controller.signal
        }
      );
    } catch (error) {
      if (isAbortError(error)) {
        workspace.updateThreadById(target.threadId, (thread) => ({
          ...thread,
          updatedAt: nowIso(),
          messages: updateMessageStatus(thread.messages, assistantPlaceholder.id, (item) => ({
            ...item,
            content: item.content?.trim() ? item.content : "생성이 중단되었습니다.",
            status: "done",
            requestMeta: liveMeta.providerDrafts?.length ? liveMeta : item.requestMeta ?? null
          }))
        }));

        workspace.touchProject(target.projectId);
        setLastError(null);
      } else {
        const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";

        workspace.updateThreadById(target.threadId, (thread) => ({
          ...thread,
          updatedAt: nowIso(),
          messages: updateMessageStatus(thread.messages, assistantPlaceholder.id, (item) => ({
            ...item,
            content: item.content ? `${item.content}\n\n오류: ${message}` : `오류: ${message}`,
            status: "error",
            requestMeta: liveMeta.providerDrafts?.length ? liveMeta : null
          }))
        }));

        workspace.touchProject(target.projectId);
        setLastError(message);
      }
    } finally {
      if (activeStreamRef.current?.placeholderId === assistantPlaceholder.id) {
        activeStreamRef.current = null;
      }
      setIsSending(false);
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
    if (!trimmed || isSending) return;

    setSidebarView("default");

    if (workspace.activeProjectId === GENERAL_PROJECT_ID) {
      const threadId = workspace.createGeneralChat();
      await sendMessageToThread(trimmed, {
        threadId,
        projectId: GENERAL_PROJECT_ID,
        currentTitle: ""
      });
      return;
    }

    const projectId = workspace.activeProjectId;
    const threadId = workspace.createThreadInProject(projectId);

    await sendMessageToThread(trimmed, {
      threadId,
      projectId,
      currentTitle: ""
    });
  }

  function handleStartEditMessage(message: Message) {
    setEditingMessageId(message.id);
    setEditingDraft(message.content);
  }

  function handleCancelEditMessage() {
    resetEditingState();
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

  function handleCopyUserMessage(message: Message) {
    void navigator.clipboard.writeText(message.content);
  }

  function handleCopyAssistantMessage(message: Message) {
    void navigator.clipboard.writeText(message.content);
  }

  function handleSelectMessageVersion(messageId: string, direction: "prev" | "next") {
    const thread = workspace.activeThread;
    if (!thread) return;

    const baseMessage = thread.messages.find((item) => item.id === messageId);
    const groupId = baseMessage?.versionGroupId;
    if (!groupId) return;

    const versions = thread.messageVersions?.[groupId] ?? [];
    const userVersions = versions
      .filter((item) => item.role === "user")
      .sort((a, b) => (a.versionIndex ?? 0) - (b.versionIndex ?? 0));

    if (userVersions.length <= 1) return;

    const currentVersionValue = thread.activeVersionIndex?.[groupId] ?? 0;
    const currentVersionPosition = userVersions.findIndex(
      (item) => (item.versionIndex ?? 0) === currentVersionValue
    );

    const safeCurrentPosition = currentVersionPosition >= 0 ? currentVersionPosition : 0;
    const nextPosition =
      direction === "prev"
        ? Math.max(0, safeCurrentPosition - 1)
        : Math.min(userVersions.length - 1, safeCurrentPosition + 1);

    if (nextPosition === safeCurrentPosition) return;

    const nextUserVersion = userVersions[nextPosition];
    const nextVersionValue = nextUserVersion.versionIndex ?? 0;

    const nextAssistantVersion =
      versions.find(
        (item) => item.role === "assistant" && (item.versionIndex ?? 0) === nextVersionValue
      ) ?? null;

    workspace.updateThreadById(thread.id, (currentThread) => {
      const visibleMessages = getVisibleMessages(currentThread);
      const currentUserIndex = visibleMessages.findIndex((item) => item.id === messageId);
      if (currentUserIndex < 0) return currentThread;

      const existingAssistant =
        currentUserIndex + 1 < visibleMessages.length && visibleMessages[currentUserIndex + 1]?.role === "assistant"
          ? visibleMessages[currentUserIndex + 1]
          : null;

      const before = visibleMessages.slice(0, currentUserIndex);
      const after = existingAssistant
        ? visibleMessages.slice(currentUserIndex + 2)
        : visibleMessages.slice(currentUserIndex + 1);

      const replacementMessages: Message[] = [
        {
          ...nextUserVersion,
          isHidden: false
        }
      ];

      if (nextAssistantVersion) {
        replacementMessages.push({
          ...nextAssistantVersion,
          isHidden: false
        });
      }

      return {
        ...currentThread,
        messages: [...before, ...replacementMessages, ...after],
        activeVersionIndex: {
          ...(currentThread.activeVersionIndex ?? {}),
          [groupId]: nextVersionValue
        }
      };
    });
  }

  return (
    <>
      <AppShell
        sidebar={
          <Sidebar
            generalThreads={workspace.generalThreads}
            projectThreads={workspace.projectThreads}
            projects={workspace.projectGroups}
            activeProjectId={workspace.activeProjectId}
            activeThreadId={workspace.activeThreadId}
            sidebarView={sidebarView}
            onOpenGeneralHome={handleOpenGeneralHome}
            onOpenSearch={handleOpenSearch}
            onOpenImages={handleOpenImages}
            onSelectProject={handleSelectProject}
            onSelectThread={handleOpenThread}
            onNewChat={handleOpenGeneralHome}
            onCreateProject={handleCreateNamedProject}
            onCreateThreadInProject={handleCreateThreadInProject}
            onRenameProject={workspace.renameProject}
            onDeleteProject={workspace.deleteProject}
            onRenameThread={workspace.renameThread}
            onDeleteThread={workspace.deleteThread}
            onMoveThread={workspace.moveThread}
            onToggleProjectMemory={handleToggleProjectMemory}
            onToggleThreadPinned={workspace.toggleThreadPinned}
          />
        }
        artifact={artifactContent ? (
          <div className="artifact-panel">
            <div className="artifact-panel__header">
              <span className="artifact-panel__title">{artifactContent.title}</span>
              <div className="artifact-panel__actions">
                <button
                  type="button"
                  title="복사"
                  onClick={() => navigator.clipboard.writeText(artifactContent.code).catch(() => {})}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 7, background: "transparent", cursor: "pointer", color: "var(--text-sub)", fontSize: 11 }}
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="10" height="10" rx="2" /><path d="M5 15V7a2 2 0 0 1 2-2h8" /></svg>
                </button>
                <button
                  type="button"
                  title="닫기"
                  onClick={() => setArtifactContent(null)}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 7, background: "transparent", cursor: "pointer", color: "var(--text-sub)" }}
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            <div className="artifact-panel__body">
              <pre className="artifact-panel__code">{artifactContent.code}</pre>
            </div>
          </div>
        ) : undefined}
        topbar={
          <Topbar
            mode={mode}
            workspaceKind={workspaceKind}
            projectTitle={
              sidebarView === "search"
                ? "채팅 검색"
                : sidebarView === "images"
                  ? "이미지"
                  : workspace.activeProject?.title ?? "AI Orchestra"
            }
            threadTitle={workspace.activeThread?.title ?? undefined}
            projectMemoryEnabled={Boolean(workspace.activeProject?.meta?.memoryEnabled)}
            onBackToHome={backToHome}
          />
        }
        main={
          mode === "home" ? (
            <HomeView
              workspaceKind={workspaceKind}
              activeProject={workspace.activeProject}
              generalThreads={workspace.generalThreads}
              projectThreads={workspace.projectThreads}
              sidebarView={sidebarView}
              isSending={isSending}
              onOpenThread={handleOpenThread}
              onSubmitPrompt={(value) => void handleHomeSubmit(value)}
              onRenameThread={handleRenameThreadFromHome}
              onMoveThread={handleMoveThreadFromHome}
              onRemoveFromProject={workspace.removeThreadFromProject}
              onDeleteThread={workspace.deleteThread}
              projectGroups={workspace.projectGroups}
            />
          ) : (
            <ChatView
              activeProject={workspace.activeProject}
              activeThread={workspace.activeThread}
              draft={draft}
              isSending={isSending}
              lastError={lastError}
              onDraftChange={setDraft}
              onSend={() => void handleSend()}
              onStopGenerating={handleStopGenerating}
              onBackToProject={backToHome}
              textareaRef={textareaRef}
              scrollRef={scrollRef}
              debugMeta={debugMeta}
              editingMessageId={editingMessageId}
              editingDraft={editingDraft}
              onEditingDraftChange={setEditingDraft}
              onStartEditMessage={handleStartEditMessage}
              onCancelEditMessage={handleCancelEditMessage}
              onSubmitEditMessage={(messageId) => void handleSubmitEditMessage(messageId)}
              onCopyUserMessage={handleCopyUserMessage}
              onCopyAssistantMessage={handleCopyAssistantMessage}
              onDeleteMessage={(messageId) => {
                if (workspace.activeThread) {
                  workspace.deleteMessage(workspace.activeThread.id, messageId);
                }
              }}
              onRelatedQuestion={(q) => {
                setDraft(q);
                setTimeout(() => textareaRef.current?.focus(), 50);
              }}
              onOpenArtifact={(title, code, language) => {
                setArtifactContent({ title, code, language });
              }}
              messageVersionMap={messageVersionMap}
              onSelectMessageVersion={handleSelectMessageVersion}
              showScrollToBottom={showScrollToBottom}
              onScrollToBottom={handleScrollToBottom}
            />
          )
        }
      />

      <ProjectCreateModal
        open={isProjectModalOpen}
        value={projectTitleDraft}
        onChange={setProjectTitleDraft}
        onClose={closeProjectModal}
        onSubmit={handleSubmitProjectModal}
      />
    </>
  );
}
