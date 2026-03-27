import { useEffect, useMemo, useState } from "react";
import type {
  DebugMeta,
  Message,
  Project,
  ProjectGroup,
  ProviderDraft,
  StreamEvent,
  StreamFinalEvent,
  StreamJudgeEvent,
  StreamOrchestrationEvent,
  StreamProviderChunkEvent,
  StreamProviderEvent,
  Thread,
  WorkspaceSnapshot
} from "../types/workspace";

export const GENERAL_PROJECT_ID = "__general__";
const STORAGE_PROJECTS_KEY = "ai-orchestra.frontend.projects.v14";
const STORAGE_THREADS_KEY = "ai-orchestra.frontend.threads.v14";
const STORAGE_ACTIVE_PROJECT_KEY = "ai-orchestra.frontend.activeProjectId.v14";
const STORAGE_ACTIVE_THREAD_KEY = "ai-orchestra.frontend.activeThreadId.v14";

type ThreadMetaWithPinned = NonNullable<Thread["meta"]> & {
  pinned?: boolean;
};

function getThreadPinned(thread: Thread) {
  return Boolean((thread.meta as ThreadMetaWithPinned | undefined)?.pinned);
}

function compareThreadsByPinnedAndUpdatedAt(a: Thread, b: Thread) {
  const aPinned = getThreadPinned(a);
  const bPinned = getThreadPinned(b);

  if (aPinned !== bPinned) {
    return aPinned ? -1 : 1;
  }

  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

export function createId(prefix: string) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${random}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function createVersionGroupId() {
  return createId("version_group");
}

export function createDefaultDebugMeta(): DebugMeta {
  return {
    providerChain: [],
    winnerProvider: null,
    qualityScoreGain: null,
    orchestraWins: null,
    singleModelWins: null,
    ties: null,
    routerTask: null,
    selectedProviders: [],
    verifierProviders: [],
    executionStrategy: null,
    parallelWidth: null,
    conflictRisk: null,
    claimCount: 0,
    conflictCount: 0,
    conflictTypes: [],
    scoreboard: null,
    raw: null,
    usageProviders: [],
    usageTotals: null,
    requestLatencyMs: null,
    requestTotalTokens: null,
    requestCostUsd: null,
    fallbackUsed: false,
    judgeConfidence: null,
    selectedModels: [],
    banditScores: {},
    providerDrafts: [],
    displayWinner: null,
    displayLosers: [],
    hiddenFailedProviders: [],
    primaryRecovered: false,
    recoveryFromModel: null,
    recoveryToModel: null,
    providerStatusMap: {},
    providerStreamSummary: {},
    timelineEvents: []
  };
}

export function createProjectEntity(title = "새 프로젝트"): Project {
  const timestamp = nowIso();
  return {
    id: createId("project"),
    title,
    createdAt: timestamp,
    updatedAt: timestamp,
    meta: {
      description: null,
      tags: [],
      memoryEnabled: false
    }
  };
}

export function createThread(projectId: string, title = "새 채팅"): Thread {
  const timestamp = nowIso();
  return {
    id: createId("thread"),
    title,
    projectId,
    messages: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    meta: {
      lastSummary: null,
      pinned: false
    } as Thread["meta"],
    messageVersions: {},
    activeVersionIndex: {}
  };
}

function createSeedSnapshot(): WorkspaceSnapshot {
  const seedProject = createProjectEntity("AI ORCHESTRA");

  return {
    projects: [seedProject],
    threads: [],
    activeProjectId: GENERAL_PROJECT_ID,
    activeThreadId: null
  };
}

function normalizeProjects(projects: Project[]): Project[] {
  return projects.map((project) => ({
    ...project,
    meta: {
      description: project.meta?.description ?? null,
      tags: Array.isArray(project.meta?.tags) ? project.meta.tags : [],
      memoryEnabled: Boolean(project.meta?.memoryEnabled)
    }
  }));
}

function normalizeMessage(message: Message): Message {
  return {
    ...message,
    status: message.status,
    requestMeta: message.requestMeta ?? null,
    versionGroupId: message.versionGroupId ?? undefined,
    versionIndex:
      typeof message.versionIndex === "number" && Number.isFinite(message.versionIndex)
        ? message.versionIndex
        : undefined,
    isHidden: Boolean(message.isHidden)
  };
}

function normalizeMessageVersions(
  versions: Thread["messageVersions"] | undefined
): NonNullable<Thread["messageVersions"]> {
  if (!versions || typeof versions !== "object") {
    return {};
  }

  const normalized: NonNullable<Thread["messageVersions"]> = {};

  for (const [groupId, messages] of Object.entries(versions)) {
    if (!Array.isArray(messages)) continue;
    normalized[groupId] = messages.map(normalizeMessage);
  }

  return normalized;
}

function normalizeActiveVersionIndex(
  activeVersionIndex: Thread["activeVersionIndex"] | undefined
): NonNullable<Thread["activeVersionIndex"]> {
  if (!activeVersionIndex || typeof activeVersionIndex !== "object") {
    return {};
  }

  const normalized: NonNullable<Thread["activeVersionIndex"]> = {};

  for (const [groupId, index] of Object.entries(activeVersionIndex)) {
    normalized[groupId] =
      typeof index === "number" && Number.isFinite(index) && index >= 0 ? index : 0;
  }

  return normalized;
}

function normalizeThreads(threads: Thread[]): Thread[] {
  return threads.map((thread) => ({
    ...thread,
    messages: Array.isArray(thread.messages) ? thread.messages.map(normalizeMessage) : [],
    meta: {
      lastSummary: thread.meta?.lastSummary ?? null,
      pinned: Boolean((thread.meta as ThreadMetaWithPinned | undefined)?.pinned)
    } as Thread["meta"],
    messageVersions: normalizeMessageVersions(thread.messageVersions),
    activeVersionIndex: normalizeActiveVersionIndex(thread.activeVersionIndex)
  }));
}

export function loadWorkspace(): WorkspaceSnapshot {
  try {
    const rawProjects = localStorage.getItem(STORAGE_PROJECTS_KEY);
    const rawThreads = localStorage.getItem(STORAGE_THREADS_KEY);
    const rawActiveProjectId = localStorage.getItem(STORAGE_ACTIVE_PROJECT_KEY);
    const rawActiveThreadId = localStorage.getItem(STORAGE_ACTIVE_THREAD_KEY);

    if (!rawProjects || !rawThreads) {
      return createSeedSnapshot();
    }

    const projects = normalizeProjects(JSON.parse(rawProjects) as Project[]);
    const threads = normalizeThreads(JSON.parse(rawThreads) as Thread[]);

    if (!Array.isArray(projects) || !Array.isArray(threads)) {
      return createSeedSnapshot();
    }

    return {
      projects,
      threads,
      activeProjectId:
        typeof rawActiveProjectId === "string" && rawActiveProjectId.trim()
          ? rawActiveProjectId
          : GENERAL_PROJECT_ID,
      activeThreadId:
        typeof rawActiveThreadId === "string" && rawActiveThreadId.trim()
          ? rawActiveThreadId
          : null
    };
  } catch {
    return createSeedSnapshot();
  }
}

export function persistWorkspace(snapshot: WorkspaceSnapshot) {
  localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(snapshot.projects));
  localStorage.setItem(STORAGE_THREADS_KEY, JSON.stringify(snapshot.threads));
  localStorage.setItem(STORAGE_ACTIVE_PROJECT_KEY, snapshot.activeProjectId);

  if (snapshot.activeThreadId) {
    localStorage.setItem(STORAGE_ACTIVE_THREAD_KEY, snapshot.activeThreadId);
  } else {
    localStorage.removeItem(STORAGE_ACTIVE_THREAD_KEY);
  }
}

export function buildProjectGroups(projects: Project[], threads: Thread[]): ProjectGroup[] {
  return [...projects]
    .map((project) => {
      const groupThreads = [...threads]
        .filter((thread) => thread.projectId === project.id)
        .sort(compareThreadsByPinnedAndUpdatedAt);

      return {
        id: project.id,
        title: project.title,
        threadCount: groupThreads.length,
        updatedAt: groupThreads[0]?.updatedAt ?? project.updatedAt,
        threads: groupThreads,
        meta: project.meta
      };
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function upsertProviderDraft(drafts: ProviderDraft[], provider: string, chunk: string) {
  const normalizedProvider = String(provider ?? "").trim().toLowerCase() || "unknown";
  const safeChunk = String(chunk ?? "");
  const existing = drafts.find((item) => item.provider === normalizedProvider);

  if (existing) {
    return drafts.map((item) =>
      item.provider === normalizedProvider
        ? { ...item, content: `${item.content}${safeChunk}` }
        : item
    );
  }

  return [...drafts, { provider: normalizedProvider, content: safeChunk }];
}

function isProviderDoneEvent(event: StreamEvent): event is StreamProviderEvent {
  return event.type === "provider" && event.stage === "done";
}

function isProviderChunkEvent(event: StreamEvent): event is StreamProviderChunkEvent {
  return event.type === "provider_chunk";
}

function isRouteResolvedEvent(event: StreamEvent): event is StreamOrchestrationEvent {
  return event.type === "orchestration" && event.stage === "route_resolved";
}

function isFinalSelectedEvent(event: StreamEvent): event is StreamOrchestrationEvent {
  return event.type === "orchestration" && event.stage === "final_selected";
}

function isJudgeDoneEvent(event: StreamEvent): event is StreamJudgeEvent {
  return event.type === "judge" && event.stage === "done";
}

function isFinalEvent(event: StreamEvent): event is StreamFinalEvent {
  return event.type === "final";
}

export function buildLiveMetaFromEvents(events: StreamEvent[]): DebugMeta {
  const meta = createDefaultDebugMeta();

  const providerDone = events.filter(isProviderDoneEvent);
  const providerChunks = events.filter(isProviderChunkEvent);
  const routeEvent = events.find(isRouteResolvedEvent);
  const finalEvent = events.find(isFinalEvent);
  const finalSelectedEvent = events.find(isFinalSelectedEvent);
  const judgeDone = events.find(isJudgeDoneEvent);

  meta.routerTask = routeEvent?.task ?? null;
  meta.selectedProviders = Array.isArray(routeEvent?.route?.selected_providers)
    ? routeEvent.route.selected_providers
    : [];
  meta.verifierProviders = Array.isArray(routeEvent?.route?.verifier_providers)
    ? routeEvent.route.verifier_providers
    : [];
  meta.executionStrategy = routeEvent?.route?.execution_strategy ?? null;
  meta.parallelWidth = Array.isArray(routeEvent?.route?.parallel_providers)
    ? routeEvent.route.parallel_providers.length
    : null;

  meta.winnerProvider =
    finalSelectedEvent?.selected_provider ??
    finalEvent?.provider ??
    judgeDone?.selected_provider ??
    meta.selectedProviders[0] ??
    null;

  meta.displayWinner = meta.winnerProvider
    ? {
        provider: meta.winnerProvider,
        role: undefined
      }
    : null;

  meta.judgeConfidence = judgeDone?.confidence ?? finalSelectedEvent?.judge_confidence ?? null;
  meta.conflictCount = judgeDone?.conflict_count ?? finalSelectedEvent?.conflict_count ?? 0;
  meta.selectedModels = providerDone.map((event) => ({
    provider: event.provider,
    model: event.model ?? undefined
  }));
  meta.usageProviders = providerDone.map((event) => ({
    provider: event.provider,
    success: event.ok,
    latency_ms: event.latency_ms ?? undefined,
    model: event.model ?? undefined
  }));
  meta.providerChain = Array.from(new Set(providerChunks.map((event) => event.provider)));
  meta.providerDrafts = providerChunks.reduce<ProviderDraft[]>(
    (acc, event) => upsertProviderDraft(acc, event.provider, event.content ?? ""),
    []
  );
  meta.raw = events;

  return meta;
}

type WorkspaceState = WorkspaceSnapshot & {
  generalThreads: Thread[];
  projectGroups: ProjectGroup[];
  projectThreads: Thread[];
  activeProject: ProjectGroup | null;
  activeThread: Thread | null;
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  setThreads: React.Dispatch<React.SetStateAction<Thread[]>>;
  setActiveProjectId: React.Dispatch<React.SetStateAction<string>>;
  setActiveThreadId: React.Dispatch<React.SetStateAction<string | null>>;
  updateThreadById: (threadId: string, mutator: (thread: Thread) => Thread) => void;
  touchProject: (projectId: string, timestamp?: string) => void;
  updateProjectMeta: (projectId: string, metaPatch: Partial<Project["meta"]>) => void;
  updateThreadMeta: (threadId: string, metaPatch: Partial<Thread["meta"]>) => void;
  updateThreadVersionGroup: (
    threadId: string,
    groupId: string,
    messages: Message[],
    activeIndex?: number
  ) => void;
  setActiveMessageVersion: (threadId: string, groupId: string, versionIndex: number) => void;
  replaceThreadMessages: (threadId: string, nextMessages: Message[], timestamp?: string) => void;
  hideMessagesAfter: (threadId: string, fromMessageId: string) => void;
  deleteMessage: (threadId: string, messageId: string) => void;
  openGeneralHome: () => void;
  selectProject: (projectId: string) => void;
  openThread: (threadId: string) => void;
  createGeneralChat: () => string;
  createNamedProject: (title?: string) => string | null;
  createThreadInProject: (projectId: string) => string;
  renameProject: (projectId: string, nextTitle: string) => void;
  deleteProject: (projectId: string) => void;
  renameThread: (threadId: string, nextTitle: string) => void;
  deleteThread: (threadId: string) => void;
  moveThread: (threadId: string, nextProjectId: string) => void;
  removeThreadFromProject: (threadId: string) => void;
  toggleThreadPinned: (threadId: string) => void;
};

export function useWorkspaceState(): WorkspaceState {
  const initialWorkspace = useMemo(() => loadWorkspace(), []);
  const [projects, setProjects] = useState<Project[]>(initialWorkspace.projects);
  const [threads, setThreads] = useState<Thread[]>(initialWorkspace.threads);
  const [activeProjectId, setActiveProjectId] = useState<string>(initialWorkspace.activeProjectId);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(initialWorkspace.activeThreadId);

  useEffect(() => {
    persistWorkspace({
      projects,
      threads,
      activeProjectId,
      activeThreadId
    });
  }, [projects, threads, activeProjectId, activeThreadId]);

  useEffect(() => {
    if (activeProjectId === GENERAL_PROJECT_ID) return;
    const exists = projects.some((project) => project.id === activeProjectId);
    if (!exists) {
      setActiveProjectId(GENERAL_PROJECT_ID);
      setActiveThreadId(null);
    }
  }, [projects, activeProjectId]);

  useEffect(() => {
    if (!activeThreadId) return;
    const currentThread = threads.find((thread) => thread.id === activeThreadId);
    if (!currentThread) {
      setActiveThreadId(null);
      return;
    }
    if (currentThread.projectId !== activeProjectId) {
      setActiveProjectId(currentThread.projectId);
    }
  }, [threads, activeThreadId, activeProjectId]);

  const generalThreads = useMemo(
    () =>
      [...threads]
        .filter((thread) => thread.projectId === GENERAL_PROJECT_ID)
        .sort(compareThreadsByPinnedAndUpdatedAt),
    [threads]
  );

  const projectGroups = useMemo(() => buildProjectGroups(projects, threads), [projects, threads]);

  const projectThreads = useMemo(
    () =>
      [...threads]
        .filter((thread) => thread.projectId === activeProjectId)
        .sort(compareThreadsByPinnedAndUpdatedAt),
    [threads, activeProjectId]
  );

  const activeProject = useMemo<ProjectGroup | null>(() => {
    if (activeProjectId === GENERAL_PROJECT_ID) return null;
    return projectGroups.find((project) => project.id === activeProjectId) ?? null;
  }, [projectGroups, activeProjectId]);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [threads, activeThreadId]
  );

  function updateThreadById(threadId: string, mutator: (thread: Thread) => Thread) {
    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId
          ? mutator({
              ...thread,
              messages: [...thread.messages],
              messageVersions: { ...(thread.messageVersions ?? {}) },
              activeVersionIndex: { ...(thread.activeVersionIndex ?? {}) }
            })
          : thread
      )
    );
  }

  function touchProject(projectId: string, timestamp = nowIso()) {
    if (projectId === GENERAL_PROJECT_ID) return;
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId
          ? { ...project, updatedAt: timestamp }
          : project
      )
    );
  }

  function updateProjectMeta(projectId: string, metaPatch: Partial<Project["meta"]>) {
    if (projectId === GENERAL_PROJECT_ID) return;
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId
          ? {
              ...project,
              meta: {
                ...(project.meta ?? {}),
                ...(metaPatch ?? {})
              }
            }
          : project
      )
    );
  }

  function updateThreadMeta(threadId: string, metaPatch: Partial<Thread["meta"]>) {
    updateThreadById(threadId, (thread) => ({
      ...thread,
      meta: {
        ...(thread.meta ?? {}),
        ...(metaPatch ?? {})
      }
    }));
  }

  function updateThreadVersionGroup(
    threadId: string,
    groupId: string,
    messages: Message[],
    activeIndex = 0
  ) {
    updateThreadById(threadId, (thread) => ({
      ...thread,
      messageVersions: {
        ...(thread.messageVersions ?? {}),
        [groupId]: messages.map(normalizeMessage)
      },
      activeVersionIndex: {
        ...(thread.activeVersionIndex ?? {}),
        [groupId]: activeIndex
      }
    }));
  }

  function setActiveMessageVersion(threadId: string, groupId: string, versionIndex: number) {
    updateThreadById(threadId, (thread) => ({
      ...thread,
      activeVersionIndex: {
        ...(thread.activeVersionIndex ?? {}),
        [groupId]: Math.max(0, versionIndex)
      }
    }));
  }

  function replaceThreadMessages(threadId: string, nextMessages: Message[], timestamp = nowIso()) {
    updateThreadById(threadId, (thread) => ({
      ...thread,
      updatedAt: timestamp,
      messages: nextMessages.map(normalizeMessage)
    }));
  }

  function hideMessagesAfter(threadId: string, fromMessageId: string) {
    updateThreadById(threadId, (thread) => {
      const nextMessages: Message[] = [];
      let shouldHide = false;

      for (const message of thread.messages) {
        if (message.id === fromMessageId) {
          shouldHide = true;
          nextMessages.push({ ...message, isHidden: false });
          continue;
        }

        if (shouldHide) {
          nextMessages.push({ ...message, isHidden: true });
          continue;
        }

        nextMessages.push({ ...message });
      }

      return {
        ...thread,
        messages: nextMessages
      };
    });
  }

  function deleteMessage(threadId: string, messageId: string) {
    updateThreadById(threadId, (thread) => ({
      ...thread,
      messages: thread.messages.filter((m) => m.id !== messageId),
      updatedAt: nowIso()
    }));
  }

  function openGeneralHome() {
    setActiveProjectId(GENERAL_PROJECT_ID);
    setActiveThreadId(null);
  }

  function selectProject(projectId: string) {
    setActiveProjectId(projectId);
    setActiveThreadId(null);
  }

  function openThread(threadId: string) {
    const nextThread = threads.find((thread) => thread.id === threadId);
    if (!nextThread) return;
    setActiveProjectId(nextThread.projectId);
    setActiveThreadId(threadId);
  }

  function createGeneralChat() {
    const nextThread = createThread(GENERAL_PROJECT_ID, "새 채팅");
    setThreads((current) => [nextThread, ...current]);
    setActiveProjectId(GENERAL_PROJECT_ID);
    setActiveThreadId(nextThread.id);
    return nextThread.id;
  }

  function createNamedProject(title?: string) {
    const nextTitle = String(title ?? "").trim() || "새 프로젝트";
    const nextProject = createProjectEntity(nextTitle);

    setProjects((current) => [nextProject, ...current]);
    setActiveProjectId(nextProject.id);
    setActiveThreadId(null);
    return nextProject.id;
  }

  function createThreadInProject(projectId: string) {
    const nextThread = createThread(projectId, "새 채팅");
    const timestamp = nowIso();

    setThreads((current) => [{ ...nextThread, updatedAt: timestamp, createdAt: timestamp }, ...current]);
    touchProject(projectId, timestamp);
    setActiveProjectId(projectId);
    setActiveThreadId(nextThread.id);
    return nextThread.id;
  }

  function renameProject(projectId: string, nextTitle: string) {
    const safeTitle = String(nextTitle ?? "").trim();
    if (!safeTitle) return;

    const timestamp = nowIso();
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId
          ? { ...project, title: safeTitle, updatedAt: timestamp }
          : project
      )
    );
  }

  function deleteProject(projectId: string) {
    setProjects((current) => current.filter((project) => project.id !== projectId));
    setThreads((current) => current.filter((thread) => thread.projectId !== projectId));

    if (activeProjectId === projectId) {
      setActiveProjectId(GENERAL_PROJECT_ID);
      setActiveThreadId(null);
    }
  }

  function renameThread(threadId: string, nextTitle: string) {
    const safeTitle = String(nextTitle ?? "").trim();
    if (!safeTitle) return;

    const target = threads.find((thread) => thread.id === threadId);
    const timestamp = nowIso();
    updateThreadById(threadId, (thread) => ({
      ...thread,
      title: safeTitle,
      updatedAt: timestamp
    }));
    if (target) touchProject(target.projectId, timestamp);
  }

  function deleteThread(threadId: string) {
    const target = threads.find((thread) => thread.id === threadId);

    setThreads((current) => current.filter((thread) => thread.id !== threadId));
    if (target) touchProject(target.projectId);

    if (activeThreadId === threadId) {
      setActiveProjectId(target?.projectId ?? GENERAL_PROJECT_ID);
      setActiveThreadId(null);
    }
  }

  function moveThread(threadId: string, nextProjectId: string) {
    const target = threads.find((thread) => thread.id === threadId);
    if (!target) return;
    if (!nextProjectId || target.projectId === nextProjectId) return;

    const timestamp = nowIso();
    updateThreadById(threadId, (thread) => ({
      ...thread,
      projectId: nextProjectId,
      updatedAt: timestamp
    }));

    touchProject(target.projectId, timestamp);
    touchProject(nextProjectId, timestamp);

    if (activeThreadId === threadId) {
      setActiveProjectId(nextProjectId);
    }
  }

  function removeThreadFromProject(threadId: string) {
    const target = threads.find((thread) => thread.id === threadId);
    if (!target) return;
    if (target.projectId === GENERAL_PROJECT_ID) return;

    const timestamp = nowIso();

    updateThreadById(threadId, (thread) => ({
      ...thread,
      projectId: GENERAL_PROJECT_ID,
      updatedAt: timestamp
    }));

    touchProject(target.projectId, timestamp);

    if (activeThreadId === threadId) {
      setActiveProjectId(GENERAL_PROJECT_ID);
    }
  }

  function toggleThreadPinned(threadId: string) {
    updateThreadById(threadId, (thread) => ({
      ...thread,
      meta: {
        ...(thread.meta ?? {}),
        pinned: !getThreadPinned(thread)
      } as Thread["meta"]
    }));
  }

  return {
    projects,
    threads,
    activeProjectId,
    activeThreadId,
    generalThreads,
    projectGroups,
    projectThreads,
    activeProject,
    activeThread,
    setProjects,
    setThreads,
    setActiveProjectId,
    setActiveThreadId,
    updateThreadById,
    touchProject,
    updateProjectMeta,
    updateThreadMeta,
    updateThreadVersionGroup,
    setActiveMessageVersion,
    replaceThreadMessages,
    hideMessagesAfter,
    deleteMessage,
    openGeneralHome,
    selectProject,
    openThread,
    createGeneralChat,
    createNamedProject,
    createThreadInProject,
    renameProject,
    deleteProject,
    renameThread,
    deleteThread,
    moveThread,
    removeThreadFromProject,
    toggleThreadPinned
  };
}
