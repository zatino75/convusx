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
        ? <mark key={i} className="search-panel__mark">{part}</mark>
        : part
    );
  }

  return (
    <section className="search-panel">
      <div className="search-panel__input-wrap">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" className="search-panel__icon">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t("nav.search") + "..."}
          className="search-panel__input"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} className="search-panel__clear">
            ×
          </button>
        )}
      </div>

      <div className="search-panel__results">
        {!trimmed ? (
          <div className="search-panel__empty">
            {t("nav.search") + "..."}
          </div>
        ) : results.length === 0 ? (
          <div className="search-panel__empty">
            "{query}" — {t("search.noResults")}
          </div>
        ) : (
          <div className="search-panel__list">
            <div className="search-panel__count">
              {results.length}{t("search.countSuffix")}
            </div>
            {results.map((result) => (
              <button
                key={result.threadId}
                type="button"
                onClick={() => onOpenThread(result.threadId)}
                className="search-panel__item"
              >
                <div className="search-panel__title">
                  {highlight(result.title, trimmed)}
                </div>
                {result.snippets.map((snippet, i) => (
                  <div key={i} className="search-panel__snippet">
                    ...{highlight(snippet, trimmed)}...
                  </div>
                ))}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
