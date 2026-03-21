import type { ScoreboardResponse } from "../../api/chat";

type Props = {
  scoreboard: ScoreboardResponse | null;
};

function formatNumber(value: number | null | undefined) {
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

export default function ScoreboardCard({ scoreboard }: Props) {
  const routingScores = Array.isArray(scoreboard?.routing_scores) ? scoreboard.routing_scores : [];

  return (
    <section className="rounded-2xl border border-white/10 bg-[#212121] p-4">
      <div className="mb-3 text-[11px] uppercase tracking-[0.16em] text-[#8e8ea0]">Routing scoreboard</div>

      <div className="space-y-3">
        {routingScores.length > 0 ? (
          routingScores.map((row) => (
            <div
              key={String(row?.provider ?? "unknown")}
              className="rounded-xl border border-white/10 bg-[#1b1b1b] px-3 py-3"
            >
              <div className="flex items-center justify-between">
                <div className="text-sm text-white">{providerLabel(row?.provider)}</div>
                <div className="text-xs text-emerald-300">{formatScore(row?.bandit_score)}</div>
              </div>

              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-emerald-400"
                  style={{ width: `${Math.max(6, Math.min(100, Number(row?.bandit_score ?? 0) * 100))}%` }}
                />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {chip(`Uses ${formatNumber(row?.uses)}`)}
                {chip(`Wins ${formatNumber(row?.wins)}`)}
                {chip(`Recent ${formatNumber(row?.recent_uses)}`)}
                {chip(`WinRate ${formatScore(row?.win_rate)}`)}
                {chip(`RecentWin ${formatScore(row?.recent_win_rate)}`)}
                {chip(`Routing ${formatScore(row?.routing_score)}`)}
                {chip(`Explore ${formatScore(row?.exploration_bonus)}`)}
                {chip(`Fresh ${formatScore(row?.freshness_bonus)}`)}
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[#8e8ea0]">
                <div>avg latency: {formatLatencyMs(row?.avg_latency)}</div>
                <div>avg cost: {formatUsd(row?.avg_cost)}</div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-xs text-[#8e8ea0]">scoreboard 데이터가 없습니다.</div>
        )}
      </div>
    </section>
  );
}
