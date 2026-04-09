import { useState } from "react";
import type { Thread } from "../../types/workspace";
import { extractMediaFromThreads } from "../../appMessageUtils";

type MediaItem = {
  id: string
  url: string
  alt: string
  threadTitle: string
  type: "image" | "video"
  provider?: string
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
