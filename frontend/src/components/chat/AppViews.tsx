import { useEffect, useMemo, useRef, useState } from "react";
import { apiUrl } from "../../api/url";
import { GENERAL_PROJECT_ID } from "../../store/workspaceStore";
import type { Thread } from "../../types/workspace";
import { extractMediaFromThreads } from "../../appMessageUtils";

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
  details?: any
  comparison?: {
    summary?: BenchmarkSummary
    pairwise?: any[]
    task_improvement?: Record<string, any>
  }
}


type MediaItem = {
  id: string
  url: string
  alt: string
  threadTitle: string
  type: "image" | "video"
  provider?: string
}


export function SearchView({
  threads,
  onOpenThread
}: {
  threads: Thread[];
  onOpenThread: (threadId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, []);

  const trimmed = query.trim().toLowerCase();

  const results = useMemo(() => {
    if (!trimmed) return [];
    return threads
      .flatMap((thread) => {
        const titleMatch = (thread.title ?? "").toLowerCase().includes(trimmed);
        const msgMatches = (thread.messages ?? [])
          .filter((m) => !m.isHidden && m.content?.toLowerCase().includes(trimmed))
          .slice(0, 2);

        if (!titleMatch && msgMatches.length === 0) return [];

        return [{
          threadId: thread.id,
          title: thread.title ?? "새 채팅",
          updatedAt: thread.updatedAt,
          titleMatch,
          snippets: msgMatches.map((m) => {
            const content = m.content ?? "";
            const idx = content.toLowerCase().indexOf(trimmed);
            const start = Math.max(0, idx - 40);
            const end = Math.min(content.length, idx + trimmed.length + 80);
            return content.slice(start, end).trim();
          })
        }];
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 30);
  }, [trimmed, threads]);

  function highlight(text: string, query: string) {
    if (!query) return text;
    const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase()
        ? <mark key={i} style={{ background: "rgba(160,128,32,0.25)", color: "var(--text-main)", borderRadius: 2, padding: "0 1px" }}>{part}</mark>
        : part
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "24px 28px", boxSizing: "border-box" as const }}>
      {/* 검색창 */}
      <div style={{ position: "relative", marginBottom: 20 }}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-soft)", pointerEvents: "none" }}>
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="대화 내용 검색..."
          style={{
            width: "100%", padding: "10px 12px 10px 36px", borderRadius: 10,
            border: "1px solid var(--border)", background: "var(--bg-main)",
            color: "var(--text-main)", fontSize: 14, outline: "none",
            boxSizing: "border-box" as const
          }}
        />
        {query && (
          <button type="button" onClick={() => setQuery("")}
            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", cursor: "pointer", color: "var(--text-soft)", fontSize: 16, lineHeight: 1 }}>
            ×
          </button>
        )}
      </div>

      {/* 결과 */}
      <div style={{ overflowY: "auto", flex: 1 }}>
        {!trimmed ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-soft)", fontSize: 13 }}>
            검색어를 입력하세요
          </div>
        ) : results.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-soft)", fontSize: 13 }}>
            "{query}"에 대한 결과가 없습니다
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12, color: "var(--text-soft)", marginBottom: 4 }}>
              {results.length}개 대화
            </div>
            {results.map((result) => (
              <button
                key={result.threadId}
                type="button"
                onClick={() => onOpenThread(result.threadId)}
                style={{
                  textAlign: "left", padding: "12px 14px", borderRadius: 10,
                  border: "1px solid var(--border)", background: "var(--bg-main)",
                  cursor: "pointer", width: "100%"
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-soft)")}
                onMouseLeave={e => (e.currentTarget.style.background = "var(--bg-main)")}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-main)", marginBottom: result.snippets.length > 0 ? 6 : 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                  {highlight(result.title, trimmed)}
                </div>
                {result.snippets.map((snippet, i) => (
                  <div key={i} style={{ fontSize: 12, color: "var(--text-sub)", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
                    ...{highlight(snippet, trimmed)}...
                  </div>
                ))}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


export function DashboardView() {
  const BILLING = {
    openai:     { url: "https://platform.openai.com/usage",        label: "OpenAI 대시보드" },
    claude:     { url: "https://console.anthropic.com/usage",      label: "Anthropic 대시보드" },
    gemini:     { url: "https://console.cloud.google.com/billing", label: "Google Cloud 대시보드" },
    perplexity: { url: "https://www.perplexity.ai/settings/api",   label: "Perplexity 대시보드" },
  } as Record<string, { url: string; label: string }>;

  const COLORS: Record<string, string> = {
    openai: "#10a37f", claude: "#d97706", gemini: "#3b82f6", perplexity: "#8b5cf6"
  };

  const [acc, setAcc] = useState<Record<string, {
    total_tokens: number; estimated_cost_usd: number; runs: number; wins: number
  }>>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [credits, setCredits] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("corvus-x.credits") ?? "{}"); } catch { return {}; }
  });
  const [editingCredit, setEditingCredit] = useState<string | null>(null);

  function saveCredit(provider: string, value: string) {
    const next = { ...credits, [provider]: value };
    setCredits(next);
    localStorage.setItem("corvus-x.credits", JSON.stringify(next));
    setEditingCredit(null);
    // 누적 데이터 초기화 (서버 API)
    fetch(apiUrl("/api/usage/reset"), { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider })
    }).catch(() => {});
  }

  useEffect(() => {
    setLoading(true);
    fetch(apiUrl("/api/usage"))
      .then(r => r.json())
      .then(d => {
        if (d?.accumulated) setAcc(d.accumulated);
        setLastUpdate(new Date().toLocaleTimeString("ko-KR"));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const providers = Object.keys(acc).filter(p => acc[p].runs > 0);
  const totalTokens = providers.reduce((s, p) => s + acc[p].total_tokens, 0);
  const totalCost   = providers.reduce((s, p) => s + acc[p].estimated_cost_usd, 0);

  return (
    <div style={{ padding: "28px 28px", overflowY: "auto", height: "100%", boxSizing: "border-box" as const }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        {/* 헤더 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-main)" }}>API 사용량 대시보드</div>
            {lastUpdate && <div style={{ fontSize: 11, color: "var(--text-soft)", marginTop: 2 }}>마지막 업데이트: {lastUpdate}</div>}
          </div>
        </div>



        {/* Provider별 상세 */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--text-soft)", fontSize: 13 }}>불러오는 중...</div>
        ) : providers.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--text-soft)", fontSize: 13 }}>대화를 시작하면 사용량이 집계됩니다</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {providers.map(provider => {
              const a = acc[provider];
              const color = COLORS[provider] ?? "#6b7280";
              const billing = BILLING[provider];
              const winRate = a.runs > 0 ? Math.round((a.wins / a.runs) * 100) : 0;
              return (
                <div key={provider} style={{ borderRadius: 12, border: `1px solid ${color}30`, background: "var(--surface-1)", overflow: "hidden" }}>
                  {/* Provider 헤더 */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--border)", background: color + "08" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)", textTransform: "capitalize" }}>{provider}</span>
                    </div>
                    {billing && (
                      <a href={billing.url} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 11, fontWeight: 600, color, textDecoration: "none", padding: "3px 10px", borderRadius: 20, background: color + "15", border: `1px solid ${color}30` }}>
                        {billing.label} →
                      </a>
                    )}
                  </div>
                  {/* 크레딧 입력 */}
                  {editingCredit === provider ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
                      <span style={{ fontSize: 12, color: "var(--text-sub)" }}>충전 크레딧 $</span>
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
                        style={{ flex: 1, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 13, background: "var(--bg-main)", color: "var(--text-main)", outline: "none" }}
                        placeholder="0.00"
                      />
                      <button type="button" onClick={() => setEditingCredit(null)} style={{ fontSize: 11, color: "var(--text-sub)", border: "none", background: "none", cursor: "pointer" }}>취소</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderBottom: "1px solid var(--border)" }}>
                      {credits[provider] ? (
                        <>
                          <span style={{ fontSize: 11, color: "var(--text-sub)" }}>충전</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)" }}>${Number(credits[provider]).toFixed(2)}</span>
                          <span style={{ fontSize: 11, color: "var(--text-sub)", marginLeft: 8 }}>잔여</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: Number(credits[provider]) - a.estimated_cost_usd > 0 ? "#10a37f" : "#ef4444" }}>
                            ${Math.max(0, Number(credits[provider]) - a.estimated_cost_usd).toFixed(4)}
                          </span>
                        </>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--text-soft)" }}>충전 크레딧 미입력</span>
                      )}
                      <button type="button" onClick={() => setEditingCredit(provider)}
                        style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-sub)", border: "1px solid var(--border)", borderRadius: 6, padding: "2px 8px", background: "transparent", cursor: "pointer" }}>
                        {credits[provider] ? "수정" : "입력"}
                      </button>
                    </div>
                  )}
                  {/* 통계 */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0 }}>
                    {[
                      ["총 토큰", a.total_tokens.toLocaleString()],
                      ["총 비용", `$${a.estimated_cost_usd.toFixed(4)}`],
                      ["실행", `${a.runs}회`],
                      ["승률", `${winRate}%`],
                    ].map(([label, value], i) => (
                      <div key={label} style={{ padding: "12px 16px", borderRight: i < 3 ? "1px solid var(--border)" : "none" }}>
                        <div style={{ fontSize: 10, color: "var(--text-sub)", marginBottom: 4 }}>{label}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>{value}</div>
                      </div>
                    ))}
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


export function BenchmarkView() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [maxCases, setMaxCases] = useState(6);
  const [selectedProviders, setSelectedProviders] = useState<string[]>(["openai", "claude", "gemini", "perplexity"]);
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
      const res = await fetch(apiUrl("/api/benchmark/history"));
      const data = await res.json();
      if (data.ok) setHistory((data.history ?? []).slice().reverse());
    } catch {} finally {
      setHistoryLoading(false);
    }
  }

  async function loadRoutingScores() {
    setRoutingLoading(true);
    try {
      const res = await fetch(apiUrl("/api/scoreboard"));
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
      const res = await fetch(apiUrl("/api/benchmark/run"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_cases: maxCases, single_providers: selectedProviders })
      });
      const data = await res.json();
      if (data.ok) setResult(data);
      else setError(data.error ?? "실행 실패");
    } catch (e: any) {
      setError(e.message ?? "네트워크 오류");
    } finally {
      setLoading(false);
    }
  }

  const summary = result?.comparison?.summary;
  const pairwise = result?.comparison?.pairwise ?? [];
  const taskImprovement = result?.comparison?.task_improvement ?? {};

  const PROVIDER_COLOR: Record<string, string> = {
    openai: "#10a37f", claude: "#d97706", gemini: "#3b82f6", perplexity: "#8b5cf6"
  };
  const TASK_LABEL: Record<string, string> = {
    dialogue: "대화", reasoning: "추론", research: "리서치", code: "코드", writing: "글쓰기", long_doc: "긴 문서"
  };

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
              {tab === "run" ? "🏆 실행" : tab === "history" ? "📈 히스토리" : "🧭 라우팅"}
            </button>
          ))}
        </div>
        {activeTab === "run" && (
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" as const }}>
            <label style={{ fontSize: 12, color: "var(--text-sub)" }}>
              케이스 수:
              <select value={maxCases} onChange={e => setMaxCases(Number(e.target.value))}
                style={{ marginLeft: 6, fontSize: 12, padding: "2px 6px", borderRadius: 4, border: "1px solid var(--border)" }}>
                {[3, 6, 10, 20].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            {/* 비교 대상 provider 선택 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-sub)" }}>
              <span>비교 대상:</span>
              {(["openai", "claude", "gemini", "perplexity"] as const).map(p => {
                const COLORS: Record<string, string> = { openai: "#10a37f", claude: "#d97706", gemini: "#3b82f6", perplexity: "#8b5cf6" };
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
              {loading ? "실행 중..." : "실행"}
            </button>
          </div>
          {selectedProviders.length === 0 && (
            <div style={{ fontSize: 11, color: "#ef4444" }}>비교 대상 provider를 1개 이상 선택하세요.</div>
          )}
          </div>
        )}
      </div>

      {activeTab === "routing" && (
        <div>
          {routingLoading && <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-sub)", fontSize: 13 }}>로딩 중...</div>}
          {!routingLoading && !routingScores && (
            <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-sub)" }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>🧭</div>
              <div style={{ fontSize: 13 }}>탭을 클릭하면 현재 라우팅 점수를 불러옵니다.</div>
            </div>
          )}
          {!routingLoading && routingScores && (() => {
            const PROVIDERS = ["openai", "claude", "gemini", "perplexity"];
            const PROVIDER_COLOR: Record<string, string> = { openai: "#10a37f", claude: "#d97706", gemini: "#3b82f6", perplexity: "#8b5cf6" };
            const TASK_LABEL: Record<string, string> = { dialogue: "대화", reasoning: "추론", research: "리서치", code: "코드", writing: "글쓰기", long_doc: "긴 문서" };
            const TASK_ORDER = ["dialogue", "reasoning", "research", "code", "writing", "long_doc"];
            const tasks = TASK_ORDER.filter(t => Object.keys(routingScores).includes(t))
              .concat(Object.keys(routingScores).filter(t => !TASK_ORDER.includes(t)).sort());
            // bandit_score 기준 최대값 (색상 정규화)
            const allScores = tasks.flatMap(t => (routingScores[t] ?? []).map((r: any) => Number(r.bandit_score ?? 0)));
            const maxScore = Math.max(...allScores, 0.01);
            return (
              <div>
                {/* 현재 배정 카드 */}
                {currentRoles && (
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-sub)", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>
                        현재 배정
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
                        Dynamic Router v4 · 12지표 점수 <span style={{ fontSize: 9, fontWeight: 400, textTransform: "none" as const }}>(0–1000)</span>
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
                  provider × task 별 bandit_score — 높을수록 해당 태스크에서 우선 배정됨
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={{ padding: "6px 10px", textAlign: "left", color: "var(--text-sub)", fontWeight: 600, borderBottom: "1px solid var(--border)" }}>태스크</th>
                        {PROVIDERS.map(p => (
                          <th key={p} style={{ padding: "6px 10px", textAlign: "center", color: PROVIDER_COLOR[p] ?? "var(--text-main)", fontWeight: 700, borderBottom: "1px solid var(--border)" }}>
                            {p}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map(task => {
                        const rows: any[] = routingScores[task] ?? [];
                        const scoreMap = Object.fromEntries(rows.map((r: any) => [r.provider, r]));
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
                    { label: "최우선", color: "#d1fae5", text: "#065f46", desc: "해당 태스크 1위" },
                    { label: "경쟁", color: "#fef9c3", text: "#92400e", desc: "근접 경쟁 중" },
                    { label: "열세", color: "#fee2e2", text: "#991b1b", desc: "낮은 우선순위" }
                  ].map(item => (
                    <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                      <div style={{ width: 12, height: 12, borderRadius: 3, background: item.color, border: `1px solid ${item.text}` }} />
                      <span style={{ color: item.text, fontWeight: 600 }}>{item.label}</span>
                      <span style={{ color: "var(--text-sub)" }}>{item.desc}</span>
                    </div>
                  ))}
                  <button type="button" onClick={loadRoutingScores}
                    style={{ marginLeft: "auto", padding: "4px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", cursor: "pointer", fontSize: 11, color: "var(--text-sub)" }}>
                    🔄 새로고침
                  </button>
                </div>

              {/* 누적 실적 — provider별 실사용 데이터 */}
              {accumulatedStats && Object.keys(accumulatedStats).length > 0 && (() => {
                const PROVIDER_COLOR: Record<string, string> = { openai: "#10a37f", claude: "#d97706", gemini: "#3b82f6", perplexity: "#8b5cf6" };
                const providers = Object.entries(accumulatedStats).filter(([, v]) => v.runs > 0);
                if (providers.length === 0) return null;
                return (
                  <div style={{ marginTop: 20 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-sub)", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 10 }}>
                      누적 실사용 실적 <span style={{ fontSize: 9, fontWeight: 400, textTransform: "none" as const }}>(model-scoreboard 집계)</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                      {providers.map(([provider, stats]) => {
                        const winRate = stats.runs > 0 ? stats.wins / stats.runs : 0;
                        const color = PROVIDER_COLOR[provider] ?? "var(--text-sub)";
                        return (
                          <div key={provider} style={{ borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card, #fafafa)", padding: "10px 12px", display: "grid", gap: 4 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 2 }}>{provider.toUpperCase()}</div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                              <span style={{ color: "var(--text-sub)" }}>실행 / 승</span>
                              <span style={{ fontWeight: 600 }}>{stats.runs} / {stats.wins}</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                              <span style={{ color: "var(--text-sub)" }}>승률</span>
                              <span style={{ fontWeight: 700, color: winRate >= 0.6 ? "#10b981" : winRate >= 0.4 ? "#f59e0b" : "#ef4444" }}>{(winRate * 100).toFixed(1)}%</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                              <span style={{ color: "var(--text-sub)" }}>누적 토큰</span>
                              <span>{stats.total_tokens.toLocaleString()}</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                              <span style={{ color: "var(--text-sub)" }}>누적 비용</span>
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
          {historyLoading && <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-sub)", fontSize: 13 }}>로딩 중...</div>}
          {!historyLoading && history.length === 0 && (
            <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-sub)" }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>📈</div>
              <div style={{ fontSize: 13 }}>아직 벤치마크 기록이 없습니다.<br />실행 탭에서 벤치마크를 실행해주세요.</div>
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
                      <span>품질 점수 추이</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}><svg width="18" height="3"><line x1="0" y1="1.5" x2="18" y2="1.5" stroke="#6366f1" strokeWidth="2" /></svg>오케스트라</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}><svg width="18" height="3"><line x1="0" y1="1.5" x2="18" y2="1.5" stroke="#f87171" strokeWidth="2" strokeDasharray="4 2" /></svg>단일 최강</span>
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
                      막대: 오케스트라 승률 (초록=50%↑, 빨강=50%↓) · 최근 {chartData.length}회
                    </div>
                  </div>
                );
              })()}
              <div style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 4 }}>최근 {history.length}개 기록 (최신순)</div>
              {history.map((entry: any, idx: number) => {
                const winRate = Math.round((entry.win_rate ?? 0) * 100);
                const date = new Date(entry.run_at).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
                return (
                  <div key={idx} style={{ padding: 14, borderRadius: 10, border: "1px solid var(--border)",
                    borderLeft: `3px solid ${winRate >= 60 ? "#10b981" : winRate >= 40 ? "#f59e0b" : "#ef4444"}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: "var(--text-sub)" }}>{date}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: winRate >= 60 ? "#10b981" : winRate >= 40 ? "#f59e0b" : "#ef4444" }}>
                        오케스트라 {winRate}% 승
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 16, marginBottom: 8 }}>
                      {[
                        { label: "오케 승", value: entry.orchestra_wins, color: "#10b981" },
                        { label: "단일 승", value: (entry.total_cases ?? 0) - (entry.orchestra_wins ?? 0), color: "#ef4444" },
                        { label: "오케 품질", value: (entry.avg_quality_orchestra ?? 0).toFixed(1), color: "#6366f1" },
                        { label: "단일 품질", value: (entry.avg_quality_single ?? 0).toFixed(1), color: "#f87171" },
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
                      const TASK_L: Record<string, string> = { dialogue: "대화", reasoning: "추론", research: "리서치", code: "코드", writing: "글쓰기", long_doc: "긴문서" };
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
              <div style={{ fontSize: 13 }}>단일 모델 + 오케스트라 동시 실행 중...</div>
              <div style={{ fontSize: 11, marginTop: 6 }}>케이스당 약 15-30초 소요</div>
            </div>
          )}
          {summary && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 12 }}>
                {[
                  { label: "오케스트라 승", value: summary.orchestra_wins, color: "#10b981" },
                  { label: "단일 모델 승", value: summary.best_single_wins, color: "#ef4444" },
                  { label: "동점", value: summary.ties, color: "#6b7280" }
                ].map(item => (
                  <div key={item.label} style={{ padding: 16, borderRadius: 10, border: "1px solid var(--border)", textAlign: "center" as const, background: item.color + "08" }}>
                    <div style={{ fontSize: 28, fontWeight: 700, color: item.color }}>{item.value}</div>
                    <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 4 }}>{item.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
                {[
                  { label: "오케스트라 승률", value: Math.round((summary.win_rate ?? 0) * 100) + "%", color: (summary.win_rate ?? 0) >= 0.5 ? "#10b981" : "#ef4444" },
                  { label: "품질 오케스트라", value: (summary.avg_quality_orchestra ?? 0).toFixed(1), color: "var(--text-main)" },
                  { label: "품질 단일 최강", value: (summary.avg_quality_single ?? 0).toFixed(1), color: "var(--text-sub)" }
                ].map(item => (
                  <div key={item.label} style={{ padding: 12, borderRadius: 10, border: "1px solid var(--border)", textAlign: "center" as const }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: item.color }}>{item.value}</div>
                    <div style={{ fontSize: 11, color: "var(--text-sub)", marginTop: 4 }}>{item.label}</div>
                  </div>
                ))}
              </div>
              {Object.keys(taskImprovement).length > 0 && (() => {
                // pairwise에서 task별 평균 점수 계산
                const taskScores: Record<string, { orchSum: number; singleSum: number; count: number }> = {};
                pairwise.forEach((p: any) => {
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
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", marginBottom: 10, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>Task별 결과</div>
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
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", marginBottom: 10, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>케이스별 결과</div>
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                    {pairwise.map((pair: any, idx: number) => {
                      const winColor = pair.benchmark_winner === "orchestra" ? "#10b981" : pair.benchmark_winner === "best_single" ? "#ef4444" : "#6b7280";
                      const orchEval = pair.orchestra_evaluation ?? {};
                      const rubric: Record<string, number> = orchEval.rubric_breakdown ?? {};
                      const reasons: string[] = orchEval.quality_reasons ?? [];
                      const orchChain: string[] = pair.orchestra_provider_chain ?? [];
                      const RUBRIC_LABEL: Record<string, string> = {
                        base_text_quality: "텍스트", request_fit: "요청 적합", multi_provider_reasoning: "멀티 추론",
                        verifier_agreement: "검증 일치", claim_density: "근거 밀도", evidence_strength: "증거",
                        conflict_resolution: "충돌 해소", judge_quality: "Judge", consistency: "일관성",
                        code_quality: "코드 품질", penalty: "페널티"
                      };
                      const topRubric = Object.entries(rubric)
                        .filter(([k, v]) => k !== "penalty" && (v as number) !== 0)
                        .sort(([, a], [, b]) => (b as number) - (a as number))
                        .slice(0, 4);
                      const singleCandidates: any[] = pair.single_evaluations ?? pair.single_candidates ?? [];
                      return (
                        <div key={idx} style={{ padding: 14, borderRadius: 10, border: "1px solid var(--border)", borderLeft: `3px solid ${winColor}` }}>
                          {/* 헤더 */}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: "var(--border)", color: "var(--text-sub)" }}>{TASK_LABEL[pair.task] ?? pair.task}</span>
                              <span style={{ fontSize: 12, fontWeight: 700, color: winColor }}>
                                {pair.benchmark_winner === "orchestra" ? "✓ 오케스트라" : pair.benchmark_winner === "best_single" ? "단일 모델" : "동점"}
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
                              {singleCandidates.slice(0, 4).map((s: any, i: number) => {
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
                                {/* 헤더 */}
                                <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-sub)", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 6 }}>
                                  🔍 Selection Trace
                                </div>

                                {/* Claims / Conflicts 배지 */}
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

                                {/* Judge 결정 이유 */}
                                {(decisionRationale || winnerReason) && (
                                  <div style={{ fontSize: 10, color: "var(--text-main)", marginBottom: 6, lineHeight: 1.5 }}>
                                    <span style={{ fontWeight: 700, color: winColor }}>Judge: </span>
                                    {decisionRationale || winnerReason}
                                  </div>
                                )}

                                {/* Winner vs Runner-up 텍스트 프리뷰 */}
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
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>벤치마크 준비됨</div>
              <div style={{ fontSize: 12 }}>실행 버튼을 누르면 단일 모델과 오케스트라를<br />동일한 테스트셋으로 비교합니다</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ImageGalleryView({ threads }: { threads: Thread[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMedia, setAllMedia] = useState<MediaItem[]>(() => extractMediaFromThreads(threads));
  const [tab, setTab] = useState<"image" | "video">("image");

  const images = allMedia.filter(m => m.type === tab);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const deleteSelected = () => {
    setAllMedia(prev => prev.filter(m => !selected.has(m.id)));
    setSelected(new Set());
  };

  const deleteAll = () => {
    setAllMedia(prev => prev.filter(m => m.type !== tab));
    setSelected(new Set());
  };

  const videoCount = allMedia.filter(m => m.type === "video").length;
  const imageCount = allMedia.filter(m => m.type === "image").length;

  return (
    <div style={{ padding: "24px 28px", overflowY: "auto", height: "100%", boxSizing: "border-box" as const }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {(["image", "video"] as const).map(t => (
            <button key={t} type="button" onClick={() => { setTab(t); setSelected(new Set()); }}
              style={{ padding: "5px 14px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                background: tab === t ? "var(--text-main)" : "transparent",
                color: tab === t ? "#fff" : "var(--text-sub)" }}>
              {t === "image" ? `🖼 이미지 ${imageCount > 0 ? `(${imageCount})` : ""}` : `🎬 비디오 ${videoCount > 0 ? `(${videoCount})` : ""}`}
            </button>
          ))}
        </div>
        {images.length > 0 && (
          <div style={{ display: "flex", gap: 8 }}>
            {selected.size > 0 && (
              <button type="button" onClick={deleteSelected}
                style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid #ef4444", background: "transparent", color: "#ef4444", cursor: "pointer" }}>
                선택 삭제 ({selected.size})
              </button>
            )}
            <button type="button" onClick={deleteAll}
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-sub)", cursor: "pointer" }}>
              전체 삭제
            </button>
          </div>
        )}
      </div>

      {images.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-sub)", paddingTop: 8 }}>채팅에서 생성된 이미지가 없습니다.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
          {images.map(img => (
            <div
              key={img.id}
              onClick={() => toggleSelect(img.id)}
              style={{
                position: "relative", cursor: "pointer", borderRadius: 8,
                border: selected.has(img.id) ? "2px solid var(--accent, #111827)" : "2px solid transparent",
                overflow: "hidden", background: "var(--surface-1, #f9f9f9)"
              }}
            >
              {img.type === "video" ? (
                String(img.url).startsWith("gs://") ? (
                  <div style={{ width: "100%", aspectRatio: "1", background: "#1e1e2e", display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", gap: 4 }}>
                    <span style={{ fontSize: 24 }}>🎬</span>
                    <a href={img.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: "#818cf8" }} onClick={e => e.stopPropagation()}>열기</a>
                  </div>
                ) : (
                  <video src={img.url} style={{ width: "100%", aspectRatio: "1", objectFit: "cover" as const, display: "block" }} />
                )
              ) : (
                <img src={img.url} alt={img.alt} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }}
                  onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
              )}
              {(img as any).provider && (
                <div style={{ position: "absolute", top: 6, left: 6, fontSize: 8, padding: "1px 5px", borderRadius: 4, background: "rgba(0,0,0,0.55)", color: "#fff", fontWeight: 600 }}>{(img as any).provider}</div>
              )}
              {selected.has(img.id) && (
                <div style={{ position: "absolute", top: 6, right: 6, width: 18, height: 18, borderRadius: "50%", background: "var(--accent, #111827)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#fff" strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg>
                </div>
              )}
              <div style={{ padding: "4px 6px", fontSize: 10, color: "var(--text-sub)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{img.threadTitle}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
