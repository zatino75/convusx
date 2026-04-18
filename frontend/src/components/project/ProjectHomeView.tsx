import { useEffect, useRef, useState, useCallback } from "react";
import { t } from "../../i18n";
import type { ProjectGroup } from "../../types/workspace";
import { useWorkspaceState } from "../../store/workspaceStore";
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
import { apiFetch } from "../../api/url";

type Props = {
  project: ProjectGroup | null;
  activeThreadId?: string | null;
  onOpenThread?: (threadId: string) => void;
  onRenameThread?: (threadId: string) => void;
  onMoveThread?: (threadId: string) => void;
  onRemoveFromProject?: (threadId: string) => void;
  onDeleteThread?: (threadId: string) => void;
  onToggleThreadPinned?: (threadId: string) => void;
  isSending?: boolean;
};

type Tab = "스레드" | "소스" | "지침";

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
  const m: Record<string, string> = { file: t("project.file"), link: t("project.link"), note: t("project.note"), image: t("project.image"), thread_summary: t("project.threadSummary") };
  return m[type] ?? type;
}
function getSourceTypeColor(type: SourceAsset["type"]) {
  const m: Record<string, string> = {
    file: "#3b82f6", link: "#10b981", note: "#c96442",
    image: "#8b5cf6", thread_summary: "#6366f1"
  };
  return m[type] ?? "#6b7280";
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
  const [dragActive, setDragActive] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  function isTextFile(file: File): boolean {
    const name = file.name.toLowerCase();
    const TEXT_EXTS = /\.(txt|md|json|csv|js|jsx|ts|tsx|py|html|css|xml|yaml|yml|toml|ini|cfg|log|sh|bat|sql|r|rb|go|java|c|cpp|h|swift|kt|rs|vue|svelte|astro|php|pl|lua|dart|scala|clj|ex|erl|hs|ml|lisp|scm|rkt|asm|makefile|dockerfile|gitignore|env)$/i;
    if (TEXT_EXTS.test(name)) return true;
    if (file.type.startsWith("text/")) return true;
    return false;
  }

  async function handleFiles(files: FileList) {
    setLoading(true);
    setProcessedCount(0);
    setErrorMsg("");
    const fileArray = Array.from(files);
    setTotalCount(fileArray.length);
    let successCount = 0;
    const errors: string[] = [];
    let doneCount = 0;

    const CONCURRENCY = 3;

    async function processFile(file: File) {
      try {
        let text: string;
        if (isTextFile(file)) {
          text = await file.text();
        } else {
          // 바이너리 파일 → 서버에서 텍스트 추출
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
            reader.onerror = () => reject(new Error(t("project.readFileFailed")));
            reader.readAsDataURL(file);
          });
          const resp = await apiFetch("/api/extract-text", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: file.name, base64, type: file.type })
          });
          const payload = await resp.json().catch(() => ({ ok: false }));
          text = payload?.ok ? payload.text : `[${t("project.textExtractFailed").replace("{name}", file.name)}]`;
        }
        const asset: SourceAsset = { id: crypto.randomUUID(), projectId, type: "file", title: file.name, content: text, status: "confirmed", createdAt: Date.now(), updatedAt: Date.now() };
        await persistAsset(projectId, asset);
        onAdd(asset);
        successCount++;
      } catch (e: any) {
        errors.push(`${file.name}: ${e?.message ?? t("settings.unknownError")}`);
      } finally {
        doneCount++;
        setProcessedCount(doneCount);
      }
    }

    // 최대 3개씩 병렬 처리
    for (let i = 0; i < fileArray.length; i += CONCURRENCY) {
      const chunk = fileArray.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(processFile));
    }

    setLoading(false);

    if (errors.length > 0) {
      setErrorMsg(`${errors.length}개 파일 실패: ${errors.join(", ")}`);
    }
    if (successCount > 0 && errors.length === 0) {
      onClose();
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  }

  async function handleSubmit() {
    if (loading) return;
    setLoading(true);
    try {
      const asset: SourceAsset = { id: crypto.randomUUID(), projectId, type: tab, title: title.trim() || (tab === "link" ? url : t("project.note")), content: content.trim() || undefined, url: tab === "link" ? url.trim() : undefined, status: "confirmed", createdAt: Date.now(), updatedAt: Date.now() };
      await persistAsset(projectId, asset);
      onAdd(asset); onClose();
    } finally { setLoading(false); }
  }

  const inputStyle = { padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 14, color: "var(--text-main)", background: "var(--surface-1, #f9f9f9)", outline: "none", width: "100%", boxSizing: "border-box" as const };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div style={{ background: "var(--bg-main, #fff)", borderRadius: 16, padding: 24, width: 480, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-main)", marginBottom: 16 }}>{t("project.addSource")}</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {(["file", "link", "note"] as const).map(tabType => (
            <button key={tabType} type="button" onClick={() => setTab(tabType)}
              style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid var(--border)", background: tab === tabType ? "var(--text-main)" : "transparent", color: tab === tabType ? "var(--bg-main, #fff)" : "var(--text-main)", fontSize: 13, cursor: "pointer", fontWeight: tab === tabType ? 600 : 400 }}>
              {tabType === "file" ? t("project.file") : tabType === "link" ? t("project.link") : t("project.note")}
            </button>
          ))}
        </div>
        {tab === "file" && (
          <div>
            <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={e => { if (e.target.files) handleFiles(e.target.files); }} />
            <div onClick={() => fileRef.current?.click()} onDragOver={handleDragOver} onDragEnter={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
              style={{ border: `2px dashed ${dragActive ? "var(--text-main)" : "var(--border)"}`, borderRadius: 12, padding: "32px 20px", textAlign: "center", cursor: "pointer", color: "var(--text-sub)", background: dragActive ? "rgba(0,0,0,0.02)" : "transparent", transition: "all 0.2s ease" }}>
              <div style={{ marginBottom: 8, display: "flex", justifyContent: "center" }}><UploadIcon /></div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{t("project.dragOrClick")}</div>
              <div style={{ fontSize: 12, marginTop: 4, color: "var(--text-sub)" }}>{t("project.multiFileSupport")}</div>
              {loading && (
                <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-main)", fontWeight: 600 }}>
                  {t("project.processingFiles").replace("{done}", String(processedCount)).replace("{total}", String(totalCount))}
                </div>
              )}
              {!loading && processedCount > 0 && !errorMsg && (
                <div style={{ marginTop: 12, fontSize: 12, color: "#10b981", fontWeight: 600 }}>
                  {t("project.filesAdded").replace("{count}", String(processedCount))}
                </div>
              )}
              {errorMsg && (
                <div style={{ marginTop: 12, fontSize: 12, color: "#c0392b", fontWeight: 600 }}>
                  {errorMsg}
                </div>
              )}
            </div>
          </div>
        )}
        {tab === "link" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." style={inputStyle} />
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t("project.titleOptional")} style={inputStyle} />
            <textarea value={content} onChange={e => setContent(e.target.value)} placeholder={t("project.contentOptional")} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
        )}
        {tab === "note" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t("project.title")} style={inputStyle} />
            <textarea value={content} onChange={e => setContent(e.target.value)} placeholder={t("project.contentPlaceholder")} rows={6} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", fontSize: 13, cursor: "pointer", color: "var(--text-main)" }}>{t("common.cancel")}</button>
          {tab !== "file" && (
            <button type="button" onClick={handleSubmit} disabled={loading || (tab === "link" ? !url.trim() : !content.trim())}
              style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--text-main)", color: "var(--bg-main, #fff)", fontSize: 13, cursor: "pointer", fontWeight: 600, opacity: loading ? 0.6 : 1 }}>
              {loading ? t("project.saving") : t("project.add")}
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
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const isConfirmed = asset.status === "confirmed";

  async function handleTestSource() {
    if (!asset.content) return;
    setTesting(true);
    setTestResult(null);
    try {
      const response = await apiFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "이 소스를 참조할 수 있나요?",
          context: asset.content.slice(0, 500)
        })
      });
      if (response.ok) {
        setTestResult({ success: true, message: t("project.sourceRefOk") });
      } else {
        setTestResult({ success: false, message: t("project.sourceRefFail") });
      }
    } catch {
      setTestResult({ success: false, message: t("project.sourceRefFail") });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: isConfirmed ? "rgba(99,102,241,0.04)" : "transparent" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px" }}>
        <span style={{ color: isConfirmed ? "#6366f1" : "var(--text-sub)", flexShrink: 0 }}>{getSourceIcon(asset.type)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{asset.title || t("project.noTitle")}</div>
          <div style={{ fontSize: 11, color: "var(--text-sub)", display: "flex", gap: 6, marginTop: 2, alignItems: "center", flexWrap: "wrap" as const }}>
            <span style={{ padding: "2px 8px", borderRadius: 4, background: getSourceTypeColor(asset.type) + "18", color: getSourceTypeColor(asset.type), fontWeight: 600, fontSize: 10 }}>
              {getSourceTypeLabel(asset.type)}
            </span>
            {asset.content && <span>{formatSize(asset.content)}</span>}
            {isConfirmed ? (
              <span style={{ padding: "1px 6px", borderRadius: 3, background: "#10b9812a", color: "#10b981", fontWeight: 600, fontSize: 10 }}>✓ {t("project.appliedToChat")}</span>
            ) : (
              <span style={{ padding: "1px 6px", borderRadius: 3, background: "var(--border)", color: "var(--text-sub)", fontWeight: 500, fontSize: 10 }}>{t("project.notApplied")}</span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {asset.content && (
            <button type="button" onClick={() => setExpanded(v => !v)}
              style={{ fontSize: 11, color: "var(--text-sub)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 8px", background: "transparent", cursor: "pointer" }}>
              {expanded ? t("project.collapse") : t("project.expand")}
            </button>
          )}
          {isConfirmed && asset.content && (
            <button type="button" onClick={handleTestSource} disabled={testing}
              style={{ fontSize: 11, color: testing ? "var(--text-sub)" : "#6366f1", border: "1px solid #6366f1", borderRadius: 6, padding: "3px 8px", background: "rgba(99,102,241,0.1)", cursor: testing ? "default" : "pointer", fontWeight: 500, opacity: testing ? 0.6 : 1 }}>
              {testing ? t("project.testing") : t("project.testSource")}
            </button>
          )}
          <button type="button" onClick={() => onToggleConfirmed(asset.id, isConfirmed ? "draft" : "confirmed")} title={isConfirmed ? t("project.unlearn") : t("project.learn")}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 6, background: isConfirmed ? "rgba(99,102,241,0.15)" : "transparent", cursor: "pointer", color: isConfirmed ? "#6366f1" : "var(--text-sub)" }}>
            <CheckIcon />
          </button>
          <button type="button" onClick={() => onDelete(asset.id)}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 6, background: "transparent", cursor: "pointer", color: "var(--text-sub)" }}>
            <TrashIcon />
          </button>
        </div>
      </div>
      {testResult && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "10px 14px", fontSize: 12, background: testResult.success ? "rgba(16,185,129,0.05)" : "rgba(239,68,68,0.05)", color: testResult.success ? "#10b981" : "#ef4444", fontWeight: 500 }}>
          {testResult.message}
        </div>
      )}
      {expanded && asset.content && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "12px 14px", fontSize: 12, color: "var(--text-sub)", maxHeight: 200, overflowY: "auto", background: "var(--surface-2, #f4f4f4)", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
          {asset.content.slice(0, 2000)}{asset.content.length > 2000 ? "\n..." : ""}
        </div>
      )}
    </div>
  );
}

function InstructionTab({ project }: { project: ProjectGroup }) {
  const workspace = useWorkspaceState();
  const [value, setValue] = useState<string>(project?.meta?.instruction ?? "");

  // 프로젝트 변경 시 값 동기화
  useEffect(() => {
    setValue(project?.meta?.instruction ?? "");
  }, [project?.id, project?.meta?.instruction]);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    setValue(next);
    workspace.updateProjectMeta(project.id, { instruction: next });
  }

  return (
    <div style={{ paddingBottom: 32 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)", marginBottom: 8 }}>
        {t("project.projectInstruction")}
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--text-sub)", lineHeight: 1.6 }}>
        {t("project.instructionDesc")}
      </p>
      <textarea
        style={{
          width: "100%", minHeight: 180, padding: "12px 14px",
          borderRadius: 10, border: "1px solid var(--border)",
          background: "var(--bg-main)", color: "var(--text-main)",
          fontSize: 13, lineHeight: 1.7, resize: "vertical",
          outline: "none", boxSizing: "border-box" as const,
          fontFamily: "inherit"
        }}
        placeholder={t("project.instructionExample")}
        value={value}
        onChange={handleChange}
      />
      <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--text-soft)" }}>
        {t("project.autoSaved")}
      </p>
    </div>
  );
}

function SourcesTab({ project }: { project: ProjectGroup }) {
  const [assets, setAssets] = useState<SourceAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<SourceAsset["type"] | "all">("all");

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

  const filtered = assets.filter(a => {
    const q = searchQuery.trim().toLowerCase();
    const matchType = typeFilter === "all" || a.type === typeFilter;
    const matchSearch = !q || (a.title ?? "").toLowerCase().includes(q) || (a.content ?? "").toLowerCase().includes(q);
    return matchType && matchSearch;
  });
  const confirmed = filtered.filter(a => a.status === "confirmed");
  const draft = filtered.filter(a => a.status === "draft");

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: "var(--text-sub)" }}>
          {t("project.learnedSources")} <strong style={{ color: "var(--text-main)" }}>{assets.filter(a=>a.status==="confirmed").length}개</strong>{searchQuery || typeFilter !== "all" ? <span style={{ marginLeft: 6, color: "#6366f1" }}>/ {t("project.filterCount").replace("{count}", String(filtered.length))}</span> : null}
        </div>
        <button type="button" onClick={() => setShowAdd(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", border: "none", borderRadius: 10, background: "var(--text-main)", color: "var(--bg-main, #fff)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          <PlusIcon />{t("project.addSource")}
        </button>
      </div>
      {/* 검색 + 타입 필터 */}
      {assets.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" as const }}>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t("project.sourceSearch")}
            style={{ flex: 1, minWidth: 120, padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, color: "var(--text-main)", background: "var(--bg-main, #fff)", outline: "none" }}
          />
          <div style={{ display: "flex", gap: 4 }}>
            {(["all", "file", "note", "link", "thread_summary"] as const).map(filterType => (
              <button key={filterType} type="button" onClick={() => setTypeFilter(filterType)}
                style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)", cursor: "pointer", fontSize: 11, fontWeight: 600,
                  background: typeFilter === filterType ? "var(--text-main)" : "transparent",
                  color: typeFilter === filterType ? "#fff" : "var(--text-sub)" }}>
                {filterType === "all" ? t("project.sourceAll") : getSourceTypeLabel(filterType)}
              </button>
            ))}
          </div>
        </div>
      )}
      {loading ? (
        <div style={{ fontSize: 13, color: "var(--text-sub)", padding: "20px 0" }}>{t("dashboard.loading")}</div>
      ) : assets.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--text-sub)" }}>
          <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}><UploadIcon /></div>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>{t("project.noSourcesYet")}</div>
          <div style={{ fontSize: 13 }}>{t("project.addSourceHint")}</div>
          <button type="button" onClick={() => setShowAdd(true)}
            style={{ marginTop: 16, padding: "8px 20px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", fontSize: 13, cursor: "pointer", color: "var(--text-main)", fontWeight: 500 }}>
            {t("project.addFirstSource")}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {confirmed.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#6366f1", letterSpacing: "0.08em", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#6366f1" }}></span>
                {t("project.appliedGroup").replace("{count}", String(confirmed.length))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {confirmed.map(a => <SourceItem key={a.id} asset={a} onDelete={handleDelete} onToggleConfirmed={handleToggleConfirmed} />)}
              </div>
            </div>
          )}
          {draft.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-sub)", letterSpacing: "0.08em", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--border)" }}></span>
                {t("project.draftGroup").replace("{count}", String(draft.length))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {draft.map(a => <SourceItem key={a.id} asset={a} onDelete={handleDelete} onToggleConfirmed={handleToggleConfirmed} />)}
              </div>
            </div>
          )}
        </div>
      )}
      {showAdd && <AddSourceModal projectId={project.id} onClose={() => setShowAdd(false)} onAdd={handleAdd} />}
    </div>
  );
}

export default function ProjectHomeView({ project, activeThreadId = null, onOpenThread, onRenameThread, onMoveThread, onRemoveFromProject, onDeleteThread, onToggleThreadPinned, isSending = false }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("스레드");
  if (!project) return null;
  return (
    <div className="home-view office-stage-view">
      <div className="home-view__scroll">
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px 0" }}>
          <section className="office-mission-strip office-mission-strip--project">
            <header className="office-mission-strip__head">
              <span className={`office-mission-strip__phase is-${isSending ? "working" : "meeting"}`}>
                {isSending ? "부서 실행" : "미팅룸 보고"}
              </span>
              <strong>PROJECT MISSION</strong>
            </header>
            <p>{project.meta?.instruction?.trim() || `${project.title} 프로젝트의 실행 현황과 보고를 관리합니다.`}</p>
          </section>

          <div style={{ marginBottom: 24 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-main)", marginBottom: 6 }}>{project.title}</h1>
            <div style={{ fontSize: 13, color: "var(--text-sub)" }}>{t("project.threadCount").replace("{count}", String(project.threadCount))}</div>
          </div>
          <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--border)" }}>
            {(["스레드", "소스", "지침"] as Tab[]).map(tab => (
              <button key={tab} type="button" onClick={() => setActiveTab(tab)}
                style={{ padding: "8px 16px", border: "none", background: "transparent", cursor: "pointer", fontSize: 14, fontWeight: activeTab === tab ? 600 : 400, color: activeTab === tab ? "var(--text-main)" : "var(--text-sub)", borderBottom: activeTab === tab ? "2px solid var(--text-main)" : "2px solid transparent", marginBottom: -1 }}>
                {tab === "스레드" ? t("project.threads") : tab === "소스" ? t("project.sources") : t("project.instructions")}
              </button>
            ))}
          </div>
          {activeTab === "스레드" && (
            <ProjectThreadList project={project} activeThreadId={activeThreadId} onOpenThread={onOpenThread} onRenameThread={onRenameThread} onMoveThread={onMoveThread} onRemoveFromProject={onRemoveFromProject} onDeleteThread={onDeleteThread} onToggleThreadPinned={onToggleThreadPinned} />
          )}
          {activeTab === "소스" && (
            <SourcesTab project={project} />
          )}
          {activeTab === "지침" && (
            <InstructionTab project={project} />
          )}
        </div>
      </div>
    </div>
  );
}
