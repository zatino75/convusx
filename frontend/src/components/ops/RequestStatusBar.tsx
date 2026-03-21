import { useState } from "react";

type DebugMeta = {
  winnerProvider: string | null;
  routerTask: string | null;
  selectedProviders: string[];
  verifierProviders: string[];
  selectedByFreshness?: boolean;
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
};

type RecentSummary = {
  total_requests?: number;
  avg_latency_ms?: number;
  avg_cost_usd?: number;
  fallback_rate?: number;
  avg_judge_confidence?: number;
  avg_conflict_count?: number;
};

type Props = {
  debugMeta: DebugMeta;
  recentSummary?: RecentSummary | null;
};

function providerLabel(provider: string | null | undefined) {
  const normalized = String(provider ?? "").trim().toLowerCase();
  if (!normalized) return "-";
  if (normalized === "openai") return "OpenAI";
  if (normalized === "claude") return "Claude";
  if (normalized === "gemini") return "Gemini";
  if (normalized === "perplexity") return "Perplexity";
  return normalized;
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

function chip(label: string, value: string, accent?: string) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
      <span className="text-[10px] text-[#8e8ea0]">{label}</span>
      <span className={["text-xs text-white", accent ?? ""].join(" ")}>{value}</span>
    </div>
  );
}

export default function RequestStatusBar({ debugMeta, recentSummary }: Props) {
  const [open, setOpen] = useState(false);

  const primary = debugMeta.selectedProviders[0] ?? null;
  const verifier = debugMeta.verifierProviders[0] ?? null;
  const selectedModels = Array.isArray(debugMeta.selectedModels) ? debugMeta.selectedModels : [];
  const primaryBanditScore =
    primary && debugMeta.banditScores
      ? Number(debugMeta.banditScores?.[primary]?.bandit_score ?? 0)
      : null;

  return (
    <div className="border-b border-white/10 bg-[#1b1b1b]">
      <div
        onClick={() => setOpen((prev) => !prev)}
        className="cursor-pointer px-4 py-2 transition hover:bg-white/[0.03] md:px-6"
      >
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {chip("최종", providerLabel(debugMeta.winnerProvider))}
            {chip("Primary", providerLabel(primary))}
            {chip("Verifier", providerLabel(verifier))}
            {chip("작업", debugMeta.routerTask ?? "-")}
            {chip("시간", formatLatencyMs(debugMeta.requestLatencyMs))}
            {chip("비용", formatUsd(debugMeta.requestCostUsd))}
          </div>

          <div className="text-xs text-[#8e8ea0]">{open ? "접기 ▲" : "운영 보기 ▼"}</div>
        </div>
      </div>

      {open ? (
        <div className="border-t border-white/10 px-4 py-3 md:px-6">
          <div className="mx-auto max-w-[1400px] space-y-3">
            <div className="rounded-2xl border border-white/10 bg-[#181818] p-3">
              <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-[#8e8ea0]">Routing timeline</div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-white">
                <span className="rounded-full border border-white/10 bg-[#212121] px-3 py-1.5">
                  Primary {providerLabel(primary)}
                </span>
                <span className="text-[#5f5f66]">→</span>
                <span className="rounded-full border border-white/10 bg-[#212121] px-3 py-1.5">
                  Verifier {providerLabel(verifier)}
                </span>
                <span className="text-[#5f5f66]">→</span>
                <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-emerald-300">
                  Winner {providerLabel(debugMeta.winnerProvider)}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {chip(
                  "라우팅",
                  debugMeta.selectedByFreshness ? "최근 성과 반영" : "기본 점수 기반",
                  debugMeta.selectedByFreshness ? "text-emerald-300" : ""
                )}
                {chip(
                  "상태",
                  debugMeta.fallbackUsed ? "Fallback 사용" : "Primary 유지",
                  debugMeta.fallbackUsed ? "text-amber-300" : ""
                )}
                {chip("신뢰도", formatScore(debugMeta.judgeConfidence))}
                {chip("토큰", String(debugMeta.requestTotalTokens ?? 0))}
                {primaryBanditScore != null ? chip("Bandit", formatScore(primaryBanditScore), "text-cyan-300") : null}
              </div>
            </div>

            {selectedModels.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {selectedModels.map((row, index) => (
                  <div
                    key={`${row.provider ?? "unknown"}_${row.model ?? "unknown"}_${index}`}
                    className="rounded-full border border-white/10 bg-[#212121] px-3 py-1.5 text-[11px] text-[#d7d7d7]"
                  >
                    {providerLabel(row.provider)} · {row.model ?? "-"}
                  </div>
                ))}
              </div>
            ) : null}

            {recentSummary ? (
              <div className="flex flex-wrap gap-2 border-t border-white/10 pt-3">
                {chip("최근 요청", String(recentSummary.total_requests ?? 0))}
                {chip("평균 시간", formatLatencyMs(recentSummary.avg_latency_ms))}
                {chip("평균 비용", formatUsd(recentSummary.avg_cost_usd))}
                {chip("Fallback 비율", formatScore(recentSummary.fallback_rate))}
                {chip("평균 신뢰도", formatScore(recentSummary.avg_judge_confidence))}
                {chip("평균 충돌", formatScore(recentSummary.avg_conflict_count))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
