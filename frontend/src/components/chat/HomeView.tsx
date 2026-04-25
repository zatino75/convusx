import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectGroup, Thread, WorkspaceKind } from "../../types/workspace";
import ProjectHomeView from "../project/ProjectHomeView";
import { t } from "../../i18n";

type Props = {
  workspaceKind: WorkspaceKind;
  activeProject: ProjectGroup | null;
  generalThreads: Thread[];
  projectThreads: Thread[];
  sidebarView: "default" | "search" | "images" | "benchmark" | "dashboard" | "sales" | "workforce" | "storeops" | "pos";
  isSending: boolean;
  onOpenThread: (threadId: string) => void;
  onRenameThread?: (threadId: string, nextTitle: string) => void;
  onMoveThread?: (threadId: string, nextProjectId: string) => void;
  onRemoveFromProject?: (threadId: string) => void;
  onDeleteThread?: (threadId: string) => void;
  onToggleThreadPinned?: (threadId: string) => void;
  /** Workforce 미션 시작 — 호환을 위해 보존 (현재 GeneralHome 에서 직접 사용 안 함) */
  onLaunchWorkforceMission?: (directive: string) => void;
  /** Director 모드(10부서 분석) — 입력값을 새 스레드로 보내고 SSE 시작 */
  onLaunchDirectorAnalysis?: (directive: string) => void;
  /** 일반 입력 → 채팅 스레드 시작 (자동/단일에이전트 모드) */
  onSubmitPrompt?: (text: string) => void;
  onOpenStoreOps?: () => void;
  onOpenPos?: () => void;
  onOpenSales?: () => void;
  projectGroups?: ProjectGroup[];
  sceneMode?: "idle" | "dispatch" | "working" | "meeting";
  sceneDirective?: string;
};

function stripMd(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\[\d+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const escaped = query.replace(/[$()*+.?[\]^{|}]/g, "\\$&");
  const parts = text.split(new RegExp("(" + escaped + ")", "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} style={{ background: "#fef08a", color: "#78350f", borderRadius: 2, padding: "0 1px" }}>{part}</mark>
      : part
  );
}

function SearchView({
  threads,
  projectGroups,
  onOpenThread
}: {
  threads: Thread[];
  projectGroups?: ProjectGroup[];
  onOpenThread?: (threadId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const q = query.trim().toLowerCase();

  type SearchResult = {
    threadId: string;
    threadTitle: string;
    projectTitle?: string;
    matchContent: string;
  };

  const results: SearchResult[] = useMemo(() => {
    if (!q) return [];
    const out: SearchResult[] = [];
    for (const thread of threads) {
      const titleMatch = thread.title.toLowerCase().includes(q);
      const matchingMsg = thread.messages
        .filter(m => !m.isHidden && m.content?.trim())
        .find(m => m.content.toLowerCase().includes(q));
      if (!titleMatch && !matchingMsg) continue;
      const projectTitle = projectGroups?.find(p => p.id === thread.projectId)?.title;
      const raw = matchingMsg?.content ?? thread.title;
      const clean = stripMd(raw);
      const idx = clean.toLowerCase().indexOf(q);
      const start = Math.max(0, idx - 40);
      const excerpt = (start > 0 ? "..." : "") + clean.slice(start, start + 120) + (start + 120 < clean.length ? "..." : "");
      out.push({ threadId: thread.id, threadTitle: thread.title, projectTitle, matchContent: excerpt });
    }
    return out.slice(0, 50);
  }, [q, threads, projectGroups]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", maxWidth: 720, margin: "0 auto", padding: "24px 20px 0", width: "100%" }}>
      <div style={{ position: "relative", marginBottom: 24 }}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"
          style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-sub)", pointerEvents: "none" }}>
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t("home.searchPlaceholder")}
          style={{ width: "100%", padding: "12px 40px", borderRadius: 12, border: "1px solid var(--border)", fontSize: 14, color: "var(--text-main)", background: "var(--surface-1, #f9fafb)", outline: "none", boxSizing: "border-box" }}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", cursor: "pointer", color: "var(--text-sub)", display: "flex", alignItems: "center" }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        )}
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {!q ? (
          <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--text-soft)" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⌕</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{t("home.searchAll")}</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>{t("home.searchHint")}</div>
          </div>
        ) : results.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--text-soft)" }}>
            <div style={{ fontSize: 14 }}>{t("home.noResults").replace("{query}", query)}</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 12 }}>{t("home.resultCount").replace("{count}", String(results.length))}</div>
            {results.map(r => (
              <button
                key={r.threadId}
                type="button"
                onClick={() => onOpenThread?.(r.threadId)}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 14px", marginBottom: 6, border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface-1, #f9fafb)", cursor: "pointer" }}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2, #f3f4f6)")}
                onMouseLeave={e => (e.currentTarget.style.background = "var(--surface-1, #f9fafb)")}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                  {r.projectTitle && (
                    <span style={{ fontSize: 11, color: "var(--text-sub)", background: "var(--border)", borderRadius: 4, padding: "1px 6px" }}>{r.projectTitle}</span>
                  )}
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-main)" }}>{highlight(r.threadTitle, query)}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-sub)", lineHeight: 1.5 }}>{highlight(r.matchContent, query)}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ImagesPlaceholder() {
  return (
    <div className="utility-view">
      <div className="utility-view__icon">▣</div>
      <div className="utility-view__title">{t("home.imagesTitle")}</div>
      <div className="utility-view__desc">{t("home.imagesDesc")}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GeneralHome — 4월 7일 원본 베이스 + 10부서 분석 퀵 액션 추가
// 크림/골드 라이트 테마. 까마귀 로고 + 입력창 + 6개 퀵 액션.
// ─────────────────────────────────────────────────────────────────────────────

type QuickAction = {
  id: string;
  icon: string;
  label: string;
  color: string;
  prompt?: string;
  director?: boolean;
};

const QUICK_ACTIONS: QuickAction[] = [
  { id: "research", icon: "🔭", label: "심층 리서치", color: "#f59e0b", prompt: "심층 리서치: " },
  { id: "legal",    icon: "⚖️",  label: "법률 검토",   color: "#6366f1", prompt: "법률 검토: " },
  { id: "finance",  icon: "📊", label: "재무 분석",   color: "#14b8a6", prompt: "재무 분석: " },
  { id: "code",     icon: "💻", label: "코드 작성",   color: "#d97706", prompt: "코드 작성: " },
  { id: "image",    icon: "🎨", label: "이미지 생성", color: "#10a37f", prompt: "이미지 생성: " },
  { id: "director", icon: "🏢", label: "10부서 분석", color: "#c96442", director: true },
];

function GeneralHome({
  isSending,
  onSubmitPrompt,
  onLaunchDirectorAnalysis,
}: {
  isSending: boolean;
  onSubmitPrompt?: (value: string) => void;
  onLaunchDirectorAnalysis?: (directive: string) => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // 한글 IME 조합 중 Enter 무시용 — compositionStart/End 로 정확히 추적
  const composingRef = useRef(false);

  // textarea 자동 높이 조절 (1~6줄)
  function autoSize(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "auto";
    const max = 6 * 24 + 16; // 6줄 + padding
    el.style.height = Math.min(el.scrollHeight, max) + "px";
  }

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || isSending) return;
    onSubmitPrompt?.(trimmed);
    setValue("");
    if (inputRef.current) inputRef.current.style.height = "auto";
  }

  function handleQuickAction(action: QuickAction) {
    if (isSending) return;
    if (action.director) {
      const directive = value.trim();
      if (!directive) {
        inputRef.current?.focus();
        return;
      }
      onLaunchDirectorAnalysis?.(directive);
      setValue("");
      if (inputRef.current) inputRef.current.style.height = "auto";
      return;
    }
    if (action.prompt) {
      const next = action.prompt + value.trim();
      setValue(next);
      inputRef.current?.focus();
      // autoSize 는 다음 paint 에서 동작하도록
      requestAnimationFrame(() => autoSize(inputRef.current));
    }
  }

  return (
    // 컨테이너: viewport 높이 채우는 flex column.
    // 상단(로고+제목)은 가운데 정렬, 하단(composer+퀵액션)은 sticky bottom.
    <div
      className="general-home"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: "100%",
        padding: 0,
        alignItems: "stretch",
        justifyContent: "stretch",
      }}
    >
      {/* 상단/중앙 — 로고 + 제목 */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 24px 20px",
          minHeight: 0,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 20 }}>
          <img
            src="/corvus-logo.png"
            alt="CORVUS X"
            style={{ width: 56, height: 56, objectFit: "contain", marginBottom: 10, opacity: 0.9 }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "0.08em", color: "var(--text-main)" }}>
            CORVUS X
          </span>
          <span style={{ fontSize: 11, color: "var(--text-sub)", letterSpacing: "0.20em", fontWeight: 500, marginTop: 6 }}>
            SEE · CHOOSE · GO
          </span>
        </div>
        <h1 className="general-home__title" style={{ margin: 0 }}>
          무엇을 도와드릴까요?
        </h1>
      </div>

      {/* 하단 고정 — composer + 퀵 액션 */}
      <div
        style={{
          flexShrink: 0,
          padding: "16px 24px 28px",
          background: "linear-gradient(to top, rgba(250, 247, 242, 0.92), rgba(250, 247, 242, 0.0))",
          backdropFilter: "blur(2px)",
        }}
      >
        <div style={{ maxWidth: 720, margin: "0 auto", width: "100%" }}>
          {/* 입력창 (textarea: Enter 전송, Shift+Enter 줄바꿈) */}
          <div
            className="launcher-composer"
            style={{ marginTop: 0, maxWidth: "none" }}
          >
            <div
              className="launcher-composer__input-wrap"
              style={{ gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "end" }}
            >
              <textarea
                ref={inputRef}
                rows={1}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  autoSize(e.currentTarget);
                }}
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={() => { composingRef.current = false; }}
                onKeyDown={(e) => {
                  // [DEBUG] 진단용 — Enter 가 도달하는지/IME 상태/onSubmitPrompt 유무 확인
                  if (e.key === "Enter") {
                    // eslint-disable-next-line no-console
                    console.log("[HomeView Enter]", {
                      key: e.key,
                      shift: e.shiftKey,
                      composingRef: composingRef.current,
                      nativeIsComposing: (e.nativeEvent as any).isComposing,
                      keyCode: e.keyCode,
                      hasOnSubmitPrompt: typeof onSubmitPrompt === "function",
                      isSending,
                      domValue: e.currentTarget.value,
                      stateValue: value,
                    });
                  }
                  // 1) 한글 IME 조합 중인 Enter 는 무시 (composingRef + nativeEvent.isComposing + keyCode 229 모두 체크)
                  const ime =
                    composingRef.current ||
                    (e.nativeEvent as any).isComposing === true ||
                    e.keyCode === 229 ||
                    e.key === "Process";
                  if (ime) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    const domVal = e.currentTarget.value;
                    const v = (domVal || value).trim();
                    if (!v) return;
                    if (typeof onSubmitPrompt === "function") {
                      onSubmitPrompt(v);
                    } else {
                      // eslint-disable-next-line no-console
                      console.warn("[HomeView Enter] onSubmitPrompt is not a function — wiring 누락");
                    }
                    setValue("");
                    e.currentTarget.value = "";
                    e.currentTarget.style.height = "auto";
                  }
                }}
                placeholder="무엇이든 물어보세요  ·  Enter 전송, Shift+Enter 줄바꿈"
                className="launcher-composer__input"
                style={{ resize: "none", minHeight: 24 }}
              />
              <div className="launcher-composer__actions">
                <button
                  type="button"
                  className="launcher-composer__submit"
                  onClick={submit}
                  disabled={isSending || !value.trim()}
                  aria-label="전송"
                  title="전송 (Enter)"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <rect x="4" y="10" width="2" height="4" rx="1" />
                    <rect x="8" y="8" width="2" height="8" rx="1" />
                    <rect x="12" y="6" width="2" height="12" rx="1" />
                    <rect x="16" y="8" width="2" height="8" rx="1" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* 퀵 액션 — 6개 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: 8,
              marginTop: 12,
            }}
          >
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => handleQuickAction(action)}
                disabled={isSending}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--bg-surface, #fefefe)",
                  cursor: isSending ? "not-allowed" : "pointer",
                  textAlign: "left" as const,
                  transition: "border-color 0.15s, background 0.15s",
                  opacity: isSending ? 0.6 : 1,
                }}
                onMouseEnter={(e) => {
                  if (isSending) return;
                  (e.currentTarget as HTMLElement).style.borderColor = action.color;
                  (e.currentTarget as HTMLElement).style.background = action.color + "0d";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                  (e.currentTarget as HTMLElement).style.background = "var(--bg-surface, #fefefe)";
                }}
              >
                <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{action.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-main)" }}>{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomeView({
  workspaceKind,
  activeProject,
  generalThreads,
  projectThreads,
  sidebarView,
  isSending,
  onOpenThread,
  onRenameThread,
  onMoveThread,
  onRemoveFromProject,
  onDeleteThread,
  onToggleThreadPinned,
  projectGroups,
  onSubmitPrompt,
  onLaunchDirectorAnalysis,
}: Props) {
  if (sidebarView === "search") {
    return (
      <div className="home-view">
        <div className="home-view__scroll" style={{ display: "flex", flexDirection: "column" }}>
          <SearchView threads={[...generalThreads, ...projectThreads]} projectGroups={projectGroups} onOpenThread={onOpenThread} />
        </div>
      </div>
    );
  }

  if (sidebarView === "images") {
    return (
      <div className="home-view">
        <div className="home-view__scroll">
          <div className="home-view__inner utility-view__inner"><ImagesPlaceholder /></div>
        </div>
      </div>
    );
  }

  if (workspaceKind === "project") {
    return (
      <ProjectHomeView
        project={activeProject}
        activeThreadId={null}
        onOpenThread={onOpenThread}
        onRenameThread={onRenameThread ? (threadId: string) => onRenameThread(threadId, "") : undefined}
        onMoveThread={onMoveThread ? (threadId: string) => onMoveThread(threadId, "__general__") : undefined}
        onDeleteThread={onDeleteThread}
        onRemoveFromProject={onRemoveFromProject}
        onToggleThreadPinned={onToggleThreadPinned}
        isSending={isSending}
      />
    );
  }

  if (workspaceKind === "general") {
    return (
      <div className="home-view">
        <div className="home-view__scroll">
          <GeneralHome
            isSending={isSending}
            onSubmitPrompt={onSubmitPrompt}
            onLaunchDirectorAnalysis={onLaunchDirectorAnalysis}
          />
        </div>
      </div>
    );
  }

  return <div className="home-view" />;
}
