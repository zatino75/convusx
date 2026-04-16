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
    <section className="media-gallery">
      <header className="media-gallery__top">
        <div className="media-gallery__tabs">
          {(["image", "video"] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setSelected(new Set());
              }}
              className={`media-gallery__tab ${tab === t ? "is-active" : ""}`}
            >
              {t === "image" ? `🖼 이미지 ${imageCount > 0 ? `(${imageCount})` : ""}` : `🎬 비디오 ${videoCount > 0 ? `(${videoCount})` : ""}`}
            </button>
          ))}
        </div>
        {images.length > 0 && (
          <div className="media-gallery__actions">
            {selected.size > 0 && (
              <button type="button" onClick={deleteSelected} className="media-gallery__btn is-danger">
                선택 삭제 ({selected.size})
              </button>
            )}
            <button type="button" onClick={deleteAll} className="media-gallery__btn">
              전체 삭제
            </button>
          </div>
        )}
      </header>

      {images.length === 0 ? (
        <div className="media-gallery__empty">채팅에서 생성된 이미지가 없습니다.</div>
      ) : (
        <div className="media-gallery__grid">
          {images.map(img => (
            <div
              key={img.id}
              onClick={() => toggleSelect(img.id)}
              className={`media-gallery__card ${selected.has(img.id) ? "is-selected" : ""}`}
            >
              {img.type === "video" ? (
                String(img.url).startsWith("gs://") ? (
                  <div className="media-gallery__video-fallback">
                    <span className="media-gallery__video-icon">🎬</span>
                    <a href={img.url} target="_blank" rel="noopener noreferrer" className="media-gallery__video-link" onClick={e => e.stopPropagation()}>열기</a>
                  </div>
                ) : (
                  <video src={img.url} className="media-gallery__thumb" />
                )
              ) : (
                <img src={img.url} alt={img.alt} className="media-gallery__thumb"
                  onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
              )}
              {img.provider && (
                <div className="media-gallery__provider">{img.provider}</div>
              )}
              {selected.has(img.id) && (
                <div className="media-gallery__check">
                  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#fff" strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg>
                </div>
              )}
              <div className="media-gallery__thread">{img.threadTitle}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
