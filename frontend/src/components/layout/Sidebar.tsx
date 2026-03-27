import { useEffect, useMemo, useState } from "react";
import type { ProjectGroup, Thread } from "../../types/workspace";

type Props = {
  generalThreads: Thread[];
  projectThreads: Thread[];
  projects: ProjectGroup[];
  activeProjectId: string;
  activeThreadId: string | null;
  sidebarView: "default" | "search" | "images";
  onOpenGeneralHome: () => void;
  onOpenSearch: () => void;
  onOpenImages: () => void;
  onSelectProject: (projectId: string) => void;
  onSelectThread: (threadId: string) => void;
  onNewChat: () => void;
  onCreateProject: () => void;
  onCreateThreadInProject: (projectId: string) => void;
  onRenameProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onRenameThread: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onMoveThread: (threadId: string, nextProjectId: string) => void;
  onToggleProjectMemory: (projectId: string) => void;
  onToggleThreadPinned?: (threadId: string) => void;
};

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\[\d+\]/g, "")
    .replace(/!?\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function LogoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 6.5v11M6.5 12h11" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9">
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4-4" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m20 16-4.5-4.5L8 19" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function SidebarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M4 5h16v14H4z" />
      <path d="M9 5v14" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1 1 0 0 1-1.4 1.4l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V19a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a1 1 0 1 1-1.4-1.4l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H5a1 1 0 0 1-1-1v-1a1 1 0 0 1 1-1h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a1 1 0 1 1 1.4-1.4l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a1 1 0 1 1 1.4 1.4l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6H19a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1h-.2a1 1 0 0 0-.9.6z" />
    </svg>
  );
}

function PinBadgeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 4h8" />
      <path d="M9 4v5l-3 4h12l-3-4V4" />
      <path d="M12 13v7" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.14s ease" }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 1 0-4-4L4.5 16v4z" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 12h14" />
      <path d="M12 5v14" opacity="0.35" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m8 4 8 8" />
      <path d="m9 9 6-6" />
      <path d="M14 14 7 21" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}

function WorkspaceRow({
  active,
  icon,
  label,
  onClick,
  emphasized
}: {
  active?: boolean;
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
  emphasized?: boolean;
}) {
  return (
    <div className={"sidebar-row" + (active ? " is-active" : "") + (emphasized ? " is-emphasized" : "")}>
      <button type="button" onClick={onClick} className="sidebar-row__main">
        <span className="sidebar-row__icon">{icon}</span>
        <span className="sidebar-row__text">{label}</span>
      </button>
    </div>
  );
}

function MenuButton({
  title,
  onClick,
  danger,
  children
}: {
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className={"menu-item-button" + (danger ? " is-danger" : "")} onClick={onClick}>
      {children}
      <span>{title}</span>
    </button>
  );
}

function ProjectActions({
  open,
  onToggle,
  onClose,
  projectId,
  onRenameProject,
  onDeleteProject
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  projectId: string;
  onRenameProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
}) {
  return (
    <div className="row-menu" data-menu-root>
      <button type="button" className="row-menu__trigger" onClick={onToggle} aria-expanded={open}>
        <DotsIcon />
      </button>

      {open ? (
        <div className="row-menu__panel">
          <MenuButton
            title="이름 바꾸기"
            onClick={() => {
              onRenameProject(projectId);
              onClose();
            }}
          >
            <PencilIcon />
          </MenuButton>

          <MenuButton
            title="삭제"
            danger
            onClick={() => {
              onDeleteProject(projectId);
              onClose();
            }}
          >
            <TrashIcon />
          </MenuButton>
        </div>
      ) : null}
    </div>
  );
}

function ProjectThreadActions({
  open,
  onToggle,
  onClose,
  thread,
  projects,
  onRenameThread,
  onDeleteThread,
  onMoveThread
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  thread: Thread;
  projects: ProjectGroup[];
  onRenameThread: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onMoveThread: (threadId: string, nextProjectId: string) => void;
}) {
  const moveTargets = projects.filter((item) => item.id !== thread.projectId);

  return (
    <div className="row-menu row-menu--hover" data-menu-root>
      <button type="button" className="row-menu__trigger" onClick={onToggle} aria-expanded={open}>
        <DotsIcon />
      </button>

      {open ? (
        <div className="row-menu__panel">
          <MenuButton
            title="이름 바꾸기"
            onClick={() => {
              onRenameThread(thread.id);
              onClose();
            }}
          >
            <PencilIcon />
          </MenuButton>

          <div className="row-menu__section">
            <div className="row-menu__label">프로젝트 이동</div>

            <div className="row-menu__move-list">
              {moveTargets.length > 0 ? (
                moveTargets.map((target) => (
                  <button
                    key={target.id}
                    type="button"
                    className="row-menu__move-button"
                    onClick={() => {
                      onMoveThread(thread.id, target.id);
                      onClose();
                    }}
                  >
                    <span>{target.title}</span>
                  </button>
                ))
              ) : (
                <div className="row-menu__empty">이동할 프로젝트 없음</div>
              )}
            </div>
          </div>

          <MenuButton
            title="해당 프로젝트에서 삭제"
            onClick={() => {
              onMoveThread(thread.id, "__general__");
              onClose();
            }}
          >
            <RemoveIcon />
          </MenuButton>

          <MenuButton
            title="삭제"
            danger
            onClick={() => {
              onDeleteThread(thread.id);
              onClose();
            }}
          >
            <TrashIcon />
          </MenuButton>
        </div>
      ) : null}
    </div>
  );
}

function GeneralThreadActions({
  open,
  onToggle,
  onClose,
  thread,
  projects,
  onRenameThread,
  onDeleteThread,
  onMoveThread,
  onToggleThreadPinned
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  thread: Thread;
  projects: ProjectGroup[];
  onRenameThread: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onMoveThread: (threadId: string, nextProjectId: string) => void;
  onToggleThreadPinned?: (threadId: string) => void;
}) {
  const isPinned = Boolean(thread.meta?.pinned);

  return (
    <div className="row-menu row-menu--hover" data-menu-root>
      <button type="button" className="row-menu__trigger" onClick={onToggle} aria-expanded={open}>
        <DotsIcon />
      </button>

      {open ? (
        <div className="row-menu__panel">
          <MenuButton
            title="이름 바꾸기"
            onClick={() => {
              onRenameThread(thread.id);
              onClose();
            }}
          >
            <PencilIcon />
          </MenuButton>

          <div className="row-menu__section">
            <div className="row-menu__label">프로젝트로 이동</div>

            <div className="row-menu__move-list">
              {projects.length > 0 ? (
                projects.map((target) => (
                  <button
                    key={target.id}
                    type="button"
                    className="row-menu__move-button"
                    onClick={() => {
                      onMoveThread(thread.id, target.id);
                      onClose();
                    }}
                  >
                    <span>{target.title}</span>
                  </button>
                ))
              ) : (
                <div className="row-menu__empty">이동할 프로젝트 없음</div>
              )}
            </div>
          </div>

          <MenuButton
            title={isPinned ? "채팅 고정 해제" : "채팅 고정"}
            onClick={() => {
              onToggleThreadPinned?.(thread.id);
              onClose();
            }}
          >
            <PinIcon />
          </MenuButton>

          <MenuButton
            title="삭제"
            danger
            onClick={() => {
              onDeleteThread(thread.id);
              onClose();
            }}
          >
            <TrashIcon />
          </MenuButton>
        </div>
      ) : null}
    </div>
  );
}

function ThreadLeaf({
  thread,
  active,
  projects,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onSelectThread,
  onRenameThread,
  onDeleteThread,
  onMoveThread
}: {
  thread: Thread;
  active: boolean;
  projects: ProjectGroup[];
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onSelectThread: (threadId: string) => void;
  onRenameThread: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onMoveThread: (threadId: string, nextProjectId: string) => void;
}) {
  const rawPv = [...thread.messages].reverse().find((item) => item.content?.trim() && !item.isHidden)?.content ?? "";
  const preview = rawPv ? stripMarkdown(rawPv).slice(0, 42) || thread.meta?.lastSummary || "아직 대화 없음" : thread.meta?.lastSummary ?? "아직 대화 없음";

  return (
    <div className="thread-row">
      <button
        type="button"
        onClick={() => onSelectThread(thread.id)}
        className={"thread-leaf" + (active ? " is-active" : "")}
      >
        <div className="thread-leaf__title">{thread.title}</div>
        <div className="thread-leaf__preview">{preview}</div>
      </button>

      <ProjectThreadActions
        open={menuOpen}
        onToggle={onToggleMenu}
        onClose={onCloseMenu}
        thread={thread}
        projects={projects}
        onRenameThread={onRenameThread}
        onDeleteThread={onDeleteThread}
        onMoveThread={onMoveThread}
      />
    </div>
  );
}

function ProjectRow({
  project,
  open,
  active,
  activeThreadId,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onToggle,
  onSelectProject,
  onSelectThread,
  onRenameProject,
  onDeleteProject,
  onRenameThread,
  onDeleteThread,
  onMoveThread,
  projects,
  openThreadMenuId,
  onToggleThreadMenu,
  onCloseThreadMenu
}: {
  project: ProjectGroup;
  open: boolean;
  active: boolean;
  activeThreadId: string | null;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onToggle: () => void;
  onSelectProject: () => void;
  onSelectThread: (threadId: string) => void;
  onRenameProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onRenameThread: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onMoveThread: (threadId: string, nextProjectId: string) => void;
  projects: ProjectGroup[];
  openThreadMenuId: string | null;
  onToggleThreadMenu: (threadId: string) => void;
  onCloseThreadMenu: () => void;
}) {
  return (
    <div className="project-block">
      <div className={"sidebar-row sidebar-row--project" + (active ? " is-active" : "")}>
        <button
          type="button"
          onClick={() => {
            onToggle();
            onSelectProject();
          }}
          className="sidebar-row__main"
        >
          <span className="sidebar-row__icon">
            <Chevron open={open} />
          </span>
          <span className="sidebar-row__icon">
            <FolderIcon />
          </span>
          <span className="sidebar-row__stack">
            <span className="sidebar-row__text">{project.title}</span>
            <span className="sidebar-row__meta">{project.threadCount}개 스레드</span>
          </span>
        </button>

        <ProjectActions
          open={menuOpen}
          onToggle={onToggleMenu}
          onClose={onCloseMenu}
          projectId={project.id}
          onRenameProject={onRenameProject}
          onDeleteProject={onDeleteProject}
        />
      </div>

      {open ? (
        <div className="project-block__threads">
          {project.threads.length > 0 ? (
            project.threads.map((thread) => (
              <ThreadLeaf
                key={thread.id}
                thread={thread}
                active={activeThreadId === thread.id}
                projects={projects}
                menuOpen={openThreadMenuId === thread.id}
                onToggleMenu={() => onToggleThreadMenu(thread.id)}
                onCloseMenu={onCloseThreadMenu}
                onSelectThread={onSelectThread}
                onRenameThread={onRenameThread}
                onDeleteThread={onDeleteThread}
                onMoveThread={onMoveThread}
              />
            ))
          ) : (
            <div className="sidebar-empty-text">스레드 없음</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function RecentThreadRow({
  thread,
  active,
  projects,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onClick,
  onRenameThread,
  onDeleteThread,
  onMoveThread,
  onToggleThreadPinned
}: {
  thread: Thread;
  active: boolean;
  projects: ProjectGroup[];
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onClick: () => void;
  onRenameThread: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onMoveThread: (threadId: string, nextProjectId: string) => void;
  onToggleThreadPinned?: (threadId: string) => void;
}) {
  const rawPreview2 = [...thread.messages].reverse().find((item) => item.content?.trim() && !item.isHidden)?.content ?? "";
  const preview = rawPreview2 ? stripMarkdown(rawPreview2).slice(0, 34) || thread.meta?.lastSummary || "아직 대화 없음" : thread.meta?.lastSummary ?? "아직 대화 없음";

  const isPinned = Boolean(thread.meta?.pinned);

  return (
    <div className="thread-row">
      <button type="button" onClick={onClick} className={"recent-thread-row" + (active ? " is-active" : "")}>
        <div
          className="recent-thread-row__title"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0
          }}
        >
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {thread.title}
          </span>

          {isPinned ? (
            <span
              aria-label="고정됨"
              title="고정됨"
              style={{
                flex: "0 0 auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                height: 22,
                padding: "0 8px",
                borderRadius: 999,
                background: "rgba(15, 23, 42, 0.08)",
                color: "var(--text-main)",
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1
              }}
            >
              <PinBadgeIcon />
              <span>고정</span>
            </span>
          ) : null}
        </div>

        <div className="recent-thread-row__preview">{preview}</div>
      </button>

      <GeneralThreadActions
        open={menuOpen}
        onToggle={onToggleMenu}
        onClose={onCloseMenu}
        thread={thread}
        projects={projects}
        onRenameThread={onRenameThread}
        onDeleteThread={onDeleteThread}
        onMoveThread={onMoveThread}
        onToggleThreadPinned={onToggleThreadPinned}
      />
    </div>
  );
}

export default function Sidebar({
  generalThreads,
  projects,
  activeProjectId,
  activeThreadId,
  sidebarView,
  onOpenGeneralHome,
  onOpenSearch,
  onOpenImages,
  onSelectProject,
  onSelectThread,
  onNewChat,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  onRenameThread,
  onDeleteThread,
  onMoveThread,
  onToggleThreadPinned
}: Props) {
  const [openProjectIds, setOpenProjectIds] = useState<string[]>([]);
  const [isCompact, setIsCompact] = useState<boolean>(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (activeProjectId && activeProjectId !== "__general__") {
      setOpenProjectIds((current) => (current.includes(activeProjectId) ? current : [...current, activeProjectId]));
    }
  }, [activeProjectId]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-menu-root]")) return;
      setOpenMenuId(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenuId(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [projects]
  );

  function toggleProject(projectId: string) {
    setOpenProjectIds((current) =>
      current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId]
    );
  }

  function toggleMenu(menuId: string) {
    setOpenMenuId((current) => (current === menuId ? null : menuId));
  }

  return (
    <div className={"sidebar" + (isCompact ? " is-compact" : "")}>
      <div
        className="sidebar__inner"
        style={{
          height: "100%",
          minHeight: 0,
          display: "grid",
          gridTemplateRows: "minmax(0, 1fr) auto"
        }}
      >
        <div
          style={{
            minHeight: 0,
            overflowY: "auto",
            overflowX: "hidden",
            paddingRight: 2
          }}
        >
          <div className="sidebar__top">
            <button type="button" className="sidebar-logo" onClick={onOpenGeneralHome}>
              <span className="sidebar-logo__icon">
                <LogoIcon />
              </span>
              <span className="sidebar-logo__text">AI ORCHESTRA</span>
            </button>

            <div className="sidebar__toolbar">
              <button
                type="button"
                className="sidebar-toolbar-btn"
                onClick={() => setIsCompact((current) => !current)}
                title="사이드바 폭 전환"
              >
                <SidebarIcon />
              </button>
            </div>
          </div>

          <div className="sidebar__menu">
            <WorkspaceRow icon={<PlusIcon />} label="새 채팅" onClick={onNewChat} />
            <WorkspaceRow active={sidebarView === "search"} icon={<SearchIcon />} label="채팅 검색" onClick={onOpenSearch} />
            <WorkspaceRow active={sidebarView === "images"} icon={<ImageIcon />} label="이미지" onClick={onOpenImages} />
          </div>

          <div className="sidebar__section-block">
            <div className="sidebar__section-header">
              <div className="sidebar__section-label sidebar__section-label--large">프로젝트</div>
            </div>

            <div className="sidebar__project-list">
              <WorkspaceRow icon={<PlusIcon />} label="새 프로젝트" onClick={onCreateProject} emphasized />

              {sortedProjects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  open={openProjectIds.includes(project.id)}
                  active={activeProjectId === project.id}
                  activeThreadId={activeThreadId}
                  menuOpen={openMenuId === `project:${project.id}`}
                  onToggleMenu={() => toggleMenu(`project:${project.id}`)}
                  onCloseMenu={() => setOpenMenuId(null)}
                  onToggle={() => toggleProject(project.id)}
                  onSelectProject={() => onSelectProject(project.id)}
                  onSelectThread={onSelectThread}
                  onRenameProject={onRenameProject}
                  onDeleteProject={onDeleteProject}
                  onRenameThread={onRenameThread}
                  onDeleteThread={onDeleteThread}
                  onMoveThread={onMoveThread}
                  projects={sortedProjects}
                  openThreadMenuId={openMenuId?.startsWith("project-thread:") ? openMenuId.replace("project-thread:", "") : null}
                  onToggleThreadMenu={(threadId) => toggleMenu(`project-thread:${threadId}`)}
                  onCloseThreadMenu={() => setOpenMenuId(null)}
                />
              ))}
            </div>
          </div>

          <div className="sidebar__section-block">
            <div className="sidebar__section-label sidebar__section-label--large">최근</div>

            <div className="sidebar__recent-list">
              {generalThreads.map((thread) => (
                <RecentThreadRow
                  key={thread.id}
                  thread={thread}
                  active={thread.id === activeThreadId && activeProjectId === "__general__"}
                  projects={sortedProjects}
                  menuOpen={openMenuId === `general-thread:${thread.id}`}
                  onToggleMenu={() => toggleMenu(`general-thread:${thread.id}`)}
                  onCloseMenu={() => setOpenMenuId(null)}
                  onClick={() => onSelectThread(thread.id)}
                  onRenameThread={onRenameThread}
                  onDeleteThread={onDeleteThread}
                  onMoveThread={onMoveThread}
                  onToggleThreadPinned={onToggleThreadPinned}
                />
              ))}
            </div>
          </div>
        </div>

        <div
          className="sidebar__footer"
          style={{
            flex: "0 0 auto",
            borderTop: "1px solid var(--border)",
            padding: "10px 2px 0",
            background: "var(--bg-sidebar)"
          }}
        >
          <button
            type="button"
            onClick={() => {
              window.alert("설정 화면은 다음 단계에서 연결합니다.");
            }}
            style={{
              width: "100%",
              minHeight: 40,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "flex-start",
              gap: 10,
              padding: "0 2px",
              border: "none",
              background: "transparent",
              color: "inherit",
              cursor: "pointer"
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 18,
                height: 18
              }}
            >
              <SettingsIcon />
            </span>
            <span
              style={{
                fontSize: 14,
                fontWeight: 500,
                lineHeight: 1.2
              }}
            >
              설정
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
