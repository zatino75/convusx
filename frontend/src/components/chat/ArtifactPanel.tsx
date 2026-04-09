/**
 * ArtifactPanel — 코드 아티팩트 사이드 패널
 * App.tsx에서 분리된 독립 컴포넌트
 */

export type Artifact = {
  id: string
  title: string
  code: string
  language: string
}

type Props = {
  artifact: Artifact
  onClose: () => void
}

const EXT_MAP: Record<string, string> = {
  javascript: "js", typescript: "ts", jsx: "jsx", tsx: "tsx",
  python: "py", java: "java", html: "html", css: "css",
  json: "json", sql: "sql", bash: "sh", markdown: "md",
}

export default function ArtifactPanel({ artifact, onClose }: Props) {
  function handleDownload() {
    const ext = EXT_MAP[artifact.language.toLowerCase()] ?? (artifact.language.toLowerCase() || "txt")
    const blob = new Blob([artifact.code], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${artifact.title || "code"}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="artifact-panel">
      <div className="artifact-panel__header">
        <span className="artifact-panel__title">{artifact.title}</span>
        <div className="artifact-panel__actions">
          <button
            type="button"
            title="파일 다운로드"
            onClick={handleDownload}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 7, background: "transparent", cursor: "pointer", color: "var(--text-sub)" }}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
          </button>

          <button
            type="button"
            title="복사"
            onClick={() => navigator.clipboard.writeText(artifact.code).catch(() => {})}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 7, background: "transparent", cursor: "pointer", color: "var(--text-sub)", fontSize: 11 }}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="9" y="9" width="10" height="10" rx="2" />
              <path d="M5 15V7a2 2 0 0 1 2-2h8" />
            </svg>
          </button>

          <button
            type="button"
            title="닫기"
            onClick={onClose}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 7, background: "transparent", cursor: "pointer", color: "var(--text-sub)" }}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="artifact-panel__body">
        <pre className="artifact-panel__code">{artifact.code}</pre>
      </div>
    </div>
  )
}
