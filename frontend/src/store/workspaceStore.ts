import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n";
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
import {
  loadWorkspaceFromServer,
  importSnapshot,
  syncState as apiSyncState,
  saveProject as apiSaveProject,
  removeProject as apiRemoveProject,
  saveThread as apiSaveThread,
  removeThread as apiRemoveThread,
  saveMessages as apiSaveMessages,
  saveVersions as apiSaveVersions
} from "../api/workspace";
import { devLog, nowIso } from "../utils/helpers";

export const GENERAL_PROJECT_ID = "__general__";
const STORAGE_PROJECTS_KEY = "corvus-x.frontend.projects.v15";
const STORAGE_THREADS_KEY = "corvus-x.frontend.threads.v15";
const STORAGE_ACTIVE_PROJECT_KEY = "corvus-x.frontend.activeProjectId.v15";
const STORAGE_ACTIVE_THREAD_KEY = "corvus-x.frontend.activeThreadId.v15";

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

export function createProjectEntity(title = t("defaults.newProject")): Project {
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

export function createThread(projectId: string, title = t("defaults.newChat")): Thread {
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
  const seedProject = createProjectEntity("CORVUS X");

  return {
    projects: [seedProject],
    threads: [],
    activeProjectId: GENERAL_PROJECT_ID,
    activeThreadId: null
  };
}

const LEGACY_BRAND_NAMES = ["AI ORCHESTRA", "AI Orchestra", "ai-orchestra"];

function normalizeProjects(projects: Project[]): Project[] {
  return projects.map((project) => ({
    ...project,
    // 구 브랜드명 자동 마이그레이션
    title: LEGACY_BRAND_NAMES.includes(project.title) ? "CORVUS X" : project.title,
    meta: {
      description: project.meta?.description ?? null,
      tags: Array.isArray(project.meta?.tags) ? project.meta.tags : [],
      memoryEnabled: Boolean(project.meta?.memoryEnabled),
      instruction: project.meta?.instruction ?? null
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
      // 브라우저 재시작 시 항상 홈 화면으로 시작
      activeThreadId: null
    };
  } catch {
    return createSeedSnapshot();
  }
}

function stripHeavyMeta(meta: Message["requestMeta"]): Message["requestMeta"] {
  if (!meta) return null;
  // providerDrafts: 스트리밍 임시 데이터, 저장 불필요 + 가장 무거운 필드
  // raw: SSE 이벤트 원본, 저장 불필요
  const { raw: _raw, providerDrafts: _drafts, ...rest } = meta as Record<string, unknown>;
  void _raw; void _drafts;
  return rest as Message["requestMeta"];
}

function trimThreadsForStorage(threads: Thread[]): Thread[] {
  return threads.map((thread) => ({
    ...thread,
    messages: thread.messages.map((msg) => ({
      ...msg,
      requestMeta: stripHeavyMeta(msg.requestMeta)
    })),
    messageVersions: Object.fromEntries(
      Object.entries(thread.messageVersions ?? {}).map(([groupId, msgs]) => [
        groupId,
        msgs.map((msg) => ({
          ...msg,
          requestMeta: stripHeavyMeta(msg.requestMeta)
        }))
      ])
    )
  }));
}

function pruneOldThreads(threads: Thread[], keepCount = 20): Thread[] {
  // 2단계: 핀된 스레드는 유지, 나머지는 최신 순 keepCount개만
  const pinned = threads.filter(getThreadPinned);
  const unpinned = threads
    .filter((t) => !getThreadPinned(t))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, Math.max(keepCount - pinned.length, 5));
  return [...pinned, ...unpinned];
}

function writeToStorage(snapshot: WorkspaceSnapshot) {
  localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(snapshot.projects));
  localStorage.setItem(STORAGE_THREADS_KEY, JSON.stringify(snapshot.threads));
  localStorage.setItem(STORAGE_ACTIVE_PROJECT_KEY, snapshot.activeProjectId);

  if (snapshot.activeThreadId) {
    localStorage.setItem(STORAGE_ACTIVE_THREAD_KEY, snapshot.activeThreadId);
  } else {
    localStorage.removeItem(STORAGE_ACTIVE_THREAD_KEY);
  }
}

export function persistWorkspace(snapshot: WorkspaceSnapshot) {
  // 항상 heavy meta(providerDrafts, raw) 제거 후 저장 — 저장 불필요한 임시 데이터
  const cleaned = { ...snapshot, threads: trimThreadsForStorage(snapshot.threads) };

  // localStorage에도 캐시 (오프라인 폴백)
  try {
    writeToStorage(cleaned);
  } catch {
    try {
      const pruned = { ...cleaned, threads: pruneOldThreads(cleaned.threads) };
      writeToStorage(pruned);
    } catch {
      devLog.warn("[CORVUS X] localStorage 저장 실패: 용량 초과.");
    }
  }
}

// ─── 서버에서 워크스페이스 로드 (비동기) ───────────
export async function loadWorkspaceAsync(): Promise<WorkspaceSnapshot & { globalInstruction?: string }> {
  try {
    const result = await loadWorkspaceFromServer();
    if (result?.ok && result.data) {
      const { projects, threads, activeProjectId, activeThreadId, globalInstruction } = result.data;

      // 서버 DB에 실제 대화 데이터가 있으면 그걸 사용 (threads 기준, __general__ 시드 프로젝트만 있는 경우 제외)
      const hasRealData = Array.isArray(threads) && threads.length > 0;
      if (hasRealData) {
        devLog.log("[CORVUS X] 서버 DB에서 워크스페이스 로드됨:", projects?.length ?? 0, "projects,", threads.length, "threads");
        return {
          projects: normalizeProjects(Array.isArray(projects) ? projects : []),
          threads: normalizeThreads(threads),
          activeProjectId: activeProjectId || GENERAL_PROJECT_ID,
          activeThreadId: null, // 브라우저 재접속 시 항상 홈 화면으로 시작
          globalInstruction: globalInstruction ?? ""
        };
      }

      // 서버 DB에 스레드 없음 → localStorage에서 마이그레이션 시도
      const local = loadWorkspace();
      if (local.threads.length > 0 || local.projects.length > 0) {
        devLog.log("[CORVUS X] localStorage → 서버 DB 마이그레이션 시작");
        const cleaned = { ...local, threads: trimThreadsForStorage(local.threads) };
        await importSnapshot(cleaned.projects, cleaned.threads);
        devLog.log("[CORVUS X] 마이그레이션 완료:", cleaned.projects.length, "projects,", cleaned.threads.length, "threads");
        return { ...local, globalInstruction: "" };
      }
    }
  } catch (err) {
    devLog.warn("[CORVUS X] 서버 로드 실패, localStorage 폴백:", err);
  }

  // 서버 접근 불가 → localStorage 폴백
  return { ...loadWorkspace(), globalInstruction: "" };
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

export type WorkspaceState = WorkspaceSnapshot & {
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
  globalInstruction: string;
  setGlobalInstruction: (value: string) => void;
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
  const [globalInstruction, setGlobalInstructionState] = useState<string>(() => {
    try { return localStorage.getItem("corvus-x.global-instruction") ?? ""; } catch { return ""; }
  });
  const [threads, setThreads] = useState<Thread[]>(initialWorkspace.threads);
  const [activeProjectId, setActiveProjectId] = useState<string>(initialWorkspace.activeProjectId);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(initialWorkspace.activeThreadId);
  const serverLoadedRef = useRef(false);

  // ── 서버에서 비동기 로드 (초기 1회) ──────────────
  useEffect(() => {
    if (serverLoadedRef.current) return;
    serverLoadedRef.current = true;

    loadWorkspaceAsync().then((snapshot) => {
      setProjects(snapshot.projects);
      setThreads(snapshot.threads);
      setActiveProjectId(snapshot.activeProjectId);
      setActiveThreadId(snapshot.activeThreadId);
      if (snapshot.globalInstruction) {
        setGlobalInstructionState(snapshot.globalInstruction);
      }
      devLog.log("[CORVUS X] 서버 동기화 완료");
    }).catch(() => {
      devLog.warn("[CORVUS X] 서버 동기화 실패, localStorage 데이터 유지");
    });
  }, []);

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

  function touchThread(threadId: string, timestamp = nowIso()) {
    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId ? { ...thread, updatedAt: timestamp } : thread
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

  function setGlobalInstruction(value: string) {
    setGlobalInstructionState(value);
    try { localStorage.setItem("corvus-x.global-instruction", value); } catch {}
    apiSyncState({ globalInstruction: value });
  }

  function updateProjectMeta(projectId: string, metaPatch: Partial<Project["meta"]>) {
    if (projectId === GENERAL_PROJECT_ID) return;
    setProjects((current) =>
      current.map((project) => {
        if (project.id === projectId) {
          const updated = {
            ...project,
            meta: {
              ...(project.meta ?? {}),
              ...(metaPatch ?? {})
            }
          };
          apiSaveProject(updated);
          return updated;
        }
        return project;
      })
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
    updateThreadById(threadId, (thread) => {
      const nextVersions = {
        ...(thread.messageVersions ?? {}),
        [groupId]: messages.map(normalizeMessage)
      };
      const nextActiveIdx = {
        ...(thread.activeVersionIndex ?? {}),
        [groupId]: activeIndex
      };
      apiSaveVersions(threadId, nextVersions, nextActiveIdx);
      return {
        ...thread,
        messageVersions: nextVersions,
        activeVersionIndex: nextActiveIdx
      };
    });
  }

  function setActiveMessageVersion(threadId: string, groupId: string, versionIndex: number) {
    updateThreadById(threadId, (thread) => {
      const nextActiveIdx = {
        ...(thread.activeVersionIndex ?? {}),
        [groupId]: Math.max(0, versionIndex)
      };
      apiSaveVersions(threadId, thread.messageVersions ?? {}, nextActiveIdx);
      return {
        ...thread,
        activeVersionIndex: nextActiveIdx
      };
    });
  }

  function replaceThreadMessages(threadId: string, nextMessages: Message[], timestamp = nowIso()) {
    updateThreadById(threadId, (thread) => {
      const normalized = nextMessages.map(normalizeMessage);
      // 서버에 메시지 저장 (heavy meta 제거 후)
      const stripped = normalized.map(m => ({ ...m, requestMeta: stripHeavyMeta(m.requestMeta) }));
      apiSaveMessages(threadId, stripped);
      return {
        ...thread,
        updatedAt: timestamp,
        messages: normalized
      };
    });
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

      const stripped = nextMessages.map(m => ({ ...m, requestMeta: stripHeavyMeta(m.requestMeta) }));
      apiSaveMessages(threadId, stripped);

      return {
        ...thread,
        messages: nextMessages
      };
    });
  }

  function deleteMessage(threadId: string, messageId: string) {
    updateThreadById(threadId, (thread) => {
      const deletedMsg = thread.messages.find((m) => m.id === messageId);
      const nextMessages = thread.messages.filter((m) => m.id !== messageId);

      // orphaned 버전 데이터 정리
      const nextVersions = { ...(thread.messageVersions ?? {}) };
      const nextActiveIdx = { ...(thread.activeVersionIndex ?? {}) };
      if (deletedMsg?.versionGroupId) {
        delete nextVersions[deletedMsg.versionGroupId];
        delete nextActiveIdx[deletedMsg.versionGroupId];
      }

      const stripped = nextMessages.map(m => ({ ...m, requestMeta: stripHeavyMeta(m.requestMeta) }));
      apiSaveMessages(threadId, stripped);
      apiSaveVersions(threadId, nextVersions, nextActiveIdx);
      return {
        ...thread,
        messages: nextMessages,
        messageVersions: nextVersions,
        activeVersionIndex: nextActiveIdx,
        updatedAt: nowIso()
      };
    });
  }

  function openGeneralHome() {
    setActiveProjectId(GENERAL_PROJECT_ID);
    setActiveThreadId(null);
    apiSyncState({ activeProjectId: GENERAL_PROJECT_ID, activeThreadId: null });
  }

  function selectProject(projectId: string) {
    setActiveProjectId(projectId);
    setActiveThreadId(null);
    apiSyncState({ activeProjectId: projectId, activeThreadId: null });
  }

  function openThread(threadId: string) {
    const nextThread = threads.find((thread) => thread.id === threadId);
    if (!nextThread) return;
    setActiveProjectId(nextThread.projectId);
    setActiveThreadId(threadId);
    apiSyncState({ activeProjectId: nextThread.projectId, activeThreadId: threadId });
  }

  function createGeneralChat() {
    const nextThread = createThread(GENERAL_PROJECT_ID);
    setThreads((current) => [nextThread, ...current]);
    setActiveProjectId(GENERAL_PROJECT_ID);
    setActiveThreadId(nextThread.id);
    apiSaveThread({ ...nextThread, messages: [] });
    apiSyncState({ activeProjectId: GENERAL_PROJECT_ID, activeThreadId: nextThread.id });
    return nextThread.id;
  }

  function createNamedProject(title?: string) {
    const nextTitle = String(title ?? "").trim() || t("defaults.newProject");
    const nextProject = createProjectEntity(nextTitle);

    setProjects((current) => [nextProject, ...current]);
    setActiveProjectId(nextProject.id);
    setActiveThreadId(null);
    apiSaveProject(nextProject);
    apiSyncState({ activeProjectId: nextProject.id, activeThreadId: null });
    return nextProject.id;
  }

  function createThreadInProject(projectId: string) {
    const nextThread = createThread(projectId);
    const timestamp = nowIso();

    const threadWithTime = { ...nextThread, updatedAt: timestamp, createdAt: timestamp };
    setThreads((current) => [threadWithTime, ...current]);
    touchProject(projectId, timestamp);
    setActiveProjectId(projectId);
    setActiveThreadId(nextThread.id);
    apiSaveThread({ ...threadWithTime, messages: [] });
    apiSyncState({ activeProjectId: projectId, activeThreadId: nextThread.id });
    return nextThread.id;
  }

  function renameProject(projectId: string, nextTitle: string) {
    const safeTitle = String(nextTitle ?? "").trim();
    if (!safeTitle) return;

    const timestamp = nowIso();
    setProjects((current) =>
      current.map((project) => {
        if (project.id === projectId) {
          const updated = { ...project, title: safeTitle, updatedAt: timestamp };
          apiSaveProject(updated);
          return updated;
        }
        return project;
      })
    );
  }

  function deleteProject(projectId: string) {
    setProjects((current) => current.filter((project) => project.id !== projectId));
    setThreads((current) => current.filter((thread) => thread.projectId !== projectId));
    apiRemoveProject(projectId);

    if (activeProjectId === projectId) {
      setActiveProjectId(GENERAL_PROJECT_ID);
      setActiveThreadId(null);
      apiSyncState({ activeProjectId: GENERAL_PROJECT_ID, activeThreadId: null });
    }
  }

  function renameThread(threadId: string, nextTitle: string) {
    const safeTitle = String(nextTitle ?? "").trim();
    if (!safeTitle) return;

    const target = threads.find((thread) => thread.id === threadId);
    const timestamp = nowIso();
    updateThreadById(threadId, (thread) => {
      const updated = { ...thread, title: safeTitle, updatedAt: timestamp };
      apiSaveThread({ id: updated.id, projectId: updated.projectId, title: updated.title, createdAt: updated.createdAt, updatedAt: updated.updatedAt, meta: updated.meta });
      return updated;
    });
    if (target) touchProject(target.projectId, timestamp);
  }

  function deleteThread(threadId: string) {
    const target = threads.find((thread) => thread.id === threadId);

    setThreads((current) => current.filter((thread) => thread.id !== threadId));
    if (target) touchProject(target.projectId);
    apiRemoveThread(threadId);

    if (activeThreadId === threadId) {
      const nextProjectId = target?.projectId ?? GENERAL_PROJECT_ID;
      setActiveProjectId(nextProjectId);
      setActiveThreadId(null);
      apiSyncState({ activeProjectId: nextProjectId, activeThreadId: null });
    }
  }

  function moveThread(threadId: string, nextProjectId: string) {
    const target = threads.find((thread) => thread.id === threadId);
    if (!target) return;
    if (!nextProjectId || target.projectId === nextProjectId) return;

    const timestamp = nowIso();
    updateThreadById(threadId, (thread) => {
      const updated = { ...thread, projectId: nextProjectId, updatedAt: timestamp };
      apiSaveThread({ id: updated.id, projectId: updated.projectId, title: updated.title, createdAt: updated.createdAt, updatedAt: updated.updatedAt, meta: updated.meta });
      return updated;
    });

    touchProject(target.projectId, timestamp);
    touchProject(nextProjectId, timestamp);

    if (activeThreadId === threadId) {
      setActiveProjectId(nextProjectId);
      apiSyncState({ activeProjectId: nextProjectId });
    }
  }

  function removeThreadFromProject(threadId: string) {
    const target = threads.find((thread) => thread.id === threadId);
    if (!target) return;
    if (target.projectId === GENERAL_PROJECT_ID) return;

    const timestamp = nowIso();

    updateThreadById(threadId, (thread) => {
      const updated = { ...thread, projectId: GENERAL_PROJECT_ID, updatedAt: timestamp };
      apiSaveThread({ id: updated.id, projectId: updated.projectId, title: updated.title, createdAt: updated.createdAt, updatedAt: updated.updatedAt, meta: updated.meta });
      return updated;
    });

    touchProject(target.projectId, timestamp);

    if (activeThreadId === threadId) {
      setActiveProjectId(GENERAL_PROJECT_ID);
      apiSyncState({ activeProjectId: GENERAL_PROJECT_ID });
    }
  }

  function toggleThreadPinned(threadId: string) {
    updateThreadById(threadId, (thread) => {
      const updated = {
        ...thread,
        meta: {
          ...(thread.meta ?? {}),
          pinned: !getThreadPinned(thread)
        } as Thread["meta"]
      };
      apiSaveThread({ id: updated.id, projectId: updated.projectId, title: updated.title, createdAt: updated.createdAt, updatedAt: updated.updatedAt, meta: updated.meta });
      return updated;
    });
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
    globalInstruction,
    setGlobalInstruction,
    deleteProject,
    renameThread,
    deleteThread,
    moveThread,
    removeThreadFromProject,
    toggleThreadPinned
  };
}
