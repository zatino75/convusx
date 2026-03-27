export type Role = "user" | "assistant";
export type MainViewMode = "home" | "thread-chat";
export type WorkspaceKind = "general" | "project";
export type MessageStatus = "pending" | "done" | "error";

export type ProviderDraft = {
  provider: string;
  content: string;
};

export type ThreadMeta = {
  labels?: string[];
  pinned?: boolean;
  archived?: boolean;
  sourceThreadIds?: string[];
  lastSummary?: string | null;
};

export type ProjectMeta = {
  description?: string | null;
  tags?: string[];
  memoryEnabled?: boolean;
};

/* 🔥 핵심 확장 */
export type Message = {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
  status?: MessageStatus;
  requestMeta?: any;

  // NEW
  versionGroupId?: string;     // 같은 질문 묶음
  versionIndex?: number;       // 0,1,2...
  isHidden?: boolean;          // 이전 답변 숨김 처리
};

export type Project = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  meta?: ProjectMeta;
};

/* 🔥 핵심 확장 */
export type Thread = {
  id: string;
  title: string;
  projectId: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  meta?: ThreadMeta;

  // NEW
  messageVersions?: {
    [groupId: string]: Message[]; // 버전 묶음
  };

  activeVersionIndex?: {
    [groupId: string]: number; // 현재 선택된 버전
  };
};

export type ProjectGroup = {
  id: string;
  title: string;
  threadCount: number;
  updatedAt: string;
  threads: Thread[];
  meta?: ProjectMeta;
};

export type DebugMeta = {
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
  usageProviders?: Array<{
    provider?: string;
    success?: boolean;
    latency_ms?: number;
    model?: string | null;
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
    provider?: string;
    model?: string;
  }>;
  banditScores?: Record<string, unknown>;
  providerDrafts?: ProviderDraft[];
  displayWinner?: {
    provider?: string;
    role?: string;
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

export type WorkspaceSnapshot = {
  projects: Project[];
  threads: Thread[];
  activeProjectId: string;
  activeThreadId: string | null;
};

export type StreamStartEvent = {
  type: "start";
  thread_id?: string;
  project_id?: string;
};

export type StreamAnswerChunkEvent = {
  type: "answer_chunk";
  content?: string;
};

export type StreamProviderChunkEvent = {
  type: "provider_chunk";
  provider: string;
  content?: string;
};

export type StreamProviderEvent = {
  type: "provider";
  stage: "start" | "done";
  provider: string;
  model?: string | null;
  ok?: boolean;
  latency_ms?: number;
  error_code?: string | null;
};

export type StreamJudgeEvent = {
  type: "judge";
  stage: "start" | "done";
  selected_provider?: string | null;
  confidence?: number;
  conflict_count?: number;
};

export type StreamOrchestrationEvent = {
  type: "orchestration";
  stage:
    | "task_detected"
    | "route_resolved"
    | "fallback_started"
    | "post_eval_pro_started"
    | "final_selected";
  task?: string;
  route?: any;
  selected_provider?: string | null;
  judge_confidence?: number;
  conflict_count?: number;
};

export type StreamFinalEvent = {
  type: "final";
  provider?: string | null;
  content?: string;
};

export type StreamDoneEvent = {
  type: "done";
  payload: any;
};

export type StreamErrorEvent = {
  type: "error";
  error?: string;
};

export type StreamEvent =
  | StreamStartEvent
  | StreamAnswerChunkEvent
  | StreamProviderChunkEvent
  | StreamProviderEvent
  | StreamJudgeEvent
  | StreamOrchestrationEvent
  | StreamFinalEvent
  | StreamDoneEvent
  | StreamErrorEvent;
