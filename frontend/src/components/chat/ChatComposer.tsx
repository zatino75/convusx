import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { t } from "../../i18n";
import { showToast } from "../ui/Toast";
import { FilePreviewThumbnail } from "./FilePreview";
import { PlusIcon, UploadIcon, SearchIcon, SparkleIcon, StopIcon } from "./ChatIcons";

export type ComposerMenuAction = "upload" | "deep-think" | "web-search" | "parallel-ensemble";
export type ComposerModeValue = "deep-think" | "web-search" | "parallel-ensemble" | null;

type SlashCommand = {
  trigger: string;        // /dalle, /midjourney 등
  label: string;
  meta: string;
  insert: string;         // textarea에 삽입될 텍스트
  category: "image" | "video" | "research" | "code" | "doc";
};

const SLASH_COMMANDS: SlashCommand[] = [
  { trigger: "/dalle",      label: t("commands.dalle"),      meta: "OpenAI DALL-E 3",              insert: t("commands.dalleInsert"),           category: "image" },
  { trigger: "/imagen",     label: t("commands.imagen"),     meta: "Gemini Imagen 4",              insert: t("commands.imagenInsert"),          category: "image" },
  { trigger: "/midjourney", label: t("commands.midjourney"), meta: "Midjourney v6.1",              insert: t("commands.midjourneyInsert"),      category: "image" },
  { trigger: "/runway",     label: t("commands.runway"),     meta: "Runway Gen4 Turbo",            insert: t("commands.runwayInsert"),        category: "video" },
  { trigger: "/veo",        label: t("commands.veo"),        meta: "Gemini Veo 3.1",              insert: t("commands.veoInsert"),           category: "video" },
  { trigger: "/research",   label: t("commands.research"),   meta: "Perplexity + OpenAI + Claude", insert: t("commands.researchInsert"),        category: "research" },
  { trigger: "/web",        label: t("commands.web"),        meta: "Perplexity Pro",               insert: t("commands.webInsert"),             category: "research" },
  { trigger: "/legal",      label: t("commands.legal"),      meta: "Claude + OpenAI",              insert: t("commands.legalInsert"),          category: "doc" },
  { trigger: "/finance",    label: t("commands.finance"),    meta: "OpenAI + Perplexity",          insert: t("commands.financeInsert"),        category: "doc" },
  { trigger: "/product",    label: t("commands.product"),    meta: "OpenAI + Perplexity",          insert: t("commands.productInsert"),       category: "doc" },
  { trigger: "/data",       label: t("commands.dataAnalysis"),        meta: "OpenAI",                       insert: t("commands.dataInsert"),          category: "doc" },
  { trigger: "/code",       label: t("commands.code"),       meta: "Claude Sonnet + GPT-5.2",       insert: "",                          category: "code" },
  { trigger: "/source",     label: t("commands.source"),     meta: t("commands.metaSource"),       insert: t("commands.sourceInsert"),           category: "doc" },
  { trigger: "/slide",      label: t("commands.slide"),      meta: t("commands.metaSlide"),        insert: t("commands.slideInsert"),      category: "doc" },
];

const CATEGORY_COLOR: Record<string, string> = {
  image:    "#8b5cf6",
  video:    "#ef4444",
  research: "#10b981",
  code:     "#f59e0b",
  doc:      "#3b82f6",
};

function ComposerMenu({
  open,
  onClose,
  onAction
}: {
  open: boolean;
  onClose: () => void;
  onAction: (action: ComposerMenuAction) => void;
}) {
  if (!open) return null;

  return (
    <div className="composer-menu" data-composer-menu-root>
      <button
        type="button"
        className="composer-menu__item"
        onClick={() => {
          onAction("upload");
          onClose();
        }}
      >
        <span className="composer-menu__icon">
          <UploadIcon />
        </span>
        <span className="composer-menu__text">{t("chat.uploadFiles")}</span>
      </button>

      <button
        type="button"
        className="composer-menu__item"
        onClick={() => {
          onAction("deep-think");
          onClose();
        }}
      >
        <span className="composer-menu__icon">
          <SparkleIcon />
        </span>
        <span className="composer-menu__stack">
          <span className="composer-menu__text">{t("chat.deepResearch")}</span>
          <span className="composer-menu__meta">{t("chat.deepResearchDesc")}</span>
        </span>
      </button>

      <button
        type="button"
        className="composer-menu__item"
        onClick={() => {
          onAction("web-search");
          onClose();
        }}
      >
        <span className="composer-menu__icon">
          <SearchIcon />
        </span>
        <span className="composer-menu__stack">
          <span className="composer-menu__text">{t("chat.webSearch")}</span>
          <span className="composer-menu__meta">{t("chat.webSearchDesc")}</span>
        </span>
      </button>

      {/* Phase 5 — 3-AI 병렬 앙상블 모드 (GPT-5.4-pro + Claude Opus 4.6 + Gemini 3.1 Pro Ultra) */}
      <button
        type="button"
        className="composer-menu__item"
        onClick={() => {
          onAction("parallel-ensemble");
          onClose();
        }}
      >
        <span className="composer-menu__icon">⚡</span>
        <span className="composer-menu__stack">
          <span className="composer-menu__text">{t("chat.parallelEnsemble")}</span>
          <span className="composer-menu__meta">{t("chat.parallelEnsembleDesc")}</span>
        </span>
      </button>
    </div>
  );
}

export default function Composer({
  draft,
  isSending,
  onDraftChange,
  onAttachFiles,
  onSend,
  onStopGenerating,
  textareaRef,
  onComposerAction,
  composerMode,
  onClearComposerMode,
  attachedFiles
}: {
  draft: string;
  isSending: boolean;
  onDraftChange: (value: string) => void;
  onAttachFiles?: (files: { name: string; type: string; base64: string; size: number }[]) => void;
  onSend: () => void;
  onStopGenerating?: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onComposerAction?: (action: ComposerMenuAction) => void;
  composerMode?: ComposerModeValue;
  onClearComposerMode?: () => void;
  attachedFiles?: { name: string; type: string; base64: string; size: number }[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashFiltered, setSlashFiltered] = useState<SlashCommand[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const menuRootRef = useRef<HTMLDivElement | null>(null);
  const slashRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    el.style.height = "0px";
    const nextHeight = Math.min(el.scrollHeight, 480);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > 480 ? "auto" : "hidden";
  }, [draft, textareaRef]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (menuRootRef.current?.contains(target ?? null)) return;
      setMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const text = event.clipboardData.getData("text/plain");
    if (text.length < 500) return; // 500자 미만은 일반 붙여넣기
    event.preventDefault();

    // 파일명 생성 (날짜 기반)
    const now = new Date();
    const fileName = t("chat.pastePrefix") + "_" + now.getFullYear() + String(now.getMonth()+1).padStart(2,"0") + String(now.getDate()).padStart(2,"0") + "_" + String(now.getHours()).padStart(2,"0") + String(now.getMinutes()).padStart(2,"0") + ".txt";

    // base64 변환
    const bytes = new TextEncoder().encode(text);
    const binary = Array.from(bytes).map(b => String.fromCharCode(b)).join("");
    const base64 = btoa(binary);

    // 파일 첨부로 처리
    if (onAttachFiles) {
      const newFile = { name: fileName, type: "text/plain", base64, size: text.length };
      onAttachFiles([...(attachedFiles ?? []), newFile].slice(0, 10));
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (slashOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashIndex(i => Math.min(i + 1, slashFiltered.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (event.key === "Tab" || (event.key === "Enter" && slashFiltered.length > 0)) {
        event.preventDefault();
        applySlashCommand(slashFiltered[slashIndex]);
        return;
      }
      if (event.key === "Escape") {
        setSlashOpen(false);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!isSending && (draft.trim() || (attachedFiles && attachedFiles.length > 0))) {
        onSend();
      }
    }
  }

  function applySlashCommand(cmd: SlashCommand) {
    // 현재 입력에서 /xxx 부분을 cmd.insert로 교체
    const replaced = draft.replace(/(^|\s)\/[\w가-힣]*$/, (m, prefix) => prefix + cmd.insert);
    onDraftChange(replaced);
    setSlashOpen(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function handleMenuAction(action: ComposerMenuAction) {
    if (action === "upload") {
      fileInputRef.current?.click();
      setMenuOpen(false);
      return;
    }
    onComposerAction?.(action);
    setMenuOpen(false);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const maxSize = 20 * 1024 * 1024; // 20MB
    const current = attachedFiles ?? [];
    const remaining = 10 - current.length;

    if (remaining <= 0) {
      showToast(t("chat.maxAttachments").replace("{max}", "10"), "warning");
      e.target.value = "";
      return;
    }

    const toProcess = files.slice(0, remaining);
    const oversized = toProcess.filter(f => f.size > maxSize);
    if (oversized.length > 0) {
      showToast(t("errors.fileSizeLimit") + oversized.map(f => f.name).join(", "), "error");
      e.target.value = "";
      return;
    }

    const results = await Promise.all(toProcess.map(file => new Promise<{ name: string; type: string; base64: string; size: number }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1] ?? result;
        resolve({ name: file.name, type: file.type, base64, size: file.size });
      };
      reader.onerror = () => reject(new Error(t("errors.fileReadFailed") + ": " + file.name));
      reader.readAsDataURL(file);
    }))).catch(() => { showToast(t("errors.fileReadFailed"), "error"); return null; });

    if (results) onAttachFiles?.([...current, ...results]);
    e.target.value = "";
  }

  return (
    <div
      className="chat-composer"
      onDragOver={e => { e.preventDefault(); e.currentTarget.style.outline = "2px dashed var(--text-soft)"; }}
      onDragLeave={e => { e.currentTarget.style.outline = ""; }}
      onDrop={async e => {
        e.preventDefault();
        e.currentTarget.style.outline = "";
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length === 0) return;
        const maxSize = 20 * 1024 * 1024;
        const current = attachedFiles ?? [];
        const remaining = 10 - current.length;
        if (remaining <= 0) { showToast(t("chat.maxAttachments").replace("{max}", "10"), "warning"); return; }
        const toProcess = files.slice(0, remaining).filter(f => f.size <= maxSize);
        const results = await Promise.all(toProcess.map(file => new Promise<{ name: string; type: string; base64: string; size: number }>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            const base64 = result.split(",")[1] ?? result;
            resolve({ name: file.name, type: file.type, base64, size: file.size });
          };
          reader.onerror = () => reject(new Error(t("errors.fileReadFailed") + ": " + file.name));
          reader.readAsDataURL(file);
        }))).catch(() => { showToast(t("errors.fileReadFailed"), "error"); return null; });
        if (results) onAttachFiles?.([...current, ...results]);
      }}
    >
      {/* hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,.pdf,.txt,.md,.csv,.json,.ts,.tsx,.js,.jsx,.py,.java,.go,.rs,.cpp,.c,.h,.hpp,.swift,.kt,.rb,.php,.sql,.xml,.yaml,.yml,.toml,.env,.sh,.bat,.html,.css,.scss,.less,.xlsx,.xls,.docx,.doc,.pptx,.ppt,.zip,.tar,.gz,.log,.ini,.cfg"
        style={{ display: "none" }}
        multiple
        onChange={handleFileChange}
      />

      {/* 첨부파일 미리보기 — 가로 스크롤 (wrap 없이 1행 고정) */}
      {attachedFiles && attachedFiles.length > 0 && (
        <div className="chat-composer__files" style={{
          padding: "10px 14px 2px",
          display: "flex",
          flexWrap: "nowrap",
          overflowX: "auto",
          gap: 8,
          alignItems: "flex-start",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}>
          {attachedFiles.map((f, idx) => (
            <FilePreviewThumbnail
              key={idx}
              name={f.name}
              type={f.type}
              base64={f.base64}
              size={f.size}
              onDelete={() => onAttachFiles?.(attachedFiles.filter((_, i) => i !== idx))}
            />
          ))}
          {attachedFiles.length < 10 && (
            <div style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 72,
              height: 72,
              borderRadius: 10,
              border: "1px dashed var(--border)",
              background: "var(--surface-2)",
              fontSize: 11,
              color: "var(--text-soft)",
              fontWeight: 500,
              textAlign: "center"
            }}>
              {attachedFiles.length}/10
            </div>
          )}
        </div>
      )}

      {composerMode && (() => {
        const modeStyles: Record<NonNullable<ComposerModeValue>, { bg: string; color: string; label: string }> = {
          "deep-think":        { bg: "rgba(99,102,241,0.1)",  color: "#6366f1", label: t("chat.deepResearchBadge") },
          "web-search":        { bg: "rgba(16,185,129,0.1)",  color: "#10b981", label: t("chat.webSearchBadge") },
          "parallel-ensemble": { bg: "rgba(217,119,6,0.12)",  color: "#b45309", label: t("chat.parallelEnsembleBadge") },
        };
        const s = modeStyles[composerMode];
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px 0" }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "3px 10px", borderRadius: 20,
              background: s.bg,
              color: s.color,
              fontSize: 12, fontWeight: 600
            }}>
              {s.label}
              <button type="button" onClick={onClearComposerMode}
                style={{ display: "flex", alignItems: "center", border: "none", background: "none", cursor: "pointer", padding: 0, color: "inherit", opacity: 0.7 }}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </span>
          </div>
        );
      })()}
      {/* slash 커맨드 팝오버 */}
      {slashOpen && slashFiltered.length > 0 && (
        <div
          ref={slashRef}
          role="listbox"
          aria-label={t("chat.commands")}
          style={{
            position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: 4,
            background: "var(--bg-main, #fff)", border: "1px solid var(--border)",
            borderRadius: 10, boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
            zIndex: 100, overflow: "hidden", maxHeight: 320, overflowY: "auto"
          }}
        >
          <div style={{ padding: "6px 10px", fontSize: 10, fontWeight: 700, color: "var(--text-sub)", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid var(--border)" }}>
            {t("chat.commands")}
          </div>
          {slashFiltered.map((cmd, idx) => (
            <button
              key={cmd.trigger}
              type="button"
              role="option"
              aria-selected={idx === slashIndex}
              onMouseDown={(e) => { e.preventDefault(); applySlashCommand(cmd); }}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: "8px 12px", border: "none", cursor: "pointer",
                background: idx === slashIndex ? "var(--bg-sub, #f3f4f6)" : "transparent",
                textAlign: "left"
              }}
            >
              <span style={{
                width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                background: CATEGORY_COLOR[cmd.category] ?? "#888"
              }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-main)", minWidth: 90 }}>
                {cmd.trigger}
              </span>
              <span style={{ fontSize: 12, color: "var(--text-main)", flex: 1 }}>{cmd.label}</span>
              <span style={{ fontSize: 10, color: "var(--text-sub)" }}>{cmd.meta}</span>
            </button>
          ))}
        </div>
      )}
      <div className="chat-composer__row" style={{ position: "relative" }}>
        <div ref={menuRootRef} className="chat-composer__menu-anchor">
          <button
            type="button"
            className="chat-composer__icon-btn"
            aria-label={t("chat.tools")}
            onClick={() => setMenuOpen((current) => !current)}
          >
            <PlusIcon />
          </button>

          <ComposerMenu open={menuOpen} onClose={() => setMenuOpen(false)} onAction={handleMenuAction} />
        </div>

        <textarea
          ref={textareaRef}
          value={draft}
          style={{ minHeight: attachedFiles && attachedFiles.length > 0 ? 52 : 24 }}
          onChange={(event) => {
            const val = event.target.value;
            onDraftChange(val);
            // slash 커맨드 감지
            const slashMatch = val.match(/(?:^|\s)\/([\w가-힣]*)$/);
            if (slashMatch) {
              const q = slashMatch[1].toLowerCase();
              const filtered = SLASH_COMMANDS.filter(c =>
                c.trigger.slice(1).startsWith(q) ||
                c.label.toLowerCase().includes(q)
              );
              setSlashFiltered(filtered);
              setSlashOpen(filtered.length > 0);
              setSlashIndex(0);
            } else {
              setSlashOpen(false);
            }
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          rows={1}
          placeholder={attachedFiles && attachedFiles.length > 0 ? t("chat.placeholderWithFile") : t("chat.placeholder")}
          className="chat-composer__textarea"
        />

        <div className="chat-composer__actions">
          <button
            type="button"
            onClick={() => {
              if (isSending) {
                onStopGenerating?.();
                return;
              }
              onSend();
            }}
            disabled={!isSending && !draft.trim() && !(attachedFiles && attachedFiles.length > 0)}
            className="chat-composer__send"
            aria-label={isSending ? t("chat.stop") : t("chat.send")}
            title={isSending ? t("chat.stopTitle") : t("chat.send")}
          >
            {isSending ? (
              <StopIcon />
            ) : (
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14" />
                <path d="m13 5 7 7-7 7" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
