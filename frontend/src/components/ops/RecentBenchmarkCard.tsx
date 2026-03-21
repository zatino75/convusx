import type { DashboardResponse } from "../../api/chat";

type Props = {
  dashboard: DashboardResponse | null;
};

function formatNumber(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString("ko-KR");
}

function formatLatencyMs(value: number | null | undefined) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number <= 0) return "-";
  if (number < 1000) return `${Math.round(number)}ms`;
  return `${(number / 1000).toFixed(1)}s`;
}

function formatUsd(value: number | null | undefined) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number <= 0) return "$0";
  if (number < 0.01) return `$${number.toFixed(4)}`;
  return `$${number.toFixed(2)}`;
}

function formatScore(value: number | null | undefined) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number <= 0) return "-";
  return number.toFixed(2);
}

function formatDate(iso?: string | null) {
  const value = String(iso ?? "").trim();
  if (!value) return "-";

  try {
    return new Date(value).toLocaleString("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return value;
  }
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

export default function RecentBenchmarkCard({ dashboard }: Props) {
  const stats = dashboard?.stats ?? null;
  const recent = Array.isArray(dashboard?.recent) ? dashboard.recent : [];

  return (
    <>
      <section className="rounded-2xl border border-white/10 bg-[#212121] p-4">
        <div className="mb-3 text-[11px] uppercase tracking-[0.16em] text-[#8e8ea0]">Recent benchmark summary</div>

        <div className="grid grid-cols-2 gap-3">
          <StatTile label="requests" value={formatNumber(stats?.total_requests)} />
          <StatTile label="avg_latency" value={formatLatencyMs(stats?.avg_latency_ms)} />
          <StatTile label="avg_cost" value={formatUsd(stats?.avg_cost_usd)} />
          <StatTile label="fallback_rate" value={formatScore(stats?.fallback_rate)} />
          <StatTile label="avg_confidence" value={formatScore(stats?.avg_judge_confidence)} accent="text-emerald-300" />
          <StatTile label="avg_conflicts" value={formatScore(stats?.avg_conflict_count)} />
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#212121] p-4">
        <div className="mb-3 text-[11px] uppercase tracking-[0.16em] text-[#8e8ea0]">Recent benchmark log</div>

        <div className="space-y-3">
          {recent.length > 0 ? (
            recent.slice(0, 6).map((item, index) => (
              <div
                key={`${item.timestamp ?? "row"}_${index}`}
                className="rounded-xl border border-white/10 bg-[#1b1b1b] px-3 py-3"
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm text-white">{item.task ?? "unknown"}</div>
                  <div className="text-xs text-[#8e8ea0]">{formatDate(item.timestamp)}</div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {chip(`Primary ${providerLabel(item.primary_provider)}`)}
                  {chip(`Final ${providerLabel(item.final_provider)}`)}
                  {chip(`Latency ${formatLatencyMs(item.latency_ms)}`)}
                  {chip(`Cost ${formatUsd(item.estimated_cost_usd)}`)}
                  {chip(
                    item.fallback_used ? "Fallback 사용" : "Primary 유지",
                    item.fallback_used ? "border-amber-500/20 bg-amber-500/10 text-amber-300" : undefined
                  )}
                  {chip(`Conf ${formatScore(item.judge_confidence)}`)}
                  {chip(`Conflict ${formatNumber(item.conflict_count)}`)}
                </div>

                <div className="mt-2 text-xs text-[#8e8ea0]">
                  executed: {Array.isArray(item.executed_providers) && item.executed_providers.length > 0
                    ? item.executed_providers.map(providerLabel).join(", ")
                    : "-"}
                </div>
              </div>
            ))
          ) : (
            <div className="text-xs text-[#8e8ea0]">recent benchmark 데이터가 없습니다.</div>
          )}
        </div>
      </section>
    </>
  );
}
