import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { apiFetch } from "../../api/url";
import { t } from "../../i18n";
import { useWebSocket } from "../../hooks/useWebSocket";
import type { WsMessage } from "../../hooks/useWebSocket";
import { OpsKpiCard, OpsPanel } from "../ops/OpsGamePrimitives";
import DeptStatsCard from "./DeptStatsCard";

type ProviderKey = "openai" | "claude" | "gemini" | "perplexity";

type ProviderUsage = {
  total_tokens: number;
  estimated_cost_usd: number;
  runs: number;
  wins: number;
  avg_response_time_ms?: number;
};

type ExecutiveKpi = {
  totalReports: number;
  recent7dCount: number;
  avgRiskCount: number;
  avgRecommendationCount: number;
  latestAt: string | null;
  latestTopic: string | null;
  daily7d: Array<{ date: string; count: number }>;
  topTopics: Array<{ topic: string; count: number }>;
};

type RetailKpi = {
  totalStores: number;
  totalRevenue: number;
  totalTransactions: number;
  periodKpi: {
    today: { total: number; orders: number; transactions: number };
    weekToDate: { total: number; orders: number; transactions: number };
    monthToDate: { total: number; orders: number; transactions: number };
  } | null;
  topStore: { name: string; total: number } | null;
  topPayment: { method: string; total: number } | null;
  topPromotion: { code: string; total: number; discount: number } | null;
};

type RetailSnapshot = {
  snapshotDate: string;
  createdAt: string;
  totalRevenue: number;
  reportsMonth: number;
};

type DashboardUiSnapshot = {
  providerFilter?: "all" | ProviderKey;
  providerSort?: "cost" | "runs";
  denseMode?: boolean;
};

const BILLING: Record<ProviderKey, { url: string }> = {
  openai: { url: "https://platform.openai.com/usage" },
  claude: { url: "https://console.anthropic.com/settings/billing" },
  gemini: { url: "https://aistudio.google.com/billing" },
  perplexity: { url: "https://docs.perplexity.ai/home" }
};

const COLORS: Record<ProviderKey, string> = {
  openai: "#10a37f",
  claude: "#c96442",
  gemini: "#4285f4",
  perplexity: "#6366f1"
};

const ALL_PROVIDERS: ProviderKey[] = ["openai", "claude", "gemini", "perplexity"];
const DASHBOARD_UI_SNAPSHOT_KEY = "convusx.dashboard.ui.v1";

function readDashboardUiSnapshot(): DashboardUiSnapshot {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(DASHBOARD_UI_SNAPSHOT_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as DashboardUiSnapshot;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeDashboardUiSnapshot(snapshot: DashboardUiSnapshot) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DASHBOARD_UI_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

function toUsage(value?: Partial<ProviderUsage>): ProviderUsage {
  return {
    total_tokens: Number(value?.total_tokens ?? 0),
    estimated_cost_usd: Number(value?.estimated_cost_usd ?? 0),
    runs: Number(value?.runs ?? 0),
    wins: Number(value?.wins ?? 0),
    avg_response_time_ms: Number(value?.avg_response_time_ms ?? 0)
  };
}

function providerClass(provider: ProviderKey): string {
  return `provider-${provider}`;
}

export function DashboardView() {
  const initialUiSnapshot = readDashboardUiSnapshot();
  const [acc, setAcc] = useState<Record<string, ProviderUsage>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  const [credits, setCredits] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("corvus-x.credits") ?? "{}");
    } catch {
      return {};
    }
  });
  const [editingCredit, setEditingCredit] = useState<string | null>(null);
  const [dailyCosts, setDailyCosts] = useState<Record<string, number[]>>({});

  const [execKpi, setExecKpi] = useState<ExecutiveKpi | null>(null);
  const [retailKpi, setRetailKpi] = useState<RetailKpi | null>(null);
  const [retailSnapshot, setRetailSnapshot] = useState<RetailSnapshot | null>(null);
  const [providerFilter, setProviderFilter] = useState<"all" | ProviderKey>(initialUiSnapshot.providerFilter ?? "all");
  const [providerSort, setProviderSort] = useState<"cost" | "runs">(initialUiSnapshot.providerSort ?? "cost");
  const [denseMode, setDenseMode] = useState(initialUiSnapshot.denseMode ?? false);

  function saveCredit(provider: ProviderKey, value: string) {
    const next = { ...credits, [provider]: value };
    setCredits(next);
    localStorage.setItem("corvus-x.credits", JSON.stringify(next));
    setEditingCredit(null);

    apiFetch("/api/usage/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider })
    }).catch(() => {});
  }

  const fetchUsageData = useCallback((showLoading = true) => {
    if (showLoading) setLoading(true);
    setLoadError(false);

    apiFetch("/api/usage")
      .then((res) => res.json())
      .then((data) => {
        if (data?.accumulated) {
          setAcc(data.accumulated);
          const mockDailyCosts: Record<string, number[]> = {};
          for (const provider of ALL_PROVIDERS) {
            const total = Number(data.accumulated?.[provider]?.estimated_cost_usd ?? 0);
            mockDailyCosts[provider] = Array.from({ length: 7 }, () => Math.random() * total * 0.3);
          }
          setDailyCosts(mockDailyCosts);
          setLastUpdate(new Date().toLocaleTimeString());
        }
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  const fetchExecutiveKpi = useCallback(() => {
    apiFetch("/api/executive-reports/kpi")
      .then((res) => res.json())
      .then((data) => {
        if (!data?.ok) return;
        setExecKpi({
          totalReports: Number(data.kpi?.totalReports ?? 0),
          recent7dCount: Number(data.kpi?.recent7dCount ?? 0),
          avgRiskCount: Number(data.kpi?.avgRiskCount ?? 0),
          avgRecommendationCount: Number(data.kpi?.avgRecommendationCount ?? 0),
          latestAt: typeof data.kpi?.latestAt === "string" ? data.kpi.latestAt : null,
          latestTopic: typeof data.kpi?.latestTopic === "string" ? data.kpi.latestTopic : null,
          daily7d: Array.isArray(data.daily7d) ? data.daily7d : [],
          topTopics: Array.isArray(data.topTopics) ? data.topTopics : []
        });
      })
      .catch(() => {});
  }, []);

  const fetchRetailKpi = useCallback(() => {
    apiFetch("/api/pos")
      .then((res) => res.json())
      .then((data) => {
        if (!data?.ok) return;

        const stores: Array<{ id: string; name: string }> = Array.isArray(data.stores) ? data.stores : [];
        const summaryByStore = (data.summaryByStore ?? {}) as Record<string, { total: number; transactions: number }>;
        const paymentSummary = (data.paymentSummary ?? {}) as Record<string, { total: number }>;
        const promotionSummary = (data.promotionSummary ?? {}) as Record<string, { total: number; discount: number }>;

        const totalRevenue = Object.values(summaryByStore).reduce((sum, item) => sum + Number(item.total ?? 0), 0);
        const totalTransactions = Object.values(summaryByStore).reduce((sum, item) => sum + Number(item.transactions ?? 0), 0);

        const topStore = stores
          .map((store) => ({ name: store.name, total: Number(summaryByStore[store.id]?.total ?? 0) }))
          .sort((a, b) => b.total - a.total)[0] ?? null;

        const topPayment = Object.entries(paymentSummary)
          .map(([method, value]) => ({ method, total: Number(value.total ?? 0) }))
          .sort((a, b) => b.total - a.total)[0] ?? null;

        const topPromotion = Object.entries(promotionSummary)
          .map(([code, value]) => ({ code, total: Number(value.total ?? 0), discount: Number(value.discount ?? 0) }))
          .sort((a, b) => b.total - a.total)[0] ?? null;

        const periodKpi = data.periodKpi;
        setRetailKpi({
          totalStores: stores.length,
          totalRevenue,
          totalTransactions,
          periodKpi: periodKpi
            ? {
                today: {
                  total: Number(periodKpi.today?.total ?? 0),
                  orders: Number(periodKpi.today?.orders ?? 0),
                  transactions: Number(periodKpi.today?.transactions ?? 0)
                },
                weekToDate: {
                  total: Number(periodKpi.weekToDate?.total ?? 0),
                  orders: Number(periodKpi.weekToDate?.orders ?? 0),
                  transactions: Number(periodKpi.weekToDate?.transactions ?? 0)
                },
                monthToDate: {
                  total: Number(periodKpi.monthToDate?.total ?? 0),
                  orders: Number(periodKpi.monthToDate?.orders ?? 0),
                  transactions: Number(periodKpi.monthToDate?.transactions ?? 0)
                }
              }
            : null,
          topStore,
          topPayment,
          topPromotion
        });
      })
      .catch(() => {});
  }, []);

  const fetchRetailSnapshot = useCallback(() => {
    apiFetch("/api/retail/reports/latest")
      .then((res) => res.json())
      .then((data) => {
        if (!data?.ok || !data?.snapshot) return;
        const snapshot = data.snapshot as {
          snapshotDate?: string;
          createdAt?: string;
          payload?: {
            channels?: { totalRevenue?: number };
            executive?: { reportsMonth?: number };
          };
        };

        setRetailSnapshot({
          snapshotDate: typeof snapshot.snapshotDate === "string" ? snapshot.snapshotDate : "-",
          createdAt: typeof snapshot.createdAt === "string" ? snapshot.createdAt : "",
          totalRevenue: Number(snapshot.payload?.channels?.totalRevenue ?? 0),
          reportsMonth: Number(snapshot.payload?.executive?.reportsMonth ?? 0)
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchUsageData();
    fetchExecutiveKpi();
    fetchRetailKpi();
    fetchRetailSnapshot();
  }, [fetchExecutiveKpi, fetchRetailKpi, fetchRetailSnapshot, fetchUsageData]);

  useEffect(() => {
    writeDashboardUiSnapshot({
      providerFilter,
      providerSort,
      denseMode
    });
  }, [providerFilter, providerSort, denseMode]);

  const handleWsEvent = useCallback((msg: WsMessage) => {
    if (msg.type === "provider:health" || msg.type === "benchmark:done") {
      fetchUsageData(false);
      fetchExecutiveKpi();
      fetchRetailKpi();
      fetchRetailSnapshot();
    }
  }, [fetchExecutiveKpi, fetchRetailKpi, fetchRetailSnapshot, fetchUsageData]);

  useWebSocket({ onEvent: handleWsEvent });

  const providers = useMemo(() => ALL_PROVIDERS.filter((provider) => toUsage(acc[provider]).runs > 0), [acc]);
  const allUsage = useMemo(() => ALL_PROVIDERS.map((provider) => toUsage(acc[provider])), [acc]);

  const totalCost = allUsage.reduce((sum, item) => sum + item.estimated_cost_usd, 0);
  const totalRuns = allUsage.reduce((sum, item) => sum + item.runs, 0);

  const avgResponseTime = providers.length > 0
    ? Math.round(providers.reduce((sum, provider) => sum + Number(toUsage(acc[provider]).avg_response_time_ms ?? 0), 0) / providers.length)
    : 0;

  const mostUsedProvider = providers.length > 0
    ? providers.reduce((best, next) => (toUsage(acc[best]).estimated_cost_usd > toUsage(acc[next]).estimated_cost_usd ? best : next))
    : null;

  const execDailyMax = execKpi ? Math.max(...execKpi.daily7d.map((row) => row.count), 1) : 1;
  const providerCards = useMemo(() => {
    const filtered = ALL_PROVIDERS.filter((provider) => providerFilter === "all" || provider === providerFilter);
    return [...filtered].sort((a, b) => {
      if (providerSort === "runs") {
        return toUsage(acc[b]).runs - toUsage(acc[a]).runs;
      }
      return toUsage(acc[b]).estimated_cost_usd - toUsage(acc[a]).estimated_cost_usd;
    });
  }, [providerFilter, providerSort, acc]);

  function getStatusIndicator(provider: ProviderKey) {
    if (!credits[provider]) return "🟡";
    const usage = toUsage(acc[provider]).estimated_cost_usd;
    const remaining = Number(credits[provider]) - usage;
    const percentage = (remaining / Math.max(Number(credits[provider]), 0.001)) * 100;
    if (percentage > 70) return "🟢";
    if (percentage > 30) return "🟡";
    return "🔴";
  }

  function getPredictionDays(provider: ProviderKey) {
    if (!credits[provider]) return null;
    const usage = toUsage(acc[provider]);
    const remaining = Number(credits[provider]) - usage.estimated_cost_usd;
    if (remaining <= 0) return t("dashboard.exhausted");
    const dailyRate = usage.estimated_cost_usd / Math.max(1, usage.runs);
    const daysLeft = Math.ceil(remaining / Math.max(0.001, dailyRate));
    return daysLeft > 365 ? t("dashboard.daysPlus") : `${daysLeft}${t("dashboard.daysUnit")}`;
  }

  function costTrendBars(provider: ProviderKey) {
    const costs = dailyCosts[provider] ?? [];
    const max = Math.max(...costs, 0.001);
    return costs.map((cost, index) => ({
      height: (cost / max) * 100,
      cost,
      dayOffset: 6 - index
    }));
  }

  return (
    <section className="dashboard-hub">
      <header className="dashboard-hub__head">
        <div>
          <div className="ops-game-screen__eyebrow">HQ DATA ROOM</div>
          <div className="dashboard-hub__title-row">
            <h2>{t("dashboard.title")}</h2>
            {lastUpdate ? <span>{t("dashboard.lastUpdate").replace("{time}", lastUpdate)}</span> : null}
          </div>
        </div>
        <button type="button" className="dashboard-refresh-btn" onClick={() => fetchUsageData(false)}>
          새로고침
        </button>
      </header>

      {!loading ? (
        <section className="dashboard-kpi-grid" aria-label="dashboard summary">
          <OpsKpiCard label={t("dashboard.totalCost")} value={`$${totalCost.toFixed(4)}`} />
          <OpsKpiCard label={t("dashboard.todayUsage")} value={`${totalRuns}회`} />
          <OpsKpiCard label={t("dashboard.topAI")} value={mostUsedProvider ? mostUsedProvider.toUpperCase() : "-"} />
          <OpsKpiCard label={t("dashboard.avgLatency")} value={`${avgResponseTime}ms`} />
        </section>
      ) : null}

      {!loading && execKpi ? (
        <OpsPanel
          className="dashboard-panel"
          title="Executive KPI"
          right={<>{execKpi.latestAt ? new Date(execKpi.latestAt).toLocaleString() : "업데이트 없음"}</>}
        >
          <div className="dashboard-mini-grid">
            <article><span>보고 누적</span><strong>{execKpi.totalReports}건</strong></article>
            <article><span>최근 7일</span><strong>{execKpi.recent7dCount}건</strong></article>
            <article><span>평균 리스크</span><strong>{execKpi.avgRiskCount}개</strong></article>
            <article><span>평균 권고</span><strong>{execKpi.avgRecommendationCount}개</strong></article>
          </div>

          <div className="dashboard-split-grid">
            <article className="dashboard-box">
              <div className="dashboard-box__title">최근 7일 보고 추이</div>
              <div className="dashboard-spark-bars">
                {(execKpi.daily7d.length > 0 ? execKpi.daily7d : [{ date: "-", count: 0 }]).map((item, index) => {
                  const height = Math.max(8, (item.count / execDailyMax) * 100);
                  return (
                    <div key={`${item.date}-${index}`} className="dashboard-spark-bars__item">
                      <span
                        title={`${item.date}: ${item.count}건`}
                        style={{ "--bar-height": `${height}%` } as CSSProperties}
                      />
                      <em>{item.date !== "-" ? item.date.slice(5) : "-"}</em>
                    </div>
                  );
                })}
              </div>
            </article>

            <article className="dashboard-box">
              <div className="dashboard-box__title">상위 보고 주제</div>
              <ul className="dashboard-topic-list">
                {(execKpi.topTopics.length > 0 ? execKpi.topTopics : [{ topic: "데이터 없음", count: 0 }]).slice(0, 4).map((item) => (
                  <li key={item.topic}>
                    <span>{item.topic}</span>
                    <strong>{item.count}건</strong>
                  </li>
                ))}
              </ul>
              {execKpi.latestTopic ? <p className="dashboard-box__meta">Latest: {execKpi.latestTopic}</p> : null}
            </article>
          </div>
        </OpsPanel>
      ) : null}

      {!loading && retailKpi ? (
        <OpsPanel
          className="dashboard-panel"
          title="Retail Ops KPI"
          right={<>{retailSnapshot ? `Snapshot ${retailSnapshot.snapshotDate}` : "Snapshot 준비 중"}</>}
        >
          <div className="dashboard-mini-grid">
            <article><span>운영 매장</span><strong>{retailKpi.totalStores}개</strong></article>
            <article><span>오프라인 매출</span><strong>{retailKpi.totalRevenue.toLocaleString()}원</strong></article>
            <article><span>결제 건수</span><strong>{retailKpi.totalTransactions.toLocaleString()}건</strong></article>
          </div>

          {retailKpi.periodKpi ? (
            <div className="dashboard-mini-grid dashboard-mini-grid--period">
              <article>
                <span>오늘</span>
                <strong>{retailKpi.periodKpi.today.total.toLocaleString()}원</strong>
                <em>{retailKpi.periodKpi.today.transactions}건</em>
              </article>
              <article>
                <span>주간 누적</span>
                <strong>{retailKpi.periodKpi.weekToDate.total.toLocaleString()}원</strong>
                <em>{retailKpi.periodKpi.weekToDate.transactions}건</em>
              </article>
              <article>
                <span>월간 누적</span>
                <strong>{retailKpi.periodKpi.monthToDate.total.toLocaleString()}원</strong>
                <em>{retailKpi.periodKpi.monthToDate.transactions}건</em>
              </article>
            </div>
          ) : null}

          <div className="dashboard-note-list">
            <p>Top Store: <strong>{retailKpi.topStore ? `${retailKpi.topStore.name} (${retailKpi.topStore.total.toLocaleString()}원)` : "-"}</strong></p>
            <p>Top Payment: <strong>{retailKpi.topPayment ? `${retailKpi.topPayment.method.toUpperCase()} (${retailKpi.topPayment.total.toLocaleString()}원)` : "-"}</strong></p>
            <p>Top Promotion: <strong>{retailKpi.topPromotion ? `${retailKpi.topPromotion.code} (매출 ${retailKpi.topPromotion.total.toLocaleString()}원 / 할인 ${retailKpi.topPromotion.discount.toLocaleString()}원)` : "-"}</strong></p>
            {retailSnapshot ? (
              <p>
                Snapshot Total: <strong>{retailSnapshot.totalRevenue.toLocaleString()}원</strong>
                {" · "}
                Executive MTD: <strong>{retailSnapshot.reportsMonth}건</strong>
              </p>
            ) : null}
          </div>
        </OpsPanel>
      ) : null}

      {/* Phase 5 — 부서 타이쿤 (레벨/XP/성공률/비용) */}
      <OpsPanel
        className="dashboard-panel"
        title="부서 타이쿤 — 레벨 & 누적 성과"
        right={<span style={{ opacity: 0.55, fontSize: 11 }}>30s polling</span>}
      >
        <DeptStatsCard />
      </OpsPanel>

      {loading ? (
        <div className="dashboard-empty">{t("dashboard.loading")}</div>
      ) : loadError ? (
        <div className="dashboard-empty">
          <p>{t("errors.dashboardLoadFailed")}</p>
          <button type="button" onClick={() => window.location.reload()}>재시도</button>
        </div>
      ) : (
        <section className="dashboard-provider-grid" aria-label="provider details">
          <div className="dashboard-provider-controls">
            <div className="dashboard-provider-controls__filter">
              {(["all", ...ALL_PROVIDERS] as Array<"all" | ProviderKey>).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={providerFilter === item ? "is-active" : ""}
                  onClick={() => setProviderFilter(item)}
                >
                  {item === "all" ? "ALL" : item.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="dashboard-provider-controls__tools">
              <button
                type="button"
                className={providerSort === "cost" ? "is-active" : ""}
                onClick={() => setProviderSort("cost")}
              >
                COST 정렬
              </button>
              <button
                type="button"
                className={providerSort === "runs" ? "is-active" : ""}
                onClick={() => setProviderSort("runs")}
              >
                RUN 정렬
              </button>
              <button
                type="button"
                className={denseMode ? "is-active" : ""}
                onClick={() => setDenseMode((prev) => !prev)}
              >
                {denseMode ? "DENSE ON" : "DENSE OFF"}
              </button>
            </div>
          </div>
          {providerCards.map((provider) => {
            const usage = toUsage(acc[provider]);
            const winRate = usage.runs > 0 ? Math.round((usage.wins / usage.runs) * 100) : 0;
            const bars = costTrendBars(provider);
            const credit = credits[provider];
            const remaining = credit ? Math.max(0, Number(credit) - usage.estimated_cost_usd) : 0;

            return (
              <article key={provider} className={`dashboard-provider-card ${providerClass(provider)}${denseMode ? " is-dense" : ""}`}>
                <header>
                  <div className="dashboard-provider-card__name">
                    <i />
                    <strong>{provider}</strong>
                    <span>{getStatusIndicator(provider)}</span>
                  </div>

                  <div className="dashboard-provider-card__credits">
                    {editingCredit === provider ? (
                      <>
                        <input
                          autoFocus
                          type="number"
                          step="0.01"
                          defaultValue={credit ?? ""}
                          placeholder="0.00"
                          onKeyDown={(event) => {
                            if (event.key === "Enter") saveCredit(provider, (event.target as HTMLInputElement).value);
                            if (event.key === "Escape") setEditingCredit(null);
                          }}
                          onBlur={(event) => saveCredit(provider, event.target.value)}
                        />
                        <button type="button" onClick={() => setEditingCredit(null)}>{t("common.cancel")}</button>
                      </>
                    ) : (
                      <>
                        {credit ? (
                          <p>
                            {t("dashboard.remaining")} <strong>${remaining.toFixed(3)}</strong>
                            {getPredictionDays(provider) ? <span>({getPredictionDays(provider)})</span> : null}
                          </p>
                        ) : (
                          <p>{t("dashboard.noCredit")}</p>
                        )}
                        <button type="button" onClick={() => setEditingCredit(provider)}>
                          {credit ? t("dashboard.edit") : t("dashboard.enter")}
                        </button>
                      </>
                    )}
                    <a href={BILLING[provider].url} target="_blank" rel="noreferrer">
                      {t("dashboard.recharge")}
                    </a>
                  </div>
                </header>

                <div className="dashboard-provider-card__stats">
                  <div><span>{t("dashboard.tokens")}</span><strong>{usage.total_tokens.toLocaleString()}</strong></div>
                  <div><span>{t("dashboard.cost")}</span><strong>${usage.estimated_cost_usd.toFixed(4)}</strong></div>
                  <div><span>{t("dashboard.executions")}</span><strong>{usage.runs}회</strong></div>
                  <div><span>{t("dashboard.winRate")}</span><strong>{winRate}%</strong></div>
                  <div><span>{t("dashboard.latency")}</span><strong>{usage.avg_response_time_ms ?? 0}ms</strong></div>
                </div>

                <div className="dashboard-provider-card__trend">
                  <div className="dashboard-provider-card__trend-title">{t("dashboard.dailyCost7d")}</div>
                  <div className="dashboard-provider-card__bars">
                    {bars.map((bar, index) => (
                      <div key={`${provider}-bar-${index}`}>
                        <span
                          title={`$${bar.cost.toFixed(3)}`}
                          style={{ "--bar-height": `${bar.height}%` } as CSSProperties}
                        />
                        <em>-{bar.dayOffset}d</em>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </section>
  );
}
