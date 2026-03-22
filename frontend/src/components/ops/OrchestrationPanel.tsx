import type { DashboardResponse, ScoreboardResponse, UsageSummaryResponse } from "../../api/chat";
import RecentBenchmarkCard from "./RecentBenchmarkCard";
import ScoreboardCard from "./ScoreboardCard";
import UsageSummaryCard from "./UsageSummaryCard";

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
    provider?: string;
    success?: boolean;
    latency_ms?: number;
    model?: string | null;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
      estimated_cost_usd?: number;
    };
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
  banditScores?: Record<
    string,
    {
      routing_score?: number;
      exploration_bonus?: number;
      freshness_bonus?: number;
      bandit_score?: number;
    }
  >;
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

type Props = {
  debugMeta: DebugMeta;
  usage: UsageSummaryResponse | null;
  scoreboard: ScoreboardResponse | null;
  dashboard: DashboardResponse | null;
  opsLoading: boolean;
  opsError: string | null;
};

function formatNumber(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString("ko-KR");
}

function formatUsd(value: number | null | undefined) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number <= 0) return "$0";
  if (number < 0.01) return `$${number.toFixed(4)}`;
  return `$${number.toFixed(2)}`;
}

function formatLatencyMs(value: number | null | undefined) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number <= 0) return "-";
  if (number < 1000) return `${Math.round(number)}ms`;
  return `${(number / 1000).toFixed(1)}s`;
}

function formatScore(value: number | null | undefined) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "-";
  return number.toFixed(2);
}

function providerLabel(provider: string | null | undefined) {
  const normalized = String(provider ?? "").trim().toLowerCase();
  if (!normalized) return "-";
  if (normalized === "openai") return "OpenAI";
  if (normalized === "claude") return "Claude";
  if (normalized === "gemini") return "Gemini";
  if (normalized === "perplexity") return "Perplexity";
  return normalized;
}

function Card({
  title,
  children,
  subtle
}: {
  title: string;
  children: React.ReactNode;
  subtle?: boolean;
}) {
  return (
    <section
      className={[
        "rounded-2xl border p-4",
        subtle ? "border-white/8 bg-[#1d1d1d]" : "border-white/10 bg-[#212121]"
      ].join(" ")}
    >
      <div className="mb-3 text-[11px] uppercase tracking-[0.16em] text-[#8e8ea0]">{title}</div>
      {children}
    </section>
  );
}

function StatTile({
  label,
  value,
  accent
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#1b1b1b] px-4 py-3">
      <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-[#8e8ea0]">{label}</div>
      <div className={["text-sm font-medium text-white", accent ?? ""].join(" ")}>{value}</div>
    </div>
  );
}

function chip(text: string, accent?: string) {
  return (
    <span
      className={[
        "inline-flex rounded-full border px-2.5 py-1 text-[11px]",
        accent ? accent : "border-white/10 bg-white/[0.04] text-[#d7d7d7]"
      ].join(" ")}
    >
      {text}
    </span>
  );
}

function buildBanditRows(debugMeta: DebugMeta) {
  const scores = debugMeta.banditScores ?? {};
  return Object.entries(scores)
    .map(([provider, row]) => ({
      provider,
      routing_score: Number(row?.routing_score ?? 0),
      exploration_bonus: Number(row?.exploration_bonus ?? 0),
      freshness_bonus: Number(row?.freshness_bonus ?? 0),
      bandit_score: Number(row?.bandit_score ?? 0)
    }))
    .sort((a, b) => b.bandit_score - a.bandit_score);
}

export default function OrchestrationPanel({
  debugMeta,
  usage,
  scoreboard,
  dashboard,
  opsLoading,
  opsError
}: Props) {
  const primaryProvider = debugMeta.selectedProviders?.[0] ?? null;
  const verifierProvider = debugMeta.verifierProviders?.[0] ?? null;
  const banditRows = buildBanditRows(debugMeta);
  const displayWinner = debugMeta.displayWinner?.provider ?? debugMeta.winnerProvider ?? null;
  const displayWinnerRole = debugMeta.displayWinner?.role ?? null;
  const displayLosers = Array.isArray(debugMeta.displayLosers) ? debugMeta.displayLosers : [];
  const providerStatusRows = Object.entries(debugMeta.providerStatusMap ?? {});
  const failedRows = providerStatusRows.filter(([, row]) => row?.status === "failed");
  const providerStreamRows = Object.values(debugMeta.providerStreamSummary ?? {}) as Array<{
    provider?: string;
    role?: string | null;
    chunk_count?: number;
    last_preview?: string;
  }>;

  return (
    <aside className="hidden h-full w-[380px] shrink-0 border-l border-white/10 bg-[#171717] xl:flex xl:flex-col">
      <div className="border-b border-white/10 px-4 py-4">
        <div className="text-sm font-semibold text-white">Orchestration Insight</div>
        <div className="mt-1 text-xs text-[#8e8ea0]">
          routing · verifier · usage · bandit · benchmark 상태 패널
        </div>
      </div>

      <div className="space-y-4 overflow-y-auto p-4 text-sm">
        {opsError ? (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
            {opsError}
          </div>
        ) : null}

        {opsLoading ? (
          <div className="rounded-2xl border border-white/10 bg-[#1d1d1d] px-4 py-3 text-xs text-[#b4b4b4]">
            운영 데이터 로딩 중...
          </div>
        ) : null}

        <Card title="Current decision">
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="winner" value={providerLabel(displayWinner)} accent="text-emerald-300" />
            <StatTile label="winner_role" value={displayWinnerRole ?? "-"} />
            <StatTile label="primary" value={providerLabel(primaryProvider)} />
            <StatTile label="verifier" value={providerLabel(verifierProvider)} />
            <StatTile label="task" value={debugMeta.routerTask ?? "-"} />
            <StatTile label="strategy" value={debugMeta.executionStrategy ?? "-"} />
            <StatTile label="latency" value={formatLatencyMs(debugMeta.requestLatencyMs)} />
            <StatTile label="cost" value={formatUsd(debugMeta.requestCostUsd)} />
            <StatTile
              label="confidence"
              value={formatScore(debugMeta.judgeConfidence)}
              accent="text-emerald-300"
            />
            <StatTile
              label="conflicts"
              value={String(debugMeta.conflictCount ?? 0)}
              accent={(debugMeta.conflictCount ?? 0) > 0 ? "text-amber-300" : "text-white"}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {chip(
              debugMeta.selectedByFreshness ? "최근 성과 반영" : "기본 점수 기반",
              debugMeta.selectedByFreshness
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                : undefined
            )}
            {chip(
              debugMeta.fallbackUsed ? "Fallback 사용" : "Primary 유지",
              debugMeta.fallbackUsed
                ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
                : undefined
            )}
            {chip(`Parallel ${debugMeta.parallelWidth ?? "-"}`)}
            {chip(`Claims ${debugMeta.claimCount ?? 0}`)}
            {debugMeta.primaryRecovered ? chip(`Recovered ${debugMeta.recoveryFromModel ?? "-"} → ${debugMeta.recoveryToModel ?? "-"}`, "border-amber-500/20 bg-amber-500/10 text-amber-300") : null}
          </div>
        </Card>

        <Card title="Provider chain" subtle>
          <div className="text-sm text-white">
            {debugMeta.providerChain.length > 0
              ? debugMeta.providerChain.map(providerLabel).join(" → ")
              : "-"}
          </div>

          <div className="mt-3 space-y-2 text-xs text-[#a8a8b3]">
            <div>selected: {debugMeta.selectedProviders.length > 0 ? debugMeta.selectedProviders.map(providerLabel).join(", ") : "-"}</div>
            <div>verifier: {debugMeta.verifierProviders.length > 0 ? debugMeta.verifierProviders.map(providerLabel).join(", ") : "-"}</div>
            <div>losers: {displayLosers.length > 0 ? displayLosers.map(providerLabel).join(", ") : "-"}</div>
            <div>override: {debugMeta.selectionOverrideReason ?? "-"}</div>
            <div>risk: {debugMeta.conflictRisk ?? "-"}</div>
          </div>
        </Card>

        <Card title="Selected models" subtle>
          {Array.isArray(debugMeta.selectedModels) && debugMeta.selectedModels.length > 0 ? (
            <div className="space-y-2">
              {debugMeta.selectedModels.map((row, index) => (
                <div
                  key={`${row.provider ?? "unknown"}_${row.model ?? "unknown"}_${index}`}
                  className="rounded-xl border border-white/10 bg-[#1b1b1b] px-3 py-3"
                >
                  <div className="text-sm text-white">{providerLabel(row.provider)}</div>
                  <div className="mt-1 text-xs text-[#8e8ea0]">{row.model ?? "-"}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-[#8e8ea0]">선택된 모델 정보가 없습니다.</div>
          )}
        </Card>

        <Card title="Request usage">
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="input_tokens" value={formatNumber(debugMeta.usageTotals?.input_tokens)} />
            <StatTile label="output_tokens" value={formatNumber(debugMeta.usageTotals?.output_tokens)} />
            <StatTile label="total_tokens" value={formatNumber(debugMeta.usageTotals?.total_tokens)} />
            <StatTile label="estimated_cost" value={formatUsd(debugMeta.usageTotals?.estimated_cost_usd)} />
          </div>
        </Card>

        <Card title="Provider usage">
          <div className="space-y-3">
            {(debugMeta.usageProviders ?? []).length > 0 ? (
              (debugMeta.usageProviders ?? []).map((row, index) => (
                <div
                  key={`${row.provider ?? "unknown"}_${index}`}
                  className="rounded-xl border border-white/10 bg-[#1b1b1b] px-3 py-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-white">{providerLabel(row.provider)}</div>
                    <div className={row.success ? "text-xs text-emerald-300" : "text-xs text-red-300"}>
                      {row.success ? "success" : "failed"}
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[#a8a8b3]">
                    <div>latency: {formatLatencyMs(row.latency_ms)}</div>
                    <div>model: {row.model ?? "-"}</div>
                    <div>tokens: {formatNumber(row.usage?.total_tokens)}</div>
                    <div>cost: {formatUsd(row.usage?.estimated_cost_usd)}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-xs text-[#8e8ea0]">아직 실행 데이터가 없습니다.</div>
            )}
          </div>
        </Card>

        <Card title="Live stream summary" subtle>
          {providerStreamRows.length > 0 ? (
            <div className="space-y-2">
              {providerStreamRows.map((row, index) => (
                <div
                  key={`${row.provider ?? "unknown"}_${index}`}
                  className="rounded-xl border border-white/10 bg-[#1b1b1b] px-3 py-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-white">{providerLabel(row.provider)}</div>
                    <div className="text-xs text-[#8e8ea0]">{row.role ?? "-"}</div>
                  </div>
                  <div className="mt-2 text-xs text-[#a8a8b3]">chunks: {formatNumber(row.chunk_count)}</div>
                  <div className="mt-2 whitespace-pre-wrap break-words text-xs text-[#d7d7d7]">
                    {row.last_preview || "-"}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-[#8e8ea0]">실시간 draft 요약이 없습니다.</div>
          )}
        </Card>

        <Card title="Failed providers" subtle>
          {failedRows.length > 0 ? (
            <div className="space-y-2">
              {failedRows.map(([provider, row]) => (
                <div
                  key={provider}
                  className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-white">{providerLabel(provider)}</div>
                    <div className="text-xs text-red-300">{row?.error_code ?? "failed"}</div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[#f0c5c5]">
                    <div>role: {row?.role ?? "-"}</div>
                    <div>model: {row?.model ?? "-"}</div>
                    <div>latency: {formatLatencyMs(row?.latency_ms)}</div>
                    <div>cost: {formatUsd(row?.estimated_cost_usd)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-[#8e8ea0]">실패 provider가 없습니다.</div>
          )}
        </Card>

        <Card title="Bandit scores">
          {banditRows.length > 0 ? (
            <div className="space-y-3">
              {banditRows.map((row) => (
                <div
                  key={row.provider}
                  className="rounded-xl border border-white/10 bg-[#1b1b1b] px-3 py-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-white">{providerLabel(row.provider)}</div>
                    <div className="text-xs text-emerald-300">{row.bandit_score.toFixed(2)}</div>
                  </div>

                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-emerald-400"
                      style={{ width: `${Math.max(6, Math.min(100, row.bandit_score * 100))}%` }}
                    />
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-[#8e8ea0]">
                    <div>routing {row.routing_score.toFixed(2)}</div>
                    <div>explore {row.exploration_bonus.toFixed(2)}</div>
                    <div>fresh {row.freshness_bonus.toFixed(2)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-[#8e8ea0]">bandit 점수 정보가 없습니다.</div>
          )}
        </Card>

        <UsageSummaryCard usage={usage} />
        <ScoreboardCard scoreboard={scoreboard} />
        <RecentBenchmarkCard dashboard={dashboard} />
      </div>
    </aside>
  );
}
