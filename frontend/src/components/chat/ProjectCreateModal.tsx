import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { t } from "../../i18n";

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
      role="dialog"
      aria-modal="true"
      aria-label={t("nav.newProject")}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="project-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="project-modal__header">
          <div className="project-modal__title" id="project-modal-title">{t("nav.newProject")}</div>

          <div className="project-modal__actions">
            <button type="button" className="project-modal__icon-btn" onClick={onClose} aria-label={t("common.close")} style={{ minWidth: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CloseIcon />
            </button>
          </div>
        </div>

        <label className="project-modal__label" htmlFor="project-name-input">{t("project.projectName")}</label>

        <div className="project-modal__input-wrap">
          <span className="project-modal__input-icon" aria-hidden="true">
            <FolderIcon />
          </span>
          <input
            id="project-name-input"
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
            placeholder={t("project.namePlaceholder")}
            aria-required="true"
            aria-invalid={value.trim().length === 0 && value.length > 0 ? "true" : undefined}
            maxLength={100}
            autoComplete="off"
          />
        </div>

        <div className="project-modal__notice">
          {t("project.createNotice")}
        </div>

        <div className="project-modal__footer">
          <button
            type="button"
            className="project-modal__submit"
            onClick={onSubmit}
            disabled={!value.trim()}
            style={{ minHeight: 44 }}
          >
            {t("project.create")}
          </button>
        </div>
      </div>

    </div>
  );
}

export default ProjectCreateModal;
