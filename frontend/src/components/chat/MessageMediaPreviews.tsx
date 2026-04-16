import type { Message } from "../../types/workspace";
import { t } from "../../i18n";

export default function MessageMediaPreviews({
  message,
  onDownloadSlide,
}: {
  message: Message;
  onDownloadSlide?: (slideData: any) => void;
}) {
  const meta = message.requestMeta;
  const imageUrl = meta?.image_url;
  const imageUrls = (meta?.image_urls as string[] | undefined) ?? [];
  const videoUrl = meta?.video_url;
  const slideData = meta?.slide_data;

  return (
    <>
      {!!slideData && onDownloadSlide && (
        <div style={{ margin: "10px 18px 4px" }}>
          <button
            type="button"
            onClick={() => onDownloadSlide(slideData)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "7px 14px", borderRadius: 8,
              background: "#ffffff", color: "#374151",
              border: "1px solid #d1d5db", cursor: "pointer",
              fontSize: 13, fontWeight: 600,
              boxShadow: "0 1px 3px rgba(0,0,0,0.07)",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f4f6")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#ffffff")}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {t("message.downloadPptx")}
          </button>
        </div>
      )}

      {imageUrl && (
        <div style={{ padding: "10px 18px 4px" }}>
          <img
            src={imageUrl}
            alt={t("message.aiImage")}
            style={{
              maxWidth: "min(480px, 90vw)", height: "auto", borderRadius: 12,
              display: "block", border: "1px solid var(--border)",
            }}
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              const fallback = document.createElement("div");
              fallback.textContent = t("errors.imageLoadFailed");
              fallback.style.cssText =
                "padding:12px 16px;border-radius:8px;background:var(--surface-1);color:var(--text-soft);font-size:12px;border:1px dashed var(--border)";
              img.replaceWith(fallback);
            }}
          />
          {meta?.image_revised_prompt && (
            <div
              style={{
                marginTop: 8, fontSize: 11, color: "var(--text-sub)",
                fontStyle: "italic", maxWidth: "min(480px, 90vw)",
              }}
            >
              {meta.image_revised_prompt}
            </div>
          )}
          {imageUrls.length > 1 && (
            <div
              style={{
                marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr",
                gap: 6, maxWidth: "min(480px, 90vw)",
              }}
            >
              {imageUrls.map((url: string, idx: number) => (
                <a key={idx} href={url} target="_blank" rel="noopener noreferrer">
                  <img
                    src={url}
                    alt={t("message.imageN").replace("{n}", String(idx + 1))}
                    style={{
                      width: "100%", aspectRatio: "1", objectFit: "cover",
                      borderRadius: 8, display: "block", border: "1px solid var(--border)",
                    }}
                    onError={(e) => {
                      const img = e.target as HTMLImageElement;
                      const fallback = document.createElement("div");
                      fallback.textContent = t("errors.imageLoadFailed");
                      fallback.style.cssText =
                        "padding:8px;border-radius:6px;background:var(--surface-1);color:var(--text-soft);font-size:11px;border:1px dashed var(--border);text-align:center";
                      img.replaceWith(fallback);
                    }}
                  />
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {videoUrl && (
        <div style={{ padding: "10px 18px 4px" }}>
          {String(videoUrl).startsWith("gs://") ? (
            <div
              style={{
                padding: "12px 16px", borderRadius: 10,
                background: "var(--bg-sub, #f3f4f6)", border: "1px solid var(--border)",
                maxWidth: 480, fontSize: 13,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{t("message.videoComplete")}</div>
              <div style={{ fontSize: 11, color: "var(--text-sub)", wordBreak: "break-all" }}>
                {videoUrl}
              </div>
              <a
                href={videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-block", marginTop: 8, fontSize: 12,
                  color: "var(--accent, #6366f1)", textDecoration: "none", fontWeight: 600,
                }}
              >
                {t("message.openVideo")}
              </a>
            </div>
          ) : (
            <video
              src={videoUrl}
              controls
              style={{
                maxWidth: "100%", width: 480, borderRadius: 12,
                display: "block", border: "1px solid var(--border)",
              }}
            />
          )}
        </div>
      )}
    </>
  );
}
