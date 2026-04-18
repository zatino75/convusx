import { Suspense, useEffect, useState } from "react";
import { t } from "./i18n";
import { useStreamLock } from "./hooks/useStreamLock";
import { useConnectionStatus } from "./hooks/useConnectionStatus";
import { apiFetch } from "./api/url";
import { saveMessages as apiSaveMessages, saveThread as apiSaveThread, syncState as apiSyncState } from "./api/workspace";
import { useSendChat } from "./hooks/useSendChat";
import { useChatMode } from "./hooks/useChatMode";
import { useScrollBehavior } from "./hooks/useScrollBehavior";
import ChatView from "./components/chat/ChatView";
import HomeView from "./components/chat/HomeView";
import AppShell from "./components/layout/AppShell";
import OfficeHudPanel from "./components/layout/OfficeHudPanel";
import MissionStudioPanel from "./components/layout/MissionStudioPanel";
import QuickJumpBar from "./components/layout/QuickJumpBar";
import OrchestrationPanel from "./components/ops/OrchestrationPanel";
import Sidebar from "./components/layout/Sidebar";
import SettingsModal from "./components/settings/SettingsModal";
import Topbar from "./components/layout/Topbar";
import InlineDialog, { type DialogState } from "./components/chat/InlineDialog";
import ArtifactPanel, { type Artifact } from "./components/chat/ArtifactPanel";
import {
  BenchmarkView,
  DashboardView,
  ImageGalleryView,
  PosView,
  SalesView,
  SearchView,
  StoreOpsView,
  WorkforceView
} from "./components/chat/AppViews";
import ProjectCreateModal from "./components/chat/ProjectCreateModal";
import ViewErrorBoundary from "./components/ViewErrorBoundary";
import {
  createId,
  createThread,
  GENERAL_PROJECT_ID,
  useWorkspaceState
} from "./store/workspaceStore";
import { initAgentSettings } from "./store/agentStore";
import { resetMissionRuntimeState, startMissionRuntime, useMissionRuntimeState } from "./store/missionRuntimeStore";
import { setPendingWorkforceMission } from "./store/workforceMissionBridge";
import { nowIso } from "./utils/helpers";
import { ToastProvider, showToast } from "./components/ui/Toast";
import type { WorkforceArchivePayload } from "./components/chat/WorkforceView";
import type { StoreOpsAlertPayload } from "./components/chat/StoreOpsView";
import type {
  MainViewMode,
  Message,
  Project,
  ProjectGroup,
  Thread,
  WorkspaceKind
} from "./types/workspace";

// ── 폰트 사이즈 정규화 — NaN 은 기본값 16, 숫자는 [10, 32] 범위로 clamp ──
function normalizeFontSize(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 16;
  return Math.min(32, Math.max(10, Math.round(n)));
}

// ── C6: Suspense fallback ──
function ViewLoadingFallback() {
  return (
    <div role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40, color: "var(--text-soft)" }}>
      <span>{t("ui.loading")}</span>
    </div>
  );
}

function buildExecutiveReportMarkdown(payload: WorkforceArchivePayload): string {
  const opportunities = payload.opportunities.length > 0
    ? payload.opportunities.map((item) => `- ${item}`).join("\n")
    : "- 없음";
  const risks = payload.risks.length > 0
    ? payload.risks.map((item) => `- ${item}`).join("\n")
    : "- 없음";
  const recommendations = payload.recommendations.length > 0
    ? payload.recommendations.map((item) => `- ${item}`).join("\n")
    : "- 없음";
  const meetingMinutes = payload.meetingMinutes.length > 0
    ? payload.meetingMinutes.map((item) => `- ${item}`).join("\n")
    : "- 회의록 없음";

  return [
    `## 상무 최종 보고 · ${payload.topic || "Executive Mission"}`,
    "",
    "### 핵심 요약",
    payload.summary || "요약 없음",
    "",
    "### 핵심 기회",
    opportunities,
    "",
    "### 핵심 리스크",
    risks,
    "",
    "### 즉시 실행 권고",
    recommendations,
    "",
    "### 미팅룸 회의록",
    meetingMinutes
  ].join("\n");
}

function buildStoreOpsAlertMarkdown(payload: StoreOpsAlertPayload): string {
  return [
    `## StoreOps 자동조치 · ${payload.title}`,
    "",
    `- 매장: ${payload.storeName}`,
    `- 심각도: ${payload.severity.toUpperCase()}`,
    `- 담당 부서: ${payload.department}`,
    `- 조치안: ${payload.action}`,
    "",
    "### 상세",
    payload.detail
  ].join("\n");
}

export default function App() {
  const workspace = useWorkspaceState();
  const missionRuntime = useMissionRuntimeState();
  const globalInstruction = workspace.globalInstruction ?? "";
  const streamLock = useStreamLock();
  void streamLock; // 스트림 락 초기화 — 내부 effect 목적
  const connectionStatus = useConnectionStatus();

  // ── UI 상태 ──────────────────────────────────────────────────────────────
  const [draft, setDraft] = useState("");
  const [sidebarView, setSidebarView] = useState<"default" | "search" | "images" | "benchmark" | "dashboard" | "sales" | "workforce" | "storeops" | "pos">("default");
  const [showSettings, setShowSettings] = useState(false);
  const [msgFontSize, setMsgFontSize] = useState(() =>
    normalizeFontSize(localStorage.getItem("corvus-x.msg-font-size"))
  );

  // setMsgFontSize 는 반드시 normalizeFontSize 를 통해서만 호출
  const setFontSize = (v: number) => setMsgFontSize(normalizeFontSize(v));

  // agentStore 초기화 — localStorage에서 도메인 프로파일 / 법규 갱신 주기 복원
  useEffect(() => { initAgentSettings(); }, []);

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

  function resetEditingState() {
    setEditingMessageId(null);
    setEditingDraft("");
  }

  // Phase 3 — 단일 에이전트 / Director 모드 토글 상태
  const { chatMode, setChatMode } = useChatMode();

  // ── 전송/스트림 훅 ──────────────────────────────────────────────────────
  const {
    isSending,
    attachedFiles,
    setAttachedFiles,
    lastError,
    debugMeta,
    handleSend,
    handleStopGenerating,
  } = useSendChat({
    workspace,
    globalInstruction,
    draft,
    editingDraft,
    resetEditingState,
    markScrollToBottom,
    setPanelPage,
    onDraftClear: () => setDraft(""),
    chatMode,
  });

  function handleStopCurrentTurn() {
    handleStopGenerating(debugMeta);
  }

  // ── 메시지 버전 훅 ──────────────────────────────────────────────────────
  const visibleThreadMessages = (workspace.activeThread?.messages ?? []).filter((message) => !message.isHidden);
  const lastVisibleMessage = visibleThreadMessages.length > 0
    ? visibleThreadMessages[visibleThreadMessages.length - 1]
    : null;
  const latestDirectiveMessage = [...visibleThreadMessages].reverse().find((message) => message.role === "user");
  const fallbackDirective = mode === "thread-chat"
    ? (latestDirectiveMessage?.content ?? "")
    : draft;
  const runtimeDirective = missionRuntime.directive.trim();
  const sceneDirective = runtimeDirective || fallbackDirective;
  const fallbackSceneMode: "idle" | "dispatch" | "working" | "meeting" =
    sidebarView === "workforce"
      ? "meeting"
      : (sidebarView === "storeops" || sidebarView === "pos" || sidebarView === "sales" || sidebarView === "dashboard")
        ? "working"
        : mode === "thread-chat"
          ? isSending
            ? (visibleThreadMessages.some((message) => message.role === "assistant" && message.status === "pending")
              ? "working"
              : "dispatch")
            : lastVisibleMessage?.role === "assistant"
              ? "meeting"
              : lastVisibleMessage?.role === "user"
                ? "dispatch"
                : "idle"
          : draft.trim()
            ? "dispatch"
            : "idle";
  const runtimeSceneMode: "idle" | "dispatch" | "working" | "meeting" =
    missionRuntime.phase === "dispatch"
      ? "dispatch"
      : missionRuntime.phase === "working"
        ? "working"
        : missionRuntime.phase === "meeting" || missionRuntime.phase === "review" || missionRuntime.phase === "done"
          ? "meeting"
          : missionRuntime.phase === "error"
            ? "working"
            : "idle";
  const sceneMode: "idle" | "dispatch" | "working" | "meeting" =
    runtimeSceneMode !== "idle" ? runtimeSceneMode : fallbackSceneMode;
  const resolvedProjectTitle =
    sidebarView === "search" ? t("nav.search")
    : sidebarView === "images" ? t("nav.images")
    : sidebarView === "dashboard" ? t("nav.dashboard")
    : sidebarView === "benchmark" ? t("nav.benchmark")
    : sidebarView === "sales" ? t("nav.sales")
    : sidebarView === "workforce" ? t("nav.workforce")
    : sidebarView === "storeops" ? t("nav.storeops")
    : sidebarView === "pos" ? t("nav.pos")
    : workspace.activeProject?.title ?? "CORVUS X";
  const runningProjects = workspace.projectGroups.filter((project) => project.id !== GENERAL_PROJECT_ID && project.threadCount > 0).length;
  const totalProjects = workspace.projectGroups.filter((project) => project.id !== GENERAL_PROJECT_ID).length;
  const quickJumpActive: "dashboard" | "sales" | "workforce" | "storeops" | "pos" | "search" | "chat" =
    sidebarView === "dashboard" ? "dashboard"
      : sidebarView === "sales" ? "sales"
        : sidebarView === "workforce" ? "workforce"
          : sidebarView === "storeops" ? "storeops"
            : sidebarView === "pos" ? "pos"
              : sidebarView === "search" ? "search"
                : "chat";

  // ── 네비게이션 핸들러 ────────────────────────────────────────────────────
  function resetNav() {
    setDraft(""); setSidebarView("default"); resetEditingState(); markScrollToBottom("auto");
  }

  function handleOpenGeneralHome() { workspace.openGeneralHome(); resetNav(); }
  function handleSelectProject(projectId: string) { workspace.selectProject(projectId); resetNav(); }
  function handleOpenThread(threadId: string) { workspace.openThread(threadId); resetNav(); }
  function handleOpenSearch() { workspace.setActiveThreadId(null); setSidebarView("search"); resetEditingState(); markScrollToBottom("auto"); }
  function handleOpenImages() { workspace.setActiveThreadId(null); setSidebarView("images"); resetEditingState(); markScrollToBottom("auto"); }
  function handleOpenBenchmark() { workspace.setActiveThreadId(null); setSidebarView("benchmark"); resetEditingState(); markScrollToBottom("auto"); }
  function handleOpenDashboard() { workspace.setActiveThreadId(null); setSidebarView("dashboard"); resetEditingState(); markScrollToBottom("auto"); }
  function handleOpenSales() { workspace.setActiveThreadId(null); setSidebarView("sales"); resetEditingState(); markScrollToBottom("auto"); }
  function handleOpenWorkforce() { workspace.setActiveThreadId(null); setSidebarView("workforce"); resetEditingState(); markScrollToBottom("auto"); }
  function handleOpenStoreOps() { workspace.setActiveThreadId(null); setSidebarView("storeops"); resetEditingState(); markScrollToBottom("auto"); }
  function handleOpenPos() { workspace.setActiveThreadId(null); setSidebarView("pos"); resetEditingState(); markScrollToBottom("auto"); }
  function handleLaunchWorkforceMission(directive: string) {
    const nextDirective = String(directive ?? "").trim();
    if (!nextDirective) return;
    startMissionRuntime(nextDirective, "hq");
    setPendingWorkforceMission(nextDirective, "hq");
    handleOpenWorkforce();
  }
  function handleResetMission() {
    resetMissionRuntimeState();
    setSidebarView("default");
    showToast("미션 런타임을 종료하고 HQ 대기 상태로 전환했습니다.", "success");
  }
  function handleOpenChatThread() {
    workspace.createGeneralChat();
    resetNav();
  }
  function handleCreateThreadInProject(projectId: string) { workspace.createThreadInProject(projectId); resetNav(); }
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

  function handleArchiveWorkforceReport(payload: WorkforceArchivePayload) {
    const archiveTag = `exec-report:${payload.id}`;
    const existing = workspace.threads.find((thread) => thread.meta?.labels?.includes(archiveTag));
    if (existing) {
      workspace.openThread(existing.id);
      setSidebarView("default");
      showToast("이미 저장된 보고서입니다.", "warning");
      return;
    }

    const targetProjectId = workspace.activeProjectId !== GENERAL_PROJECT_ID
      ? workspace.activeProjectId
      : workspace.projectGroups.find((project) => project.id !== GENERAL_PROJECT_ID)?.id ?? GENERAL_PROJECT_ID;

    const threadTitle = `[상무보고] ${payload.topic || "Executive Mission"}`;
    const timestamp = nowIso();
    const nextThread = {
      ...createThread(targetProjectId, threadTitle),
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const directiveMessage: Message = {
      id: createId("msg"),
      role: "user",
      content: `대표이사 지시\n${payload.directive}`,
      createdAt: timestamp,
      status: "done"
    };
    const reportMessage: Message = {
      id: createId("msg"),
      role: "assistant",
      content: buildExecutiveReportMarkdown(payload),
      createdAt: timestamp,
      status: "done"
    };

    const finalThread: Thread = {
      ...nextThread,
      messages: [directiveMessage, reportMessage],
      meta: {
        ...(nextThread.meta ?? {}),
        labels: [...(nextThread.meta?.labels ?? []), "executive-report", archiveTag],
        lastSummary: payload.summary || "상무 보고가 저장되었습니다."
      }
    };

    workspace.setThreads((current) => [finalThread, ...current]);
    workspace.touchProject(targetProjectId, timestamp);
    workspace.setActiveProjectId(targetProjectId);
    workspace.setActiveThreadId(finalThread.id);
    setSidebarView("default");

    apiSaveThread({
      id: finalThread.id,
      projectId: finalThread.projectId,
      title: finalThread.title,
      createdAt: finalThread.createdAt,
      updatedAt: finalThread.updatedAt,
      meta: finalThread.meta
    });
    apiSaveMessages(finalThread.id, finalThread.messages);
    apiSyncState({ activeProjectId: targetProjectId, activeThreadId: finalThread.id });

    showToast(`보고가 저장되었습니다: ${finalThread.title}`, "success");
  }

  function handleCreateStoreOpsProjectAlert(payload: StoreOpsAlertPayload) {
    const alertTag = `store-alert:${payload.id}`;
    const existing = workspace.threads.find((thread) => thread.meta?.labels?.includes(alertTag));
    if (existing) {
      workspace.openThread(existing.id);
      setSidebarView("default");
      showToast("이미 생성된 자동조치 프로젝트가 있습니다.", "warning");
      return;
    }

    const routedProject = workspace.projectGroups.find((project) =>
      project.id !== GENERAL_PROJECT_ID &&
      (
        project.title.includes(payload.department) ||
        project.title.includes(payload.storeName) ||
        project.title.includes("매장")
      )
    );
    const targetProjectId = routedProject?.id
      ?? (workspace.activeProjectId !== GENERAL_PROJECT_ID
        ? workspace.activeProjectId
        : workspace.projectGroups.find((project) => project.id !== GENERAL_PROJECT_ID)?.id ?? GENERAL_PROJECT_ID);

    const threadTitle = `[자동조치] ${payload.title}`;
    const timestamp = nowIso();
    const nextThread = {
      ...createThread(targetProjectId, threadTitle),
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const triggerMessage: Message = {
      id: createId("msg"),
      role: "user",
      content: `StoreOps 경보\n[담당 부서] ${payload.department}\n${payload.detail}`,
      createdAt: timestamp,
      status: "done"
    };
    const actionMessage: Message = {
      id: createId("msg"),
      role: "assistant",
      content: buildStoreOpsAlertMarkdown(payload),
      createdAt: timestamp,
      status: "done"
    };

    const finalThread: Thread = {
      ...nextThread,
      messages: [triggerMessage, actionMessage],
      meta: {
        ...(nextThread.meta ?? {}),
        labels: [...(nextThread.meta?.labels ?? []), "storeops-alert", alertTag, `department:${payload.department}`],
        lastSummary: `${payload.department} · ${payload.action}`
      }
    };

    workspace.setThreads((current) => [finalThread, ...current]);
    workspace.touchProject(targetProjectId, timestamp);
    workspace.setActiveProjectId(targetProjectId);
    workspace.setActiveThreadId(finalThread.id);
    setSidebarView("default");

    apiSaveThread({
      id: finalThread.id,
      projectId: finalThread.projectId,
      title: finalThread.title,
      createdAt: finalThread.createdAt,
      updatedAt: finalThread.updatedAt,
      meta: finalThread.meta
    });
    apiSaveMessages(finalThread.id, finalThread.messages);
    apiSyncState({ activeProjectId: targetProjectId, activeThreadId: finalThread.id });

    showToast(`자동조치 프로젝트가 생성되었습니다: ${finalThread.title}`, "success");
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
        sceneMode={sceneMode}
        sceneDirective={sceneDirective}
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
            onOpenDashboard={handleOpenDashboard}
            onOpenSales={handleOpenSales}
            onOpenWorkforce={handleOpenWorkforce}
            onOpenStoreOps={handleOpenStoreOps}
            onOpenPos={handleOpenPos}
            onOpenBenchmark={handleOpenBenchmark}
            onSelectProject={handleSelectProject}
            onSelectThread={handleOpenThread}
            onNewChat={handleOpenGeneralHome}
            onCreateProject={() => { setProjectTitleDraft(""); setIsProjectModalOpen(true); }}
            onCreateNamedProject={(title) => {
              const next = title.trim();
              if (!next) return;
              workspace.createNamedProject(next);
              resetNav();
            }}
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
        hud={
          <div className="game-shell__hud-stack">
            <OfficeHudPanel
              mode={sceneMode}
              directive={sceneDirective}
              projectTitle={resolvedProjectTitle}
              threadTitle={workspace.activeThread?.title ?? undefined}
              missionPhase={missionRuntime.phase}
            />
            <MissionStudioPanel
              mode={sceneMode}
              latestDirective={sceneDirective}
              workflowNotes={missionRuntime.workflowNotes}
              onLaunchMission={handleLaunchWorkforceMission}
              onResetMission={handleResetMission}
              onOpenWorkforce={handleOpenWorkforce}
              onOpenStoreOps={handleOpenStoreOps}
              onOpenPos={handleOpenPos}
              onOpenSales={handleOpenSales}
              activeProjects={runningProjects}
              totalProjects={totalProjects}
            />
          </div>
        }
        topbar={
          <Topbar
            mode={mode}
            workspaceKind={workspaceKind}
            projectTitle={resolvedProjectTitle}
            threadTitle={workspace.activeThread?.title ?? undefined}
            sceneMode={sceneMode}
            projectMemoryEnabled={Boolean(workspace.activeProject?.meta?.memoryEnabled)}
            onBackToHome={backToHome}
            connectionStatus={connectionStatus}
          />
        }
        main={
          <div className="main-stage">
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
            ) : sidebarView === "sales" ? (
              <ViewErrorBoundary name="Sales">
                <SalesView
                  onOpenWorkforce={handleOpenWorkforce}
                  onOpenStoreOps={handleOpenStoreOps}
                  onOpenPos={handleOpenPos}
                />
              </ViewErrorBoundary>
            ) : sidebarView === "workforce" ? (
              <ViewErrorBoundary name="Workforce">
                <WorkforceView
                  onArchiveReport={handleArchiveWorkforceReport}
                  onOpenStoreOps={handleOpenStoreOps}
                  onOpenPos={handleOpenPos}
                  onOpenSales={handleOpenSales}
                />
              </ViewErrorBoundary>
            ) : sidebarView === "storeops" ? (
              <ViewErrorBoundary name="StoreOps">
                <StoreOpsView
                  onCreateProjectAlert={handleCreateStoreOpsProjectAlert}
                  onOpenWorkforce={handleOpenWorkforce}
                  onOpenPos={handleOpenPos}
                  onOpenSales={handleOpenSales}
                />
              </ViewErrorBoundary>
            ) : sidebarView === "pos" ? (
              <ViewErrorBoundary name="POS">
                <PosView
                  onOpenWorkforce={handleOpenWorkforce}
                  onOpenStoreOps={handleOpenStoreOps}
                  onOpenSales={handleOpenSales}
                />
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
                  onRenameThread={(id, _nextTitle) => openRenameThread(id)}
                  onMoveThread={(threadId, nextProjectId) => { if (!nextProjectId) return; workspace.moveThread(threadId, nextProjectId); }}
                  onRemoveFromProject={workspace.removeThreadFromProject}
                  onDeleteThread={openDeleteThread}
                  onToggleThreadPinned={workspace.toggleThreadPinned}
                  projectGroups={workspace.projectGroups}
                  onLaunchWorkforceMission={handleLaunchWorkforceMission}
                  onOpenStoreOps={handleOpenStoreOps}
                  onOpenPos={handleOpenPos}
                  onOpenSales={handleOpenSales}
                  sceneMode={sceneMode}
                  sceneDirective={sceneDirective}
                />
              </ViewErrorBoundary>
            ) : (
              <ViewErrorBoundary name="Chat">
                <ChatView
                activeThread={workspace.activeThread}
                isSending={isSending}
                lastError={lastError}
                draft={draft}
                onDraftChange={setDraft}
                onSend={handleSend}
                onStop={handleStopCurrentTurn}
                scrollRef={scrollRef}
                attachedFiles={attachedFiles}
                onAttachFiles={setAttachedFiles}
                onOpenArtifact={handleOpenArtifact}
                onDownloadSlide={handleDownloadSlide}
                showScrollToBottom={showScrollToBottom}
                onScrollToBottom={handleScrollToBottom}
                chatMode={chatMode}
                onChatModeChange={setChatMode}
              />
              </ViewErrorBoundary>
            )}
            </Suspense>
            {!(mode === "home" && sidebarView === "default") ? (
              <QuickJumpBar
                active={quickJumpActive}
                onOpenChat={handleOpenChatThread}
                onOpenDashboard={handleOpenDashboard}
                onOpenSales={handleOpenSales}
                onOpenWorkforce={handleOpenWorkforce}
                onOpenStoreOps={handleOpenStoreOps}
                onOpenPos={handleOpenPos}
                onOpenSearch={handleOpenSearch}
              />
            ) : null}
          </div>
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
        onFontSizeChange={setFontSize}
        globalInstruction={globalInstruction}
        onGlobalInstructionChange={(v: string) => workspace.setGlobalInstruction(v)}
      />
    </ToastProvider>
  );
}
