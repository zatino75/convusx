export type ChatRequest = {
  message: string;
  thread_id?: string;
  project_id?: string;
  mode?: string;
};

type AnyRecord = Record<string, any>;

export type ConflictTypeRecent = {
  numeric?: number;
  fact?: number;
  risk?: number;
  recommendation?: number;
  comparison?: number;
  implementation?: number;
  context?: number;
  other?: number;
};

export type UsageProviderNode = {
  provider?: string | null;
  task?: string | null;

  calls?: number;
  success?: number;
  failure?: number;
  total_latency_ms?: number;
  avg_latency_ms?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_tokens?: number;
  estimated_cost_usd?: number;
  last_model?: string | null;
  last_called_at?: string | null;

  uses?: number;
  wins?: number;
  task_uses?: number | null;
  task_wins?: number | null;

  recent_uses?: number;
  recent_wins?: number;
  task_recent_uses?: number | null;
  task_recent_wins?: number | null;

  win_rate?: number;
  blended_win_rate?: number;
  task_win_rate?: number | null;
  task_blended_win_rate?: number | null;
  effective_win_rate?: number | null;

  recent_win_rate?: number;
  task_recent_win_rate?: number | null;

  avg_latency?: number;
  avg_cost?: number;
  task_avg_latency?: number | null;
  task_avg_cost?: number | null;

  routing_score?: number;
  exploration_bonus?: number;
  freshness_bonus?: number;

  conflict_penalty_recent?: number;
  context_conflicts_recent?: number;
  provider_conflicts_recent?: number;
  conflict_penalty?: number;

  conflict_type_recent?: ConflictTypeRecent | null;
  type_penalty?: number | null;

  bandit_score?: number;
  routing_floor?: number;

  last_used_at?: number;
  last_conflict_at?: number;
};

export type UsageSummaryResponse = {
  ok: boolean;
  providers: UsageProviderNode[];
  task_routing_scores?: Record<string, UsageProviderNode[]>;
};

export type ScoreboardResponse = {
  ok: boolean;
  scoreboard: Record<string, any>;
  routing_scores?: UsageProviderNode[];
  task_routing_scores?: Record<string, UsageProviderNode[]>;
};

export type DashboardRecentBenchmark = {
  timestamp?: string;
  task?: string;
  primary_provider?: string | null;
  final_provider?: string | null;
  executed_providers?: string[];
  latency_ms?: number;
  estimated_cost_usd?: number;
  fallback_used?: boolean;
  judge_confidence?: number;
  conflict_count?: number;
};

export type DashboardResponse = {
  ok: boolean;
  stats: {
    total_requests: number;
    avg_latency_ms: number;
    avg_cost_usd: number;
    fallback_rate: number;
    avg_judge_confidence: number;
    avg_conflict_count: number;
  };
  by_task: Record<string, any>;
  scoreboard: Record<string, any>;
  bandit: UsageProviderNode[];
  task_bandit?: Record<string, UsageProviderNode[]>;
  recent: DashboardRecentBenchmark[];
};

export type ChatProviderUsage = {
  provider?: string | null;
  role?: string | null;
  success?: boolean;
  latency_ms?: number;
  error_code?: string | null;
  model?: string | null;
  usage?: {
    estimated_cost_usd?: number;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

export type ChatOrchestrationMeta = {
  primary_provider?: string | null;
  effective_primary_provider?: string | null;
  verifier_providers?: string[];
  optional_providers?: string[];
  scout_providers?: string[];
  selected_providers?: string[];
  fallback_providers?: string[];
  parallel_providers?: string[];
  executed_providers?: string[];
  selected_models?: Array<{
    provider?: string | null;
    model?: string | null;
  }>;
  latency_ms?: number;
  estimated_cost_usd?: number;
  raw_cost_usd?: number;
  fallback_used?: boolean;
  judge_confidence?: number;
  conflict_count?: number;
  conflict_buckets?: {
    total?: number;
    context_conflicts?: number;
    provider_conflicts?: number;
    high?: number;
    medium?: number;
    low?: number;
  };
  execution_policy?: {
    max_parallel?: number;
    cost_gate_enabled?: boolean;
    max_total_estimated_cost_usd?: number;
    prefer_fast_fallback?: boolean;
  };
  provider_usage?: ChatProviderUsage[];
  provider_status_map?: Record<string, any>;
  provider_stream_summary?: Record<string, any>;
  final_provider?: string | null;
  parallel_width?: number | null;
  router_policy?: string | null;
  winner_reason?: {
    provider?: string | null;
    role?: string | null;
    rationale?: string | null;
    confidence?: number;
    top_reasons?: string[];
    context_conflicts?: number;
    provider_conflicts?: number;
  };
  selection_trace?: {
    selected_provider?: string | null;
    selected_role?: string | null;
    judge_rationale?: string | null;
    judge_confidence?: number;
    selected_score?: number;
    selected_reasons?: string[];
    conflict_buckets?: {
      total?: number;
      context_conflicts?: number;
      provider_conflicts?: number;
      high?: number;
      medium?: number;
      low?: number;
    };
  };
  display_winner?: {
    provider?: string | null;
    role?: string | null;
  };
  display_losers?: string[];
  primary_recovered?: boolean;
  recovery_from_model?: string | null;
  recovery_to_model?: string | null;
};

export type ChatBanditMeta = {
  router_policy?: string | null;
  provider_bandit?: Record<string, {
    routing_score?: number;
    exploration_bonus?: number;
    freshness_bonus?: number;
    conflict_penalty_recent?: number;
    context_conflicts_recent?: number;
    provider_conflicts_recent?: number;
    conflict_type_recent?: ConflictTypeRecent | null;
    type_penalty?: number | null;
    bandit_score?: number;
  }>;
  selected_primary?: string | null;
  selected_verifier?: string | null;
};

export type ChatResponse = {
  ok: boolean;
  answer?: {
    provider?: string | null;
    role?: string | null;
    text?: string;
    ok?: boolean;
  };
  meta?: {
    orchestration?: ChatOrchestrationMeta;
  };
  orchestration?: ChatOrchestrationMeta;
  bandit?: ChatBanditMeta;
  derived?: AnyRecord;
  internal?: AnyRecord;
  result?: AnyRecord;
  error?: string;
};

export type DebugMeta = {
  winnerProvider: string | null;
  routerTask: string | null;
  selectedProviders: string[];
  verifierProviders: string[];
  executionStrategy: string | null;
  parallelWidth: number | null;
  conflictCount: number;
  judgeConfidence?: number | null;
  requestLatencyMs?: number | null;
  requestCostUsd?: number | null;
  displayWinner?: {
    provider?: string;
    role?: string;
  } | null;
  displayLosers?: string[];
  primaryRecovered?: boolean;
  recoveryFromModel?: string | null;
  recoveryToModel?: string | null;
  providerStatusMap?: Record<string, any>;
  providerStreamSummary?: Record<string, any>;
};

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? (value as Record<string, any>) : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? "")).filter(Boolean) : [];
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export function extractDebugMeta(response: ChatResponse | null | undefined): DebugMeta {
  const root = asRecord(response);
  const orchestration =
    asRecord(root.orchestration).final_provider !== undefined ||
    asRecord(root.orchestration).latency_ms !== undefined
      ? asRecord(root.orchestration)
      : asRecord(asRecord(root.meta).orchestration);

  const derived = asRecord(root.derived);
  const internal = asRecord(root.internal);
  const route = asRecord(internal.route);
  const winnerReason = asRecord(orchestration.winner_reason);
  const displayWinner = asRecord(orchestration.display_winner);

  const selectedProviders = asStringArray(orchestration.selected_providers).length > 0
    ? asStringArray(orchestration.selected_providers)
    : asStringArray(route.selected_providers);

  const verifierProviders = asStringArray(orchestration.verifier_providers).length > 0
    ? asStringArray(orchestration.verifier_providers)
    : asStringArray(route.verifier_providers);

  return {
    winnerProvider:
      String(
        displayWinner.provider ??
        winnerReason.provider ??
        orchestration.final_provider ??
        derived.winner ??
        response?.answer?.provider ??
        ""
      ).trim() || null,

    routerTask:
      String(
        internal.task ??
        derived.detected_task ??
        route.task ??
        ""
      ).trim() || null,

    selectedProviders,
    verifierProviders,

    executionStrategy:
      String(
        derived.execution_strategy ??
        route.execution_strategy ??
        ""
      ).trim() || null,

    parallelWidth:
      Number.isFinite(Number(orchestration.parallel_width))
        ? Number(orchestration.parallel_width)
        : Number.isFinite(Number(route.parallel_width))
          ? Number(route.parallel_width)
          : Array.isArray(orchestration.parallel_providers)
            ? orchestration.parallel_providers.length
            : null,

    conflictCount: Number(
      orchestration.conflict_count ??
      internal.conflict_count ??
      derived.conflict_count ??
      0
    ),

    judgeConfidence:
      Number.isFinite(Number(orchestration.judge_confidence))
        ? Number(orchestration.judge_confidence)
        : Number.isFinite(Number(internal?.judge?.confidence))
          ? Number(internal.judge.confidence)
          : null,

    requestLatencyMs:
      Number.isFinite(Number(orchestration.latency_ms))
        ? Number(orchestration.latency_ms)
        : null,

    requestCostUsd:
      Number.isFinite(Number(orchestration.estimated_cost_usd))
        ? Number(orchestration.estimated_cost_usd)
        : null,

    displayWinner:
      displayWinner.provider || displayWinner.role
        ? {
            provider: displayWinner.provider ? String(displayWinner.provider) : undefined,
            role: displayWinner.role ? String(displayWinner.role) : undefined
          }
        : null,

    displayLosers: asStringArray(orchestration.display_losers),

    primaryRecovered: Boolean(orchestration.primary_recovered),
    recoveryFromModel:
      String(orchestration.recovery_from_model ?? "").trim() || null,
    recoveryToModel:
      String(orchestration.recovery_to_model ?? "").trim() || null,

    providerStatusMap: asRecord(orchestration.provider_status_map),
    providerStreamSummary: asRecord(orchestration.provider_stream_summary)
  };
}

export async function sendChat(input: ChatRequest): Promise<ChatResponse> {
  const response = await fetch("http://localhost:8000/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  const payload = await safeJson(response);

  if (!response.ok) {
    return {
      ok: false,
      error: String((payload as any)?.error ?? "request_failed")
    };
  }

  return payload as ChatResponse;
}

export async function fetchUsageSummary(): Promise<UsageSummaryResponse> {
  const response = await fetch("http://localhost:8000/api/usage");
  const payload = await safeJson(response);
  return payload as UsageSummaryResponse;
}

export async function fetchScoreboard(): Promise<ScoreboardResponse> {
  const response = await fetch("http://localhost:8000/api/scoreboard");
  const payload = await safeJson(response);
  return payload as ScoreboardResponse;
}

export async function fetchDashboard(): Promise<DashboardResponse> {
  const response = await fetch("http://localhost:8000/api/dashboard");
  const payload = await safeJson(response);
  return payload as DashboardResponse;
}
