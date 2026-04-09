import { useState } from "react";
import { apiFetch } from "../../api/url";
import { t } from "../../i18n";

type BenchmarkSummary = {
  orchestra_wins?: number
  best_single_wins?: number
  ties?: number
  win_rate?: number
  avg_quality_orchestra?: number
  avg_quality_single?: number
}

type BenchmarkResult = {
  ok: boolean
  score?: number
  message?: string
  details?: Record<string, any>
  comparison?: {
    summary?: BenchmarkSummary
    pairwise?: Array<Record<string, any>>
    task_improvement?: Record<string, Record<string, any>>
  }
}

const PROVIDER_COLOR: Record<string, string> = {
  openai: "#10a37f", claude: "#c96442", gemini: "#4285f4", perplexity: "#6366f1"
};
const TASK_LABEL: Record<string, string> = {
  dialogue: t("task.dialogue"), reasoning: t("task.reasoning"), research: t("task.research"), code: t("task.code"), writing: t("task.writing"), long_doc: t("task.long_doc")
};

export function BenchmarkView() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [maxCases, setMaxCases] = useState(6);
  const [selectedProviders, setSelectedProviders] = useState<string[]>(["openai", "claude", "gemini", "perplexity"]);
  const [customMode, setCustomMode] = useState(false);
  const [customQuestion, setCustomQuestion] = useState("");
  const [customTask, setCustomTask] = useState("dialogue");
  const [activeTab, setActiveTab] = useState<"run" | "history" | "routing">("run");
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [routingScores, setRoutingScores] = useState<Record<string, any[]> | null>(null);
  const [currentRoles, setCurrentRoles] = useState<Record<string, {
    primary: string | null;
    verifier: string | null;
    optional: string | null;
    dynamic_scores?: Record<string, { score: number; breakdown: Record<string, number> }>;
    router_policy?: string;
  }> | null>(null);
  const [routingLoading, setRoutingLoading] = useState(false);
  const [accumulatedStats, setAccumulatedStats] = useState<Record<string, { total_tokens: number; estimated_cost_usd: number; runs: number; wins: number }> | null>(null);

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const res = await apiFetch("/api/benchmark/history");
      const data = await res.json();
      if (data.ok) setHistory((data.history ?? []).slice().reverse());
    } catch {} finally {
      setHistoryLoading(false);
    }
  }

  async function loadRoutingScores() {
    setRoutingLoading(true);
    try {
      const res = await apiFetch("/api/scoreboard");
      const data = await res.json();
      if (data.ok) {
        setRoutingScores(data.task_routing_scores ?? null);
        setCurrentRoles(data.current_roles ?? null);
        setAccumulatedStats(data.accumulated ?? null);
      }
    } catch {} finally {
      setRoutingLoading(false);
    }
  }

  async function runBenchmark() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const payload: Record<string, any> = { max_cases: maxCases, single_providers: selectedProviders };
      if (customMode && customQuestion.trim()) {
        payload.cases = [{
          id: "custom_1",
          label: customTask,
          input: { task: customTask, message: customQuestion.trim() }
        }];
        payload.max_cases = 1;
      }
      const res = await apiFetch("/api/benchmark/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.ok) setResult(data);
      else setError(data.error ?? t("benchmark.executionFailed"));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "네트워크 오류");
    } finally {
      setLoading(false);
    }
  }

  const summary = result?.comparison?.summary;
  const pairwise = result?.comparison?.pairwise ?? [];
  const taskImprovement = result?.comparison?.task_improvement ?? {};

  return (
    <div style={{ padding: "24px 28px", overflowY: "auto", height: "100%", boxSizing: "border-box" as const }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {(["run", "history", "routing"] as const).map(tab => (
            <button key={tab} type="button"
              onClick={() => {
                setActiveTab(tab);
                if (tab === "history") loadHistory();
                if (tab === "routing") loadRoutingScores();
              }}
              style={{
                padding: "6px 14px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                background: activeTab === tab ? "var(--text-main)" : "transparent",
                color: activeTab === tab ? "#fff" : "var(--text-sub)"
              }}
            >
              {tab === "run" ? t("benchmark.tabRun") : tab === "history" ? t("benchmark.tabHistory") : t("benchmark.tabRouting")}
            </button>
          ))}
        </div>
        {activeTab === "run" && (
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" as const }}>
            <label style={{ fontSize: 12, color: "var(--text-sub)" }}>
              {t("benchmark.caseCount")}
              <select value={maxCases} onChange={e => setMaxCases(Number(e.target.value))}
                style={{ marginLeft: 6, fontSize: 12, padding: "2px 6px", borderRadius: 4, border: "1px solid var(--border)" }}>
                {[3, 6, 10, 20].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            {/* 비교 대상 provider 선택 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-sub)" }}>
              <span>{t("benchmark.compareTarget")}</span>
              {(["openai", "claude", "gemini", "perplexity"] as const).map(p => {
                const COLORS: Record<string, string> = { openai: "#10a37f", claude: "#c96442", gemini: "#4285f4", perplexity: "#6366f1" };
                const checked = selectedProviders.includes(p);
                return (
                  <label key={p} style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer", userSelect: "none" as const }}>
                    <input type="checkbox" checked={checked}
                      onChange={e => setSelectedProviders(prev =>
                        e.target.checked ? [...prev, p] : prev.filter(x => x !== p)
                      )}
                      style={{ accentColor: COLORS[p] }} />
                    <span style={{ color: checked ? COLORS[p] : "var(--text-sub)", fontWeight: checked ? 700 : 400 }}>{p}</span>
                  </label>
                );
              })}
            </div>
            <button type="button" onClick={runBenchmark} disabled={loading || selectedProviders.length === 0}
              style={{ padding: "7px 16px", borderRadius: 8, border: "none",
                background: loading ? "var(--border)" : "var(--text-main)",
                color: loading ? "var(--text-sub)" : "#fff",
                fontSize: 13, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
              {loading ? t("benchmark.running") : t("benchmark.run")}
            </button>
          </div>
          {selectedProviders.length === 0 && (
            <div style={{ fontSize: 11, color: "#ef4444" }}>{t("benchmark.selectProvider")}</div>
          )}
          {/* 커스텀 질문 모드 */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <label style={{ fontSize: 12, color: "var(--text-sub)", display: "flex", alignItems: "center", gap: 4, cursor: "pointer", userSelect: "none" as const }}>
              <input type="checkbox" checked={customMode} onChange={e => setCustomMode(e.target.checked)}
                style={{ accentColor: "var(--accent)" }} />
              {t("benchmark.customMode") || "직접 질문 입력"}
            </label>
          </div>
          {customMode && (
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 6, marginTop: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ fontSize: 11, color: "var(--text-sub)", flexShrink: 0 }}>Task</label>
                <select value={customTask} onChange={e => setCustomTask(e.target.value)}
                  style={{ fontSize: 12, padding: "3px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-1)" }}>
                  {["dialogue", "reasoning", "research", "code", "writing", "long_doc"].map(t => (
                    <option key={t} value={t}>{TASK_LABEL[t] || t}</option>
                  ))}
                </select>
              </div>
              <textarea
                value={customQuestion}
                onChange={e => setCustomQuestion(e.target.value)}
                placeholder={t("benchmark.customPlaceholder") || "비교할 질문을 입력하세요..."}
                rows={3}
                style={{
                  fontSize: 13, padding: "8px 12px", borderRadius: 8,
                  border: "1px solid var(--border)", background: "var(--surface-1)",
                  color: "var(--text-main)", resize: "vertical", lineHeight: 1.5,
                  fontFamily: "inherit"
                }}
              />
            </div>
          )}
          </div>
        )}
      </div>

      {activeTab === "routing" && (
        <div>
          {routingLoading && <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-sub)", fontSize: 13 }}>{t("common.loading")}</div>}
          {!routingLoading && !routingScores && (
            <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-sub)" }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>🧭</div>
              <div style={{ fontSize: 13 }}>{t("benchmark.routingHint")}</div>
            </div>
          )}
          {!routingLoading && routingScores && (() => {
            const PROVIDERS = ["openai", "claude", "gemini", "perplexity"];
            const TASK_ORDER = ["dialogue", "reasoning", "research", "code", "writing", "long_doc"];
            const tasks = TASK_ORDER.filter(t => Object.keys(routingScores).includes(t))
              .concat(Object.keys(routingScores).filter(t => !TASK_ORDER.includes(t)).sort());
            const allScores = tasks.flatMap(t => (routingScores[t] ?? []).map((r: Record<string, any>) => Number(r.bandit_score ?? 0)));
            const maxScore = Math.max(...allScores, 0.01);
            // suppress unused warning
            void maxScore;
            return (
              <div>
                {/* 현재 배정 카드 */}
                {currentRoles && (
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-sub)", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>
                        {t("benchmark.currentAssignment")}
                      </div>
                      {(() => {
                        const anyPolicy = Object.values(currentRoles)[0]?.router_policy;
                        return anyPolicy ? (
                          <span style={{ fontSize: 9, padding: "1px 7px", borderRadius: 8, background: "#eff6ff", color: "#3b82f6", fontWeight: 600 }}>
                            {anyPolicy}
                          </span>
                        ) : null;
                      })()}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 8 }}>
                      {tasks.map(task => {
                        const roles = currentRoles[task];
                        if (!roles) return null;
                        const primary = roles.primary;
                        const verifier = roles.verifier;
                        return (
                          <div key={task} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card, #fafafa)", fontSize: 11 }}>
                            <span style={{ fontWeight: 700, color: "var(--text-sub)", minWidth: 38 }}>{TASK_LABEL[task] ?? task}</span>
                            <span style={{ color: "var(--text-sub)" }}>→</span>
                            {primary && (
                              <span style={{ fontWeight: 800, color: PROVIDER_COLOR[primary] ?? "var(--text-main)", background: `${PROVIDER_COLOR[primary] ?? "#888"}18`, padding: "1px 6px", borderRadius: 4 }}>
                                P: {primary}
                              </span>
                            )}
                            {verifier && (
                              <span style={{ fontWeight: 600, color: PROVIDER_COLOR[verifier] ?? "var(--text-sub)", background: "var(--bg-sub, #f3f4f6)", padding: "1px 6px", borderRadius: 4 }}>
                                V: {verifier}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Dynamic v4 Score — 태스크별 provider 점수 바 */}
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-sub)", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 10 }}>
                        Dynamic Router v4 · {t("benchmark.dynamicScoreLabel")} <span style={{ fontSize: 9, fontWeight: 400, textTransform: "none" as const }}>(0–1000)</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
                        {tasks.map(task => {
                          const roles = currentRoles[task];
                          if (!roles?.dynamic_scores) return null;
                          const dynScores = roles.dynamic_scores as Record<string, { score: number; breakdown: Record<string, number> }>;
                          const ranked = PROVIDERS
                            .map(p => ({ p, score: dynScores[p]?.score ?? 0 }))
                            .sort((a, b) => b.score - a.score);
                          const maxDyn = Math.max(...ranked.map(r => r.score), 1);
                          const primary = roles.primary;
                          return (
                            <div key={task} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-card, #fafafa)" }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-main)", marginBottom: 8 }}>
                                {TASK_LABEL[task] ?? task}
                              </div>
                              {ranked.map(({ p, score }) => {
                                const pct = Math.round((score / maxDyn) * 100);
                                const isWinner = p === primary;
                                return (
                                  <div key={p} style={{ marginBottom: 6 }}>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                                      <span style={{ fontSize: 10, fontWeight: isWinner ? 800 : 500, color: PROVIDER_COLOR[p] ?? "var(--text-sub)" }}>
                                        {isWinner ? "▶ " : ""}{p}
                                      </span>
                                      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-main)", fontVariantNumeric: "tabular-nums" as const }}>
                                        {score.toFixed(0)}
                                      </span>
                                    </div>
                                    <div style={{ height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden" }}>
                                      <div style={{ height: "100%", width: `${pct}%`, borderRadius: 2, background: isWinner ? (PROVIDER_COLOR[p] ?? "#888") : (PROVIDER_COLOR[p] ?? "#888") + "60" }} />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
                <div style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 14 }}>
                  {t("benchmark.banditDesc")}
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={{ padding: "6px 10px", textAlign: "left", color: "var(--text-sub)", fontWeight: 600, borderBottom: "1px solid var(--border)" }}>{t("benchmark.taskHeader")}</th>
                        {PROVIDERS.map(p => (
                          <th key={p} style={{ padding: "6px 10px", textAlign: "center", color: PROVIDER_COLOR[p] ?? "var(--text-main)", fontWeight: 700, borderBottom: "1px solid var(--border)" }}>
                            {p}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map(task => {
                        const rows = (routingScores[task] ?? []) as Array<Record<string, any>>;
                        const scoreMap = Object.fromEntries(rows.map((r: Record<string, any>) => [r.provider, r]));
                        const taskScores = PROVIDERS.map(p => Number(scoreMap[p]?.bandit_score ?? 0));
                        const taskMax = Math.max(...taskScores, 0.01);
                        return (
                          <tr key={task} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ padding: "8px 10px", fontWeight: 600, color: "var(--text-main)" }}>{TASK_LABEL[task] ?? task}</td>
                            {PROVIDERS.map(p => {
                              const row = scoreMap[p];
                              const score = Number(row?.bandit_score ?? 0);
                              const pct = score / taskMax;
                              const bg = pct >= 0.85 ? "#d1fae5" : pct >= 0.65 ? "#fef9c3" : pct >= 0.4 ? "#fee2e2" : "transparent";
                              const textColor = pct >= 0.85 ? "#065f46" : pct >= 0.65 ? "#92400e" : pct >= 0.4 ? "#991b1b" : "var(--text-sub)";
                              const uses = Number(row?.task_uses ?? row?.uses ?? 0);
                              const winRate = row?.task_win_rate != null ? Number(row.task_win_rate) : (row?.win_rate != null ? Number(row.win_rate) : null);
                              return (
                                <td key={p} style={{ padding: "6px 8px", textAlign: "center" }}>
                                  <div style={{ display: "inline-block", padding: "4px 10px", borderRadius: 6, background: bg, color: textColor, fontWeight: 700, fontSize: 13, minWidth: 52 }}>
                                    {score.toFixed(3)}
                                  </div>
                                  <div style={{ fontSize: 10, color: "var(--text-sub)", marginTop: 2 }}>
                                    {uses > 0 ? `${uses}회` : "—"}
                                    {winRate != null && uses > 0 ? ` / ${Math.round(winRate * 100)}%승` : ""}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" as const }}>
                  {[
                    { label: t("benchmark.legendTop"), color: "#d1fae5", text: "#065f46", desc: t("benchmark.legendTopDesc") },
                    { label: t("benchmark.legendCompete"), color: "#fef9c3", text: "#92400e", desc: t("benchmark.legendCompeteDesc") },
                    { label: t("benchmark.legendWeak"), color: "#fee2e2", text: "#991b1b", desc: t("benchmark.legendWeakDesc") }
                  ].map(item => (
                    <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                      <div style={{ width: 12, height: 12, borderRadius: 3, background: item.color, border: `1px solid ${item.text}` }} />
                      <span style={{ color: item.text, fontWeight: 600 }}>{item.label}</span>
                      <span style={{ color: "var(--text-sub)" }}>{item.desc}</span>
                    </div>
                  ))}
                  <button type="button" onClick={loadRoutingScores}
                    style={{ marginLeft: "auto", padding: "4px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", cursor: "pointer", fontSize: 11, color: "var(--text-sub)" }}>
                    {t("benchmark.refresh")}
                  </button>
                </div>

              {/* 누적 실적 — provider별 실사용 데이터 */}
              {accumulatedStats && Object.keys(accumulatedStats).length > 0 && (() => {
                const providers = Object.entries(accumulatedStats).filter(([, v]) => v.runs > 0);
                if (providers.length === 0) return null;
                return (
                  <div style={{ marginTop: 20 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-sub)", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 10 }}>
                      {t("benchmark.accumulatedStats")} <span style={{ fontSize: 9, fontWeight: 400, textTransform: "none" as const }}>(model-scoreboard 집계)</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                      {providers.map(([provider, stats]) => {
                        const winRate = stats.runs > 0 ? stats.wins / stats.runs : 0;
                        const color = PROVIDER_COLOR[provider] ?? "var(--text-sub)";
                        return (
                          <div key={provider} style={{ borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card, #fafafa)", padding: "10px 12px", display: "grid", gap: 4 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 2 }}>{provider.toUpperCase()}</div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                              <span style={{ color: "var(--text-sub)" }}>{t("benchmark.runsWins")}</span>
                              <span style={{ fontWeight: 600 }}>{stats.runs} / {stats.wins}</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                              <span style={{ color: "var(--text-sub)" }}>{t("benchmark.winRate")}</span>
                              <span style={{ fontWeight: 700, color: winRate >= 0.6 ? "#10b981" : winRate >= 0.4 ? "#f59e0b" : "#ef4444" }}>{(winRate * 100).toFixed(1)}%</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                              <span style={{ color: "var(--text-sub)" }}>{t("benchmark.totalTokens")}</span>
                              <span>{stats.total_tokens.toLocaleString()}</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                              <span style={{ color: "var(--text-sub)" }}>{t("benchmark.totalCost")}</span>
                              <span>${stats.estimated_cost_usd.toFixed(4)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
            );
          })()}
        </div>
      )}

      {activeTab === "history" && (
        <div>
          {historyLoading && <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-sub)", fontSize: 13 }}>{t("common.loading")}</div>}
          {!historyLoading && history.length === 0 && (
            <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-sub)" }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>📈</div>
              <div style={{ fontSize: 13 }}>{t("benchmark.noHistory")}<br />{t("benchmark.noHistoryHint")}</div>
            </div>
          )}
          {!historyLoading && history.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
              {/* 트렌드 차트 — orchestra vs single 점수 추이 */}
              {history.length >= 2 && (() => {
                const chartData = [...history].reverse(); // 오래된 순으로
                const W = 560; const H = 110; const PAD = { t: 10, r: 12, b: 28, l: 36 };
                const cW = W - PAD.l - PAD.r; const cH = H - PAD.t - PAD.b;
                const orchScores = chartData.map(e => Number(e.avg_quality_orchestra ?? 0));
                const singleScores = chartData.map(e => Number(e.avg_quality_single ?? 0));
                const winRates = chartData.map(e => Number(e.win_rate ?? 0));
                const allScores = [...orchScores, ...singleScores].filter(s => s > 0);
                const minY = Math.max(0, Math.min(...allScores) - 1);
                const maxY = Math.max(...allScores) + 1;
                const xStep = chartData.length > 1 ? cW / (chartData.length - 1) : cW;
                const toX = (i: number) => PAD.l + i * xStep;
                const toY = (v: number) => PAD.t + cH - ((v - minY) / (maxY - minY)) * cH;
                const polyline = (arr: number[]) =>
                  arr.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
                const yTicks = [minY, (minY + maxY) / 2, maxY].map(v => Math.round(v));
                return (
                  <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", background: "var(--bg-card, #fafafa)" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-sub)", marginBottom: 8, display: "flex", alignItems: "center", gap: 14 }}>
                      <span>{t("benchmark.qualityTrend")}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}><svg width="18" height="3"><line x1="0" y1="1.5" x2="18" y2="1.5" stroke="#6366f1" strokeWidth="2" /></svg>{t("benchmark.orchestra")}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}><svg width="18" height="3"><line x1="0" y1="1.5" x2="18" y2="1.5" stroke="#f87171" strokeWidth="2" strokeDasharray="4 2" /></svg>{t("benchmark.bestSingle")}</span>
                    </div>
                    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block" }}>
                      {/* y grid */}
                      {yTicks.map(v => (
                        <g key={v}>
                          <line x1={PAD.l} y1={toY(v)} x2={W - PAD.r} y2={toY(v)} stroke="var(--border, #e5e7eb)" strokeWidth="1" />
                          <text x={PAD.l - 4} y={toY(v) + 4} textAnchor="end" fontSize="9" fill="var(--text-sub, #9ca3af)">{v.toFixed(0)}</text>
                        </g>
                      ))}
                      {/* win rate bars */}
                      {chartData.map((_, i) => {
                        const bW = Math.max(4, xStep * 0.4);
                        const bH = winRates[i] * cH * 0.35;
                        const bX = toX(i) - bW / 2;
                        const bY = PAD.t + cH - bH;
                        return <rect key={i} x={bX} y={bY} width={bW} height={bH} fill={winRates[i] >= 0.5 ? "#d1fae5" : "#fee2e2"} opacity="0.7" rx="2" />;
                      })}
                      {/* lines */}
                      <polyline points={polyline(singleScores)} fill="none" stroke="#f87171" strokeWidth="1.5" strokeDasharray="5 3" strokeLinejoin="round" />
                      <polyline points={polyline(orchScores)} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" />
                      {/* dots */}
                      {orchScores.map((v, i) => (
                        <circle key={i} cx={toX(i)} cy={toY(v)} r="3" fill="#6366f1" />
                      ))}
                      {singleScores.map((v, i) => (
                        <circle key={i} cx={toX(i)} cy={toY(v)} r="2.5" fill="#f87171" />
                      ))}
                      {/* x labels */}
                      {chartData.map((_, i) => (
                        <text key={i} x={toX(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--text-sub, #9ca3af)">#{i + 1}</text>
                      ))}
                    </svg>
                    <div style={{ fontSize: 10, color: "var(--text-sub)", marginTop: 4 }}>
                      {t("benchmark.winRateBar")} · 최근 {chartData.length}회
                    </div>
                  </div>
                );
              })()}
              <div style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 4 }}>{t("benchmark.recentRecords").replace("{count}", String(history.length))}</div>
              {history.map((entry: Record<string, any>, idx: number) => {
                const winRate = Math.round((entry.win_rate ?? 0) * 100);
                const date = new Date(entry.run_at).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
                return (
                  <div key={idx} style={{ padding: 14, borderRadius: 10, border: "1px solid var(--border)",
                    borderLeft: `3px solid ${winRate >= 60 ? "#10b981" : winRate >= 40 ? "#f59e0b" : "#ef4444"}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: "var(--text-sub)" }}>{date}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: winRate >= 60 ? "#10b981" : winRate >= 40 ? "#f59e0b" : "#ef4444" }}>
                        {t("benchmark.orchestraWinPct").replace("{pct}", String(winRate))}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 16, marginBottom: 8 }}>
                      {[
                        { label: t("benchmark.orchWin"), value: entry.orchestra_wins, color: "#10b981" },
                        { label: t("benchmark.singleWin"), value: (entry.total_cases ?? 0) - (entry.orchestra_wins ?? 0), color: "#ef4444" },
                        { label: t("benchmark.orchQuality"), value: (entry.avg_quality_orchestra ?? 0).toFixed(1), color: "#6366f1" },
                        { label: t("benchmark.singleQuality"), value: (entry.avg_quality_single ?? 0).toFixed(1), color: "#f87171" },
                      ].map(item => (
                        <div key={item.label} style={{ textAlign: "center" as const }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: item.color }}>{item.value}</div>
                          <div style={{ fontSize: 10, color: "var(--text-sub)" }}>{item.label}</div>
                        </div>
                      ))}
                    </div>
                    {/* task별 승률 미니 바 */}
                    {(() => {
                      const ti = entry.comparison?.task_improvement ?? {};
                      const tasks = Object.keys(ti);
                      if (tasks.length === 0) return null;
                      const TASK_L: Record<string, string> = { dialogue: t("task.dialogue"), reasoning: t("task.reasoning"), research: t("task.research"), code: t("task.code"), writing: t("task.writing"), long_doc: t("task.long_doc") };
                      return (
                        <div style={{ display: "flex", flexWrap: "wrap" as const, gap: "4px 10px" }}>
                          {tasks.map(t => {
                            const d = ti[t];
                            const wr = d.total > 0 ? Math.round((d.orchestra_win / d.total) * 100) : 0;
                            const color = wr >= 60 ? "#10b981" : wr >= 40 ? "#f59e0b" : "#ef4444";
                            return (
                              <div key={t} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10 }}>
                                <span style={{ color: "var(--text-sub)", minWidth: 28 }}>{TASK_L[t] ?? t}</span>
                                <div style={{ width: 40, height: 3, borderRadius: 2, background: "var(--border)" }}>
                                  <div style={{ width: wr + "%", height: "100%", borderRadius: 2, background: color }} />
                                </div>
                                <span style={{ fontWeight: 700, color, minWidth: 24 }}>{wr}%</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === "run" && (
        <>
          {error && (
            <div style={{ padding: 12, borderRadius: 8, background: "#fef2f2", color: "#ef4444", fontSize: 13, marginBottom: 16 }}>
              {error}
            </div>
          )}
          {loading && (
            <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-sub)" }}>
              <div style={{ fontSize: 13 }}>{t("benchmark.executingBoth")}</div>
              <div style={{ fontSize: 11, marginTop: 6 }}>{t("benchmark.caseTime")}</div>
            </div>
          )}
          {summary && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 12 }}>
                {[
                  { label: t("benchmark.orchestraWins"), value: summary.orchestra_wins, color: "#10b981" },
                  { label: t("benchmark.singleModelWins"), value: summary.best_single_wins, color: "#ef4444" },
                  { label: t("benchmark.ties"), value: summary.ties, color: "#6b7280" }
                ].map(item => (
                  <div key={item.label} style={{ padding: 16, borderRadius: 10, border: "1px solid var(--border)", textAlign: "center" as const, background: item.color + "08" }}>
                    <div style={{ fontSize: 28, fontWeight: 700, color: item.color }}>{item.value}</div>
                    <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 4 }}>{item.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
                {[
                  { label: t("benchmark.orchestraWinRate"), value: Math.round((summary.win_rate ?? 0) * 100) + "%", color: (summary.win_rate ?? 0) >= 0.5 ? "#10b981" : "#ef4444" },
                  { label: t("benchmark.qualityOrchestra"), value: (summary.avg_quality_orchestra ?? 0).toFixed(1), color: "var(--text-main)" },
                  { label: t("benchmark.qualitySingle"), value: (summary.avg_quality_single ?? 0).toFixed(1), color: "var(--text-sub)" }
                ].map(item => (
                  <div key={item.label} style={{ padding: 12, borderRadius: 10, border: "1px solid var(--border)", textAlign: "center" as const }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: item.color }}>{item.value}</div>
                    <div style={{ fontSize: 11, color: "var(--text-sub)", marginTop: 4 }}>{item.label}</div>
                  </div>
                ))}
              </div>
              {Object.keys(taskImprovement).length > 0 && (() => {
                const taskScores: Record<string, { orchSum: number; singleSum: number; count: number }> = {};
                pairwise.forEach((p: Record<string, any>) => {
                  const t = p.task ?? "unknown";
                  if (!taskScores[t]) taskScores[t] = { orchSum: 0, singleSum: 0, count: 0 };
                  if (Number(p.orchestra_score) > 0 || Number(p.best_single_score) > 0) {
                    taskScores[t].orchSum += Number(p.orchestra_score ?? 0);
                    taskScores[t].singleSum += Number(p.best_single_score ?? 0);
                    taskScores[t].count += 1;
                  }
                });
                const TASK_ORDER_BENCH = ["dialogue", "reasoning", "research", "code", "writing", "long_doc"];
                const sortedTasks = TASK_ORDER_BENCH.filter(t => taskImprovement[t])
                  .concat(Object.keys(taskImprovement).filter(t => !TASK_ORDER_BENCH.includes(t)));
                return (
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", marginBottom: 10, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>{t("benchmark.taskResults")}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
                      {sortedTasks.map(task => {
                        const data = taskImprovement[task];
                        const winRate = data.total > 0 ? Math.round((data.orchestra_win / data.total) * 100) : 0;
                        const sc = taskScores[task];
                        const orchAvg = sc && sc.count > 0 ? sc.orchSum / sc.count : null;
                        const singleAvg = sc && sc.count > 0 ? sc.singleSum / sc.count : null;
                        const gap = orchAvg != null && singleAvg != null ? orchAvg - singleAvg : null;
                        const winColor = winRate >= 50 ? "#10b981" : "#ef4444";
                        return (
                          <div key={task} style={{ padding: 12, borderRadius: 8, border: `1px solid ${winRate >= 50 ? "#a7f3d0" : "#fecaca"}`, background: winRate >= 50 ? "#f0fdf4" : "#fff5f5" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-main)" }}>{TASK_LABEL[task] ?? task}</span>
                              <span style={{ fontSize: 10, color: "var(--text-sub)" }}>{data.total}건</span>
                            </div>
                            <div style={{ marginTop: 4, height: 4, borderRadius: 2, background: "var(--border, #e5e7eb)" }}>
                              <div style={{ width: winRate + "%", height: "100%", borderRadius: 2, background: winColor, transition: "width 0.4s ease" }} />
                            </div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: winColor, marginTop: 5 }}>오케 {winRate}% 승 ({data.orchestra_win}W/{data.best_single_win}L/{data.tie}T)</div>
                            {orchAvg != null && singleAvg != null && (
                              <div style={{ fontSize: 10, color: "var(--text-sub)", marginTop: 3, display: "flex", gap: 6 }}>
                                <span style={{ color: "#6366f1" }}>오케 {orchAvg.toFixed(1)}</span>
                                <span>vs</span>
                                <span style={{ color: "#f87171" }}>단일 {singleAvg.toFixed(1)}</span>
                                <span style={{ fontWeight: 700, color: gap != null && gap >= 0 ? "#10b981" : "#ef4444" }}>
                                  {gap != null ? (gap >= 0 ? "+" : "") + gap.toFixed(1) : ""}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              {pairwise.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", marginBottom: 10, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>{t("benchmark.caseResults")}</div>
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                    {pairwise.map((pair: Record<string, any>, idx: number) => {
                      const winColor = pair.benchmark_winner === "orchestra" ? "#10b981" : pair.benchmark_winner === "best_single" ? "#ef4444" : "#6b7280";
                      const orchEval = pair.orchestra_evaluation ?? {};
                      const rubric: Record<string, number> = orchEval.rubric_breakdown ?? {};
                      const reasons: string[] = orchEval.quality_reasons ?? [];
                      const orchChain: string[] = pair.orchestra_provider_chain ?? [];
                      const RUBRIC_LABEL: Record<string, string> = {
                        base_text_quality: t("benchmark.rubricText"), request_fit: t("benchmark.rubricRequestFit"), multi_provider_reasoning: t("benchmark.rubricMultiReasoning"),
                        verifier_agreement: t("benchmark.rubricVerifierAgree"), claim_density: t("benchmark.rubricClaimDensity"), evidence_strength: t("benchmark.rubricEvidence"),
                        conflict_resolution: t("benchmark.rubricConflictResolution"), judge_quality: t("benchmark.rubricJudge"), consistency: t("benchmark.rubricConsistency"),
                        code_quality: t("benchmark.rubricCodeQuality"), penalty: t("benchmark.rubricPenalty")
                      };
                      const topRubric = Object.entries(rubric)
                        .filter(([k, v]) => k !== "penalty" && (v as number) !== 0)
                        .sort(([, a], [, b]) => (b as number) - (a as number))
                        .slice(0, 4);
                      const singleCandidates = (pair.single_evaluations ?? pair.single_candidates ?? []) as Array<Record<string, any>>;
                      return (
                        <div key={idx} style={{ padding: 14, borderRadius: 10, border: "1px solid var(--border)", borderLeft: `3px solid ${winColor}` }}>
                          {/* 헤더 */}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: "var(--border)", color: "var(--text-sub)" }}>{TASK_LABEL[pair.task] ?? pair.task}</span>
                              <span style={{ fontSize: 12, fontWeight: 700, color: winColor }}>
                                {pair.benchmark_winner === "orchestra" ? t("benchmark.orchWinner") : pair.benchmark_winner === "best_single" ? t("benchmark.singleWinner") : t("benchmark.tie")}
                              </span>
                            </div>
                            <div style={{ fontSize: 11, color: "var(--text-sub)", fontFamily: "monospace" }}>
                              <span style={{ color: "#6366f1", fontWeight: 700 }}>{pair.orchestra_score?.toFixed(1)}</span>
                              {" vs "}
                              <span style={{ color: "#f87171", fontWeight: 700 }}>{pair.best_single_score?.toFixed(1)}</span>
                              <span style={{ marginLeft: 6, color: pair.score_gap >= 0 ? "#10b981" : "#ef4444", fontWeight: 700 }}>
                                ({pair.score_gap >= 0 ? "+" : ""}{pair.score_gap?.toFixed(1)})
                              </span>
                            </div>
                          </div>

                          {/* case_id + provider chain */}
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" as const }}>
                            <span style={{ fontSize: 10, color: "var(--text-soft, #9ca3af)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, maxWidth: 160 }}>{pair.case_id}</span>
                            {orchChain.length > 0 && (
                              <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                                {orchChain.map((p: string, i: number) => (
                                  <span key={i} style={{ fontSize: 9, padding: "1px 5px", borderRadius: 6, background: (PROVIDER_COLOR[p.toLowerCase()] ?? "#888") + "20", color: PROVIDER_COLOR[p.toLowerCase()] ?? "var(--text-sub)", fontWeight: 600 }}>
                                    {p}
                                  </span>
                                ))}
                              </div>
                            )}
                            {pair.best_single_provider && (
                              <span style={{ fontSize: 10, color: "var(--text-sub)" }}>
                                vs <span style={{ fontWeight: 600, color: PROVIDER_COLOR[pair.best_single_provider] ?? "var(--text-main)" }}>{pair.best_single_provider}</span>
                              </span>
                            )}
                          </div>

                          {/* Rubric breakdown bars */}
                          {topRubric.length > 0 && (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 10px", marginBottom: 6 }}>
                              {topRubric.map(([k, v]) => (
                                <div key={k} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                  <span style={{ fontSize: 9, color: "var(--text-sub)", minWidth: 48, whiteSpace: "nowrap" as const }}>{RUBRIC_LABEL[k] ?? k}</span>
                                  <div style={{ flex: 1, height: 3, borderRadius: 2, background: "var(--border)" }}>
                                    <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, (v as number) / 3 * 100))}%`, borderRadius: 2, background: "#6366f1" }} />
                                  </div>
                                  <span style={{ fontSize: 9, fontWeight: 700, color: "var(--text-main)", minWidth: 18, textAlign: "right" as const }}>{(v as number).toFixed(1)}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* quality_reasons tags */}
                          {reasons.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 3 }}>
                              {reasons.slice(0, 5).map((r: string, i: number) => (
                                <span key={i} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: r.includes("bonus") ? "#f0fdf4" : r.includes("penalty") ? "#fff5f5" : "#f3f4f6", color: r.includes("bonus") ? "#065f46" : r.includes("penalty") ? "#991b1b" : "var(--text-sub)" }}>
                                  {r.replace(/_bonus$/, " ✓").replace(/_penalty$/, " ✗").replace(/_/g, " ")}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* single 후보 점수 비교 */}
                          {singleCandidates.length > 1 && (
                            <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" as const }}>
                              {singleCandidates.slice(0, 4).map((s: Record<string, any>, i: number) => {
                                const sp = s.provider ?? s.mode?.replace("single_", "") ?? "?";
                                const ss = Number(s.score ?? s.evaluation?.text_quality_score ?? 0);
                                return (
                                  <span key={i} style={{ fontSize: 9, padding: "1px 7px", borderRadius: 8, background: "var(--border)", color: PROVIDER_COLOR[sp] ?? "var(--text-sub)", fontWeight: 600 }}>
                                    {sp} {ss.toFixed(1)}
                                  </span>
                                );
                              })}
                            </div>
                          )}

                          {/* ── Selection Trace ── 왜 이 답이 선택됐는지 구조적 추적 */}
                          {(() => {
                            const jt = pair.judge_trace ?? {};
                            const decisionRationale: string = pair.decision_rationale ?? jt.rationale ?? "";
                            const winnerReason: string = pair.orchestra_evaluation?.winner_reason ?? "";
                            const claimCount = Number(pair.claim_count ?? jt.claim_count ?? 0);
                            const conflictCount = Number(pair.conflict_count ?? jt.conflict_count ?? 0);
                            const winnerSnap: string = pair.winner_snapshot?.text ?? "";
                            const runnerSnap: string = pair.runner_up_snapshot?.text ?? "";
                            const winnerProv: string = pair.winner_snapshot?.provider ?? "";
                            const runnerProv: string = pair.runner_up_snapshot?.provider ?? "";
                            const hasTrace = decisionRationale || winnerReason || claimCount > 0 || winnerSnap;
                            if (!hasTrace) return null;
                            return (
                              <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "var(--bg-sub, #f8fafc)", border: "1px solid var(--border)" }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-sub)", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 6 }}>
                                  🔍 Selection Trace
                                </div>
                                <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                                  {claimCount > 0 && (
                                    <span style={{ fontSize: 9, padding: "1px 7px", borderRadius: 8, background: "#eff6ff", color: "#3b82f6", fontWeight: 600 }}>
                                      Claims {claimCount}
                                    </span>
                                  )}
                                  {conflictCount > 0 && (
                                    <span style={{ fontSize: 9, padding: "1px 7px", borderRadius: 8, background: "#fff7ed", color: "#f97316", fontWeight: 600 }}>
                                      Conflicts {conflictCount}
                                    </span>
                                  )}
                                  {conflictCount === 0 && claimCount > 0 && (
                                    <span style={{ fontSize: 9, padding: "1px 7px", borderRadius: 8, background: "#f0fdf4", color: "#22c55e", fontWeight: 600 }}>
                                      Conflict-free ✓
                                    </span>
                                  )}
                                </div>
                                {(decisionRationale || winnerReason) && (
                                  <div style={{ fontSize: 10, color: "var(--text-main)", marginBottom: 6, lineHeight: 1.5 }}>
                                    <span style={{ fontWeight: 700, color: winColor }}>Judge: </span>
                                    {decisionRationale || winnerReason}
                                  </div>
                                )}
                                {(winnerSnap || runnerSnap) && (
                                  <div style={{ display: "grid", gridTemplateColumns: runnerSnap ? "1fr 1fr" : "1fr", gap: 6 }}>
                                    {winnerSnap && (
                                      <div style={{ padding: "5px 8px", borderRadius: 6, background: winColor + "10", border: `1px solid ${winColor}30` }}>
                                        <div style={{ fontSize: 8, fontWeight: 700, color: winColor, marginBottom: 3 }}>
                                          ✓ {winnerProv ? winnerProv.toUpperCase() : "WINNER"}
                                        </div>
                                        <div style={{ fontSize: 9, color: "var(--text-main)", lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" as const }}>
                                          {winnerSnap}
                                        </div>
                                      </div>
                                    )}
                                    {runnerSnap && (
                                      <div style={{ padding: "5px 8px", borderRadius: 6, background: "var(--border)", border: "1px solid var(--border)" }}>
                                        <div style={{ fontSize: 8, fontWeight: 700, color: "var(--text-sub)", marginBottom: 3 }}>
                                          {runnerProv ? runnerProv.toUpperCase() : "RUNNER-UP"}
                                        </div>
                                        <div style={{ fontSize: 9, color: "var(--text-sub)", lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" as const }}>
                                          {runnerSnap}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
          {!loading && !result && !error && (
            <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-sub)" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🏆</div>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>{t("benchmark.ready")}</div>
              <div style={{ fontSize: 12 }}>{t("benchmark.readyDesc")}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
