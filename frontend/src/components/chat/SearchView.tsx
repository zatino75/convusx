import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../../i18n";
import type { Thread } from "../../types/workspace";

export function SearchView({
  threads,
  onOpenThread
}: {
  threads: Thread[];
  onOpenThread: (threadId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, []);

  // 300ms 디바운스
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const trimmed = debouncedQuery;

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
          title: thread.title ?? t("defaults.newChat"),
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
        ? <mark key={i} style={{ background: "rgba(201, 100, 66, 0.25)", color: "var(--text-main)", borderRadius: 2, padding: "0 1px" }}>{part}</mark>
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
          placeholder={t("nav.search") + "..."}
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
            {t("nav.search") + "..."}
          </div>
        ) : results.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-soft)", fontSize: 13 }}>
            "{query}" — {t("search.noResults")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12, color: "var(--text-soft)", marginBottom: 4 }}>
              {results.length}{t("search.countSuffix")}
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
