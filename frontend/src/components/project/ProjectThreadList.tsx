import { useEffect, useRef, useState } from "react";
import type { ProjectGroup } from "../../types/workspace";
import { stripMarkdown } from "../../utils/helpers";

type Props = {
  project: ProjectGroup | null;
  activeThreadId?: string | null;
  onOpenThread?: (threadId: string) => void;

  onRenameThread?: (threadId: string) => void;
  onMoveThread?: (threadId: string) => void;
  onRemoveFromProject?: (threadId: string) => void;
  onDeleteThread?: (threadId: string) => void;
};

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

export default function ProjectThreadList({
  project,
  activeThreadId = null,
  onOpenThread,
  onRenameThread,
  onMoveThread,
  onRemoveFromProject,
  onDeleteThread
}: Props) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!project) return null;

  return (
    <div className="project-home__list" ref={containerRef}>
      {project.threads.map((thread) => {
        const isActive = activeThreadId === thread.id;

        const rawPreview =
          [...thread.messages]
            .reverse()
            .find((item) => item.content?.trim())
            ?.content ?? "";
        const preview = rawPreview ? stripMarkdown(rawPreview).slice(0, 96) || "아직 대화 없음" : "아직 대화 없음";

        const isMenuOpen = openMenuId === thread.id;

        return (
          <div key={thread.id} className="project-thread-hover-row">
            
            {/* ✅ ROW */}
            <button
              type="button"
              onClick={() => onOpenThread?.(thread.id)}
              className="project-thread-row"
              style={isActive ? { background: "#f3f4f6" } : undefined}
            >
              <div className="project-thread-row__main">
                <div className="project-thread-row__title">{thread.title}</div>
                <div className="project-thread-row__preview">{preview}</div>
              </div>

              <div className="project-thread-row__date">
                {new Date(thread.updatedAt).toLocaleString("ko-KR", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit"
                })}
              </div>
            </button>

            {/* ✅ MENU */}
            <div
              className="row-menu row-menu--project-home"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="row-menu__trigger"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuId((prev) =>
                    prev === thread.id ? null : thread.id
                  );
                }}
              >
                <MoreIcon />
              </button>

              {isMenuOpen && (
                <div className="row-menu__panel row-menu__panel--project-home">
                  
                  <button
                    className="menu-item-button"
                    onClick={() => {
                      onRenameThread?.(thread.id);
                      setOpenMenuId(null);
                    }}
                  >
                    이름 바꾸기
                  </button>

                  <button
                    className="menu-item-button"
                    onClick={() => {
                      onMoveThread?.(thread.id);
                      setOpenMenuId(null);
                    }}
                  >
                    프로젝트 이동
                  </button>

                  <button
                    className="menu-item-button"
                    onClick={() => {
                      onRemoveFromProject?.(thread.id);
                      setOpenMenuId(null);
                    }}
                  >
                    프로젝트에서 제거
                  </button>

                  <button
                    className="menu-item-button is-danger"
                    onClick={() => {
                      onDeleteThread?.(thread.id);
                      setOpenMenuId(null);
                    }}
                  >
                    삭제
                  </button>

                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
