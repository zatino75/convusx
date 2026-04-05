import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function ProjectCreateModal({
  open,
  value,
  onChange,
  onClose,
  onSubmit
}: {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="project-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="project-modal__header">
          <div className="project-modal__title">새 프로젝트</div>

          <div className="project-modal__actions">
            <button type="button" className="project-modal__icon-btn" onClick={onClose} aria-label="닫기">
              <CloseIcon />
            </button>
          </div>
        </div>

        <div className="project-modal__label">프로젝트 이름</div>

        <div className="project-modal__input-wrap">
          <span className="project-modal__input-icon">
            <FolderIcon />
          </span>
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmit();
              }
            }}
            className="project-modal__input"
            placeholder="예: CORVUS X 분석 리서치"
          />
        </div>

        <div className="project-modal__chips">
          <button type="button" className="project-modal__chip" onClick={() => onChange("CORVUS X")}>
            CORVUS X
          </button>
          <button type="button" className="project-modal__chip" onClick={() => onChange("멀티 AI 리서치")}>
            멀티 AI 리서치
          </button>
          <button type="button" className="project-modal__chip" onClick={() => onChange("UI 고도화")}>
            UI 고도화
          </button>
        </div>

        <div className="project-modal__notice">
          프로젝트를 만들면 프로젝트 홈과 스레드 구조가 분리되어 관리됩니다.
        </div>

        <div className="project-modal__footer">
          <button
            type="button"
            className="project-modal__submit"
            onClick={onSubmit}
            disabled={!value.trim()}
          >
            생성
          </button>
        </div>
      </div>

    </div>
  );
}

export default ProjectCreateModal;
