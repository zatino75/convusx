export type ChatRequest = {
  message: string;
  thread_id?: string;
  project_id?: string;
  mode?: string;
};

type AnyRecord = Record<string, any>;

export type UsageProviderNode = {
  provider?: string | null;
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
  recent_uses?: number;
  recent_wins?: number;
  win_rate?: number;
  recent_win_rate?: number;
  avg_latency?: number;
  avg_cost?: number;
  routing_score?: number;
  exploration_bonus?: number;
  freshness_bonus?: number;
  bandit_score?: number;
  last_used_at?: number;
};

export type UsageSummaryResponse = {
  ok: boolean;
  providers: UsageProviderNode[];
};

export type ScoreboardResponse = {
  ok: boolean;
  scoreboard: Record<string, any>;
  routing_scores?: UsageProviderNode[];
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
  recent: DashboardRecentBenchmark[];
};

export type ChatProviderUsage = {
  provider?: string | null;
  success?: boolean;
  latency_ms?: number;
  error_code?: string | null;
  model?: string | null;
  usage?: {
    estimated_cost_usd?: number;
  };
};

export type ChatOrchestrationMeta = {
  primary_provider?: string | null;
  verifier_providers?: string[];
  optional_providers?: string[];
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
  fallback_used?: boolean;
  judge_confidence?: number;
  conflict_count?: number;
  execution_policy?: {
    max_parallel?: number;
    cost_gate_enabled?: boolean;
    max_total_estimated_cost_usd?: number;
    prefer_fast_fallback?: boolean;
  };
  provider_usage?: ChatProviderUsage[];
  final_provider?: string | null;
};

export type ChatBanditMeta = {
  router_policy?: string | null;
  provider_bandit?: Record<string, {
    routing_score?: number;
    exploration_bonus?: number;
    freshness_bonus?: number;
    bandit_score?: number;
  }>;
  selected_primary?: string | null;
  selected_verifier?: string | null;
};

export type ChatDerivedMeta = {
  detected_task?: string | null;
  execution_strategy?: string | null;
  selected_providers?: string[];
  verifier_providers?: string[];
  fallback_providers?: string[];
  parallel_providers?: string[];
  winner?: string | null;
  runner_up?: string | null;
  conflict_count?: number;
  executed_provider_count?: number;
  latency_ms?: number;
  estimated_cost_usd?: number;
  fallback_used?: boolean;
  judge_confidence?: number;
};

export type ChatResponse = {
  ok: boolean;
  answer?: {
    provider?: string | null;
    text?: string;
    ok?: boolean;
  };
  meta?: {
    orchestration?: ChatOrchestrationMeta | null;
  };
  orchestration?: ChatOrchestrationMeta | null;
  bandit?: ChatBanditMeta | null;
  derived?: ChatDerivedMeta;
  internal?: AnyRecord;
  result?: AnyRecord;
  error?: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let json: AnyRecord | null = null;

  try {
    json = text ? (JSON.parse(text) as AnyRecord) : {};
  } catch {
    json = { rawText: text };
  }

  if (!response.ok) {
    const detail =
      json?.error ??
      json?.message ??
      json?.detail ??
      text ??
      `HTTP ${response.status}`;

    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }

  return (json ?? {}) as T;
}

export async function sendChat(input: ChatRequest) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      mode: input.mode ?? "runtime_orchestra",
      message: input.message,
      prompt: input.message,
      input: input.message,
      query: input.message,
      thread_id: input.thread_id,
      project_id: input.project_id
    })
  });

  return readJson<ChatResponse>(response);
}

export async function fetchUsageSummary(signal?: AbortSignal) {
  const response = await fetch("/api/usage", {
    method: "GET",
    signal
  });

  return readJson<UsageSummaryResponse>(response);
}

export async function fetchScoreboard(signal?: AbortSignal) {
  const response = await fetch("/api/scoreboard", {
    method: "GET",
    signal
  });

  return readJson<ScoreboardResponse>(response);
}

export async function fetchDashboard(signal?: AbortSignal) {
  const response = await fetch("/api/dashboard", {
    method: "GET",
    signal
  });

  return readJson<DashboardResponse>(response);
}

function pickFirstString(candidates: unknown[]): string {
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        if (typeof item === "string") {
          return [item];
        }

        if (item && typeof item === "object") {
          const record = item as AnyRecord;
          return [record.provider, record.name, record.model].filter(
            (entry): entry is string => typeof entry === "string" && !!entry
          );
        }

        return [];
      })
      .filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[\s,>/-]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

function requestLatencyFromUsageRows(rows: Array<AnyRecord>) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const values = rows
    .map((row) => Number(row?.latency_ms ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (values.length === 0) return null;
  return Math.max(...values);
}

export function extractAssistantText(payload: AnyRecord): string {
  const result = payload?.result ?? {};
  const answer = payload?.answer ?? result?.final_answer ?? payload?.final_answer ?? {};
  const finalAnswer = result?.final_answer ?? payload?.final_answer ?? answer ?? {};

  const bestText = pickFirstString([
    answer?.text,
    answer?.answer_text,
    finalAnswer?.text,
    finalAnswer?.answer_text,
    finalAnswer?.content,
    finalAnswer?.summary,
    result?.final?.answer_text,
    result?.answer,
    result?.content,
    result?.text,
    payload?.text,
    payload?.message,
    payload?.rawText
  ]);

  if (bestText) {
    return bestText;
  }

  if (typeof answer === "string" && answer.trim()) {
    return answer.trim();
  }

  const serialized = safeJsonStringify(answer);
  if (serialized) {
    return serialized;
  }

  return "";
}

export function extractDebugMeta(payload: AnyRecord) {
  const result = payload?.result ?? {};
  const internal = payload?.internal ?? result?.internal_rationale ?? {};
  const route = internal?.route ?? result?.route ?? {};
  const judge = internal?.judge ?? {};
  const claims = Array.isArray(internal?.claims) ? internal.claims : [];
  const conflicts = Array.isArray(internal?.conflicts) ? internal.conflicts : [];
  const derived = payload?.derived ?? {};
  const orchestration = payload?.orchestration ?? payload?.meta?.orchestration ?? {};
  const bandit = payload?.bandit ?? internal?.bandit ?? {};
  const providerUsage = Array.isArray(orchestration?.provider_usage) ? orchestration.provider_usage : [];

  const providerChain = Array.from(
    new Set(
      [
        ...toArray(derived?.provider_chain),
        ...toArray(route?.provider_chain),
        ...toArray(route?.selected_providers),
        ...toArray(route?.verifier_providers),
        ...toArray(orchestration?.executed_providers),
        ...toArray(internal?.executed_providers),
        ...toArray(result?.executed_providers)
      ].filter(Boolean)
    )
  );

  const winnerProvider =
    pickFirstString([
      payload?.answer?.provider,
      orchestration?.final_provider,
      result?.final_answer?.provider,
      judge?.selected_provider,
      derived?.winner
    ]) || null;

  const scoreRows = Array.isArray(judge?.scores) ? judge.scores : [];
  const topScore = scoreRows.length > 0 && typeof scoreRows[0]?.score === "number" ? scoreRows[0].score : null;
  const secondScore = scoreRows.length > 1 && typeof scoreRows[1]?.score === "number" ? scoreRows[1].score : null;

  const conflictTypes = conflicts
    .map((conflict: AnyRecord) => String(conflict?.type ?? "").trim())
    .filter(Boolean);

  const selectedProviders = Array.isArray(route?.selected_providers)
    ? route.selected_providers.map((provider: unknown) => String(provider ?? "").trim()).filter(Boolean)
    : [];

  const verifierProviders = Array.isArray(route?.verifier_providers)
    ? route.verifier_providers.map((provider: unknown) => String(provider ?? "").trim()).filter(Boolean)
    : [];

  const usageTotals = {
    estimated_cost_usd: Number(orchestration?.estimated_cost_usd ?? 0)
  };

  return {
    providerChain,
    winnerProvider,
    qualityScoreGain:
      topScore !== null && secondScore !== null ? Number((topScore - secondScore).toFixed(2)) : null,
    orchestraWins: null,
    singleModelWins: null,
    ties: null,
    routerTask: route?.task ?? derived?.detected_task ?? null,
    selectedProviders,
    verifierProviders,
    executionStrategy: route?.execution_strategy ?? derived?.execution_strategy ?? null,
    parallelWidth:
      typeof route?.parallel_width === "number"
        ? route.parallel_width
        : providerChain.length > 0
          ? providerChain.length
          : null,
    conflictRisk: route?.conflict_risk ?? null,
    claimCount: claims.reduce((sum: number, item: AnyRecord) => {
      const innerClaims = Array.isArray(item?.claims) ? item.claims.length : 0;
      return sum + (innerClaims > 0 ? innerClaims : 1);
    }, 0),
    conflictCount:
      typeof derived?.conflict_count === "number"
        ? derived.conflict_count
        : Number(orchestration?.conflict_count ?? conflicts.length),
    conflictTypes,
    scoreboard: {
      judge_scores: scoreRows,
      usage_totals: usageTotals
    },
    raw: {
      derived,
      route,
      judge,
      claims,
      conflicts,
      orchestration,
      bandit
    },
    selectedByFreshness: Boolean(route?.routing_reason?.selected_by_freshness),
    selectionOverrideReason:
      typeof route?.routing_reason?.selection_override_reason === "string"
        ? route.routing_reason.selection_override_reason
        : null,
    runnerUpProvider: typeof derived?.runner_up === "string" ? derived.runner_up : null,
    usageProviders: providerUsage,
    usageTotals,
    requestLatencyMs:
      typeof orchestration?.latency_ms === "number"
        ? orchestration.latency_ms
        : requestLatencyFromUsageRows(providerUsage),
    requestTotalTokens: 0,
    requestCostUsd: Number(orchestration?.estimated_cost_usd ?? 0),
    fallbackUsed: Boolean(orchestration?.fallback_used),
    judgeConfidence: Number(orchestration?.judge_confidence ?? judge?.confidence ?? 0),
    selectedModels: Array.isArray(orchestration?.selected_models) ? orchestration.selected_models : [],
    banditScores: bandit?.provider_bandit ?? {}
  };
}

export function extractUIState(payload: ChatResponse) {
  const answer = payload?.answer ?? {};
  const orchestration = payload?.orchestration ?? payload?.meta?.orchestration ?? {};
  const bandit = payload?.bandit ?? {};
  const derived = payload?.derived ?? {};

  return {
    text: String(answer?.text ?? ""),
    provider: answer?.provider ?? orchestration?.final_provider ?? null,
    latency: Number(orchestration?.latency_ms ?? derived?.latency_ms ?? 0),
    cost: Number(orchestration?.estimated_cost_usd ?? derived?.estimated_cost_usd ?? 0),
    fallback: Boolean(orchestration?.fallback_used ?? derived?.fallback_used),
    confidence: Number(orchestration?.judge_confidence ?? derived?.judge_confidence ?? 0),
    selected: Array.isArray(derived?.selected_providers) ? derived.selected_providers : [],
    verifier: Array.isArray(derived?.verifier_providers) ? derived.verifier_providers : [],
    selectedModels: Array.isArray(orchestration?.selected_models) ? orchestration.selected_models : [],
    executedProviders: Array.isArray(orchestration?.executed_providers) ? orchestration.executed_providers : [],
    banditScores: bandit?.provider_bandit ?? {},
    finalProvider: derived?.winner ?? orchestration?.final_provider ?? null
  };
}
