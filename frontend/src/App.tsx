import { useEffect, useMemo, useRef, useState } from "react";
import {
  extractDebugMeta,
  fetchDashboard,
  fetchScoreboard,
  fetchUsageSummary,
  type DashboardResponse,
  type ScoreboardResponse,
  type UsageSummaryResponse
} from "./api/chat";

import ChatView from "./components/chat/ChatView";
import AppShell from "./components/layout/AppShell";
import Sidebar from "./components/layout/Sidebar";
import Topbar from "./components/layout/Topbar";
import OrchestrationPanel from "./components/ops/OrchestrationPanel";
import RequestStatusBar from "./components/ops/RequestStatusBar";

type Role = "user" | "assistant";

export type MessageStatus = "pending" | "done" | "error";

export type ProviderDraft = {
  provider: string;
  content: string;
};

export type Message = {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
  status?: MessageStatus;
  requestMeta?: any;
};

export type Thread = {
  id: string;
  title: string;
  projectId: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectGroup = {
  id: string;
  title: string;
  threadCount: number;
  updatedAt: string;
  threads: Thread[];
};

type DebugMeta = {
  providerChain: string[];
  winnerProvider: string | null;
  qualityScoreGain: number | null;
  orchestraWins: number | null;
  singleModelWins: number | null;
  ties: number | null;
  routerTask: string | null;
  selectedProviders: string[];
  verifierProviders: string[];
  executionStrategy: string | null;
  parallelWidth: number | null;
  conflictRisk: string | null;
  claimCount: number;
  conflictCount: number;
  conflictTypes: string[];
  scoreboard: unknown;
  raw: unknown;
  selectedByFreshness?: boolean;
  selectionOverrideReason?: string | null;
  runnerUpProvider?: string | null;
  usageProviders?: Array<{
    provider?: string | undefined;
    success?: boolean | undefined;
    latency_ms?: number | undefined;
    model?: string | null | undefined;
    usage?: {
      input_tokens?: number | undefined;
      output_tokens?: number | undefined;
      total_tokens?: number | undefined;
      estimated_cost_usd?: number | undefined;
    } | undefined;
  }>;
  usageTotals?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    estimated_cost_usd?: number;
  } | null;
  requestLatencyMs?: number | null;
  requestTotalTokens?: number | null;
  requestCostUsd?: number | null;
  fallbackUsed?: boolean;
  judgeConfidence?: number | null;
  selectedModels?: Array<{
    provider?: string | undefined;
    model?: string | undefined;
  }>;
  banditScores?: Record<
    string,
    {
      routing_score?: number;
      exploration_bonus?: number;
      freshness_bonus?: number;
      bandit_score?: number;
    }
  >;
  providerDrafts?: ProviderDraft[];
  displayWinner?: {
    provider?: string | undefined;
    role?: string | undefined;
  } | null;
  displayLosers?: string[];
  hiddenFailedProviders?: string[];
  primaryRecovered?: boolean;
  recoveryFromModel?: string | null;
  recoveryToModel?: string | null;
  providerStatusMap?: Record<string, any>;
  providerStreamSummary?: Record<string, any>;
  timelineEvents?: any[];
};

type OpsSnapshot = {
  usage: UsageSummaryResponse | null;
  scoreboard: ScoreboardResponse | null;
  dashboard: DashboardResponse | null;
};

type StartEvent = {
  type: "start";
  thread_id?: string;
  project_id?: string;
};

type AnswerChunkEvent = {
  type: "answer_chunk";
  content?: string;
};

type ProviderChunkEvent = {
  type: "provider_chunk";
  provider: string;
  content?: string;
};

type ProviderEvent = {
  type: "provider";
  stage: "start" | "done";
  provider: string;
  model?: string | null;
  ok?: boolean;
  latency_ms?: number;
  error_code?: string | null;
  answer_preview?: string;
};

type JudgeEvent = {
  type: "judge";
  stage: "start" | "done";
  candidate_count?: number;
  selected_provider?: string | null;
  confidence?: number;
  conflict_count?: number;
};

type OrchestrationEvent = {
  type: "orchestration";
  stage:
    | "task_detected"
    | "route_resolved"
    | "fallback_started"
    | "post_eval_pro_started"
    | "final_selected";
  task?: string;
  planner_signals?: any;
  route?: any;
  provider?: string;
  providers?: string[];
  reason?: string;
  selected_provider?: string | null;
  selected_model?: string | null;
  conflict_count?: number;
  judge_confidence?: number;
};

type FinalEvent = {
  type: "final";
  provider?: string | null;
  content?: string;
};

type DoneEvent = {
  type: "done";
  payload: any;
};

type ErrorEvent = {
  type: "error";
  error?: string;
};

type StreamEvent =
  | StartEvent
  | AnswerChunkEvent
  | ProviderChunkEvent
  | ProviderEvent
  | JudgeEvent
  | OrchestrationEvent
  | FinalEvent
  | DoneEvent
  | ErrorEvent;

const STORAGE_THREADS_KEY = "ai-orchestra.frontend.threads";
const STORAGE_ACTIVE_KEY = "ai-orchestra.frontend.activeThreadId";

function isProviderDoneEvent(event: StreamEvent): event is ProviderEvent {
  return event.type === "provider" && event.stage === "done";
}

function isProviderChunkEvent(event: StreamEvent): event is ProviderChunkEvent {
  return event.type === "provider_chunk";
}

function isRouteResolvedEvent(event: StreamEvent): event is OrchestrationEvent {
  return event.type === "orchestration" && event.stage === "route_resolved";
}

function isFinalSelectedEvent(event: StreamEvent): event is OrchestrationEvent {
  return event.type === "orchestration" && event.stage === "final_selected";
}

function isJudgeDoneEvent(event: StreamEvent): event is JudgeEvent {
  return event.type === "judge" && event.stage === "done";
}

function isFinalEvent(event: StreamEvent): event is FinalEvent {
  return event.type === "final";
}

function createId(prefix: string) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${random}`;
}

function nowIso() {
  return new Date().toISOString();
}

function summarizeTitle(input: string) {
  const clean = input.replace(/\s+/g, " ").trim();
  if (!clean) return "새 채팅";
  return clean.length > 28 ? `${clean.slice(0, 28)}...` : clean;
}

function cloneThread(thread: Thread): Thread {
  return JSON.parse(JSON.stringify(thread)) as Thread;
}

function createDefaultDebugMeta(): DebugMeta {
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
    selectedByFreshness: false,
    selectionOverrideReason: null,
    runnerUpProvider: null,
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

function createWelcomeThread(projectId = "ai-orchestra"): Thread {
  const timestamp = nowIso();
  return {
    id: createId("thread"),
    title: "새 채팅",
    projectId,
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [
      {
        id: createId("msg"),
        role: "assistant",
        content: "AI ORCHESTRA 준비 완료입니다. 메시지를 입력하면 /api/chat/stream 으로 연결합니다.",
        createdAt: timestamp,
        status: "done",
        requestMeta: null
      }
    ]
  };
}

function loadInitialThreads() {
  try {
    const saved = localStorage.getItem(STORAGE_THREADS_KEY);
    if (!saved) return [createWelcomeThread()];
    const parsed = JSON.parse(saved) as Thread[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [createWelcomeThread()];
  } catch {
    return [createWelcomeThread()];
  }
}

function projectTitle(projectId: string) {
  const normalized = String(projectId ?? "").trim();
  if (!normalized) return "Untitled Project";
  if (normalized === "ai-orchestra") return "AI ORCHESTRA";
  return normalized
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildProjectGroups(threads: Thread[]): ProjectGroup[] {
  const grouped = new Map<string, Thread[]>();

  for (const thread of threads) {
    const key = String(thread.projectId ?? "ai-orchestra").trim() || "ai-orchestra";
    const current = grouped.get(key) ?? [];
    current.push(thread);
    grouped.set(key, current);
  }

  return Array.from(grouped.entries())
    .map(([id, projectThreads]) => {
      const sortedThreads = [...projectThreads].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

      return {
        id,
        title: projectTitle(id),
        threadCount: sortedThreads.length,
        updatedAt: sortedThreads[0]?.updatedAt ?? nowIso(),
        threads: sortedThreads
      };
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function upsertProviderDraft(drafts: ProviderDraft[], provider: string, chunk: string) {
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

function buildLiveMetaFromEvents(events: StreamEvent[]): DebugMeta {
  const meta = createDefaultDebugMeta();

  const providerDone = events.filter(isProviderDoneEvent);
  const providerChunks = events.filter(isProviderChunkEvent);
  const routeEvent = events.find(isRouteResolvedEvent);
  const finalEvent = events.find(isFinalEvent);
  const finalSelectedEvent = events.find(isFinalSelectedEvent);
  const judgeDone = events.find(isJudgeDoneEvent);

  meta.routerTask = routeEvent?.task ?? null;
  meta.selectedProviders = Array.isArray(routeEvent?.route?.selected_providers) ? routeEvent.route.selected_providers : [];
  meta.verifierProviders = Array.isArray(routeEvent?.route?.verifier_providers) ? routeEvent.route.verifier_providers : [];
  meta.executionStrategy = routeEvent?.route?.execution_strategy ?? null;
  meta.parallelWidth = Array.isArray(routeEvent?.route?.parallel_providers) ? routeEvent.route.parallel_providers.length : null;
  meta.winnerProvider =
    finalSelectedEvent?.selected_provider ??
    finalEvent?.provider ??
    judgeDone?.selected_provider ??
    meta.selectedProviders[0] ??
    null;
  meta.displayWinner = meta.winnerProvider
    ? {
        provider: meta.winnerProvider,
        role: null
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
    model: event.model ?? undefined,
    usage: {
      estimated_cost_usd: 0
    }
  }));
  meta.providerChain = Array.from(new Set(providerChunks.map((event) => event.provider)));
  meta.providerDrafts = providerChunks.reduce<ProviderDraft[]>(
    (acc, event) => upsertProviderDraft(acc, event.provider, event.content ?? ""),
    []
  );
  meta.raw = events;

  return meta;
}

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
  }
) {
  const response = await fetch("http://localhost:8000/api/chat/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok || !response.body) {
    throw new Error(`스트림 연결 실패 (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
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
}

export default function App() {
  const initialThreads = useMemo(() => loadInitialThreads(), []);
  const [threads, setThreads] = useState<Thread[]>(initialThreads);
  const [activeThreadId, setActiveThreadId] = useState<string>(() => {
    const saved = localStorage.getItem(STORAGE_ACTIVE_KEY);
    if (saved && initialThreads.some((thread) => thread.id === saved)) {
      return saved;
    }
    return initialThreads[0]?.id ?? createWelcomeThread().id;
  });

  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [showOps, setShowOps] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);
  const [opsError, setOpsError] = useState<string | null>(null);
  const [opsLoading, setOpsLoading] = useState(false);
  const [debugMeta, setDebugMeta] = useState<DebugMeta>(createDefaultDebugMeta());
  const [opsSnapshot, setOpsSnapshot] = useState<OpsSnapshot>({
    usage: null,
    scoreboard: null,
    dashboard: null
  });

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_THREADS_KEY, JSON.stringify(threads));
  }, [threads]);

  useEffect(() => {
    localStorage.setItem(STORAGE_ACTIVE_KEY, activeThreadId);
  }, [activeThreadId]);

  useEffect(() => {
    const exists = threads.some((thread) => thread.id === activeThreadId);
    if (!exists && threads.length > 0) {
      setActiveThreadId(threads[0].id);
    }
  }, [threads, activeThreadId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [threads, isSending]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadOps() {
      setOpsLoading(true);
      setOpsError(null);

      try {
        const [usage, scoreboard, dashboard] = await Promise.all([
          fetchUsageSummary(controller.signal),
          fetchScoreboard(controller.signal),
          fetchDashboard(controller.signal)
        ]);

        setOpsSnapshot({ usage, scoreboard, dashboard });
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "운영 패널 데이터를 불러오지 못했습니다.";
        setOpsError(message);
      } finally {
        if (!controller.signal.aborted) {
          setOpsLoading(false);
        }
      }
    }

    void loadOps();

    return () => controller.abort();
  }, []);

  const activeThread = useMemo(() => {
    const found = threads.find((thread) => thread.id === activeThreadId);
    return found ?? threads[0];
  }, [threads, activeThreadId]);

  const projectGroups = useMemo(() => buildProjectGroups(threads), [threads]);

  function updateActiveThread(mutator: (thread: Thread) => Thread) {
    setThreads((current) =>
      current.map((thread) => (thread.id === activeThreadId ? mutator(cloneThread(thread)) : thread))
    );
  }

  function handleNewThread() {
    const projectId = activeThread?.projectId ?? "ai-orchestra";
    const next = createWelcomeThread(projectId);

    setThreads((current) => [next, ...current]);
    setActiveThreadId(next.id);
    setLastError(null);
    setDraft("");
    setDebugMeta(createDefaultDebugMeta());
    queueMicrotask(() => textareaRef.current?.focus());
  }

  function handleNewThreadInProject(projectId: string) {
    const next = createWelcomeThread(projectId);

    setThreads((current) => [next, ...current]);
    setActiveThreadId(next.id);
    setLastError(null);
    setDraft("");
    setDebugMeta(createDefaultDebugMeta());
    queueMicrotask(() => textareaRef.current?.focus());
  }

  async function refreshOpsSnapshot() {
    try {
      const [usage, scoreboard, dashboard] = await Promise.all([
        fetchUsageSummary(),
        fetchScoreboard(),
        fetchDashboard()
      ]);

      setOpsSnapshot({ usage, scoreboard, dashboard });
      setOpsError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "운영 패널 갱신에 실패했습니다.";
      setOpsError(message);
    }
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text || !activeThread || isSending) return;

    const timestamp = nowIso();

    const userMessage: Message = {
      id: createId("msg"),
      role: "user",
      content: text,
      createdAt: timestamp,
      status: "done",
      requestMeta: null
    };

    const assistantPlaceholder: Message = {
      id: createId("msg"),
      role: "assistant",
      content: "",
      createdAt: nowIso(),
      status: "pending",
      requestMeta: null
    };

    const optimisticTitle = activeThread.title === "새 채팅" ? summarizeTitle(text) : activeThread.title;
    const liveEvents: StreamEvent[] = [];
    let liveMeta = createDefaultDebugMeta();
    let finalTextFromEvent = "";

    updateActiveThread((thread) => ({
      ...thread,
      title: optimisticTitle,
      updatedAt: timestamp,
      messages: [...thread.messages, userMessage, assistantPlaceholder]
    }));

    setDraft("");
    setIsSending(true);
    setLastError(null);
    setDebugMeta(createDefaultDebugMeta());

    try {
      await sendChatStream(
        {
          message: text,
          thread_id: activeThread.id,
          project_id: activeThread.projectId,
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

              updateActiveThread((thread) => ({
                ...thread,
                updatedAt: nowIso(),
                messages: thread.messages.map((message) =>
                  message.id === assistantPlaceholder.id
                    ? {
                        ...message,
                        content: currentWinnerDraft,
                        status: "pending",
                        requestMeta: liveMeta
                      }
                    : message
                )
              }));

              setDebugMeta(liveMeta);
              return;
            }

            if (event.type === "answer_chunk") {
              updateActiveThread((thread) => ({
                ...thread,
                updatedAt: nowIso(),
                messages: thread.messages.map((message) =>
                  message.id === assistantPlaceholder.id
                    ? {
                        ...message,
                        content: `${message.content}${event.content ?? ""}`,
                        status: "pending",
                        requestMeta: liveMeta
                      }
                    : message
                )
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
                  provider: event.provider ?? liveMeta.winnerProvider ?? null,
                  role: liveMeta.displayWinner?.role ?? null
                }
              };

              updateActiveThread((thread) => ({
                ...thread,
                updatedAt: nowIso(),
                messages: thread.messages.map((message) =>
                  message.id === assistantPlaceholder.id
                    ? {
                        ...message,
                        content: finalTextFromEvent || message.content,
                        status: "pending",
                        requestMeta: liveMeta
                      }
                    : message
                )
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

            const rawMeta = extractDebugMeta(payload);

            const meta = {
              ...rawMeta,
              providerDrafts: liveMeta.providerDrafts ?? [],
              displayWinner: rawMeta.display_winner ?? null,
              displayLosers: rawMeta.display_losers ?? [],
              hiddenFailedProviders: rawMeta.hidden_failed_providers ?? [],
              primaryRecovered: rawMeta.primary_recovered ?? false,
              recoveryFromModel: rawMeta.recovery_from_model ?? null,
              recoveryToModel: rawMeta.recovery_to_model ?? null,
              providerStatusMap: rawMeta.provider_status_map ?? {},
              providerStreamSummary: rawMeta.provider_stream_summary ?? {},
              timelineEvents: rawMeta.timeline_events ?? []
            };

            updateActiveThread((thread) => ({
              ...thread,
              updatedAt: nowIso(),
              messages: thread.messages.map((message) =>
                message.id === assistantPlaceholder.id
                  ? {
                      ...message,
                      content:
                        assistantText ||
                        message.content ||
                        "응답은 왔지만 표시 가능한 final_answer를 찾지 못했습니다.",
                      status: "done",
                      requestMeta: meta
                    }
                  : message
              )
            }));

            setDebugMeta(meta);
          }
        }
      );

      void refreshOpsSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";

      updateActiveThread((thread) => ({
        ...thread,
        updatedAt: nowIso(),
        messages: thread.messages.map((item) =>
          item.id === assistantPlaceholder.id
            ? {
                ...item,
                content: item.content ? `${item.content}\n\n오류: ${message}` : `오류: ${message}`,
                status: "error",
                requestMeta: liveMeta.providerDrafts?.length ? liveMeta : null
              }
            : item
        )
      }));

      setLastError(message);
    } finally {
      setIsSending(false);
      queueMicrotask(() => textareaRef.current?.focus());
    }
  }

  return (
    <AppShell
      sidebar={
        <Sidebar
          projects={projectGroups}
          activeThreadId={activeThreadId}
          onSelectThread={setActiveThreadId}
          onNewThread={handleNewThread}
          onNewThreadInProject={handleNewThreadInProject}
        />
      }
      topbar={
        <Topbar
          onNewThread={handleNewThread}
          onRefreshOps={() => void refreshOpsSnapshot()}
          onToggleOps={() => setShowOps((prev) => !prev)}
          showOps={showOps}
        />
      }
      statusBar={
        <RequestStatusBar
          debugMeta={debugMeta}
          recentSummary={opsSnapshot.dashboard?.stats}
        />
      }
      main={
        <ChatView
          activeThread={activeThread}
          isSending={isSending}
          lastError={lastError}
          draft={draft}
          onDraftChange={setDraft}
          onSend={() => void handleSend()}
          textareaRef={textareaRef}
          scrollRef={scrollRef}
        />
      }
      rightPanel={
        showOps ? (
          <OrchestrationPanel
            debugMeta={debugMeta}
            usage={opsSnapshot.usage}
            scoreboard={opsSnapshot.scoreboard}
            dashboard={opsSnapshot.dashboard}
            opsLoading={opsLoading}
            opsError={opsError}
          />
        ) : null
      }
    />
  );
}
