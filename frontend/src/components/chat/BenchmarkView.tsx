import { useMemo, useState } from "react";
import { apiFetch } from "../../api/url";
import { t } from "../../i18n";

type BenchmarkSummary = {
  orchestra_wins?: number;
  best_single_wins?: number;
  ties?: number;
  win_rate?: number;
  avg_quality_orchestra?: number;
  avg_quality_single?: number;
};

type BenchmarkResult = {
  ok: boolean;
  score?: number;
  message?: string;
  details?: Record<string, unknown>;
  comparison?: {
    summary?: BenchmarkSummary;
    pairwise?: Array<Record<string, unknown>>;
    task_improvement?: Record<string, Record<string, number>>;
  };
};

type RoutingRole = {
  primary: string | null;
  verifier: string | null;
  optional: string | null;
  router_policy?: string;
};

type AccumulatedStat = {
  total_tokens: number;
  estimated_cost_usd: number;
  runs: number;
  wins: number;
};

const PROVIDERS = ["openai", "claude", "gemini", "perplexity"] as const;
const TASK_ORDER = ["dialogue", "reasoning", "research", "code", "writing", "long_doc"] as const;

const PROVIDER_COLOR: Record<string, string> = {
  openai: "#10a37f",
  claude: "#c96442",
  gemini: "#4285f4",
  perplexity: "#6366f1"
};

const TASK_LABEL: Record<string, string> = {
  dialogue: t("task.dialogue"),
  reasoning: t("task.reasoning"),
  research: t("task.research"),
  code: t("task.code"),
  writing: t("task.writing"),
  long_doc: t("task.long_doc")
};

function providerClass(provider: string | null | undefined): string {
  if (!provider) return "provider-unknown";
  return `provider-${provider.toLowerCase()}`;
}

function toNum(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDate(iso?: unknown): string {
  if (!iso) return "-";
  const date = new Date(String(iso));
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function BenchmarkView() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [maxCases, setMaxCases] = useState(6);
  const [selectedProviders, setSelectedProviders] = useState<string[]>([...PROVIDERS]);
  const [customMode, setCustomMode] = useState(false);
  const [customQuestion, setCustomQuestion] = useState("");
  const [customTask, setCustomTask] = useState("dialogue");
  const [activeTab, setActiveTab] = useState<"run" | "history" | "routing">("run");

  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [routingScores, setRoutingScores] = useState<Record<string, Array<Record<string, unknown>>> | null>(null);
  const [currentRoles, setCurrentRoles] = useState<Record<string, RoutingRole> | null>(null);
  const [accumulatedStats, setAccumulatedStats] = useState<Record<string, AccumulatedStat> | null>(null);
  const [routingLoading, setRoutingLoading] = useState(false);

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const res = await apiFetch("/api/benchmark/history");
      const data = await res.json();
      if (data.ok) setHistory((data.history ?? []).slice().reverse());
    } catch {
      setHistory([]);
    } finally {
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
      } else {
        setRoutingScores(null);
        setCurrentRoles(null);
        setAccumulatedStats(null);
      }
    } catch {
      setRoutingScores(null);
      setCurrentRoles(null);
      setAccumulatedStats(null);
    } finally {
      setRoutingLoading(false);
    }
  }

  async function runBenchmark() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const payload: Record<string, unknown> = {
        max_cases: maxCases,
        single_providers: selectedProviders
      };

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
      setError(e instanceof Error ? e.message : t("benchmark.executionFailed"));
    } finally {
      setLoading(false);
    }
  }

  function switchTab(tab: "run" | "history" | "routing") {
    setActiveTab(tab);
    if (tab === "history") void loadHistory();
    if (tab === "routing") void loadRoutingScores();
  }

  function toggleProvider(provider: string, checked: boolean) {
    setSelectedProviders((prev) => {
      if (checked) return prev.includes(provider) ? prev : [...prev, provider];
      return prev.filter((item) => item !== provider);
    });
  }

  const summary = result?.comparison?.summary;
  const pairwise = (result?.comparison?.pairwise ?? []) as Array<Record<string, unknown>>;
  const taskImprovement = (result?.comparison?.task_improvement ?? {}) as Record<string, Record<string, number>>;

  const orderedRoutingTasks = useMemo(() => {
    if (!routingScores) return [];
    const known = TASK_ORDER.filter((task) => Object.prototype.hasOwnProperty.call(routingScores, task));
    const extra = Object.keys(routingScores).filter((task) => !TASK_ORDER.includes(task as never)).sort();
    return [...known, ...extra];
  }, [routingScores]);

  return (
    <section className="benchmark-hub">
      <header className="benchmark-hub__head">
        <div className="benchmark-hub__tabs" role="tablist" aria-label="Benchmark tabs">
          {(["run", "history", "routing"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => switchTab(tab)}
              className={`benchmark-tab ${activeTab === tab ? "is-active" : ""}`}
            >
              {tab === "run" ? t("benchmark.tabRun") : tab === "history" ? t("benchmark.tabHistory") : t("benchmark.tabRouting")}
            </button>
          ))}
        </div>

        {activeTab === "run" ? (
          <div className="benchmark-run-controls">
            <label className="benchmark-run-controls__label">
              {t("benchmark.caseCount")}
              <select value={maxCases} onChange={(e) => setMaxCases(Number(e.target.value))}>
                {[3, 6, 10, 20].map((count) => (
                  <option key={count} value={count}>{count}</option>
                ))}
              </select>
            </label>

            <div className="benchmark-provider-group">
              <span>{t("benchmark.compareTarget")}</span>
              {PROVIDERS.map((provider) => {
                const checked = selectedProviders.includes(provider);
                return (
                  <label key={provider} className={`benchmark-provider-chip ${checked ? "is-on" : ""} ${providerClass(provider)}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => toggleProvider(provider, event.target.checked)}
                    />
                    <span>{provider}</span>
                  </label>
                );
              })}
            </div>

            <button
              type="button"
              onClick={runBenchmark}
              disabled={loading || selectedProviders.length === 0}
              className="benchmark-run-btn"
            >
              {loading ? t("benchmark.running") : t("benchmark.run")}
            </button>
          </div>
        ) : null}
      </header>

      {activeTab === "run" ? (
        <div className="benchmark-panel">
          <div className="benchmark-custom-row">
            <label className="benchmark-checkline">
              <input type="checkbox" checked={customMode} onChange={(event) => setCustomMode(event.target.checked)} />
              <span>{t("benchmark.customMode") || "직접 질문 입력"}</span>
            </label>
            {selectedProviders.length === 0 ? <span className="benchmark-warning">{t("benchmark.selectProvider")}</span> : null}
          </div>

          {customMode ? (
            <div className="benchmark-custom-box">
              <div className="benchmark-custom-task">
                <span>Task</span>
                <select value={customTask} onChange={(e) => setCustomTask(e.target.value)}>
                  {TASK_ORDER.map((task) => (
                    <option key={task} value={task}>{TASK_LABEL[task] ?? task}</option>
                  ))}
                </select>
              </div>
              <textarea
                rows={3}
                value={customQuestion}
                onChange={(event) => setCustomQuestion(event.target.value)}
                placeholder={t("benchmark.customPlaceholder") || "비교할 질문을 입력하세요..."}
              />
            </div>
          ) : null}

          {error ? <div className="benchmark-error">{error}</div> : null}
          {loading ? <div className="benchmark-empty">{t("benchmark.executingBoth")} · {t("benchmark.caseTime")}</div> : null}

          {!loading && !result && !error ? (
            <div className="benchmark-empty">
              <div className="benchmark-empty__emoji">🏆</div>
              <strong>{t("benchmark.ready")}</strong>
              <p>{t("benchmark.readyDesc")}</p>
            </div>
          ) : null}

          {summary ? (
            <>
              <div className="benchmark-kpi-grid">
                <article>
                  <span>{t("benchmark.orchestraWins")}</span>
                  <strong className="is-success">{toNum(summary.orchestra_wins)}</strong>
                </article>
                <article>
                  <span>{t("benchmark.singleModelWins")}</span>
                  <strong className="is-danger">{toNum(summary.best_single_wins)}</strong>
                </article>
                <article>
                  <span>{t("benchmark.ties")}</span>
                  <strong>{toNum(summary.ties)}</strong>
                </article>
                <article>
                  <span>{t("benchmark.orchestraWinRate")}</span>
                  <strong className={toNum(summary.win_rate) >= 0.5 ? "is-success" : "is-danger"}>{Math.round(toNum(summary.win_rate) * 100)}%</strong>
                </article>
                <article>
                  <span>{t("benchmark.qualityOrchestra")}</span>
                  <strong>{toNum(summary.avg_quality_orchestra).toFixed(1)}</strong>
                </article>
                <article>
                  <span>{t("benchmark.qualitySingle")}</span>
                  <strong>{toNum(summary.avg_quality_single).toFixed(1)}</strong>
                </article>
              </div>

              {Object.keys(taskImprovement).length > 0 ? (
                <section className="benchmark-task-cards" aria-label="Task results">
                  {Object.entries(taskImprovement).map(([task, data]) => {
                    const total = toNum(data.total);
                    const wins = toNum(data.orchestra_win);
                    const losses = toNum(data.best_single_win);
                    const ties = toNum(data.tie);
                    const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
                    return (
                      <article key={task} className={winRate >= 50 ? "is-positive" : "is-negative"}>
                        <header>
                          <strong>{TASK_LABEL[task] ?? task}</strong>
                          <span>{total}{t("search.countSuffix")}</span>
                        </header>
                        <div className="benchmark-task-cards__bar">
                          <span style={{ width: `${winRate}%` }} />
                        </div>
                        <p>{winRate}% · {wins}W / {losses}L / {ties}T</p>
                      </article>
                    );
                  })}
                </section>
              ) : null}

              {pairwise.length > 0 ? (
                <section className="benchmark-case-list" aria-label="Case results">
                  {pairwise.map((pair, idx) => {
                    const winner = String(pair.benchmark_winner ?? "tie");
                    const winnerText = winner === "orchestra"
                      ? t("benchmark.orchWinner")
                      : winner === "best_single"
                        ? t("benchmark.singleWinner")
                        : t("benchmark.tie");
                    const gap = toNum(pair.score_gap);
                    const task = String(pair.task ?? "-");
                    const orchestraScore = toNum(pair.orchestra_score);
                    const singleScore = toNum(pair.best_single_score);
                    const winnerClass = winner === "orchestra" ? "is-success" : winner === "best_single" ? "is-danger" : "is-neutral";
                    return (
                      <article key={`${pair.case_id ?? idx}`} className={`benchmark-case ${winnerClass}`}>
                        <header>
                          <span className="benchmark-case__task">{TASK_LABEL[task] ?? task}</span>
                          <strong>{winnerText}</strong>
                          <span className="benchmark-case__score">{orchestraScore.toFixed(1)} vs {singleScore.toFixed(1)} ({gap >= 0 ? "+" : ""}{gap.toFixed(1)})</span>
                        </header>
                        <p>{String(pair.case_id ?? "")}</p>
                      </article>
                    );
                  })}
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {activeTab === "history" ? (
        <section className="benchmark-panel">
          {historyLoading ? <div className="benchmark-empty">{t("common.loading")}</div> : null}

          {!historyLoading && history.length === 0 ? (
            <div className="benchmark-empty">
              <div className="benchmark-empty__emoji">📈</div>
              <strong>{t("benchmark.noHistory")}</strong>
              <p>{t("benchmark.noHistoryHint")}</p>
            </div>
          ) : null}

          {!historyLoading && history.length > 0 ? (
            <div className="benchmark-history-list">
              <div className="benchmark-history-list__title">{t("benchmark.recentRecords").replace("{count}", String(history.length))}</div>
              {history.map((entry, idx) => {
                const runAt = formatDate(entry.run_at);
                const winRate = Math.round(toNum(entry.win_rate) * 100);
                const wins = toNum(entry.orchestra_wins);
                const total = toNum(entry.total_cases, wins);
                const singleWins = Math.max(0, total - wins);
                const qOrch = toNum(entry.avg_quality_orchestra).toFixed(1);
                const qSingle = toNum(entry.avg_quality_single).toFixed(1);
                return (
                  <article key={`history-${idx}`} className="benchmark-history-item">
                    <header>
                      <span>{runAt}</span>
                      <strong className={winRate >= 60 ? "is-success" : winRate >= 40 ? "is-warn" : "is-danger"}>
                        {t("benchmark.orchestraWinPct").replace("{pct}", String(winRate))}
                      </strong>
                    </header>
                    <div className="benchmark-history-item__metrics">
                      <span>{t("benchmark.orchWin")}: <strong>{wins}</strong></span>
                      <span>{t("benchmark.singleWin")}: <strong>{singleWins}</strong></span>
                      <span>{t("benchmark.orchQuality")}: <strong>{qOrch}</strong></span>
                      <span>{t("benchmark.singleQuality")}: <strong>{qSingle}</strong></span>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === "routing" ? (
        <section className="benchmark-panel">
          {routingLoading ? <div className="benchmark-empty">{t("common.loading")}</div> : null}

          {!routingLoading && !routingScores ? (
            <div className="benchmark-empty">
              <div className="benchmark-empty__emoji">🧭</div>
              <strong>{t("benchmark.tabRouting")}</strong>
              <p>{t("benchmark.routingHint")}</p>
            </div>
          ) : null}

          {!routingLoading && routingScores ? (
            <>
              {currentRoles ? (
                <section className="benchmark-routing-roles">
                  <header>
                    <strong>{t("benchmark.currentAssignment")}</strong>
                    <button type="button" onClick={loadRoutingScores}>{t("benchmark.refresh")}</button>
                  </header>
                  <div className="benchmark-routing-roles__list">
                    {orderedRoutingTasks.map((task) => {
                      const role = currentRoles[task];
                      if (!role) return null;
                      return (
                        <article key={`role-${task}`}>
                          <strong>{TASK_LABEL[task] ?? task}</strong>
                          <div>
                            <span className={providerClass(role.primary)}>P: {role.primary ?? "-"}</span>
                            <span className={providerClass(role.verifier)}>V: {role.verifier ?? "-"}</span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              <section className="benchmark-routing-table-wrap">
                <table className="benchmark-routing-table">
                  <thead>
                    <tr>
                      <th>{t("benchmark.taskHeader")}</th>
                      {PROVIDERS.map((provider) => (
                        <th key={provider} className={providerClass(provider)}>{provider}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orderedRoutingTasks.map((task) => {
                      const rows = routingScores[task] ?? [];
                      const map = Object.fromEntries(rows.map((row) => [String(row.provider ?? ""), row]));
                      return (
                        <tr key={`score-${task}`}>
                          <td>{TASK_LABEL[task] ?? task}</td>
                          {PROVIDERS.map((provider) => {
                            const record = map[provider] ?? {};
                            const banditScore = toNum(record.bandit_score);
                            const uses = toNum(record.task_uses ?? record.uses);
                            const winRate = toNum(record.task_win_rate ?? record.win_rate);
                            return (
                              <td key={`${task}-${provider}`}>
                                <strong>{banditScore.toFixed(3)}</strong>
                                <span>{uses > 0 ? `${uses}회 / ${Math.round(winRate * 100)}%` : "-"}</span>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>

              {accumulatedStats && Object.keys(accumulatedStats).length > 0 ? (
                <section className="benchmark-accum-grid">
                  {Object.entries(accumulatedStats)
                    .filter(([, stat]) => toNum(stat.runs) > 0)
                    .map(([provider, stat]) => {
                      const runs = toNum(stat.runs);
                      const wins = toNum(stat.wins);
                      const winRate = runs > 0 ? Math.round((wins / runs) * 100) : 0;
                      return (
                        <article key={`accum-${provider}`} className={providerClass(provider)}>
                          <strong>{provider.toUpperCase()}</strong>
                          <p>{t("benchmark.runsWins")}: {runs} / {wins}</p>
                          <p>{t("benchmark.winRate")}: {winRate}%</p>
                          <p>{t("benchmark.totalTokens")}: {toNum(stat.total_tokens).toLocaleString()}</p>
                          <p>{t("benchmark.totalCost")}: ${toNum(stat.estimated_cost_usd).toFixed(4)}</p>
                        </article>
                      );
                    })}
                </section>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
