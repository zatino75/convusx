import { Suspense, useEffect, useRef, useState } from "react";
import { t } from "./i18n";
import { useStreamLock } from "./hooks/useStreamLock";
import { useConnectionStatus } from "./hooks/useConnectionStatus";
import { apiFetch } from "./api/url";
import { useSendChat } from "./hooks/useSendChat";
import { useMessageVersions } from "./hooks/useMessageVersions";
import { useScrollBehavior } from "./hooks/useScrollBehavior";
import ChatView from "./components/chat/ChatView";
import HomeView from "./components/chat/HomeView";
import AppShell from "./components/layout/AppShell";
import OrchestrationPanel from "./components/ops/OrchestrationPanel";
import Sidebar from "./components/layout/Sidebar";
import SettingsModal from "./components/settings/SettingsModal";
import Topbar from "./components/layout/Topbar";
import InlineDialog, { type DialogState } from "./components/chat/InlineDialog";
import ArtifactPanel, { type Artifact } from "./components/chat/ArtifactPanel";
import { BenchmarkView, DashboardView, ImageGalleryView, SearchView } from "./components/chat/AppViews";
import ProjectCreateModal from "./components/chat/ProjectCreateModal";
import ViewErrorBoundary from "./components/ViewErrorBoundary";
import {
  GENERAL_PROJECT_ID,
  useWorkspaceState
} from "./store/workspaceStore";
import { nowIso } from "./utils/helpers";
import { ToastProvider, showToast } from "./components/ui/Toast";
import type {
  MainViewMode,
  Message,
  Project,
  ProjectGroup,
  Thread,
  WorkspaceKind
} from "./types/workspace";

// ── C6: Suspense fallback ──
function ViewLoadingFallback() {
  return (
    <div role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40, color: "var(--text-soft)" }}>
      <span>{t("ui.loading")}</span>
    </div>
  );
}

export default function App() {
  const workspace = useWorkspaceState();
  const globalInstruction = workspace.globalInstruction ?? "";
  const streamLock = useStreamLock();
  void streamLock; // 스트림 락 초기화 — 내부 effect 목적
  const connectionStatus = useConnectionStatus();

  // ── UI 상태 ──────────────────────────────────────────────────────────────
  const [draft, setDraft] = useState("");
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

  const [artifactList, setArtifactList] = useState<Artifact[]>([]);
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [panelPage, setPanelPage] = useState(0);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dialogInput, setDialogInput] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [projectTitleDraft, setProjectTitleDraft] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // document.title 동기화
  useEffect(() => {
    const title = workspace.activeThread?.title?.trim();
    document.title = title ? `${title} — CORVUS X` : "CORVUS X";
  }, [workspace.activeThread?.title, workspace.activeThreadId]);

  // ── 전역 키보드 단축키 ──────────────────────────────────────────────────
  useEffect(() => {
    function handleGlobalKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      // Ctrl/Cmd + N → 새 채팅
      if (e.key === "n") {
        e.preventDefault();
        workspace.createGeneralChat();
        setSidebarView("default");
        queueMicrotask(() => textareaRef.current?.focus());
        return;
      }
      // Ctrl/Cmd + K → 검색 토글
      if (e.key === "k") {
        e.preventDefault();
        setSidebarView(prev => prev === "search" ? "default" : "search");
        return;
      }
      // Ctrl/Cmd + , → 설정 열기
      if (e.key === ",") {
        e.preventDefault();
        setShowSettings(prev => !prev);
        return;
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // 설정 모달 닫기
      if (showSettings) { setShowSettings(false); return; }
      // 프로젝트 모달 닫기
      if (isProjectModalOpen) { setIsProjectModalOpen(false); return; }
    }

    window.addEventListener("keydown", handleGlobalKey);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleGlobalKey);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [showSettings, isProjectModalOpen, workspace]);

  // ── 스크롤 동작 훅 ──────────────────────────────────────────────────────
  const {
    scrollRef,
    showScrollToBottom,
    setShowScrollToBottom,
    markScrollToBottom,
    handleScrollToBottom,
  } = useScrollBehavior({
    activeThreadId: workspace.activeThreadId,
    sidebarView,
    threads: workspace.threads,
  });

  const workspaceKind: WorkspaceKind =
    workspace.activeProjectId === GENERAL_PROJECT_ID ? "general" : "project";
  const mode: MainViewMode = workspace.activeThreadId ? "thread-chat" : "home";

  function focusComposer() {
    queueMicrotask(() => textareaRef.current?.focus());
  }

  function resetEditingState() {
    setEditingMessageId(null);
    setEditingDraft("");
  }

  // ── 전송/스트림 훅 ──────────────────────────────────────────────────────
  const {
    isSending,
    attachedFiles,
    setAttachedFiles,
    lastError,
    debugMeta,
    composerOptions,
    setComposerOptions,
    handleSend,
    handleHomeSubmit,
    handleSubmitEditMessage,
    handleStopGenerating,
  } = useSendChat({
    workspace,
    globalInstruction,
    draft,
    editingDraft,
    resetEditingState,
    markScrollToBottom,
    focusComposer,
    setPanelPage,
    setShowScrollToBottom,
    onDraftClear: () => setDraft(""),
  });

  // ── 메시지 버전 훅 ──────────────────────────────────────────────────────
  const { messageVersionMap, handleSelectMessageVersion } = useMessageVersions(workspace);

  // ── 네비게이션 핸들러 ────────────────────────────────────────────────────
  function resetNav() {
    setDraft(""); setSidebarView("default"); resetEditingState(); markScrollToBottom("auto");
  }

  function handleOpenGeneralHome() { workspace.openGeneralHome(); resetNav(); }
  function handleSelectProject(projectId: string) { workspace.selectProject(projectId); resetNav(); }
  function handleOpenThread(threadId: string) { workspace.openThread(threadId); resetNav(); focusComposer(); }
  function handleOpenSearch() { workspace.setActiveThreadId(null); setSidebarView("search"); resetEditingState(); markScrollToBottom("auto"); }
  function handleOpenImages() { workspace.setActiveThreadId(null); setSidebarView("images"); resetEditingState(); markScrollToBottom("auto"); }
  function handleOpenBenchmark() { workspace.setActiveThreadId(null); setSidebarView("benchmark"); resetEditingState(); markScrollToBottom("auto"); }
  function handleCreateThreadInProject(projectId: string) { workspace.createThreadInProject(projectId); resetNav(); focusComposer(); }
  function backToHome() { workspace.setActiveThreadId(null); setSidebarView("default"); resetEditingState(); markScrollToBottom("auto"); }

  function handleToggleProjectMemory(projectId: string) {
    const project = workspace.projects.find((item: Project) => item.id === projectId);
    if (!project) return;
    workspace.updateProjectMeta(projectId, { memoryEnabled: !project.meta?.memoryEnabled });
  }

  function handleOpenArtifact(title: string, code: string, language: string) {
    const existing = artifactList.find(a => a.title === title);
    if (existing) { setActiveArtifact(existing); return; }
    setActiveArtifact({ id: `artifact_${Date.now()}`, title, code, language });
  }

  async function handleDownloadSlide(slideData: Record<string, unknown>) {
    try {
      const res = await apiFetch("/api/slides/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slide_data: slideData })
      });
      if (!res.ok) throw new Error(`서버 오류 ${res.status}: ${(await res.text().catch(() => "")).slice(0, 100)}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${String(slideData?.title ?? "slides").replace(/[^a-zA-Z0-9가-힣\s]/g, "")}.pptx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : t("common.error");
      showToast(t("errors.slideDownloadFailed") + errMsg, "error");
    }
  }

  // ── 다이얼로그 열기 헬퍼 ─────────────────────────────────────────────────
  function openRenameProject(id: string) {
    const project = workspace.projectGroups.find((p: ProjectGroup) => p.id === id);
    setDialog({ type: "rename-project", id, currentTitle: project?.title ?? "" });
    setDialogInput(project?.title ?? "");
  }

  function openDeleteProject(id: string) {
    const project = workspace.projectGroups.find((p: ProjectGroup) => p.id === id);
    setDialog({ type: "delete-project", id, currentTitle: project?.title ?? "" });
  }

  function openRenameThread(id: string) {
    const thread = workspace.threads.find((t: Thread) => t.id === id);
    setDialog({ type: "rename-thread", id, currentTitle: thread?.title ?? "" });
    setDialogInput(thread?.title ?? "");
  }

  function openDeleteThread(id: string) {
    const thread = workspace.threads.find((t: Thread) => t.id === id);
    setDialog({ type: "delete-thread", id, currentTitle: thread?.title ?? "" });
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  return (
    <ToastProvider>
      <InlineDialog
        dialog={dialog}
        dialogInput={dialogInput}
        onDialogInputChange={setDialogInput}
        onClose={() => setDialog(null)}
        onRenameProject={workspace.renameProject}
        onRenameThread={workspace.renameThread}
        onDeleteProject={workspace.deleteProject}
        onDeleteThread={workspace.deleteThread}
      />

      <AppShell
        showPanel={showPanel}
        onTogglePanel={() => { setShowPanel(v => { if (v) setPanelPage(0); return !v; }); }}
        sidebar={({ onCloseSidebar }) => (
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
            onCreateProject={() => { setProjectTitleDraft(""); setIsProjectModalOpen(true); }}
            onCreateThreadInProject={handleCreateThreadInProject}
            onRenameProject={openRenameProject}
            onDeleteProject={openDeleteProject}
            onRenameThread={openRenameThread}
            onDeleteThread={openDeleteThread}
            onMoveThread={workspace.moveThread}
            onToggleProjectMemory={handleToggleProjectMemory}
            onToggleThreadPinned={workspace.toggleThreadPinned}
            onClose={onCloseSidebar}
          />
        )}
        artifact={activeArtifact ? (
          <ArtifactPanel artifact={activeArtifact} onClose={() => setActiveArtifact(null)} />
        ) : (mode === "thread-chat" ? (
          <OrchestrationPanel debugMeta={debugMeta} artifactList={artifactList} />
        ) : undefined)}
        topbar={
          <Topbar
            mode={mode}
            workspaceKind={workspaceKind}
            projectTitle={
              sidebarView === "search" ? t("nav.search")
              : sidebarView === "images" ? t("nav.images")
              : sidebarView === "benchmark" ? t("nav.benchmark")
              : workspace.activeProject?.title ?? "CORVUS X"
            }
            threadTitle={workspace.activeThread?.title ?? undefined}
            projectMemoryEnabled={Boolean(workspace.activeProject?.meta?.memoryEnabled)}
            onBackToHome={backToHome}
            connectionStatus={connectionStatus}
            panelToggle={
              <button
                type="button"
                onClick={() => { setShowPanel(v => { if (v) setPanelPage(0); return !v; }); }}
                title={showPanel ? t("nav.closePanel") : t("nav.openPanel")}
                style={{ width: 36, height: 36, border: "none", borderRadius: 8, background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-sub)", padding: 0 }}
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
          <Suspense fallback={<ViewLoadingFallback />}>
          {sidebarView === "search" ? (
            <ViewErrorBoundary name="Search">
              <SearchView threads={workspace.threads} onOpenThread={handleOpenThread} />
            </ViewErrorBoundary>
          ) : sidebarView === "images" ? (
            <ViewErrorBoundary name="Gallery">
              <ImageGalleryView threads={workspace.threads} />
            </ViewErrorBoundary>
          ) : sidebarView === "dashboard" ? (
            <ViewErrorBoundary name="Dashboard">
              <DashboardView />
            </ViewErrorBoundary>
          ) : sidebarView === "benchmark" ? (
            <ViewErrorBoundary name="Benchmark">
              <BenchmarkView />
            </ViewErrorBoundary>
          ) : mode === "home" ? (
            <ViewErrorBoundary name="Home">
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
                onRenameThread={(id, _nextTitle) => openRenameThread(id)}
                onMoveThread={(threadId, nextProjectId) => { if (!nextProjectId) return; workspace.moveThread(threadId, nextProjectId); }}
                onRemoveFromProject={workspace.removeThreadFromProject}
                onDeleteThread={openDeleteThread}
                projectGroups={workspace.projectGroups}
              />
            </ViewErrorBoundary>
          ) : (
            <ViewErrorBoundary name="Chat">
              <ChatView
              activeProject={workspace.activeProject}
              activeThread={workspace.activeThread}
              draft={draft}
              isSending={isSending}
              lastError={lastError}
              onDraftChange={setDraft}
              onSend={() => void handleSend()}
              onStopGenerating={() => handleStopGenerating(debugMeta)}
              onBackToProject={backToHome}
              textareaRef={textareaRef}
              scrollRef={scrollRef}
              debugMeta={debugMeta}
              editingMessageId={editingMessageId}
              editingDraft={editingDraft}
              onEditingDraftChange={setEditingDraft}
              onStartEditMessage={(message: Message) => { setEditingMessageId(message.id); setEditingDraft(message.content); }}
              onCancelEditMessage={resetEditingState}
              onSubmitEditMessage={(messageId) => void handleSubmitEditMessage(messageId)}
              onCopyUserMessage={(message: Message) => void navigator.clipboard.writeText(message.content)}
              onCopyAssistantMessage={(message: Message) => void navigator.clipboard.writeText(message.content)}
              onDeleteMessage={(messageId) => { if (workspace.activeThread) workspace.deleteMessage(workspace.activeThread.id, messageId); }}
              onRelatedQuestion={(q) => { setDraft(q); setTimeout(() => textareaRef.current?.focus(), 50); }}
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
              composerMode={composerOptions
                ? (composerOptions.force_high_value
                    ? "parallel-ensemble"
                    : composerOptions.force_pro
                      ? "deep-think"
                      : composerOptions.task === "research"
                        ? "web-search"
                        : null)
                : null}
              onClearComposerMode={() => setComposerOptions(null)}
              onComposerAction={(action) => {
                if (action === "deep-think") setComposerOptions({ force_pro: true, deep_research: true });
                else if (action === "web-search") setComposerOptions({ task: "research" });
                else if (action === "parallel-ensemble") setComposerOptions({ force_high_value: true });
                else setComposerOptions(null);
              }}
              messageVersionMap={messageVersionMap}
              onSelectMessageVersion={handleSelectMessageVersion}
              showScrollToBottom={showScrollToBottom}
              onScrollToBottom={handleScrollToBottom}
            />
            </ViewErrorBoundary>
          )}
          </Suspense>
        }
      />

      <ProjectCreateModal
        open={isProjectModalOpen}
        value={projectTitleDraft}
        onChange={setProjectTitleDraft}
        onClose={() => { setIsProjectModalOpen(false); setProjectTitleDraft(""); }}
        onSubmit={() => {
          const nextTitle = projectTitleDraft.trim();
          if (!nextTitle) return;
          workspace.createNamedProject(nextTitle);
          resetNav();
          setIsProjectModalOpen(false);
          setProjectTitleDraft("");
        }}
      />


      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        fontSize={msgFontSize}
        onFontSizeChange={setMsgFontSize}
        globalInstruction={globalInstruction}
        onGlobalInstructionChange={(v: string) => workspace.setGlobalInstruction(v)}
      />
    </ToastProvider>
  );
}
