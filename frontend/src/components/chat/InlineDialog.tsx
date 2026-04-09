/**
 * InlineDialog — 이름 변경 / 삭제 확인 인라인 모달
 * App.tsx에서 분리된 독립 컴포넌트
 */

export type DialogState = {
  type: "rename-project" | "delete-project" | "rename-thread" | "delete-thread"
  id: string
  currentTitle?: string
} | null

type Props = {
  dialog: DialogState
  dialogInput: string
  onDialogInputChange: (v: string) => void
  onClose: () => void
  onRenameProject: (id: string, name: string) => void
  onRenameThread: (id: string, name: string) => void
  onDeleteProject: (id: string) => void
  onDeleteThread: (id: string) => void
}

export default function InlineDialog({
  dialog,
  dialogInput,
  onDialogInputChange,
  onClose,
  onRenameProject,
  onRenameThread,
  onDeleteProject,
  onDeleteThread,
}: Props) {
  if (!dialog) return null

  const isRename = dialog.type === "rename-project" || dialog.type === "rename-thread"
  const isDelete = dialog.type === "delete-project" || dialog.type === "delete-thread"

  function handleConfirmRename() {
    if (!dialogInput.trim()) return
    if (dialog!.type === "rename-project") onRenameProject(dialog!.id, dialogInput)
    else onRenameThread(dialog!.id, dialogInput)
    onClose()
  }

  function handleConfirmDelete() {
    if (dialog!.type === "delete-project") onDeleteProject(dialog!.id)
    else onDeleteThread(dialog!.id)
    onClose()
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.35)"
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--bg-surface, #fff)", borderRadius: 16, padding: 24,
          width: 400, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,0.2)"
        }}
        onClick={e => e.stopPropagation()}
      >
        {isRename && (
          <>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-main)", marginBottom: 16 }}>
              {dialog.type === "rename-project" ? "프로젝트 이름 변경" : "스레드 이름 변경"}
            </div>
            <input
              autoFocus
              value={dialogInput}
              onChange={e => onDialogInputChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") handleConfirmRename()
                if (e.key === "Escape") onClose()
              }}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8,
                border: "1px solid var(--border)", fontSize: 14,
                color: "var(--text-main)", background: "var(--surface-1, #f9f9f9)",
                outline: "none", boxSizing: "border-box" as const
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button type="button" onClick={onClose}
                style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", fontSize: 13, cursor: "pointer", color: "var(--text-main)" }}>
                취소
              </button>
              <button type="button" onClick={handleConfirmRename}
                style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--text-main)", color: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
                변경
              </button>
            </div>
          </>
        )}

        {isDelete && (
          <>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-main)", marginBottom: 8 }}>
              {dialog.type === "delete-project" ? "프로젝트 삭제" : "스레드 삭제"}
            </div>
            <div style={{ fontSize: 14, color: "var(--text-sub)", marginBottom: 20, lineHeight: 1.6 }}>
              <strong style={{ color: "var(--text-main)" }}>"{dialog.currentTitle}"</strong>을(를) 삭제합니다.
              {dialog.type === "delete-project" && <span> 프로젝트 내 모든 스레드도 함께 삭제됩니다.</span>}
              <br />이 작업은 되돌릴 수 없습니다.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={onClose}
                style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", fontSize: 13, cursor: "pointer", color: "var(--text-main)" }}>
                취소
              </button>
              <button type="button" onClick={handleConfirmDelete}
                style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#ef4444", color: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
                삭제
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
