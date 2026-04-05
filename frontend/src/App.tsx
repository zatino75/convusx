import { useEffect, useMemo, useRef, useState } from "react";
import { extractDebugMeta } from "./api/chat";
import { useStreamLock } from "./hooks/useStreamLock";
import { apiUrl } from "./api/url";
import ChatView from "./components/chat/ChatView";
import HomeView from "./components/chat/HomeView";
import AppShell from "./components/layout/AppShell";
import OrchestrationPanel from "./components/ops/OrchestrationPanel";
import Sidebar from "./components/layout/Sidebar";
import SettingsModal from "./components/settings/SettingsModal";
import Topbar from "./components/layout/Topbar";
import { createMessage, getVisibleMessages, isAbortError, makeThreadTitle, normalizeThreadTitle, updateMessageStatus } from "./appMessageUtils";
import { BenchmarkView, DashboardView, ImageGalleryView, SearchView } from "./components/chat/AppViews";
import ProjectCreateModal from "./components/chat/ProjectCreateModal";
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
    messages?: Array<{ role: string; content: string }>;
    attached_file?: { name: string; type: string; base64: string; size: number };
    [key: string]: any;
  },
  handlers: {
    onEvent?: (event: StreamEvent) => void;
    onDone?: (payload: any) => void;
  },
  options?: {
    signal?: AbortSignal;
  }
) {
  const response = await fetch(apiUrl("/api/chat/stream"), {
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

  const handleRawEvent = (rawEvent: string) => {
    const dataLines = rawEvent
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());

    if (dataLines.length === 0) return;

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
  };

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

function findBaseUserMessageIndex(messages: any[], fromId: string): number {
  return messages.findIndex((m: any) => m.id === fromId)
}

function findNextUserMessageIndex(messages: any[], fromIndex: number): number {
  for (let i = fromIndex + 1; i < messages.length; i++) {
    if ((messages[i] as any).role === "user") return i
  }
  return messages.length
}

function isGenericThreadTitle(title: string | null | undefined): boolean {
  if (!title) return true
  const lower = title.trim().toLowerCase()
  return lower === "새 채팅" || lower === "new chat" || lower === "untitled" || lower.length < 3
}


export default function App() {
  const workspace = useWorkspaceState();
  const globalInstruction = workspace.globalInstruction ?? "";

  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [credits, setCredits] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("corvus-x.credits") ?? "{}"); } catch { return {}; }
  });
  const [editingCredit, setEditingCredit] = useState<string | null>(null);
  function saveCredit(provider: string, value: string) {
    const next = { ...credits, [provider]: value };
    setCredits(next);
    localStorage.setItem("corvus-x.credits", JSON.stringify(next));
    setEditingCredit(null);
  }
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; type: string; base64: string; size: number }[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [debugMeta, setDebugMeta] = useState<DebugMeta>(createDefaultDebugMeta());
  const [sidebarView, setSidebarView] = useState<"default" | "search" | "images" | "benchmark" | "dashboard">("default");
  const [showSettings, setShowSettings] = useState(false);
  const [msgFontSize, setMsgFontSize] = useState(() => {
    const saved = localStorage.getItem("corvus-x.msg-font-size");
    return saved ? Number(saved) : 16;
  });

  useEffect(() => {
    document.documentElement.style.setProperty("--msg-font-size", `${msgFontSize}px`);
    localStorage.setItem("corvus-x.msg-font-size", String(msgFontSize));
  }, [msgFontSize]);
  const [artifactList, setArtifactList] = useState<Array<{ id: string; title: string; code: string; language: string }>>([]);
  const [activeArtifact, setActiveArtifact] = useState<{ id: string; title: string; code: string; language: string } | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [panelPage, setPanelPage] = useState(0);
  const [composerOptions, setComposerOptions] = useState<{ force_pro?: boolean; deep_research?: boolean; task?: string } | null>(null);
  const [dialog, setDialog] = useState<{
    type: "rename-project" | "delete-project" | "rename-thread" | "delete-thread";
    id: string;
    currentTitle?: string;
  } | null>(null);
  const [dialogInput, setDialogInput] = useState("");
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
  const streamLock = useStreamLock();

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

  // document.title 동기화 — 스레드 열면 탭 제목 변경, 홈이면 CORVUS X
  useEffect(() => {
    const thread = workspace.activeThread;
    const title = thread?.title?.trim();
    document.title = title ? `${title} — CORVUS X` : "CORVUS X";
  }, [workspace.activeThread?.title, workspace.activeThreadId]);

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

  function handleOpenBenchmark() {
    workspace.setActiveThreadId(null);
    setSidebarView("benchmark");
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
      messages: updateMessageStatus(thread.messages, activeStream.placeholderId, (message: any) => ({
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
    if (!trimmed && attachedFiles.length === 0) return;

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

    const displayText = trimmed || (attachedFiles.length > 0 ? `📎 ${attachedFiles.map(f => f.name).join(", ")}` : "")
    const userMessage = createMessage("user", displayText, "done", {
      versionGroupId,
      versionIndex,
      isHidden: false,
      attachedFiles: attachedFiles.length > 0
        ? attachedFiles.map(f => ({ name: f.name, type: f.type, size: f.size }))
        : undefined
    });

    const assistantPlaceholder = createMessage("assistant", "", "pending", {
      versionGroupId,
      versionIndex,
      isHidden: false
    });

    const nextTitle = makeThreadTitle(trimmed || (attachedFiles.length > 0 ? attachedFiles[0].name : "파일 분석"));
    const liveEvents: StreamEvent[] = [];
    let liveMeta = createDefaultDebugMeta();
    let finalTextFromEvent = "";
    let chunkAccumulator = "";
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
    setAttachedFiles([]);
    setComposerOptions(null);
    setIsSending(true);
    setLastError(null);
    setDebugMeta(createDefaultDebugMeta());
    resetEditingState();

    try {
      // 현재 요청 직전의 스레드 메시지 수집 (현재 user/placeholder 제외)
      const threadMessages = preservedMessages
        .filter(m => !m.isHidden && m.content?.trim() && !m.content.includes("[응답 오류]") && m.status !== "pending")
        .map(m => {
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
        .filter(m => m.content.trim().length > 0);

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
            .map(m => "[" + (m.role === "user" ? "USER" : "AI") + "] " + String(m.content).slice(0, 400))
            .join("\n");
          const claudeKey = String((window as any).__ANTHROPIC_KEY__ ?? "");
          const openaiKey = String((window as any).__OPENAI_KEY__ ?? "");
          let summary = "";
          if (openaiKey) {
            const resp = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: { Authorization: "Bearer " + openaiKey, "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                  { role: "system", content: "다음 대화 내용을 핵심만 500자 이내로 압축 요약하세요. 중요한 결정사항, 코드, 숫자는 반드시 포함하세요." },
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
              { role: "user" as const, content: "[📋 이전 대화 요약 — " + toCompress.length + "개 메시지 압축]\n\n" + summary },
              { role: "assistant" as const, content: "이전 대화 내용을 참고하겠습니다." }
            ];
            threadMessages.splice(0, threadMessages.length, ...compressed, ...recent);
          }
        } catch { /* 압축 실패 시 원본 유지 */ }
      }

      await sendChatStream(
        {
          message: trimmed || (attachedFiles.length > 0 ? `첨부 파일 ${attachedFiles.map(f => f.name).join(", ")}을 분석해줘` : ""),
          thread_id: target.threadId,
          project_id: target.projectId,
          mode: "runtime_orchestra",
          messages: threadMessages,
          global_instruction: globalInstruction?.trim() || null,
          project_instruction: workspace.activeProject?.meta?.instruction?.trim() || null,
          ...(composerOptions ?? {}),
          ...(attachedFiles.length > 0 ? {
            attached_files: attachedFiles.map(f => ({
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

            if (event.type === "provider_chunk") {
              // liveEvents에는 모든 provider chunk 포함 (비교탭 표시용)
              // 화면 표시는 primary provider + final 이전만
              if (!finalTextFromEvent) {
                const cp = String(event.provider ?? "").toLowerCase();
                const primary = String(liveMeta.selectedProviders?.[0] ?? "").toLowerCase();
                const isPrimary = !cp || !primary || cp === primary;
                if (isPrimary) {
                  chunkAccumulator += String(event.content ?? "");
                  workspace.updateThreadById(target.threadId, (thread) => ({
                    ...thread,
                    messages: updateMessageStatus(thread.messages, assistantPlaceholder.id, (msg: any) => ({
                      ...msg, content: chunkAccumulator, status: "pending" as const
                    }))
                  }));
                }
              }
            }

            if (event.type === "chunk" || event.type === "answer_chunk") { chunkAccumulator += String(event.content ?? "");
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
                messages: updateMessageStatus(thread.messages, assistantPlaceholder.id, (message: any) => ({
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
            // 슬라이드 데이터 감지 — 다운로드 버튼 메시지로 처리
            if (payload?.is_slide && payload?.slide_data) {
              const slideData = payload.slide_data
              const slideText = String(payload?.answer?.text ?? "").trim()
              workspace.updateThreadById(target.threadId, (thread) => ({
                ...thread,
                updatedAt: nowIso(),
                messages: updateMessageStatus(thread.messages, assistantPlaceholder.id, (msg: any) => ({
                  ...msg,
                  content: slideText,
                  status: "done",
                  requestMeta: { ...(msg.requestMeta ?? {}), slide_data: slideData }
                }))
              }))
              workspace.touchProject(target.projectId)
              setIsSending(false)
              setAttachedFiles([])
              focusComposer()
              activeStreamRef.current = null
              return
            }

            // 이미지 생성 결과 저장 (DALL-E / Imagen / Midjourney)
            if (payload?.is_image && payload?.image_url) {
              const imageUrl = payload.image_url
              const imageText = String(payload?.answer?.text ?? "🎨 이미지가 생성됐습니다.").trim()
              workspace.updateThreadById(target.threadId, (thread) => ({
                ...thread,
                updatedAt: nowIso(),
                messages: updateMessageStatus(thread.messages, assistantPlaceholder.id, (msg: any) => ({
                  ...msg,
                  content: imageText,
                  status: "done",
                  requestMeta: {
                    ...(msg.requestMeta ?? {}),
                    image_url: imageUrl,
                    image_urls: payload?.image_urls ?? null,
                    image_revised_prompt: payload?.image_revised_prompt ?? null
                  }
                }))
              }))
              workspace.touchProject(target.projectId)
              setIsSending(false)
              setAttachedFiles([])
              focusComposer()
              activeStreamRef.current = null
              return
            }

            // 비디오 생성 결과 저장 (Runway / Veo)
            if (payload?.is_video && payload?.video_url) {
              const videoUrl = payload.video_url
              const videoText = String(payload?.answer?.text ?? "🎬 비디오가 생성됐습니다.").trim()
              workspace.updateThreadById(target.threadId, (thread) => ({
                ...thread,
                updatedAt: nowIso(),
                messages: updateMessageStatus(thread.messages, assistantPlaceholder.id, (msg: any) => ({
                  ...msg,
                  content: videoText,
                  status: "done",
                  requestMeta: {
                    ...(msg.requestMeta ?? {}),
                    video_url: videoUrl,
                    is_video: true
                  }
                }))
              }))
              workspace.touchProject(target.projectId)
              setIsSending(false)
              setAttachedFiles([])
              focusComposer()
              activeStreamRef.current = null
              return
            }

            // done 시점에 이미 화면에 표시된 내용을 우선 사용
            const currentDisplayContent = (() => {
              const thread = workspace.threads.find(t => t.id === target.threadId)
              return thread?.messages.find(m => m.id === assistantPlaceholder.id)?.content ?? ""
            })()

            const assistantText =
              finalTextFromEvent ||
              String(payload?.answer?.text ?? "").trim() ||
              chunkAccumulator ||
              currentDisplayContent ||
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

            const doneTask = String(payload?.internal?.task ?? (meta as any)?.task ?? "").toLowerCase();
            if (doneTask === "code" || doneTask === "code_implement" || doneTask === "code_debug" || doneTask === "code_refactor") {
              setShowPanel(true);
              setPanelPage(2);
            }

            workspace.updateThreadById(target.threadId, (thread) => {
              const nextMessages: Message[] = updateMessageStatus(thread.messages, assistantPlaceholder.id, (message: any) => ({
                ...message,
                content:
                  assistantText ||
                  message.content ||
                  "[응답 오류] 잠시 후 다시 시도해주세요.",
                status: "done",
                requestMeta: meta
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

              // 서버에서 생성한 thread_title 적용 (isGenericThreadTitle인 경우에만)
              if (payload?.thread_title && isGenericThreadTitle(nextThread.title)) {
                const autoTitle = String(payload.thread_title).trim().slice(0, 32);
                if (autoTitle) nextThread = { ...nextThread, title: autoTitle };
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
          messages: updateMessageStatus(thread.messages, assistantPlaceholder.id, (item: any) => ({
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
          messages: updateMessageStatus(thread.messages, assistantPlaceholder.id, (item: any) => ({
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
      setAttachedFiles([]);
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
    if ((!trimmed && attachedFiles.length === 0) || isSending) return;

    setSidebarView("default");

    if (workspace.activeProjectId === GENERAL_PROJECT_ID) {
      const threadId = workspace.createGeneralChat();
      await sendMessageToThread(trimmed, {
        threadId,
        projectId: GENERAL_PROJECT_ID,
        currentTitle: ""
      });
      setAttachedFiles([]);
      return;
    }

    const projectId = workspace.activeProjectId;
    const threadId = workspace.createThreadInProject(projectId);

    await sendMessageToThread(trimmed, {
      threadId,
      projectId,
      currentTitle: ""
    });
    setAttachedFiles([]);
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
      const currentUserIndex = visibleMessages.findIndex((item: any) => item.id === messageId);
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

  async function handleDownloadSlide(slideData: any) {
    try {
      const res = await fetch(apiUrl("/api/slides/generate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slide_data: slideData })
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => "")
        console.error("[SLIDE DOWNLOAD] Server error:", res.status, errText)
        throw new Error(`서버 오류 ${res.status}: ${errText.slice(0, 100)}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${String(slideData?.title ?? "slides").replace(/[^a-zA-Z0-9가-힣\s]/g, "")}.pptx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert("슬라이드 다운로드 실패: " + (e?.message ?? "오류"))
    }
  }

  function handleOpenArtifact(title: string, code: string, language: string) {
    const existing = artifactList.find(a => a.title === title);
    if (existing) {
      setActiveArtifact(existing);
    } else {
      const item = { id: `artifact_${Date.now()}`, title, code, language };
      setActiveArtifact(item);
    }
  }

  return (
    <>
      {/* ─── Inline Dialog ─────────────────────────────────────── */}
      {dialog && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)" }}
          onClick={() => setDialog(null)}>
          <div style={{ background: "var(--bg-surface, #fff)", borderRadius: 16, padding: 24, width: 400, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}
            onClick={e => e.stopPropagation()}>

            {(dialog.type === "rename-project" || dialog.type === "rename-thread") && (
              <>
                <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-main)", marginBottom: 16 }}>
                  {dialog.type === "rename-project" ? "프로젝트 이름 변경" : "스레드 이름 변경"}
                </div>
                <input
                  autoFocus
                  value={dialogInput}
                  onChange={e => setDialogInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      if (dialog.type === "rename-project") workspace.renameProject(dialog.id, dialogInput);
                      else workspace.renameThread(dialog.id, dialogInput);
                      setDialog(null);
                    }
                    if (e.key === "Escape") setDialog(null);
                  }}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 14, color: "var(--text-main)", background: "var(--surface-1, #f9f9f9)", outline: "none", boxSizing: "border-box" as const }}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
                  <button type="button" onClick={() => setDialog(null)}
                    style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", fontSize: 13, cursor: "pointer", color: "var(--text-main)" }}>
                    취소
                  </button>
                  <button type="button"
                    onClick={() => {
                      if (!dialogInput.trim()) return;
                      if (dialog.type === "rename-project") workspace.renameProject(dialog.id, dialogInput);
                      else workspace.renameThread(dialog.id, dialogInput);
                      setDialog(null);
                    }}
                    style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--text-main)", color: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
                    변경
                  </button>
                </div>
              </>
            )}

            {(dialog.type === "delete-project" || dialog.type === "delete-thread") && (
              <>
                <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-main)", marginBottom: 8 }}>
                  {dialog.type === "delete-project" ? "프로젝트 삭제" : "스레드 삭제"}
                </div>
                <div style={{ fontSize: 14, color: "var(--text-sub)", marginBottom: 20, lineHeight: 1.6 }}>
                  <strong style={{ color: "var(--text-main)" }}>"{dialog.currentTitle}"</strong>을(를) 삭제합니다.
                  {dialog.type === "delete-project" && <span> 프로젝트 내 모든 스레드도 함께 삭제됩니다.</span>}
                  <br />이 작업은 되돌릴 수 없습니다.
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button type="button" onClick={() => setDialog(null)}
                    style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", fontSize: 13, cursor: "pointer", color: "var(--text-main)" }}>
                    취소
                  </button>
                  <button type="button"
                    onClick={() => {
                      if (dialog.type === "delete-project") workspace.deleteProject(dialog.id);
                      else workspace.deleteThread(dialog.id);
                      setDialog(null);
                    }}
                    style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#ef4444", color: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
                    삭제
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <AppShell
        showPanel={showPanel}
        onTogglePanel={() => { setShowPanel(v => { if (v) setPanelPage(0); return !v; }); }}
        sidebar={
          <Sidebar
            generalThreads={workspace.generalThreads}
            projectThreads={workspace.projectThreads}
            projects={workspace.projectGroups}
            activeProjectId={workspace.activeProjectId}
            activeThreadId={workspace.activeThreadId}
            sidebarView={sidebarView}
            artifacts={artifactList}
            onOpenArtifact={handleOpenArtifact}
            onOpenGeneralHome={handleOpenGeneralHome}
            onOpenSearch={handleOpenSearch}
            onOpenImages={handleOpenImages}
            onOpenSettings={() => setShowSettings(true)}
            onOpenDashboard={() => { setSidebarView("dashboard"); }}
            onOpenBenchmark={handleOpenBenchmark}
            onSelectProject={handleSelectProject}
            onSelectThread={handleOpenThread}
            onNewChat={handleOpenGeneralHome}
            onCreateProject={handleCreateNamedProject}
            onCreateThreadInProject={handleCreateThreadInProject}
            onRenameProject={(id) => {
                const project = workspace.projectGroups.find(p => p.id === id);
                setDialog({ type: "rename-project", id, currentTitle: project?.title ?? "" });
                setDialogInput(project?.title ?? "");
              }}
            onDeleteProject={(id) => {
                const project = workspace.projectGroups.find(p => p.id === id);
                setDialog({ type: "delete-project", id, currentTitle: project?.title ?? "" });
              }}
            onRenameThread={(id) => {
                const thread = workspace.threads.find(t => t.id === id);
                setDialog({ type: "rename-thread", id, currentTitle: thread?.title ?? "" });
                setDialogInput(thread?.title ?? "");
              }}
            onDeleteThread={(id) => {
                const thread = workspace.threads.find(t => t.id === id);
                setDialog({ type: "delete-thread", id, currentTitle: thread?.title ?? "" });
              }}
            onMoveThread={workspace.moveThread}
            onToggleProjectMemory={handleToggleProjectMemory}
            onToggleThreadPinned={workspace.toggleThreadPinned}
          />
        }
        artifact={activeArtifact ? (
          <div className="artifact-panel">
            <div className="artifact-panel__header">
              <span className="artifact-panel__title">{activeArtifact.title}</span>
              <div className="artifact-panel__actions">
                <button
                  type="button"
                  title="복사"
                  onClick={() => navigator.clipboard.writeText(activeArtifact.code).catch(() => {})}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 7, background: "transparent", cursor: "pointer", color: "var(--text-sub)", fontSize: 11 }}
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="10" height="10" rx="2" /><path d="M5 15V7a2 2 0 0 1 2-2h8" /></svg>
                </button>
                <button
                  type="button"
                  title="닫기"
                  onClick={() => setActiveArtifact(null)}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 7, background: "transparent", cursor: "pointer", color: "var(--text-sub)" }}
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            <div className="artifact-panel__body">
              <pre className="artifact-panel__code">{activeArtifact.code}</pre>
            </div>
          </div>
        ) : (mode === "thread-chat" ? (
          <OrchestrationPanel
            debugMeta={debugMeta}
            artifactList={artifactList}
          />
        ) : undefined)}
        topbar={
          <Topbar
            mode={mode}
            workspaceKind={workspaceKind}
            projectTitle={
              sidebarView === "search"
                ? "채팅 검색"
                : sidebarView === "images"
                  ? "이미지"
                  : sidebarView === "benchmark"
                    ? "벤치마크"
                    : workspace.activeProject?.title ?? "CORVUS X"
            }
            threadTitle={workspace.activeThread?.title ?? undefined}
            projectMemoryEnabled={Boolean(workspace.activeProject?.meta?.memoryEnabled)}
            onBackToHome={backToHome}
            panelToggle={
              <button
                type="button"
                onClick={() => { setShowPanel(v => { if (v) setPanelPage(0); return !v; }); }}
                title={showPanel ? "패널 닫기" : "패널 열기"}
                style={{
                  width: 36, height: 36, border: "none", borderRadius: 8,
                  background: "transparent", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "var(--text-sub)", padding: 0
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,0,0,0.06)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M15 3v18" />
                </svg>
              </button>
            }
          />
        }
        main={
          sidebarView === "search" ? (
            <SearchView
              threads={workspace.threads}
              onOpenThread={handleOpenThread}
            />
          ) : sidebarView === "images" ? (
            <ImageGalleryView threads={workspace.threads} />
          ) : sidebarView === "dashboard" ? (
            <DashboardView />
          ) : sidebarView === "benchmark" ? (
            <BenchmarkView />
          ) : mode === "home" ? (
            <HomeView
              workspaceKind={workspaceKind}
              activeProject={workspace.activeProject}
              generalThreads={workspace.generalThreads}
              projectThreads={workspace.projectThreads}
              sidebarView={sidebarView}
              isSending={isSending}
              onOpenThread={handleOpenThread}
              attachedFiles={attachedFiles}
              onAttachFiles={setAttachedFiles}
              onSubmitPrompt={(value) => void handleHomeSubmit(value)}
              onRenameThread={(id, _nextTitle) => {
                const thread = workspace.threads.find(t => t.id === id);
                setDialog({ type: "rename-thread", id, currentTitle: thread?.title ?? "" });
                setDialogInput(thread?.title ?? "");
              }}
              onMoveThread={handleMoveThreadFromHome}
              onRemoveFromProject={workspace.removeThreadFromProject}
              onDeleteThread={(id) => {
                const thread = workspace.threads.find(t => t.id === id);
                setDialog({ type: "delete-thread", id, currentTitle: thread?.title ?? "" });
              }}
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
                const newId = `artifact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                setArtifactList(prev => {
                  const existingIndex = prev.findIndex(a => a.title === title);
                  if (existingIndex >= 0) {
                    const next = [...prev];
                    next[existingIndex] = { ...next[existingIndex], code, language };
                    setActiveArtifact(next[existingIndex]);
                    return next;
                  }
                  const item = { id: newId, title, code, language };
                  setActiveArtifact(item);
                  return [...prev, item];
                });
              }}
              onDownloadSlide={handleDownloadSlide}
              attachedFiles={attachedFiles}
              onAttachFiles={setAttachedFiles}
              composerMode={composerOptions ? (composerOptions.force_pro ? "deep-think" : composerOptions.task === "research" ? "web-search" : null) : null}
              onClearComposerMode={() => setComposerOptions(null)}
              onComposerAction={(action) => {
                if (action === "deep-think") {
                  setComposerOptions({ force_pro: true, deep_research: true });
                } else if (action === "web-search") {
                  setComposerOptions({ task: "research" });
                } else {
                  setComposerOptions(null);
                }
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

      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        fontSize={msgFontSize}
        onFontSizeChange={setMsgFontSize}
        globalInstruction={globalInstruction}
        onGlobalInstructionChange={(v: string) => workspace.setGlobalInstruction(v)}
      />
    </>
  );
}
