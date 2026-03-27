import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ProjectGroup, Thread, WorkspaceKind } from "../../types/workspace";
import ProjectHomeView from "../project/ProjectHomeView";

type Props = {
  workspaceKind: WorkspaceKind;
  activeProject: ProjectGroup | null;
  generalThreads: Thread[];
  projectThreads: Thread[];
  sidebarView: "default" | "search" | "images";
  isSending: boolean;
  onOpenThread: (threadId: string) => void;
  onSubmitPrompt: (value: string) => void;
  onRenameThread?: (threadId: string, nextTitle: string) => void;
  onMoveThread?: (threadId: string, nextProjectId: string) => void;
  onRemoveFromProject?: (threadId: string) => void;
  onDeleteThread?: (threadId: string) => void;
  projectGroups?: ProjectGroup[];
};

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 5a4 4 0 0 1 4 4v3a4 4 0 0 1-8 0V9a4 4 0 0 1 4-4z" />
      <path d="M19 11a7 7 0 0 1-14 0M12 18v3" />
    </svg>
  );
}

function WaveIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <rect x="4" y="10" width="2" height="4" rx="1" />
      <rect x="8" y="8" width="2" height="8" rx="1" />
      <rect x="12" y="6" width="2" height="12" rx="1" />
      <rect x="16" y="8" width="2" height="8" rx="1" />
    </svg>
  );
}

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
        <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
          placeholder="대화 내용, 스레드 제목 검색..."
          style={{ width: "100%", padding: "12px 40px", borderRadius: 12, border: "1px solid var(--border)", fontSize: 14, color: "var(--text-main)", background: "var(--surface-1, #f9fafb)", outline: "none", boxSizing: "border-box" as const }} />
        {query && (
          <button type="button" onClick={() => setQuery("")}
            style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", cursor: "pointer", color: "var(--text-sub)", display: "flex", alignItems: "center" }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        )}
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {!q ? (
          <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--text-soft)" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⌕</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>전체 채팅 검색</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>스레드 제목이나 대화 내용으로 검색하세요</div>
          </div>
        ) : results.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--text-soft)" }}>
            <div style={{ fontSize: 14 }}>"{query}"에 대한 결과가 없습니다</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 12 }}>{results.length}개 결과</div>
            {results.map(r => (
              <button key={r.threadId} type="button" onClick={() => onOpenThread?.(r.threadId)}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 14px", marginBottom: 6, border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface-1, #f9fafb)", cursor: "pointer" }}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2, #f3f4f6)")}
                onMouseLeave={e => (e.currentTarget.style.background = "var(--surface-1, #f9fafb)")}>
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
      <div className="utility-view__title">이미지</div>
      <div className="utility-view__desc">채팅에서 생성된 이미지를 이 화면에 모아 노출합니다.</div>
    </div>
  );
}

function HomeComposer({ placeholder, isSending, onSubmit }: { placeholder: string; isSending: boolean; onSubmit: (value: string) => void; }) {
  const [value, setValue] = useState("");
  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed || isSending) return;
    onSubmit(trimmed);
    setValue("");
  }
  return (
    <div className="launcher-composer">
      <div className="launcher-composer__input-wrap">
        <button type="button" className="launcher-composer__ghost"><PlusIcon /></button>
        <input value={value} onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleSubmit(); } }}
          placeholder={placeholder} className="launcher-composer__input" />
        <div className="launcher-composer__actions">
          <button type="button" className="launcher-composer__ghost"><MicIcon /></button>
          <button type="button" className="launcher-composer__submit" onClick={handleSubmit} disabled={isSending || !value.trim()}><WaveIcon /></button>
        </div>
      </div>
    </div>
  );
}

function GeneralHome({ isSending, onSubmitPrompt }: { isSending: boolean; onSubmitPrompt: (value: string) => void; }) {
  return (
    <div className="general-home">
      <div className="general-home__center">
        <h1 className="general-home__title">Mr.T 님, 어떻게 도와드릴까요?</h1>
        <HomeComposer placeholder="무엇이든 물어보세요" isSending={isSending} onSubmit={onSubmitPrompt} />
      </div>
    </div>
  );
}

export default function HomeView({
  workspaceKind, activeProject, generalThreads, projectThreads,
  sidebarView, isSending, onOpenThread, onSubmitPrompt,
  onRenameThread, onMoveThread, onRemoveFromProject, onDeleteThread, projectGroups
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
        onSubmitPrompt={onSubmitPrompt}
        isSending={isSending}
      />
    );
  }
  if (workspaceKind === "general") {
    return (
      <div className="home-view">
        <div className="home-view__scroll">
          <GeneralHome isSending={isSending} onSubmitPrompt={onSubmitPrompt} />
        </div>
      </div>
    );
  }
  return <div className="home-view" />;
}