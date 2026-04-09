import React, { useMemo } from "react";

type FilePreviewProps = {
  name: string;
  type: string;
  base64?: string;
  size?: number;
  onDelete?: () => void;
  compact?: boolean; // for message display
};

function PDFIcon() {
  return (
    <svg viewBox="0 0 24 24" width="48" height="48" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#ef4444" fillOpacity="0.1" stroke="#ef4444" strokeWidth="1.5" />
      <text x="12" y="16" fontSize="10" fontWeight="bold" fill="#ef4444" textAnchor="middle" fontFamily="system-ui">PDF</text>
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="48" height="48" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#3b82f6" fillOpacity="0.1" stroke="#3b82f6" strokeWidth="1.5" />
      <path d="M7 10l-2 2 2 2M17 10l2 2-2 2M14 6l-4 12" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" width="48" height="48" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#6b7280" fillOpacity="0.1" stroke="#6b7280" strokeWidth="1.5" />
      <path d="M14 2v6h6" fill="none" stroke="#6b7280" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6 10h4M6 14h8M6 18h3" stroke="#6b7280" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="48" height="48" fill="none">
      <rect x="2" y="4" width="20" height="16" rx="2" fill="#8b5cf6" fillOpacity="0.1" stroke="#8b5cf6" strokeWidth="1.5" />
      <polygon points="9,8 9,16 16,12" fill="#8b5cf6" />
    </svg>
  );
}

function ExcelIcon() {
  return (
    <svg viewBox="0 0 24 24" width="48" height="48" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#10b981" fillOpacity="0.1" stroke="#10b981" strokeWidth="1.5" />
      <g stroke="#10b981" strokeWidth="1" fill="none">
        <rect x="5" y="5" width="14" height="14" />
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="10" x2="19" y2="10" />
        <line x1="5" y1="15" x2="19" y2="15" />
      </g>
    </svg>
  );
}

function WordIcon() {
  return (
    <svg viewBox="0 0 24 24" width="48" height="48" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#2563eb" fillOpacity="0.1" stroke="#2563eb" strokeWidth="1.5" />
      <text x="12" y="16" fontSize="9" fontWeight="bold" fill="#2563eb" textAnchor="middle" fontFamily="system-ui">DOC</text>
    </svg>
  );
}

function PowerPointIcon() {
  return (
    <svg viewBox="0 0 24 24" width="48" height="48" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#d97706" fillOpacity="0.1" stroke="#d97706" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="4" fill="#d97706" fillOpacity="0.2" stroke="#d97706" strokeWidth="1" />
      <path d="M12 9v6M9 12h6" stroke="#d97706" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function getFileIcon(type: string, name: string): React.ReactNode {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const mimeType = type.toLowerCase();

  // PDF
  if (ext === "pdf" || mimeType.includes("pdf")) return <PDFIcon />;

  // Code files
  if (["ts", "tsx", "js", "jsx", "py", "java", "go", "rb", "php", "json", "xml", "yaml", "yml", "sql", "sh", "bash"].includes(ext) || mimeType.includes("text/x-") || mimeType.includes("application/x-")) {
    return <CodeIcon />;
  }

  // Excel
  if (["xlsx", "xls", "csv"].includes(ext) || mimeType.includes("spreadsheet") || mimeType.includes("ms-excel")) {
    return <ExcelIcon />;
  }

  // Word
  if (["docx", "doc"].includes(ext) || mimeType.includes("word") || mimeType.includes("wordprocessingml")) {
    return <WordIcon />;
  }

  // PowerPoint
  if (["pptx", "ppt", "odp"].includes(ext) || mimeType.includes("presentation") || mimeType.includes("officedocument.presentationml")) {
    return <PowerPointIcon />;
  }

  // Video
  if (ext.match(/^(mp4|webm|avi|mov|mkv|flv|wmv|m4v)$/) || mimeType.startsWith("video/")) {
    return <VideoIcon />;
  }

  // Default document
  return <DocumentIcon />;
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KB";
  return (bytes / (1024 * 1024)).toFixed(1) + "MB";
}

function truncateFileName(name: string, maxLength: number = 20): string {
  if (name.length <= maxLength) return name;
  const ext = name.split(".").pop() || "";
  const nameWithoutExt = name.slice(0, -(ext.length + 1));
  const available = maxLength - ext.length - 2; // -2 for the dot and ellipsis
  return nameWithoutExt.slice(0, Math.max(1, available)) + "..." + ext;
}

export function FilePreviewCompact({
  name,
  type,
  size,
  onDelete
}: FilePreviewProps) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 5,
      padding: "3px 9px",
      borderRadius: 6,
      background: "rgba(255,255,255,0.18)",
      border: "1px solid rgba(255,255,255,0.3)",
      fontSize: 11,
      color: "inherit",
      maxWidth: 200
    }}>
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </svg>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      {size && <span style={{ opacity: 0.7, flexShrink: 0 }}>{formatFileSize(size)}</span>}
    </div>
  );
}

export function FilePreviewThumbnail({
  name,
  type,
  base64,
  size,
  onDelete
}: FilePreviewProps) {
  const isImage = useMemo(() => type.startsWith("image/"), [type]);
  const imageUrl = useMemo(() => {
    if (!isImage || !base64) return null;
    try {
      return "data:" + type + ";base64," + base64;
    } catch {
      return null;
    }
  }, [isImage, base64, type]);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 6,
      padding: "10px",
      borderRadius: 10,
      background: "var(--surface-1)",
      border: "1px solid var(--border)",
      width: 76,
      flexShrink: 0,   /* 가로 스크롤에서 찌그러짐 방지 */
      position: "relative"
    }}>
      {/* Thumbnail or Icon */}
      <div style={{
        width: 48,
        height: 48,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        background: "var(--surface-2)",
        overflow: "hidden",
        flexShrink: 0
      }}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={name}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover"
            }}
          />
        ) : (
          getFileIcon(type, name)
        )}
      </div>

      {/* File Name */}
      <div style={{
        width: "100%",
        fontSize: 11,
        fontWeight: 500,
        color: "var(--text-main)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        textAlign: "center"
      }} title={name}>
        {truncateFileName(name, 15)}
      </div>

      {/* File Size */}
      {size && (
        <div style={{
          fontSize: 10,
          color: "var(--text-soft)",
          width: "100%",
          textAlign: "center"
        }}>
          {formatFileSize(size)}
        </div>
      )}

      {/* Delete Button */}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          style={{
            position: "absolute",
            top: -8,
            right: -8,
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: "var(--text-main)",
            border: "2px solid var(--surface-1)",
            color: "var(--surface-1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            padding: 0,
            fontSize: 14,
            fontWeight: 700,
            lineHeight: 1,
            transition: "all 0.2s"
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = "var(--text-soft)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = "var(--text-main)";
          }}
          title="Remove"
        >
          ×
        </button>
      )}
    </div>
  );
}

export default function FilePreview({
  name,
  type,
  base64,
  size,
  onDelete,
  compact = false
}: FilePreviewProps) {
  if (compact) {
    return <FilePreviewCompact name={name} type={type} size={size} onDelete={onDelete} />;
  }
  return <FilePreviewThumbnail name={name} type={type} base64={base64} size={size} onDelete={onDelete} />;
}
