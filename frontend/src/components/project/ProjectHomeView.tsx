import { useEffect, useRef, useState } from "react";
import type { ProjectGroup } from "../../types/workspace";
import {
  fetchProjectAssets,
  persistAsset,
  removeAsset,
  updateAsset,
  getAssetsByProject,
  deleteAssetFromServer,
  patchAssetOnServer,
  type SourceAsset
} from "../../store/sourceStore";
import ProjectThreadList from "./ProjectThreadList";

type Props = {
  project: ProjectGroup | null;
  activeThreadId?: string | null;
  onOpenThread?: (threadId: string) => void;
  onRenameThread?: (threadId: string) => void;
  onMoveThread?: (threadId: string) => void;
  onRemoveFromProject?: (threadId: string) => void;
  onDeleteThread?: (threadId: string) => void;
  onSubmitPrompt?: (value: string) => void;
  isSending?: boolean;
};

type Tab = "스레드" | "소스";

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
function NoteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M8 12h8M8 16h5" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 16V5M7 10l5-5 5 5" />
      <path d="M5 19h14" />
    </svg>
  );
}

function getSourceIcon(type: SourceAsset["type"]) {
  if (type === "link") return <LinkIcon />;
  if (type === "note") return <NoteIcon />;
  return <FileIcon />;
}
function getSourceTypeLabel(type: SourceAsset["type"]) {
  const m: Record<string, string> = { file: "파일", link: "링크", note: "노트", image: "이미지", thread_summary: "스레드 요약" };
  return m[type] ?? type;
}
function formatSize(content?: string) {
  if (!content) return "";
  const bytes = new TextEncoder().encode(content).length;
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function AddSourceModal({ projectId, onClose, onAdd }: {
  projectId: string; onClose: () => void; onAdd: (a: SourceAsset) => void;
}) {
  const [tab, setTab] = useState<"file" | "link" | "note">("file");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function handleFile(file: File) {
    setLoading(true);
    try {
      const text = await file.text();
      const asset: SourceAsset = { id: crypto.randomUUID(), projectId, type: "file", title: file.name, content: text, status: "confirmed", createdAt: Date.now(), updatedAt: Date.now() };
      await persistAsset(projectId, asset);
      onAdd(asset); onClose();
    } finally { setLoading(false); }
  }

  async function handleSubmit() {
    if (loading) return;
    setLoading(true);
    try {
      const asset: SourceAsset = { id: crypto.randomUUID(), projectId, type: tab, title: title.trim() || (tab === "link" ? url : "노트"), content: content.trim() || undefined, url: tab === "link" ? url.trim() : undefined, status: "confirmed", createdAt: Date.now(), updatedAt: Date.now() };
      await persistAsset(projectId, asset);
      onAdd(asset); onClose();
    } finally { setLoading(false); }
  }

  const inputStyle = { padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 14, color: "var(--text-main)", background: "var(--surface-1, #f9f9f9)", outline: "none", width: "100%", boxSizing: "border-box" as const };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div style={{ background: "var(--bg-main, #fff)", borderRadius: 16, padding: 24, width: 480, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-main)", marginBottom: 16 }}>소스 추가</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {(["file", "link", "note"] as const).map(t => (
            <button key={t} type="button" onClick={() => setTab(t)}
              style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid var(--border)", background: tab === t ? "var(--text-main)" : "transparent", color: tab === t ? "var(--bg-main, #fff)" : "var(--text-main)", fontSize: 13, cursor: "pointer", fontWeight: tab === t ? 600 : 400 }}>
              {t === "file" ? "파일" : t === "link" ? "링크" : "노트"}
            </button>
          ))}
        </div>
        {tab === "file" && (
          <div>
            <input ref={fileRef} type="file" accept=".txt,.md,.pdf,.js,.ts,.py,.json,.csv" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            <div onClick={() => fileRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
              style={{ border: "2px dashed var(--border)", borderRadius: 12, padding: "32px 20px", textAlign: "center", cursor: "pointer", color: "var(--text-sub)" }}>
              <div style={{ marginBottom: 8, display: "flex", justifyContent: "center" }}><UploadIcon /></div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>파일을 드래그하거나 클릭해서 업로드</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>txt, md, pdf, js, ts, py, json, csv</div>
            </div>
          </div>
        )}
        {tab === "link" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." style={inputStyle} />
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="제목 (선택)" style={inputStyle} />
            <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="설명 또는 내용 (선택)" rows={3} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
        )}
        {tab === "note" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="제목" style={inputStyle} />
            <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="내용을 입력하세요..." rows={6} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", fontSize: 13, cursor: "pointer", color: "var(--text-main)" }}>취소</button>
          {tab !== "file" && (
            <button type="button" onClick={handleSubmit} disabled={loading || (tab === "link" ? !url.trim() : !content.trim())}
              style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--text-main)", color: "var(--bg-main, #fff)", fontSize: 13, cursor: "pointer", fontWeight: 600, opacity: loading ? 0.6 : 1 }}>
              {loading ? "저장 중..." : "추가"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceItem({ asset, onDelete, onToggleConfirmed }: {
  asset: SourceAsset; onDelete: (id: string) => void; onToggleConfirmed: (id: string, s: "draft" | "confirmed") => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isConfirmed = asset.status === "confirmed";
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: isConfirmed ? "rgba(99,102,241,0.03)" : "transparent" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px" }}>
        <span style={{ color: isConfirmed ? "#6366f1" : "var(--text-sub)", flexShrink: 0 }}>{getSourceIcon(asset.type)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{asset.title || "제목 없음"}</div>
          <div style={{ fontSize: 11, color: "var(--text-sub)", display: "flex", gap: 8, marginTop: 2 }}>
            <span>{getSourceTypeLabel(asset.type)}</span>
            {asset.content && <span>{formatSize(asset.content)}</span>}
            {isConfirmed && <span style={{ color: "#6366f1", fontWeight: 500 }}>● 학습됨</span>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {asset.content && (
            <button type="button" onClick={() => setExpanded(v => !v)}
              style={{ fontSize: 11, color: "var(--text-sub)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 8px", background: "transparent", cursor: "pointer" }}>
              {expanded ? "접기" : "보기"}
            </button>
          )}
          <button type="button" onClick={() => onToggleConfirmed(asset.id, isConfirmed ? "draft" : "confirmed")} title={isConfirmed ? "학습 해제" : "학습에 포함"}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 6, background: isConfirmed ? "rgba(99,102,241,0.1)" : "transparent", cursor: "pointer", color: isConfirmed ? "#6366f1" : "var(--text-sub)" }}>
            <CheckIcon />
          </button>
          <button type="button" onClick={() => onDelete(asset.id)}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 6, background: "transparent", cursor: "pointer", color: "var(--text-sub)" }}>
            <TrashIcon />
          </button>
        </div>
      </div>
      {expanded && asset.content && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "12px 14px", fontSize: 12, color: "var(--text-sub)", maxHeight: 200, overflowY: "auto", background: "var(--surface-2, #f4f4f4)", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
          {asset.content.slice(0, 2000)}{asset.content.length > 2000 ? "\n..." : ""}
        </div>
      )}
    </div>
  );
}

function SourcesTab({ project }: { project: ProjectGroup }) {
  const [assets, setAssets] = useState<SourceAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchProjectAssets(project.id)
      .then(list => setAssets(list))
      .catch(() => setAssets(getAssetsByProject(project.id)))
      .finally(() => setLoading(false));
  }, [project.id]);

  function handleAdd(asset: SourceAsset) { setAssets(prev => [asset, ...prev]); }

  async function handleDelete(id: string) {
    removeAsset(id);
    setAssets(prev => prev.filter(a => a.id !== id));
    await deleteAssetFromServer(project.id, id);
  }

  async function handleToggleConfirmed(id: string, status: "draft" | "confirmed") {
    updateAsset(id, { status });
    setAssets(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    await patchAssetOnServer(project.id, id, { status });
  }

  const confirmed = assets.filter(a => a.status === "confirmed");
  const draft = assets.filter(a => a.status === "draft");

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: "var(--text-sub)" }}>
          학습된 소스 <strong style={{ color: "var(--text-main)" }}>{confirmed.length}개</strong>가 모든 대화에 자동으로 주입됩니다.
        </div>
        <button type="button" onClick={() => setShowAdd(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", border: "none", borderRadius: 10, background: "var(--text-main)", color: "var(--bg-main, #fff)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          <PlusIcon />소스 추가
        </button>
      </div>
      {loading ? (
        <div style={{ fontSize: 13, color: "var(--text-sub)", padding: "20px 0" }}>불러오는 중...</div>
      ) : assets.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--text-sub)" }}>
          <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}><UploadIcon /></div>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>아직 소스가 없습니다</div>
          <div style={{ fontSize: 13 }}>파일, 링크, 노트를 추가하면 프로젝트 내 모든 대화에 자동으로 반영됩니다</div>
          <button type="button" onClick={() => setShowAdd(true)}
            style={{ marginTop: 16, padding: "8px 20px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", fontSize: 13, cursor: "pointer", color: "var(--text-main)", fontWeight: 500 }}>
            첫 소스 추가하기
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {confirmed.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#6366f1", letterSpacing: "0.08em", marginBottom: 8 }}>학습에 포함됨 ({confirmed.length})</div>
              {confirmed.map(a => <div key={a.id} style={{ marginBottom: 6 }}><SourceItem asset={a} onDelete={handleDelete} onToggleConfirmed={handleToggleConfirmed} /></div>)}
            </div>
          )}
          {draft.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-sub)", letterSpacing: "0.08em", marginBottom: 8 }}>대기 중 ({draft.length})</div>
              {draft.map(a => <div key={a.id} style={{ marginBottom: 6 }}><SourceItem asset={a} onDelete={handleDelete} onToggleConfirmed={handleToggleConfirmed} /></div>)}
            </div>
          )}
        </div>
      )}
      {showAdd && <AddSourceModal projectId={project.id} onClose={() => setShowAdd(false)} onAdd={handleAdd} />}
    </div>
  );
}

function ProjectQuickComposer({ isSending, onSubmit }: { isSending: boolean; onSubmit: (v: string) => void }) {
  const [value, setValue] = useState("");
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey && value.trim() && !isSending) { e.preventDefault(); onSubmit(value.trim()); setValue(""); }
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface-1, #f9f9f9)" }}>
      <input value={value} onChange={e => setValue(e.target.value)} onKeyDown={handleKeyDown} placeholder="이 프로젝트에서 새 채팅 시작..."
        style={{ flex: 1, border: "none", background: "transparent", fontSize: 14, color: "var(--text-main)", outline: "none" }} />
      <button type="button" onClick={() => { if (value.trim() && !isSending) { onSubmit(value.trim()); setValue(""); } }} disabled={!value.trim() || isSending}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: "50%", border: "none", background: value.trim() ? "var(--text-main)" : "var(--border)", color: value.trim() ? "var(--bg-main, #fff)" : "var(--text-sub)", cursor: value.trim() ? "pointer" : "default" }}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
      </button>
    </div>
  );
}

export default function ProjectHomeView({ project, activeThreadId = null, onOpenThread, onRenameThread, onMoveThread, onRemoveFromProject, onDeleteThread, onSubmitPrompt, isSending = false }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("스레드");
  if (!project) return null;
  return (
    <div className="home-view">
      <div className="home-view__scroll">
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px 0" }}>
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-main)", marginBottom: 6 }}>{project.title}</h1>
            <div style={{ fontSize: 13, color: "var(--text-sub)" }}>스레드 {project.threadCount}개</div>
          </div>
          {onSubmitPrompt && (
            <div style={{ marginBottom: 24 }}>
              <ProjectQuickComposer isSending={isSending} onSubmit={onSubmitPrompt} />
            </div>
          )}
          <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--border)" }}>
            {(["스레드", "소스"] as Tab[]).map(tab => (
              <button key={tab} type="button" onClick={() => setActiveTab(tab)}
                style={{ padding: "8px 16px", border: "none", background: "transparent", cursor: "pointer", fontSize: 14, fontWeight: activeTab === tab ? 600 : 400, color: activeTab === tab ? "var(--text-main)" : "var(--text-sub)", borderBottom: activeTab === tab ? "2px solid var(--text-main)" : "2px solid transparent", marginBottom: -1 }}>
                {tab}
              </button>
            ))}
          </div>
          {activeTab === "스레드" ? (
            <ProjectThreadList project={project} activeThreadId={activeThreadId} onOpenThread={onOpenThread} onRenameThread={onRenameThread} onMoveThread={onMoveThread} onRemoveFromProject={onRemoveFromProject} onDeleteThread={onDeleteThread} />
          ) : (
            <SourcesTab project={project} />
          )}
        </div>
      </div>
    </div>
  );
}