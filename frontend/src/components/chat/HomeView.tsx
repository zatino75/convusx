import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ProjectGroup, Thread, WorkspaceKind } from "../../types/workspace";
import ProjectHomeView from "../project/ProjectHomeView";

const MAX_ATTACHMENTS = 10;
type AttachedFile = { name: string; type: string; base64: string; size: number };

type Props = {
  workspaceKind: WorkspaceKind;
  activeProject: ProjectGroup | null;
  generalThreads: Thread[];
  projectThreads: Thread[];
  sidebarView: "default" | "search" | "images" | "benchmark" | "dashboard";
  isSending: boolean;
  onOpenThread: (threadId: string) => void;
  onSubmitPrompt: (value: string) => void;
  onRenameThread?: (threadId: string, nextTitle: string) => void;
  onMoveThread?: (threadId: string, nextProjectId: string) => void;
  onRemoveFromProject?: (threadId: string) => void;
  onDeleteThread?: (threadId: string) => void;
  projectGroups?: ProjectGroup[];
  attachedFiles?: AttachedFile[];
  onAttachFiles?: (files: AttachedFile[]) => void;
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

function HomeComposer({
  placeholder, isSending, onSubmit, attachedFiles, onAttachFiles
}: {
  placeholder: string;
  isSending: boolean;
  onSubmit: (value: string) => void;
  attachedFiles?: AttachedFile[];
  onAttachFiles?: (files: AttachedFile[]) => void;
}) {
  const [value, setValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // 메뉴 외부 클릭 시 닫기
  useState(() => {
    function handleClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  });

  function handleSubmit() {
    const trimmed = value.trim();
    if ((!trimmed && (!attachedFiles || attachedFiles.length === 0)) || isSending) return;
    onSubmit(trimmed);
    setValue("");
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const maxSize = 20 * 1024 * 1024;
    const current = attachedFiles ?? [];
    const remaining = MAX_ATTACHMENTS - current.length;
    if (remaining <= 0) { alert(`최대 ${MAX_ATTACHMENTS}개까지 첨부할 수 있습니다.`); e.target.value = ""; return; }
    const toProcess = files.slice(0, remaining).filter(f => f.size <= maxSize);
    const results = await Promise.all(toProcess.map(file => new Promise<AttachedFile>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1] ?? result;
        resolve({ name: file.name, type: file.type, base64, size: file.size });
      };
      reader.readAsDataURL(file);
    })));
    onAttachFiles?.([...current, ...results]);
    e.target.value = "";
  }

  return (
    <div
      className="launcher-composer"
      onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLElement).style.outline = "2px dashed var(--text-soft)"; }}
      onDragLeave={e => { (e.currentTarget as HTMLElement).style.outline = ""; }}
      onDrop={async e => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).style.outline = "";
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length === 0) return;
        const maxSize = 20 * 1024 * 1024;
        const current = attachedFiles ?? [];
        const remaining = MAX_ATTACHMENTS - current.length;
        if (remaining <= 0) { alert(`최대 ${MAX_ATTACHMENTS}개까지 첨부할 수 있습니다.`); return; }
        const toProcess = files.slice(0, remaining).filter(f => f.size <= maxSize);
        const results = await Promise.all(toProcess.map(file => new Promise<AttachedFile>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            const base64 = result.split(",")[1] ?? result;
            resolve({ name: file.name, type: file.type, base64, size: file.size });
          };
          reader.readAsDataURL(file);
        })));
        onAttachFiles?.([...current, ...results]);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf,.txt,.md,.csv,.json,.ts,.tsx,.js,.jsx,.py"
        style={{ display: "none" }}
        multiple
        onChange={handleFileChange}
      />

      {/* 첨부 파일 미리보기 */}
      {attachedFiles && attachedFiles.length > 0 && (
        <div style={{ padding: "8px 14px 0", display: "flex", flexWrap: "wrap", gap: 6 }}>
          {attachedFiles.map((f, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 8, background: "var(--surface-1)", border: "1px solid var(--border)", fontSize: 12 }}>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: "var(--text-sub)", flexShrink: 0 }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
              </svg>
              <span style={{ color: "var(--text-main)", fontWeight: 500, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{f.name}</span>
              <span style={{ color: "var(--text-soft)", fontSize: 11 }}>{(f.size / 1024).toFixed(0)}KB</span>
              <button type="button" onClick={() => onAttachFiles?.(attachedFiles.filter((_, i) => i !== idx))} style={{ border: "none", background: "none", cursor: "pointer", padding: 0, color: "var(--text-soft)", display: "flex", alignItems: "center" }}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
          {attachedFiles.length < MAX_ATTACHMENTS && (
            <span style={{ fontSize: 11, color: "var(--text-soft)", alignSelf: "center" }}>{attachedFiles.length}/{MAX_ATTACHMENTS}</span>
          )}
        </div>
      )}

      <div className="launcher-composer__input-wrap">
        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            type="button"
            className="launcher-composer__ghost"
            onClick={() => setMenuOpen(o => !o)}
            title="도구"
          >
            <PlusIcon />
          </button>

          {menuOpen && (
            <div style={{
              position: "absolute", left: 0, bottom: 40, zIndex: 60,
              width: 260, padding: 8, border: "1px solid var(--border)",
              borderRadius: 16, background: "#ffffff",
              boxShadow: "0 4px 20px rgba(0,0,0,0.10)",
              display: "flex", flexDirection: "column" as const, gap: 4
            }}>
              <button type="button" onClick={() => { fileInputRef.current?.click(); setMenuOpen(false); }}
                style={{ width: "100%", padding: "10px", borderRadius: 12, display: "flex", alignItems: "flex-start", gap: 10, border: "none", background: "none", cursor: "pointer", textAlign: "left" as const }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(17,24,39,0.05)")}
                onMouseLeave={e => (e.currentTarget.style.background = "none")}>
                <span style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                </span>
                <span>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>사진 및 파일 업로드</div>
                  <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 2 }}>이미지, PDF, 텍스트 파일</div>
                </span>
              </button>
            </div>
          )}
        </div>
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleSubmit(); } }}
          placeholder={attachedFiles && attachedFiles.length > 0 ? "파일에 대해 질문하거나 Enter로 바로 전송" : placeholder}
          className="launcher-composer__input"
        />
        <div className="launcher-composer__actions">
          <button
            type="button"
            className="launcher-composer__submit"
            onClick={handleSubmit}
            disabled={isSending || (!value.trim() && !(attachedFiles && attachedFiles.length > 0))}
          >
            <WaveIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

function GeneralHome({
  isSending, onSubmitPrompt, attachedFiles, onAttachFiles
}: {
  isSending: boolean;
  onSubmitPrompt: (value: string) => void;
  attachedFiles?: AttachedFile[];
  onAttachFiles?: (files: AttachedFile[]) => void;
}) {
  return (
    <div
      className="general-home"
      onDragOver={e => { e.preventDefault(); }}
      onDrop={async e => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length === 0) return;
        const maxSize = 20 * 1024 * 1024;
        const current = attachedFiles ?? [];
        const remaining = MAX_ATTACHMENTS - current.length;
        if (remaining <= 0) { alert(`최대 ${MAX_ATTACHMENTS}개까지 첨부할 수 있습니다.`); return; }
        const toProcess = files.slice(0, remaining).filter(f => f.size <= maxSize);
        const results = await Promise.all(toProcess.map(file => new Promise<AttachedFile>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            const base64 = result.split(",")[1] ?? result;
            resolve({ name: file.name, type: file.type, base64, size: file.size });
          };
          reader.readAsDataURL(file);
        })));
        onAttachFiles?.([...current, ...results]);
      }}
    >
      <div className="general-home__center">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 18 }}>
          <img
            src="/corvus-logo.png"
            alt="CORVUS X"
            style={{ width: 52, height: 52, objectFit: "contain", marginBottom: 8, opacity: 0.85 }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "0.08em", color: "var(--text-main)" }}>CORVUS X</span>
          <span style={{ fontSize: 11, color: "var(--text-sub)", letterSpacing: "0.18em", fontWeight: 500, marginTop: 4 }}>SEE · CHOOSE · GO</span>
        </div>
        <h1 className="general-home__title">Mr.T 님, 어떻게 도와드릴까요?</h1>
        <HomeComposer
          placeholder="무엇이든 물어보세요  ·  / 로 커맨드 입력"
          isSending={isSending}
          onSubmit={onSubmitPrompt}
          attachedFiles={attachedFiles}
          onAttachFiles={onAttachFiles}
        />
        {/* Slash 커맨드 힌트 카드 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, marginTop: 20, maxWidth: 640, width: "100%" }}>
          {[
            { cmd: "/dalle",      icon: "🎨", label: "DALL-E 이미지",     color: "#10a37f" },
            { cmd: "/midjourney", icon: "🖼",  label: "Midjourney",        color: "#8b5cf6" },
            { cmd: "/runway",     icon: "🎬", label: "Runway 비디오",     color: "#ef4444" },
            { cmd: "/veo",        icon: "🎞", label: "Gemini Veo",        color: "#3b82f6" },
            { cmd: "/research",   icon: "🔭", label: "심층 리서치",       color: "#f59e0b" },
            { cmd: "/legal",      icon: "⚖️",  label: "법률 검토",         color: "#6366f1" },
            { cmd: "/finance",    icon: "📊", label: "재무 분석",         color: "#14b8a6" },
            { cmd: "/code",       icon: "💻", label: "코드 작성",         color: "#d97706" },
          ].map(({ cmd, icon, label, color }) => (
            <button
              key={cmd}
              type="button"
              onClick={() => onSubmitPrompt(cmd + " ")}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "9px 12px", borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--bg-card, #fafafa)",
                cursor: "pointer", textAlign: "left" as const,
                transition: "border-color 0.15s, background 0.15s"
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = color;
                (e.currentTarget as HTMLElement).style.background = color + "10";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                (e.currentTarget as HTMLElement).style.background = "var(--bg-card, #fafafa)";
              }}
            >
              <span style={{ fontSize: 16 }}>{icon}</span>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color, fontFamily: "monospace" }}>{cmd}</div>
                <div style={{ fontSize: 11, color: "var(--text-sub)", marginTop: 1 }}>{label}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function HomeView({
  workspaceKind, activeProject, generalThreads, projectThreads,
  sidebarView, isSending, onOpenThread, onSubmitPrompt,
  onRenameThread, onMoveThread, onRemoveFromProject, onDeleteThread, projectGroups,
  attachedFiles, onAttachFiles
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
          <GeneralHome
            isSending={isSending}
            onSubmitPrompt={onSubmitPrompt}
            attachedFiles={attachedFiles}
            onAttachFiles={onAttachFiles}
          />
        </div>
      </div>
    );
  }
  return <div className="home-view" />;
}