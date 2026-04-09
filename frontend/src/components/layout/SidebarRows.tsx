import type { ProjectGroup, Thread } from "../../types/workspace";
import { t } from "../../i18n";
import { stripMarkdown } from "../../utils/helpers";
import {
  Chevron, DotsIcon, FileIcon, FolderIcon, MemoryIcon,
  PencilIcon, PinBadgeIcon, PinIcon, RemoveIcon, TrashIcon
} from "./SidebarIcons";

export type ArtifactItem = {
  id: string;
  title: string;
  code: string;
  language: string;
};

// ─── Primitives ───────────────────────────────────────────────────────────────

export function WorkspaceRow({
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

// ─── Context Menu Popovers ─────────────────────────────────────────────────────

function ProjectActions({
  open,
  onToggle,
  onClose,
  projectId,
  memoryEnabled,
  onRenameProject,
  onDeleteProject,
  onToggleProjectMemory
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  projectId: string;
  memoryEnabled: boolean;
  onRenameProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onToggleProjectMemory?: (projectId: string) => void;
}) {
  return (
    <div className="row-menu" data-menu-root>
      <button type="button" className="row-menu__trigger" onClick={onToggle} aria-expanded={open}>
        <DotsIcon />
      </button>

      {open ? (
        <div className="row-menu__panel">
          {onToggleProjectMemory && (
            <MenuButton
              title={memoryEnabled ? t("sidebar.memoryOff") : t("sidebar.memoryOn")}
              onClick={() => {
                onToggleProjectMemory(projectId);
                onClose();
              }}
            >
              <MemoryIcon />
            </MenuButton>
          )}

          <MenuButton
            title={t("sidebar.rename")}
            onClick={() => {
              onRenameProject(projectId);
              onClose();
            }}
          >
            <PencilIcon />
          </MenuButton>

          <MenuButton
            title={t("sidebar.delete")}
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
            title={t("sidebar.rename")}
            onClick={() => {
              onRenameThread(thread.id);
              onClose();
            }}
          >
            <PencilIcon />
          </MenuButton>

          <div className="row-menu__section">
            <div className="row-menu__label">{t("sidebar.moveProject")}</div>

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
                <div className="row-menu__empty">{t("sidebar.noMoveTarget")}</div>
              )}
            </div>
          </div>

          <MenuButton
            title={t("sidebar.removeFromProject")}
            onClick={() => {
              onMoveThread(thread.id, "__general__");
              onClose();
            }}
          >
            <RemoveIcon />
          </MenuButton>

          <MenuButton
            title={t("sidebar.delete")}
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
            title={t("sidebar.rename")}
            onClick={() => {
              onRenameThread(thread.id);
              onClose();
            }}
          >
            <PencilIcon />
          </MenuButton>

          <div className="row-menu__section">
            <div className="row-menu__label">{t("sidebar.moveToProject")}</div>

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
                <div className="row-menu__empty">{t("sidebar.noMoveTarget")}</div>
              )}
            </div>
          </div>

          <MenuButton
            title={isPinned ? t("sidebar.unpinChat") : t("sidebar.pinChat")}
            onClick={() => {
              onToggleThreadPinned?.(thread.id);
              onClose();
            }}
          >
            <PinIcon />
          </MenuButton>

          <MenuButton
            title={t("sidebar.delete")}
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

// ─── List Row Components ───────────────────────────────────────────────────────

export function ThreadLeaf({
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
  const preview = rawPv ? stripMarkdown(rawPv).slice(0, 42) || thread.meta?.lastSummary || t("sidebar.noConversation") : thread.meta?.lastSummary ?? t("sidebar.noConversation");
  void preview; // rendered conditionally elsewhere

  return (
    <div className="thread-row">
      <button
        type="button"
        onClick={() => onSelectThread(thread.id)}
        className={"thread-leaf" + (active ? " is-active" : "")}
      >
        <div className="thread-leaf__title">{thread.title}</div>
        {false && <div className="thread-leaf__preview">{preview}</div>}
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

export function ProjectRow({
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
  onToggleProjectMemory,
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
  onToggleProjectMemory?: (projectId: string) => void;
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
            <span className="sidebar-row__meta">{t("sidebar.threadCount").replace("{count}", String(project.threadCount))}</span>
          </span>
        </button>

        <ProjectActions
          open={menuOpen}
          onToggle={onToggleMenu}
          onClose={onCloseMenu}
          projectId={project.id}
          memoryEnabled={!!project.meta?.memoryEnabled}
          onRenameProject={onRenameProject}
          onDeleteProject={onDeleteProject}
          onToggleProjectMemory={onToggleProjectMemory}
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
            <div className="sidebar-empty-text">{t("sidebar.noThreads")}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function RecentThreadRow({
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
  const preview = rawPreview2 ? stripMarkdown(rawPreview2).slice(0, 34) || thread.meta?.lastSummary || t("sidebar.noConversation") : thread.meta?.lastSummary ?? t("sidebar.noConversation");
  void preview; // rendered conditionally elsewhere

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
              aria-label={t("sidebar.pinned")}
              title={t("sidebar.pinned")}
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
              <span>{t("sidebar.pinned")}</span>
            </span>
          ) : null}
        </div>

        {false && <div className="recent-thread-row__preview">{preview}</div>}
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

export function ArtifactRow({
  artifact,
  onClick
}: {
  artifact: ArtifactItem;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 2px",
        border: "none",
        background: "none",
        cursor: "pointer",
        borderRadius: 6,
        color: "var(--text-main)",
        textAlign: "left",
        minWidth: 0
      }}
      onMouseEnter={e => (e.currentTarget.style.background = "rgba(15,23,42,0.05)")}
      onMouseLeave={e => (e.currentTarget.style.background = "none")}
    >
      <span style={{ flex: "0 0 auto", color: "var(--text-sub)", display: "flex", alignItems: "center" }}>
        <FileIcon />
      </span>
      <span style={{
        fontSize: 13,
        fontWeight: 500,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        minWidth: 0
      }}>
        {artifact.title}
      </span>
      {artifact.language ? (
        <span style={{
          flex: "0 0 auto",
          fontSize: 10,
          fontWeight: 600,
          padding: "1px 6px",
          borderRadius: 4,
          background: "rgba(15,23,42,0.07)",
          color: "var(--text-sub)",
          marginLeft: "auto"
        }}>
          {artifact.language}
        </span>
      ) : null}
    </button>
  );
}
