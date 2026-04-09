import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../api/url";
import { t } from "../../i18n";
import { useWebSocket } from "../../hooks/useWebSocket";
import type { WsMessage } from "../../hooks/useWebSocket";

const BILLING = {
  openai:     { url: "https://platform.openai.com/usage",            label: () => t("dashboard.billing") },
  claude:     { url: "https://console.anthropic.com/settings/billing", label: () => t("dashboard.billing") },
  gemini:     { url: "https://aistudio.google.com/billing",          label: () => t("dashboard.billing") },
  perplexity: { url: "https://docs.perplexity.ai/home",              label: () => t("dashboard.billing") },
} as Record<string, { url: string; label: () => string }>;

const COLORS: Record<string, string> = {
  openai: "#10a37f", claude: "#c96442", gemini: "#4285f4", perplexity: "#6366f1"
};

const ALL_PROVIDERS = ["openai", "claude", "gemini", "perplexity"];

export function DashboardView() {
  const [acc, setAcc] = useState<Record<string, {
    total_tokens: number; estimated_cost_usd: number; runs: number; wins: number; avg_response_time_ms?: number
  }>>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [credits, setCredits] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("corvus-x.credits") ?? "{}"); } catch { return {}; }
  });
  const [editingCredit, setEditingCredit] = useState<string | null>(null);
  const [dailyCosts, setDailyCosts] = useState<Record<string, number[]>>({});

  function saveCredit(provider: string, value: string) {
    const next = { ...credits, [provider]: value };
    setCredits(next);
    localStorage.setItem("corvus-x.credits", JSON.stringify(next));
    setEditingCredit(null);
    apiFetch("/api/usage/reset", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider })
    }).catch(() => {});
  }

  const [loadError, setLoadError] = useState(false);

  const fetchUsageData = useCallback((showLoading = true) => {
    if (showLoading) setLoading(true);
    setLoadError(false);
    apiFetch("/api/usage")
      .then(r => r.json())
      .then(d => {
        if (d?.accumulated) setAcc(d.accumulated);
        // Generate mock daily costs data for the last 7 days
        const mockDailyCosts: Record<string, number[]> = {};
        ALL_PROVIDERS.forEach(p => {
          mockDailyCosts[p] = Array.from({ length: 7 }, () => Math.random() * (d?.accumulated?.[p]?.estimated_cost_usd ?? 0) * 0.3);
        });
        setDailyCosts(mockDailyCosts);
        setLastUpdate(new Date().toLocaleTimeString());
      })
      .catch(() => { setLoadError(true); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchUsageData(); }, [fetchUsageData]);

  // ── WebSocket 실시간 갱신 ──
  const handleWsEvent = useCallback((msg: WsMessage) => {
    if (msg.type === "provider:health" || msg.type === "benchmark:done") {
      // 서버 이벤트 수신 시 대시보드 데이터 자동 refetch (로딩 표시 없이)
      fetchUsageData(false);
    }
  }, [fetchUsageData]);

  useWebSocket({ onEvent: handleWsEvent });

  const providers = ALL_PROVIDERS.filter(p => acc[p]?.runs > 0);
  const allProvidersData = ALL_PROVIDERS.map(p => acc[p] ?? { total_tokens: 0, estimated_cost_usd: 0, runs: 0, wins: 0, avg_response_time_ms: 0 });
  const totalTokens = allProvidersData.reduce((s, a) => s + a.total_tokens, 0);
  const totalCost = allProvidersData.reduce((s, a) => s + a.estimated_cost_usd, 0);
  const avgResponseTime = providers.length > 0
    ? Math.round(providers.reduce((s, p) => s + (acc[p].avg_response_time_ms ?? 0), 0) / providers.length)
    : 0;
  const mostUsedProvider = providers.length > 0
    ? providers.reduce((a, b) => acc[a].estimated_cost_usd > acc[b].estimated_cost_usd ? a : b)
    : "N/A";

  const getStatusIndicator = (provider: string) => {
    if (!credits[provider]) return "🟡";
    const remaining = Number(credits[provider]) - acc[provider]?.estimated_cost_usd;
    const percentage = (remaining / Number(credits[provider])) * 100;
    if (percentage > 70) return "🟢";
    if (percentage > 30) return "🟡";
    return "🔴";
  };

  const getPredictionDays = (provider: string) => {
    if (!credits[provider] || !acc[provider]) return null;
    const remaining = Number(credits[provider]) - acc[provider].estimated_cost_usd;
    if (remaining <= 0) return t("dashboard.exhausted");
    const dailyRate = acc[provider].estimated_cost_usd / Math.max(1, acc[provider].runs); // rough estimate
    const daysLeft = Math.ceil(remaining / Math.max(0.001, dailyRate));
    return daysLeft > 365 ? t("dashboard.daysPlus") : daysLeft + t("dashboard.daysUnit");
  };

  const costTrendBars = (provider: string) => {
    const costs = dailyCosts[provider] ?? [];
    const max = Math.max(...costs, 0.001);
    return costs.map((cost, i) => ({
      height: (cost / max) * 100,
      cost: cost.toFixed(3),
      dayOffset: 6 - i
    }));
  };

  // suppress unused warning
  void totalTokens;

  return (
    <div style={{ padding: "16px 20px", overflowY: "auto", height: "100%", boxSizing: "border-box" as const }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        {/* 헤더 */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-main)" }}>{t("dashboard.title")}</div>
          {lastUpdate && <div style={{ fontSize: 10, color: "var(--text-soft)" }}>{t("dashboard.lastUpdate").replace("{time}", lastUpdate)}</div>}
        </div>

        {/* 요약 헤더 */}
        {!loading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 14 }}>
            {[
              [t("dashboard.totalCost"), `$${totalCost.toFixed(4)}`],
              [t("dashboard.todayUsage"), `${allProvidersData.reduce((s, a) => s + a.runs, 0)}회`],
              [t("dashboard.topAI"), mostUsedProvider.toUpperCase()],
              [t("dashboard.avgLatency"), `${avgResponseTime}ms`],
            ].map(([label, value]) => (
              <div key={label} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-1)" }}>
                <div style={{ fontSize: 10, color: "var(--text-soft)", marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>{value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Provider별 상세 */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--text-soft)", fontSize: 13 }}>{t("dashboard.loading")}</div>
        ) : loadError ? (
          <div style={{ textAlign: "center", padding: 40 }}>
            <div style={{ color: "var(--text-soft)", fontSize: 13, marginBottom: 12 }}>{t("errors.dashboardLoadFailed")}</div>
            <button type="button" onClick={() => window.location.reload()} style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-1)", color: "var(--text-main)", cursor: "pointer", fontSize: 12 }}>{t("ui.retry")}</button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
            {ALL_PROVIDERS.map(provider => {
              const a = acc[provider] ?? { total_tokens: 0, estimated_cost_usd: 0, runs: 0, wins: 0, avg_response_time_ms: 0 };
              const color = COLORS[provider] ?? "#6b7280";
              const billing = BILLING[provider];
              const winRate = a.runs > 0 ? Math.round((a.wins / a.runs) * 100) : 0;
              const statusIndicator = getStatusIndicator(provider);
              const predictionDays = getPredictionDays(provider);
              const bars = costTrendBars(provider);

              return (
                <div key={provider} style={{ borderRadius: 10, border: `1px solid ${color}30`, background: "var(--surface-1)", overflow: "hidden" }}>
                  {/* Provider 헤더 + 크레딧 한 줄 */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid var(--border)", background: color + "08" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)", textTransform: "capitalize" }}>{provider}</span>
                      <span style={{ fontSize: 13 }}>{statusIndicator}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {editingCredit === provider ? (
                        <>
                          <span style={{ fontSize: 11, color: "var(--text-sub)" }}>$</span>
                          <input
                            autoFocus
                            type="number"
                            step="0.01"
                            defaultValue={credits[provider] ?? ""}
                            onKeyDown={e => {
                              if (e.key === "Enter") saveCredit(provider, (e.target as HTMLInputElement).value);
                              if (e.key === "Escape") setEditingCredit(null);
                            }}
                            onBlur={e => saveCredit(provider, e.target.value)}
                            style={{ width: 70, padding: "2px 6px", borderRadius: 5, border: "1px solid var(--border)", fontSize: 12, background: "var(--bg-main)", color: "var(--text-main)", outline: "none" }}
                            placeholder="0.00"
                          />
                          <button type="button" onClick={() => setEditingCredit(null)} style={{ fontSize: 10, color: "var(--text-sub)", border: "none", background: "none", cursor: "pointer" }}>{t("common.cancel")}</button>
                        </>
                      ) : (
                        <>
                          {credits[provider] ? (
                            <span style={{ fontSize: 11, color: "var(--text-sub)" }}>
                              {t("dashboard.remaining")} <strong style={{ color: Number(credits[provider]) - a.estimated_cost_usd > 0 ? "#10a37f" : "#ef4444" }}>
                                ${Math.max(0, Number(credits[provider]) - a.estimated_cost_usd).toFixed(3)}
                              </strong>
                              {predictionDays && <span style={{ color: "var(--text-soft)", marginLeft: 4 }}>({predictionDays})</span>}
                            </span>
                          ) : (
                            <span style={{ fontSize: 10, color: "var(--text-soft)" }}>{t("dashboard.noCredit")}</span>
                          )}
                          <button type="button" onClick={() => setEditingCredit(provider)}
                            style={{ fontSize: 10, color: "var(--text-sub)", border: "1px solid var(--border)", borderRadius: 5, padding: "1px 6px", background: "transparent", cursor: "pointer" }}>
                            {credits[provider] ? t("dashboard.edit") : t("dashboard.enter")}
                          </button>
                        </>
                      )}
                      {billing && (
                        <a href={billing.url} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 11, fontWeight: 600, textDecoration: "none", padding: "3px 10px", borderRadius: 5, background: color, color: "#fff" }}>
                          {t("dashboard.recharge")}
                        </a>
                      )}
                    </div>
                  </div>

                  {/* 통계 - 5열 그리드 */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 0 }}>
                    {[
                      [t("dashboard.tokens"), a.total_tokens.toLocaleString()],
                      [t("dashboard.cost"), `$${a.estimated_cost_usd.toFixed(4)}`],
                      [t("dashboard.executions"), `${a.runs}회`],
                      [t("dashboard.winRate"), `${winRate}%`],
                      [t("dashboard.latency"), `${a.avg_response_time_ms ?? 0}ms`],
                    ].map(([label, value], i) => (
                      <div key={label} style={{ padding: "7px 8px", borderRight: i < 4 ? "1px solid var(--border)" : "none" }}>
                        <div style={{ fontSize: 9, color: "var(--text-sub)", marginBottom: 2 }}>{label}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-main)" }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  {/* 비용 추세 차트 (7일) */}
                  <div style={{ padding: "8px 12px", borderTop: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 9, color: "var(--text-sub)", marginBottom: 4 }}>{t("dashboard.dailyCost7d")}</div>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 40, justifyContent: "space-around" }}>
                      {bars.map((bar, i) => (
                        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                          <div
                            title={`$${bar.cost}`}
                            style={{
                              width: "100%",
                              height: bar.height + "%",
                              background: color,
                              borderRadius: "2px 2px 0 0",
                              opacity: 0.7,
                              minHeight: bar.height > 0 ? 3 : 0
                            }}
                          />
                          <div style={{ fontSize: 8, color: "var(--text-soft)" }}>-{bar.dayOffset}d</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
