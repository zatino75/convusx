import type { UsageSummaryResponse } from "../../api/chat";

type Props = {
  usage: UsageSummaryResponse | null;
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

export default function UsageSummaryCard({ usage }: Props) {
  const providers = Array.isArray(usage?.providers) ? usage.providers : [];
  const topRows = providers.slice(0, 4);

  const totalUses = providers.reduce((sum, row) => sum + Number(row?.uses ?? 0), 0);
  const totalWins = providers.reduce((sum, row) => sum + Number(row?.wins ?? 0), 0);
  const avgLatency =
    providers.reduce((sum, row) => sum + Number(row?.avg_latency ?? 0), 0) / (providers.length || 1);
  const avgCost =
    providers.reduce((sum, row) => sum + Number(row?.avg_cost ?? 0), 0) / (providers.length || 1);

  return (
    <section className="rounded-2xl border border-white/10 bg-[#212121] p-4">
      <div className="mb-3 text-[11px] uppercase tracking-[0.16em] text-[#8e8ea0]">Provider usage</div>

      <div className="grid grid-cols-2 gap-3">
        <StatTile label="providers" value={formatNumber(providers.length)} />
        <StatTile label="total_uses" value={formatNumber(totalUses)} />
        <StatTile label="total_wins" value={formatNumber(totalWins)} />
        <StatTile label="avg_latency" value={formatLatencyMs(avgLatency)} />
        <StatTile label="avg_cost" value={formatUsd(avgCost)} />
        <StatTile
          label="top_bandit"
          value={providerLabel(topRows[0]?.provider)}
          accent="text-emerald-300"
        />
      </div>

      <div className="mt-3 space-y-3">
        {topRows.length > 0 ? (
          topRows.map((row) => (
            <div
              key={String(row?.provider ?? "unknown")}
              className="rounded-xl border border-white/10 bg-[#1b1b1b] px-3 py-3"
            >
              <div className="flex items-center justify-between">
                <div className="text-sm text-white">{providerLabel(row?.provider)}</div>
                <div className="text-xs text-emerald-300">{formatScore(row?.bandit_score)}</div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[#8e8ea0]">
                <div>uses: {formatNumber(row?.uses)}</div>
                <div>wins: {formatNumber(row?.wins)}</div>
                <div>win rate: {formatScore(row?.win_rate)}</div>
                <div>recent: {formatNumber(row?.recent_uses)}</div>
                <div>avg latency: {formatLatencyMs(row?.avg_latency)}</div>
                <div>avg cost: {formatUsd(row?.avg_cost)}</div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-xs text-[#8e8ea0]">usage 데이터가 없습니다.</div>
        )}
      </div>
    </section>
  );
}
