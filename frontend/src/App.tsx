import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { extractDebugMeta } from "./api/chat";
import ChatView from "./components/chat/ChatView";
import HomeView from "./components/chat/HomeView";
import AppShell from "./components/layout/AppShell";
import OrchestrationPanel from "./components/ops/OrchestrationPanel";
import Sidebar from "./components/layout/Sidebar";
import Topbar from "./components/layout/Topbar";
import {
  GENERAL_PROJECT_ID,
  buildLiveMetaFromEvents,
  createDefaultDebugMeta,
  createVersionGroupId,
  nowIso,
  useWorkspaceState
} from "./store/workspaceStore";
import type {
  DebugMeta,
  MainViewMode,
  Message,
  MessageStatus,
  StreamEvent,
  Thread,
  WorkspaceKind
} from "./types/workspace";

async function sendChatStream(
  payload: {
    message: string;
    thread_id: string;
    project_id: string;
    mode: string;
    messages?: Array<{ role: string; content: string }>;
    attached_file?: { name: string; type: string; base64: string; size: number };
    [key: string]: any;
  },
  handlers: {
    onEvent?: (event: StreamEvent) => void;
    onDone?: (payload: any) => void;
  },
  options?: {
    signal?: AbortSignal;
  }
) {
  const response = await fetch("http://localhost:8000/api/chat/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: options?.signal
  });

  if (!response.ok || !response.body) {
    throw new Error(`스트림 연결 실패 (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (options?.signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      while (buffer.includes("\n\n")) {
        const splitIndex = buffer.indexOf("\n\n");
        const rawEvent = buffer.slice(0, splitIndex);
        buffer = buffer.slice(splitIndex + 2);

        const dataLines = rawEvent
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim());

        if (dataLines.length === 0) continue;

        const json = dataLines.join("\n");
        const event = JSON.parse(json) as StreamEvent;

        if (event.type === "done") {
          handlers.onDone?.(event.payload);
        } else {
          handlers.onEvent?.(event);
        }

        if (event.type === "error") {
          throw new Error(event.error || "unknown_error");
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      return;
    }
  }
}

function createMessage(
  role: "user" | "assistant",
  content: string,
  status?: MessageStatus,
  extra?: Partial<Message>
): Message {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    role,
    content,
    createdAt: nowIso(),
    status,
    requestMeta: null,
    ...extra
  };
}

function normalizeThreadTitle(input: string | null | undefined) {
  return String(input ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isGenericThreadTitle(input: string | null | undefined) {
  const normalized = normalizeThreadTitle(input);

  if (!normalized) return true;

  const genericTitles = new Set([
    "새 채팅",
    "새채팅",
    "new chat",
    "untitled",
    "chat",
    "thread",
    "global chat",
    "globalchat",
    "글로벌채팅",
    "글로벌 채팅",
    "일반채팅",
    "일반 채팅",
    "general chat"
  ]);

  return genericTitles.has(normalized);
}

function makeThreadTitle(input: string) {
  const oneLine = input.replace(/\s+/g, " ").trim();
  if (!oneLine) return "새 채팅";
  return oneLine.slice(0, 32);
}

function getVisibleMessages(thread: Thread | null) {
  return (thread?.messages ?? []).filter((message) => !message.isHidden);
}

function findBaseUserMessageIndex(messages: Message[], messageId: string) {
  return messages.findIndex((item) => item.id === messageId);
}

function findNextUserMessageIndex(messages: Message[], startIndex: number) {
  for (let index = startIndex + 1; index < messages.length; index += 1) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }
  return -1;
}

function updateMessageStatus(
  messages: Message[],
  targetId: string,
  updater: (message: Message) => Message
): Message[] {
  return messages.map((message) => (message.id === targetId ? updater(message) : message));
}

function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function extractImagesFromThreads(threads: Thread[]): Array<{ id: string; url: string; alt: string; threadTitle: string }> {
  const results: Array<{ id: string; url: string; alt: string; threadTitle: string }> = [];
  const seen = new Set<string>();
  const mdImgRe = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  const htmlImgRe = /<img[^>]+src=["'](https?:\/\/[^"']+)["'][^>]*>/g;

  for (const thread of threads) {
    for (const msg of thread.messages ?? []) {
      const content = msg.content ?? "";
      let m: RegExpExecArray | null;

      mdImgRe.lastIndex = 0;
      while ((m = mdImgRe.exec(content)) !== null) {
        const url = m[2];
        if (!seen.has(url)) {
          seen.add(url);
          results.push({ id: `${thread.id}_${results.length}`, url, alt: m[1] || "image", threadTitle: thread.title });
        }
      }

      htmlImgRe.lastIndex = 0;
      while ((m = htmlImgRe.exec(content)) !== null) {
        const url = m[1];
        if (!seen.has(url)) {
          seen.add(url);
          results.push({ id: `${thread.id}_${results.length}`, url, alt: "image", threadTitle: thread.title });
        }
      }
    }
  }

  return results;
}

type BenchmarkResult = {
  ok: boolean;
  case_count: number;
  single_providers: string[];
  comparison: {
    summary: { orchestra_wins: number; best_single_wins: number; ties: number; total_cases?: number; win_rate?: number; avg_quality_orchestra?: number; avg_quality_single?: number };
    pairwise: any[];
    task_improvement: Record<string, { total: number; orchestra_win: number; best_single_win: number; tie: number }>;
  };
};

function BenchmarkView() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [maxCases, setMaxCases] = useState(6);
  const [activeTab, setActiveTab] = useState<"run" | "history" | "routing">("run");
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [routingScores, setRoutingScores] = useState<Record<string, any[]> | null>(null);
  const [currentRoles, setCurrentRoles] = useState<Record<string, { primary: string | null; verifier: string | null; optional: string | null }> | null>(null);
  const [routingLoading, setRoutingLoading] = useState(false);

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const res = await fetch("http://localhost:8000/api/benchmark/history");
      const data = await res.json();
      if (data.ok) setHistory((data.history ?? []).slice().reverse());
    } catch {} finally {
      setHistoryLoading(false);
    }
  }

  async function loadRoutingScores() {
    setRoutingLoading(true);
    try {
      const res = await fetch("http://localhost:8000/api/scoreboard");
      const data = await res.json();
      if (data.ok) {
        setRoutingScores(data.task_routing_scores ?? null);
        setCurrentRoles(data.current_roles ?? null);
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
      const res = await fetch("http://localhost:8000/api/benchmark/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_cases: maxCases, single_providers: ["openai", "claude", "perplexity"] })
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
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{ fontSize: 12, color: "var(--text-sub)" }}>
              케이스 수:
              <select value={maxCases} onChange={e => setMaxCases(Number(e.target.value))}
                style={{ marginLeft: 6, fontSize: 12, padding: "2px 6px", borderRadius: 4, border: "1px solid var(--border)" }}>
                {[3, 6, 10, 20].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button type="button" onClick={runBenchmark} disabled={loading}
              style={{ padding: "7px 16px", borderRadius: 8, border: "none",
                background: loading ? "var(--border)" : "var(--text-main)",
                color: loading ? "var(--text-sub)" : "#fff",
                fontSize: 13, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
              {loading ? "실행 중..." : "실행"}
            </button>
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
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-sub)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      현재 배정 (Dynamic chooseRoles)
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
                    <div style={{ display: "flex", gap: 16 }}>
                      {[
                        { label: "오케스트라 승", value: entry.orchestra_wins, color: "#10b981" },
                        { label: "단일 모델 승", value: (entry.total_cases ?? 0) - (entry.orchestra_wins ?? 0), color: "#ef4444" },
                        { label: "품질 오케스트라", value: (entry.avg_quality_orchestra ?? 0).toFixed(1), color: "var(--text-main)" },
                        { label: "품질 단일", value: (entry.avg_quality_single ?? 0).toFixed(1), color: "var(--text-sub)" },
                      ].map(item => (
                        <div key={item.label} style={{ textAlign: "center" as const }}>
                          <div style={{ fontSize: 16, fontWeight: 700, color: item.color }}>{item.value}</div>
                          <div style={{ fontSize: 10, color: "var(--text-sub)" }}>{item.label}</div>
                        </div>
                      ))}
                    </div>
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
              {Object.keys(taskImprovement).length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", marginBottom: 10, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>Task별 결과</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
                    {Object.entries(taskImprovement).map(([task, data]) => {
                      const winRate = data.total > 0 ? Math.round((data.orchestra_win / data.total) * 100) : 0;
                      return (
                        <div key={task} style={{ padding: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-1, #f9fafb)" }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-main)", marginBottom: 6 }}>{TASK_LABEL[task] ?? task}</div>
                          <div style={{ fontSize: 11, color: "var(--text-sub)" }}>{data.total}건 중</div>
                          <div style={{ marginTop: 6, height: 4, borderRadius: 2, background: "var(--border)" }}>
                            <div style={{ width: winRate + "%", height: "100%", borderRadius: 2, background: winRate >= 50 ? "#10b981" : "#ef4444", transition: "width 0.4s ease" }} />
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: winRate >= 50 ? "#10b981" : "#ef4444", marginTop: 4 }}>오케스트라 {winRate}% 승</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {pairwise.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", marginBottom: 10, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>케이스별 결과</div>
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                    {pairwise.map((pair: any, idx: number) => (
                      <div key={idx} style={{ padding: 14, borderRadius: 10, border: "1px solid var(--border)",
                        borderLeft: `3px solid ${pair.benchmark_winner === "orchestra" ? "#10b981" : pair.benchmark_winner === "best_single" ? "#ef4444" : "#6b7280"}` }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: "var(--border)", color: "var(--text-sub)" }}>{TASK_LABEL[pair.task] ?? pair.task}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: pair.benchmark_winner === "orchestra" ? "#10b981" : pair.benchmark_winner === "best_single" ? "#ef4444" : "#6b7280" }}>
                              {pair.benchmark_winner === "orchestra" ? "✓ 오케스트라" : pair.benchmark_winner === "best_single" ? "단일 모델" : "동점"}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-sub)", fontFamily: "monospace" }}>
                            {pair.orchestra_score?.toFixed(1)} vs {pair.best_single_score?.toFixed(1)}
                            <span style={{ marginLeft: 6, color: pair.score_gap >= 0 ? "#10b981" : "#ef4444" }}>({pair.score_gap >= 0 ? "+" : ""}{pair.score_gap?.toFixed(1)})</span>
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-sub)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{pair.case_id}</div>
                        {pair.best_single_provider && (
                          <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-sub)" }}>
                            최강 단일: <span style={{ fontWeight: 600, color: PROVIDER_COLOR[pair.best_single_provider] ?? "var(--text-main)" }}>{pair.best_single_provider}</span>
                          </div>
                        )}
                      </div>
                    ))}
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

function ImageGalleryView({ threads }: { threads: Thread[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [images, setImages] = useState(() => extractImagesFromThreads(threads));

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const deleteSelected = () => {
    setImages(prev => prev.filter(img => !selected.has(img.id)));
    setSelected(new Set());
  };

  const deleteAll = () => {
    setImages([]);
    setSelected(new Set());
  };

  return (
    <div style={{ padding: "24px 28px", overflowY: "auto", height: "100%", boxSizing: "border-box" as const }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-main)" }}>이미지</div>
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
              <img src={img.url} alt={img.alt} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }} />
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

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function ProjectCreateModal({
  open,
  value,
  onChange,
  onClose,
  onSubmit
}: {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="project-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="project-modal__header">
          <div className="project-modal__title">새 프로젝트</div>

          <div className="project-modal__actions">
            <button type="button" className="project-modal__icon-btn" onClick={onClose} aria-label="닫기">
              <CloseIcon />
            </button>
          </div>
        </div>

        <div className="project-modal__label">프로젝트 이름</div>

        <div className="project-modal__input-wrap">
          <span className="project-modal__input-icon">
            <FolderIcon />
          </span>
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmit();
              }
            }}
            className="project-modal__input"
            placeholder="예: AI ORCHESTRA UI 리디자인"
          />
        </div>

        <div className="project-modal__chips">
          <button type="button" className="project-modal__chip" onClick={() => onChange("AI ORCHESTRA")}>
            AI ORCHESTRA
          </button>
          <button type="button" className="project-modal__chip" onClick={() => onChange("멀티 AI 리서치")}>
            멀티 AI 리서치
          </button>
          <button type="button" className="project-modal__chip" onClick={() => onChange("UI 고도화")}>
            UI 고도화
          </button>
        </div>

        <div className="project-modal__notice">
          프로젝트를 만들면 프로젝트 홈과 스레드 구조가 분리되어 관리됩니다.
        </div>

        <div className="project-modal__footer">
          <button
            type="button"
            className="project-modal__submit"
            onClick={onSubmit}
            disabled={!value.trim()}
          >
            생성
          </button>
        </div>
      </div>
    </div>
  );
}

type SendTarget = {
  threadId: string;
  projectId: string;
  currentTitle: string;
};

type RetryOptions = {
  replaceFromMessageId?: string | null;
};

type ActiveStreamState = {
  controller: AbortController;
  threadId: string;
  projectId: string;
  placeholderId: string;
};

export default function App() {
  const workspace = useWorkspaceState();

  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [attachedFile, setAttachedFile] = useState<{ name: string; type: string; base64: string; size: number } | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [debugMeta, setDebugMeta] = useState<DebugMeta>(createDefaultDebugMeta());
  const [sidebarView, setSidebarView] = useState<"default" | "search" | "images" | "benchmark">("default");
  const [artifactList, setArtifactList] = useState<Array<{ id: string; title: string; code: string; language: string }>>([]);
  const [activeArtifact, setActiveArtifact] = useState<{ id: string; title: string; code: string; language: string } | null>(null);
  const [showPanel, setShowPanel] = useState(true);
  const [composerOptions, setComposerOptions] = useState<{ force_pro?: boolean; deep_research?: boolean; task?: string } | null>(null);
  const [dialog, setDialog] = useState<{
    type: "rename-project" | "delete-project" | "rename-thread" | "delete-thread";
    id: string;
    currentTitle?: string;
  } | null>(null);
  const [dialogInput, setDialogInput] = useState("");
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");

  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [projectTitleDraft, setProjectTitleDraft] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoStickRef = useRef(true);
  const pendingScrollBehaviorRef = useRef<ScrollBehavior | null>("auto");
  const activeStreamRef = useRef<ActiveStreamState | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      setShowScrollToBottom(false);
      return;
    }

    const updateStickiness = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const isNearBottom = distanceFromBottom <= 96;
      shouldAutoStickRef.current = isNearBottom;
      setShowScrollToBottom(distanceFromBottom > 120);
    };

    updateStickiness();
    el.addEventListener("scroll", updateStickiness, { passive: true });

    return () => {
      el.removeEventListener("scroll", updateStickiness);
    };
  }, [workspace.activeThreadId, sidebarView]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (!shouldAutoStickRef.current && pendingScrollBehaviorRef.current === null) return;

    const behavior = pendingScrollBehaviorRef.current ?? "auto";

    requestAnimationFrame(() => {
      const latest = scrollRef.current;
      if (!latest) return;

      latest.scrollTo({
        top: latest.scrollHeight,
        behavior
      });

      const distanceFromBottom = latest.scrollHeight - latest.scrollTop - latest.clientHeight;
      setShowScrollToBottom(distanceFromBottom > 120);
      pendingScrollBehaviorRef.current = null;
    });
  }, [workspace.threads, workspace.activeThreadId, isSending]);

  const workspaceKind: WorkspaceKind =
    workspace.activeProjectId === GENERAL_PROJECT_ID ? "general" : "project";
  const mode: MainViewMode = workspace.activeThreadId ? "thread-chat" : "home";

  const messageVersionMap = useMemo(() => {
    const thread = workspace.activeThread;
    if (!thread) return {};

    const versions = thread.messageVersions ?? {};
    const activeVersionIndex = thread.activeVersionIndex ?? {};
    const result: Record<string, { current: number; total: number }> = {};

    for (const [groupId, messages] of Object.entries(versions)) {
      if (!Array.isArray(messages) || messages.length <= 1) continue;

      const visibleUserMessage = thread.messages.find(
        (item) => item.role === "user" && !item.isHidden && item.versionGroupId === groupId
      );

      if (!visibleUserMessage) continue;

      result[visibleUserMessage.id] = {
        current: (activeVersionIndex[groupId] ?? 0) + 1,
        total: messages.filter((item) => item.role === "user").length || messages.length
      };
    }

    return result;
  }, [workspace.activeThread]);

  function focusComposer() {
    queueMicrotask(() => textareaRef.current?.focus());
  }

  function markScrollToBottom(behavior: ScrollBehavior = "auto") {
    shouldAutoStickRef.current = true;
    pendingScrollBehaviorRef.current = behavior;
    setShowScrollToBottom(false);
  }

  function resetEditingState() {
    setEditingMessageId(null);
    setEditingDraft("");
  }

  function openProjectModal() {
    setProjectTitleDraft("");
    setIsProjectModalOpen(true);
  }

  function closeProjectModal() {
    setIsProjectModalOpen(false);
    setProjectTitleDraft("");
  }

  function handleSubmitProjectModal() {
    const nextTitle = projectTitleDraft.trim();
    if (!nextTitle) return;

    workspace.createNamedProject(nextTitle);
    setDraft("");
    setLastError(null);
    setDebugMeta(createDefaultDebugMeta());
    setSidebarView("default");
    resetEditingState();
    markScrollToBottom("auto");
    closeProjectModal();
  }

  function handleOpenGeneralHome() {
    workspace.openGeneralHome();
    setDraft("");
    setLastError(null);
    setSidebarView("default");
    resetEditingState();
    markScrollToBottom("auto");
  }

  function handleSelectProject(projectId: string) {
    workspace.selectProject(projectId);
    setDraft("");
    setLastError(null);
    setSidebarView("default");
    resetEditingState();
    markScrollToBottom("auto");
  }

  function handleOpenThread(threadId: string) {
    workspace.openThread(threadId);
    setDraft("");
    setLastError(null);
    setSidebarView("default");
    resetEditingState();
    markScrollToBottom("auto");
    focusComposer();
  }

  function handleOpenSearch() {
    workspace.setActiveThreadId(null);
    setSidebarView("search");
    setLastError(null);
    resetEditingState();
    markScrollToBottom("auto");
  }

  function handleOpenImages() {
    workspace.setActiveThreadId(null);
    setSidebarView("images");
    setLastError(null);
    resetEditingState();
    markScrollToBottom("auto");
  }

  function handleOpenBenchmark() {
    workspace.setActiveThreadId(null);
    setSidebarView("benchmark");
    setLastError(null);
    resetEditingState();
    markScrollToBottom("auto");
  }

  function handleCreateNamedProject() {
    openProjectModal();
  }

  function handleCreateThreadInProject(projectId: string) {
    workspace.createThreadInProject(projectId);
    setDraft("");
    setLastError(null);
    setDebugMeta(createDefaultDebugMeta());
    setSidebarView("default");
    resetEditingState();
    markScrollToBottom("auto");
    focusComposer();
  }

  function handleToggleProjectMemory(projectId: string) {
    const project = workspace.projects.find((item) => item.id === projectId);
    if (!project) return;

    workspace.updateProjectMeta(projectId, {
      memoryEnabled: !project.meta?.memoryEnabled
    });
  }

  function handleRenameThreadFromHome(threadId: string, nextTitle: string) {
    const safeTitle = nextTitle.trim();
    if (!safeTitle) return;

    workspace.updateThreadById(threadId, (thread) => ({
      ...thread,
      title: safeTitle,
      updatedAt: nowIso()
    }));

    const targetThread = workspace.threads.find((thread) => thread.id === threadId);
    if (targetThread) {
      workspace.touchProject(targetThread.projectId, nowIso());
    }
  }

  function handleMoveThreadFromHome(threadId: string, nextProjectId: string) {
    if (!nextProjectId) return;
    workspace.moveThread(threadId, nextProjectId);
  }

  function backToHome() {
    workspace.setActiveThreadId(null);
    setLastError(null);
    setSidebarView("default");
    resetEditingState();
    markScrollToBottom("auto");
  }

  function handleScrollToBottom() {
    const el = scrollRef.current;
    if (!el) return;

    el.scrollTo({
      top: el.scrollHeight,
      behavior: "smooth"
    });

    shouldAutoStickRef.current = true;
    setShowScrollToBottom(false);
  }

  function handleStopGenerating() {
    const activeStream = activeStreamRef.current;
    if (!activeStream) return;

    activeStream.controller.abort();

    workspace.updateThreadById(activeStream.threadId, (thread) => ({
      ...thread,
      updatedAt: nowIso(),
      messages: updateMessageStatus(thread.messages, activeStream.placeholderId, (message) => ({
        ...message,
        content: message.content?.trim() ? message.content : "생성이 중단되었습니다.",
        status: "done",
        requestMeta: message.requestMeta ?? debugMeta
      }))
    }));

    workspace.touchProject(activeStream.projectId);
    activeStreamRef.current = null;
    setIsSending(false);
    setLastError(null);
    setShowScrollToBottom(false);
    focusComposer();
  }

  async function sendMessageToThread(text: string, target: SendTarget, options?: RetryOptions) {
    const trimmed = text.trim();
    if ((!trimmed && !attachedFile) || isSending) return;

    const timestamp = nowIso();
    const replaceFromMessageId = options?.replaceFromMessageId ?? null;
    const activeThread = workspace.threads.find((thread) => thread.id === target.threadId) ?? null;
    const visibleMessages = getVisibleMessages(activeThread);

    let versionGroupId = createVersionGroupId();
    let versionIndex = 0;
    let preservedMessages = visibleMessages;
    let messageVersions = { ...(activeThread?.messageVersions ?? {}) };
    let activeVersionIndex = { ...(activeThread?.activeVersionIndex ?? {}) };

    if (replaceFromMessageId && activeThread) {
      const replaceIndex = findBaseUserMessageIndex(visibleMessages, replaceFromMessageId);
      if (replaceIndex >= 0) {
        const originalUserMessage = visibleMessages[replaceIndex];
        versionGroupId = originalUserMessage.versionGroupId ?? createVersionGroupId();

        const groupMessages = [...(messageVersions[versionGroupId] ?? [])];
        const nextExistingIndex =
          Math.max(
            -1,
            ...groupMessages
              .filter((item) => item.role === "user")
              .map((item) => item.versionIndex ?? 0)
          ) + 1;

        const originalAnswer =
          replaceIndex + 1 < visibleMessages.length && visibleMessages[replaceIndex + 1]?.role === "assistant"
            ? visibleMessages[replaceIndex + 1]
            : null;

        const archivedUserMessage: Message = {
          ...originalUserMessage,
          versionGroupId,
          versionIndex: originalUserMessage.versionIndex ?? 0,
          isHidden: true
        };

        const existingUserIndex = groupMessages.findIndex(
          (item) =>
            item.role === "user" &&
            item.versionIndex === archivedUserMessage.versionIndex &&
            item.versionGroupId === versionGroupId
        );

        if (existingUserIndex >= 0) {
          groupMessages[existingUserIndex] = archivedUserMessage;
        } else {
          groupMessages.push(archivedUserMessage);
        }

        if (originalAnswer) {
          const archivedAnswer: Message = {
            ...originalAnswer,
            versionGroupId,
            versionIndex: archivedUserMessage.versionIndex ?? 0,
            isHidden: true
          };

          const existingAnswerIndex = groupMessages.findIndex(
            (item) =>
              item.role === "assistant" &&
              item.versionIndex === archivedAnswer.versionIndex &&
              item.versionGroupId === versionGroupId
          );

          if (existingAnswerIndex >= 0) {
            groupMessages[existingAnswerIndex] = archivedAnswer;
          } else {
            groupMessages.push(archivedAnswer);
          }
        }

        versionIndex = nextExistingIndex;
        messageVersions[versionGroupId] = groupMessages;
        activeVersionIndex[versionGroupId] = versionIndex;

        const nextUserBoundary = findNextUserMessageIndex(visibleMessages, replaceIndex);
        preservedMessages =
          nextUserBoundary >= 0
            ? visibleMessages.slice(0, replaceIndex).concat(visibleMessages.slice(nextUserBoundary))
            : visibleMessages.slice(0, replaceIndex);
      }
    }

    const displayText = trimmed || (attachedFile ? `📎 ${attachedFile.name}` : "")
    const userMessage = createMessage("user", displayText, "done", {
      versionGroupId,
      versionIndex,
      isHidden: false
    });

    const assistantPlaceholder = createMessage("assistant", "", "pending", {
      versionGroupId,
      versionIndex,
      isHidden: false
    });

    const nextTitle = makeThreadTitle(trimmed || (attachedFile?.name ?? "파일 분석"));
    const liveEvents: StreamEvent[] = [];
    let liveMeta = createDefaultDebugMeta();
    let finalTextFromEvent = "";
    const controller = new AbortController();

    activeStreamRef.current = {
      controller,
      threadId: target.threadId,
      projectId: target.projectId,
      placeholderId: assistantPlaceholder.id
    };

    markScrollToBottom("smooth");

    workspace.updateThreadById(target.threadId, (thread) => ({
      ...thread,
      title: isGenericThreadTitle(thread.title) ? nextTitle : thread.title,
      updatedAt: timestamp,
      meta: {
        ...(thread.meta ?? {}),
        lastSummary: trimmed.slice(0, 160)
      },
      messages: [...preservedMessages, userMessage, assistantPlaceholder],
      messageVersions,
      activeVersionIndex
    }));
    workspace.touchProject(target.projectId, timestamp);

    setDraft("");
    setComposerOptions(null);
    setIsSending(true);
    setLastError(null);
    setDebugMeta(createDefaultDebugMeta());
    resetEditingState();

    try {
      // 현재 스레드 메시지 수집 (핸드오프/세션 요약용)
      const currentThread = workspace.threads.find(t => t.id === target.threadId);
      const threadMessages = (currentThread?.messages ?? [])
        .filter(m => !m.isHidden && m.content?.trim())
        .map(m => ({ role: m.role, content: m.content }));

      await sendChatStream(
        {
          message: trimmed || (attachedFile ? `첨부 파일 ${attachedFile.name}을 분석해줘` : ""),
          thread_id: target.threadId,
          project_id: target.projectId,
          mode: "runtime_orchestra",
          messages: threadMessages,
          ...(composerOptions ?? {}),
          ...(attachedFile ? {
            attached_file: {
              name: attachedFile.name,
              type: attachedFile.type,
              base64: attachedFile.base64,
              size: attachedFile.size
            }
          } : {})
        },
        {
          onEvent: (event) => {
            liveEvents.push(event);
            liveMeta = buildLiveMetaFromEvents(liveEvents);

            if (event.type === "provider_chunk") {
              const winnerProvider =
                liveMeta.displayWinner?.provider ??
                liveMeta.winnerProvider ??
                liveMeta.selectedProviders[0] ??
                event.provider;

              const currentWinnerDraft =
                liveMeta.providerDrafts?.find((item) => item.provider === winnerProvider)?.content ?? "";

              workspace.updateThreadById(target.threadId, (thread) => ({
                ...thread,
                updatedAt: nowIso(),
                messages: updateMessageStatus(thread.messages, assistantPlaceholder.id, (message) => ({
                  ...message,
                  content: currentWinnerDraft,
                  status: "pending",
                  requestMeta: liveMeta
                }))
              }));

              setDebugMeta(liveMeta);
              return;
            }

            if (event.type === "answer_chunk") {
              workspace.updateThreadById(target.threadId, (thread) => ({
                ...thread,
                updatedAt: nowIso(),
                messages: updateMessageStatus(thread.messages, assistantPlaceholder.id, (message) => ({
                  ...message,
                  content: `${message.content}${event.content ?? ""}`,
                  status: "pending",
                  requestMeta: liveMeta
                }))
              }));

              setDebugMeta(liveMeta);
              return;
            }

            if (event.type === "final") {
              finalTextFromEvent = String(event.content ?? "");
              liveMeta = {
                ...liveMeta,
                winnerProvider: event.provider ?? liveMeta.winnerProvider ?? null,
                displayWinner: {
                  provider: event.provider ?? liveMeta.winnerProvider ?? undefined,
                  role: liveMeta.displayWinner?.role
                }
              };

              workspace.updateThreadById(target.threadId, (thread) => ({
                ...thread,
                updatedAt: nowIso(),
                messages: updateMessageStatus(thread.messages, assistantPlaceholder.id, (message) => ({
                  ...message,
                  content: finalTextFromEvent || message.content,
                  status: "pending",
                  requestMeta: liveMeta
                }))
              }));

              setDebugMeta(liveMeta);
              return;
            }

            setDebugMeta(liveMeta);
          },
          onDone: (payload) => {
            // 슬라이드 데이터 감지 — 다운로드 버튼 메시지로 처리
            if (payload?.is_slide && payload?.slide_data) {
              const slideData = payload.slide_data
              const slideText = String(payload?.answer?.text ?? "").trim()
              workspace.updateThreadById(target.threadId, (thread) => ({
                ...thread,
                updatedAt: nowIso(),
                messages: updateMessageStatus(thread.messages, assistantPlaceholder.id, (msg) => ({
                  ...msg,
                  content: slideText,
                  status: "done",
                  requestMeta: { ...(msg.requestMeta ?? {}), slide_data: slideData }
                }))
              }))
              workspace.touchProject(target.projectId)
              setIsSending(false)
              setAttachedFile(null)
              focusComposer()
              activeStreamRef.current = null
              return
            }

            // 이미지 생성 결과 저장
            if (payload?.is_image && payload?.image_url) {
              const imageUrl = payload.image_url
              const imageText = String(payload?.answer?.text ?? "🎨 이미지가 생성됐습니다.").trim()
              workspace.updateThreadById(target.threadId, (thread) => ({
                ...thread,
                updatedAt: nowIso(),
                messages: updateMessageStatus(thread.messages, assistantPlaceholder.id, (msg) => ({
                  ...msg,
                  content: imageText,
                  status: "done",
                  requestMeta: {
                    ...(msg.requestMeta ?? {}),
                    image_url: imageUrl,
                    image_revised_prompt: payload?.image_revised_prompt ?? null
                  }
                }))
              }))
              workspace.touchProject(target.projectId)
              setIsSending(false)
              setAttachedFile(null)
              focusComposer()
              activeStreamRef.current = null
              return
            }

            // done 시점에 이미 화면에 표시된 내용을 우선 사용
            const currentDisplayContent = (() => {
              const thread = workspace.threads.find(t => t.id === target.threadId)
              return thread?.messages.find(m => m.id === assistantPlaceholder.id)?.content ?? ""
            })()

            const assistantText =
              String(payload?.answer?.text ?? "").trim() ||
              finalTextFromEvent ||
              currentDisplayContent ||
              liveMeta.providerDrafts?.find((item) => item.provider === liveMeta.displayWinner?.provider)?.content ||
              liveMeta.providerDrafts?.find((item) => item.provider === liveMeta.winnerProvider)?.content ||
              "";

            const rawMeta = extractDebugMeta(payload) as any;

            const meta: DebugMeta = {
              ...rawMeta,
              providerDrafts: liveMeta.providerDrafts ?? [],
              displayWinner: rawMeta?.display_winner ?? null,
              displayLosers: rawMeta?.display_losers ?? [],
              hiddenFailedProviders: rawMeta?.hidden_failed_providers ?? [],
              primaryRecovered: rawMeta?.primary_recovered ?? false,
              recoveryFromModel: rawMeta?.recovery_from_model ?? null,
              recoveryToModel: rawMeta?.recovery_to_model ?? null,
              providerStatusMap: rawMeta?.provider_status_map ?? {},
              providerStreamSummary: rawMeta?.provider_stream_summary ?? {},
              timelineEvents: rawMeta?.timeline_events ?? []
            };

            workspace.updateThreadById(target.threadId, (thread) => {
              const nextMessages: Message[] = updateMessageStatus(thread.messages, assistantPlaceholder.id, (message) => ({
                ...message,
                content:
                  assistantText ||
                  message.content ||
                  "응답은 왔지만 표시 가능한 final_answer를 찾지 못했습니다.",
                status: "done",
                requestMeta: meta
              }));

              const nextThread: Thread = {
                ...thread,
                updatedAt: nowIso(),
                meta: {
                  ...(thread.meta ?? {}),
                  lastSummary: assistantText.slice(0, 160)
                },
                messages: nextMessages
              };

              if (replaceFromMessageId) {
                const groupId = userMessage.versionGroupId ?? "";
                const finalizedAssistant =
                  nextMessages.find((item) => item.id === assistantPlaceholder.id) ?? assistantPlaceholder;

                const mergedGroupMessages: Message[] = [
                  ...(thread.messageVersions?.[groupId] ?? []).filter(
                    (item) => item.versionIndex !== userMessage.versionIndex
                  ),
                  userMessage,
                  finalizedAssistant
                ];

                nextThread.messageVersions = {
                  ...(thread.messageVersions ?? {}),
                  [groupId]: mergedGroupMessages
                };
                nextThread.activeVersionIndex = {
                  ...(thread.activeVersionIndex ?? {}),
                  [groupId]: userMessage.versionIndex ?? 0
                };
              }

              return nextThread;
            });

            workspace.touchProject(target.projectId);
            setDebugMeta(meta);
          }
        },
        {
          signal: controller.signal
        }
      );
    } catch (error) {
      if (isAbortError(error)) {
        workspace.updateThreadById(target.threadId, (thread) => ({
          ...thread,
          updatedAt: nowIso(),
          messages: updateMessageStatus(thread.messages, assistantPlaceholder.id, (item) => ({
            ...item,
            content: item.content?.trim() ? item.content : "생성이 중단되었습니다.",
            status: "done",
            requestMeta: liveMeta.providerDrafts?.length ? liveMeta : item.requestMeta ?? null
          }))
        }));

        workspace.touchProject(target.projectId);
        setLastError(null);
      } else {
        const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";

        workspace.updateThreadById(target.threadId, (thread) => ({
          ...thread,
          updatedAt: nowIso(),
          messages: updateMessageStatus(thread.messages, assistantPlaceholder.id, (item) => ({
            ...item,
            content: item.content ? `${item.content}\n\n오류: ${message}` : `오류: ${message}`,
            status: "error",
            requestMeta: liveMeta.providerDrafts?.length ? liveMeta : null
          }))
        }));

        workspace.touchProject(target.projectId);
        setLastError(message);
      }
    } finally {
      if (activeStreamRef.current?.placeholderId === assistantPlaceholder.id) {
        activeStreamRef.current = null;
      }
      setIsSending(false);
      focusComposer();
    }
  }

  async function handleSend() {
    if (!workspace.activeThread) return;

    await sendMessageToThread(draft, {
      threadId: workspace.activeThread.id,
      projectId: workspace.activeThread.projectId,
      currentTitle: workspace.activeThread.title
    });
  }

  async function handleHomeSubmit(text: string) {
    const trimmed = text.trim();
    if ((!trimmed && !attachedFile) || isSending) return;

    setSidebarView("default");

    if (workspace.activeProjectId === GENERAL_PROJECT_ID) {
      const threadId = workspace.createGeneralChat();
      await sendMessageToThread(trimmed, {
        threadId,
        projectId: GENERAL_PROJECT_ID,
        currentTitle: ""
      });
      setAttachedFile(null);
      return;
    }

    const projectId = workspace.activeProjectId;
    const threadId = workspace.createThreadInProject(projectId);

    await sendMessageToThread(trimmed, {
      threadId,
      projectId,
      currentTitle: ""
    });
    setAttachedFile(null);
  }

  function handleStartEditMessage(message: Message) {
    setEditingMessageId(message.id);
    setEditingDraft(message.content);
  }

  function handleCancelEditMessage() {
    resetEditingState();
  }

  async function handleSubmitEditMessage(messageId: string) {
    if (!workspace.activeThread) return;
    const nextText = editingDraft.trim();
    if (!nextText) return;

    await sendMessageToThread(
      nextText,
      {
        threadId: workspace.activeThread.id,
        projectId: workspace.activeThread.projectId,
        currentTitle: workspace.activeThread.title
      },
      {
        replaceFromMessageId: messageId
      }
    );
  }

  function handleCopyUserMessage(message: Message) {
    void navigator.clipboard.writeText(message.content);
  }

  function handleCopyAssistantMessage(message: Message) {
    void navigator.clipboard.writeText(message.content);
  }

  function handleSelectMessageVersion(messageId: string, direction: "prev" | "next") {
    const thread = workspace.activeThread;
    if (!thread) return;

    const baseMessage = thread.messages.find((item) => item.id === messageId);
    const groupId = baseMessage?.versionGroupId;
    if (!groupId) return;

    const versions = thread.messageVersions?.[groupId] ?? [];
    const userVersions = versions
      .filter((item) => item.role === "user")
      .sort((a, b) => (a.versionIndex ?? 0) - (b.versionIndex ?? 0));

    if (userVersions.length <= 1) return;

    const currentVersionValue = thread.activeVersionIndex?.[groupId] ?? 0;
    const currentVersionPosition = userVersions.findIndex(
      (item) => (item.versionIndex ?? 0) === currentVersionValue
    );

    const safeCurrentPosition = currentVersionPosition >= 0 ? currentVersionPosition : 0;
    const nextPosition =
      direction === "prev"
        ? Math.max(0, safeCurrentPosition - 1)
        : Math.min(userVersions.length - 1, safeCurrentPosition + 1);

    if (nextPosition === safeCurrentPosition) return;

    const nextUserVersion = userVersions[nextPosition];
    const nextVersionValue = nextUserVersion.versionIndex ?? 0;

    const nextAssistantVersion =
      versions.find(
        (item) => item.role === "assistant" && (item.versionIndex ?? 0) === nextVersionValue
      ) ?? null;

    workspace.updateThreadById(thread.id, (currentThread) => {
      const visibleMessages = getVisibleMessages(currentThread);
      const currentUserIndex = visibleMessages.findIndex((item) => item.id === messageId);
      if (currentUserIndex < 0) return currentThread;

      const existingAssistant =
        currentUserIndex + 1 < visibleMessages.length && visibleMessages[currentUserIndex + 1]?.role === "assistant"
          ? visibleMessages[currentUserIndex + 1]
          : null;

      const before = visibleMessages.slice(0, currentUserIndex);
      const after = existingAssistant
        ? visibleMessages.slice(currentUserIndex + 2)
        : visibleMessages.slice(currentUserIndex + 1);

      const replacementMessages: Message[] = [
        {
          ...nextUserVersion,
          isHidden: false
        }
      ];

      if (nextAssistantVersion) {
        replacementMessages.push({
          ...nextAssistantVersion,
          isHidden: false
        });
      }

      return {
        ...currentThread,
        messages: [...before, ...replacementMessages, ...after],
        activeVersionIndex: {
          ...(currentThread.activeVersionIndex ?? {}),
          [groupId]: nextVersionValue
        }
      };
    });
  }

  async function handleDownloadSlide(slideData: any) {
    try {
      const res = await fetch("http://localhost:8000/api/slides/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slide_data: slideData })
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => "")
        console.error("[SLIDE DOWNLOAD] Server error:", res.status, errText)
        throw new Error(`서버 오류 ${res.status}: ${errText.slice(0, 100)}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${String(slideData?.title ?? "slides").replace(/[^a-zA-Z0-9가-힣\s]/g, "")}.pptx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert("슬라이드 다운로드 실패: " + (e?.message ?? "오류"))
    }
  }

  function handleOpenArtifact(title: string, code: string, language: string) {
    const existing = artifactList.find(a => a.title === title);
    if (existing) {
      setActiveArtifact(existing);
    } else {
      const item = { id: `artifact_${Date.now()}`, title, code, language };
      setActiveArtifact(item);
    }
  }

  return (
    <>
      {/* ─── Inline Dialog ─────────────────────────────────────── */}
      {dialog && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)" }}
          onClick={() => setDialog(null)}>
          <div style={{ background: "var(--bg-surface, #fff)", borderRadius: 16, padding: 24, width: 400, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}
            onClick={e => e.stopPropagation()}>

            {(dialog.type === "rename-project" || dialog.type === "rename-thread") && (
              <>
                <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-main)", marginBottom: 16 }}>
                  {dialog.type === "rename-project" ? "프로젝트 이름 변경" : "스레드 이름 변경"}
                </div>
                <input
                  autoFocus
                  value={dialogInput}
                  onChange={e => setDialogInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      if (dialog.type === "rename-project") workspace.renameProject(dialog.id, dialogInput);
                      else workspace.renameThread(dialog.id, dialogInput);
                      setDialog(null);
                    }
                    if (e.key === "Escape") setDialog(null);
                  }}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 14, color: "var(--text-main)", background: "var(--surface-1, #f9f9f9)", outline: "none", boxSizing: "border-box" as const }}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
                  <button type="button" onClick={() => setDialog(null)}
                    style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", fontSize: 13, cursor: "pointer", color: "var(--text-main)" }}>
                    취소
                  </button>
                  <button type="button"
                    onClick={() => {
                      if (!dialogInput.trim()) return;
                      if (dialog.type === "rename-project") workspace.renameProject(dialog.id, dialogInput);
                      else workspace.renameThread(dialog.id, dialogInput);
                      setDialog(null);
                    }}
                    style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--text-main)", color: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
                    변경
                  </button>
                </div>
              </>
            )}

            {(dialog.type === "delete-project" || dialog.type === "delete-thread") && (
              <>
                <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-main)", marginBottom: 8 }}>
                  {dialog.type === "delete-project" ? "프로젝트 삭제" : "스레드 삭제"}
                </div>
                <div style={{ fontSize: 14, color: "var(--text-sub)", marginBottom: 20, lineHeight: 1.6 }}>
                  <strong style={{ color: "var(--text-main)" }}>"{dialog.currentTitle}"</strong>을(를) 삭제합니다.
                  {dialog.type === "delete-project" && <span> 프로젝트 내 모든 스레드도 함께 삭제됩니다.</span>}
                  <br />이 작업은 되돌릴 수 없습니다.
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button type="button" onClick={() => setDialog(null)}
                    style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", fontSize: 13, cursor: "pointer", color: "var(--text-main)" }}>
                    취소
                  </button>
                  <button type="button"
                    onClick={() => {
                      if (dialog.type === "delete-project") workspace.deleteProject(dialog.id);
                      else workspace.deleteThread(dialog.id);
                      setDialog(null);
                    }}
                    style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#ef4444", color: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
                    삭제
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <AppShell
        showPanel={showPanel}
        onTogglePanel={() => setShowPanel(v => !v)}
        sidebar={
          <Sidebar
            generalThreads={workspace.generalThreads}
            projectThreads={workspace.projectThreads}
            projects={workspace.projectGroups}
            activeProjectId={workspace.activeProjectId}
            activeThreadId={workspace.activeThreadId}
            sidebarView={sidebarView}
            artifacts={artifactList}
            onOpenArtifact={handleOpenArtifact}
            onOpenGeneralHome={handleOpenGeneralHome}
            onOpenSearch={handleOpenSearch}
            onOpenImages={handleOpenImages}
            onOpenBenchmark={handleOpenBenchmark}
            onSelectProject={handleSelectProject}
            onSelectThread={handleOpenThread}
            onNewChat={handleOpenGeneralHome}
            onCreateProject={handleCreateNamedProject}
            onCreateThreadInProject={handleCreateThreadInProject}
            onRenameProject={(id) => {
                const project = workspace.projectGroups.find(p => p.id === id);
                setDialog({ type: "rename-project", id, currentTitle: project?.title ?? "" });
                setDialogInput(project?.title ?? "");
              }}
            onDeleteProject={(id) => {
                const project = workspace.projectGroups.find(p => p.id === id);
                setDialog({ type: "delete-project", id, currentTitle: project?.title ?? "" });
              }}
            onRenameThread={(id) => {
                const thread = workspace.threads.find(t => t.id === id);
                setDialog({ type: "rename-thread", id, currentTitle: thread?.title ?? "" });
                setDialogInput(thread?.title ?? "");
              }}
            onDeleteThread={(id) => {
                const thread = workspace.threads.find(t => t.id === id);
                setDialog({ type: "delete-thread", id, currentTitle: thread?.title ?? "" });
              }}
            onMoveThread={workspace.moveThread}
            onToggleProjectMemory={handleToggleProjectMemory}
            onToggleThreadPinned={workspace.toggleThreadPinned}
          />
        }
        artifact={activeArtifact ? (
          <div className="artifact-panel">
            <div className="artifact-panel__header">
              <span className="artifact-panel__title">{activeArtifact.title}</span>
              <div className="artifact-panel__actions">
                <button
                  type="button"
                  title="복사"
                  onClick={() => navigator.clipboard.writeText(activeArtifact.code).catch(() => {})}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 7, background: "transparent", cursor: "pointer", color: "var(--text-sub)", fontSize: 11 }}
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="10" height="10" rx="2" /><path d="M5 15V7a2 2 0 0 1 2-2h8" /></svg>
                </button>
                <button
                  type="button"
                  title="닫기"
                  onClick={() => setActiveArtifact(null)}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 7, background: "transparent", cursor: "pointer", color: "var(--text-sub)" }}
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            <div className="artifact-panel__body">
              <pre className="artifact-panel__code">{activeArtifact.code}</pre>
            </div>
          </div>
        ) : (mode === "thread-chat" ? (
          <OrchestrationPanel
            debugMeta={debugMeta}
            usage={null}
            scoreboard={null}
            dashboard={null}
            opsLoading={false}
            opsError={null}
            artifactList={artifactList}
          />
        ) : undefined)}
        topbar={
          <Topbar
            mode={mode}
            workspaceKind={workspaceKind}
            projectTitle={
              sidebarView === "search"
                ? "채팅 검색"
                : sidebarView === "images"
                  ? "이미지"
                  : sidebarView === "benchmark"
                    ? "벤치마크"
                    : workspace.activeProject?.title ?? "AI Orchestra"
            }
            threadTitle={workspace.activeThread?.title ?? undefined}
            projectMemoryEnabled={Boolean(workspace.activeProject?.meta?.memoryEnabled)}
            onBackToHome={backToHome}
            panelToggle={
              <button
                type="button"
                onClick={() => setShowPanel(v => !v)}
                title={showPanel ? "패널 닫기" : "패널 열기"}
                style={{
                  width: 36, height: 36, border: "none", borderRadius: 8,
                  background: "transparent", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "var(--text-sub)", padding: 0
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,0,0,0.06)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M15 3v18" />
                </svg>
              </button>
            }
          />
        }
        main={
          sidebarView === "images" ? (
            <ImageGalleryView threads={workspace.threads} />
          ) : sidebarView === "benchmark" ? (
            <BenchmarkView />
          ) : mode === "home" ? (
            <HomeView
              workspaceKind={workspaceKind}
              activeProject={workspace.activeProject}
              generalThreads={workspace.generalThreads}
              projectThreads={workspace.projectThreads}
              sidebarView={sidebarView}
              isSending={isSending}
              onOpenThread={handleOpenThread}
              attachedFile={attachedFile}
              onAttachFile={setAttachedFile}
              onSubmitPrompt={(value) => void handleHomeSubmit(value)}
              onRenameThread={(id, _nextTitle) => {
                const thread = workspace.threads.find(t => t.id === id);
                setDialog({ type: "rename-thread", id, currentTitle: thread?.title ?? "" });
                setDialogInput(thread?.title ?? "");
              }}
              onMoveThread={handleMoveThreadFromHome}
              onRemoveFromProject={workspace.removeThreadFromProject}
              onDeleteThread={(id) => {
                const thread = workspace.threads.find(t => t.id === id);
                setDialog({ type: "delete-thread", id, currentTitle: thread?.title ?? "" });
              }}
              projectGroups={workspace.projectGroups}
            />
          ) : (
            <ChatView
              activeProject={workspace.activeProject}
              activeThread={workspace.activeThread}
              draft={draft}
              isSending={isSending}
              lastError={lastError}
              onDraftChange={setDraft}
              onSend={() => void handleSend()}
              onStopGenerating={handleStopGenerating}
              onBackToProject={backToHome}
              textareaRef={textareaRef}
              scrollRef={scrollRef}
              debugMeta={debugMeta}
              editingMessageId={editingMessageId}
              editingDraft={editingDraft}
              onEditingDraftChange={setEditingDraft}
              onStartEditMessage={handleStartEditMessage}
              onCancelEditMessage={handleCancelEditMessage}
              onSubmitEditMessage={(messageId) => void handleSubmitEditMessage(messageId)}
              onCopyUserMessage={handleCopyUserMessage}
              onCopyAssistantMessage={handleCopyAssistantMessage}
              onDeleteMessage={(messageId) => {
                if (workspace.activeThread) {
                  workspace.deleteMessage(workspace.activeThread.id, messageId);
                }
              }}
              onRelatedQuestion={(q) => {
                setDraft(q);
                setTimeout(() => textareaRef.current?.focus(), 50);
              }}
              onOpenArtifact={(title, code, language) => {
                const newId = `artifact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                setArtifactList(prev => {
                  const existingIndex = prev.findIndex(a => a.title === title);
                  if (existingIndex >= 0) {
                    const next = [...prev];
                    next[existingIndex] = { ...next[existingIndex], code, language };
                    setActiveArtifact(next[existingIndex]);
                    return next;
                  }
                  const item = { id: newId, title, code, language };
                  setActiveArtifact(item);
                  return [...prev, item];
                });
              }}
              onDownloadSlide={handleDownloadSlide}
              attachedFile={attachedFile}
              onAttachFile={setAttachedFile}
              composerMode={composerOptions ? (composerOptions.force_pro ? "deep-think" : composerOptions.task === "research" ? "web-search" : null) : null}
              onClearComposerMode={() => setComposerOptions(null)}
              onComposerAction={(action) => {
                if (action === "deep-think") {
                  setComposerOptions({ force_pro: true, deep_research: true });
                } else if (action === "web-search") {
                  setComposerOptions({ task: "research" });
                } else {
                  setComposerOptions(null);
                }
              }}
              messageVersionMap={messageVersionMap}
              onSelectMessageVersion={handleSelectMessageVersion}
              showScrollToBottom={showScrollToBottom}
              onScrollToBottom={handleScrollToBottom}
            />
          )
        }
      />

      <ProjectCreateModal
        open={isProjectModalOpen}
        value={projectTitleDraft}
        onChange={setProjectTitleDraft}
        onClose={closeProjectModal}
        onSubmit={handleSubmitProjectModal}
      />
    </>
  );
}
