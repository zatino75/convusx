import { useEffect, useMemo, useState } from "react";
import type { ProjectGroup, Thread } from "../../types/workspace";
import { t } from "../../i18n";
import { DashboardIcon, ImageIcon, PlusIcon, SearchIcon, SettingsIcon } from "./SidebarIcons";
import { type ArtifactItem, ProjectRow, RecentThreadRow, WorkspaceRow } from "./SidebarRows";

type Props = {
  generalThreads: Thread[];
  projectThreads: Thread[];
  projects: ProjectGroup[];
  activeProjectId: string;
  activeThreadId: string | null;
  sidebarView: "default" | "search" | "images" | "benchmark" | "dashboard";
  artifacts?: ArtifactItem[];
  onOpenArtifact?: (title: string, code: string, language: string) => void;
  onOpenGeneralHome: () => void;
  onOpenSearch: () => void;
  onOpenImages: () => void;
  onOpenBenchmark: () => void;
  onOpenDashboard: () => void;
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
  onOpenSettings?: () => void;
  onClose?: () => void;
};

export default function Sidebar({
  generalThreads,
  projects,
  activeProjectId,
  activeThreadId,
  sidebarView,
  onOpenGeneralHome,
  onOpenSearch,
  onOpenImages,
  onOpenBenchmark,
  onOpenDashboard,
  onSelectProject,
  onSelectThread,
  onNewChat,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  onRenameThread,
  onDeleteThread,
  onMoveThread,
  onToggleProjectMemory,
  onToggleThreadPinned,
  onOpenSettings,
  onClose
}: Props) {
  const [openProjectIds, setOpenProjectIds] = useState<string[]>([]);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (activeProjectId && activeProjectId !== "__general__") {
      setOpenProjectIds((current) => (current.includes(activeProjectId) ? current : [...current, activeProjectId]));
    }
  }, [activeProjectId]);

  // Detect mobile viewport changes
  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 768px)");
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
    };
    setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

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
    () => [...projects].filter((p) => p.id !== "__general__").sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
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

  // Auto-close sidebar on mobile when navigating
  function handleSelectThread(threadId: string) {
    onSelectThread(threadId);
    if (isMobile && onClose) onClose();
  }

  function handleSelectProject(projectId: string) {
    onSelectProject(projectId);
    if (isMobile && onClose) onClose();
  }

  function handleOpenGeneralHome() {
    onOpenGeneralHome();
    if (isMobile && onClose) onClose();
  }

  function handleOpenSearch() {
    onOpenSearch();
    if (isMobile && onClose) onClose();
  }

  function handleOpenImages() {
    onOpenImages();
    if (isMobile && onClose) onClose();
  }

  function handleOpenBenchmark() {
    onOpenBenchmark();
    if (isMobile && onClose) onClose();
  }

  function handleOpenDashboard() {
    onOpenDashboard();
    if (isMobile && onClose) onClose();
  }

  function handleNewChat() {
    onNewChat();
    if (isMobile && onClose) onClose();
  }

  // kept for possible future use (currently not wired in JSX)
  void handleOpenBenchmark;

  return (
    <div className="sidebar">
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
          <div className="sidebar__top" style={{ position: "relative", paddingRight: 36 }}>
            <button type="button" className="sidebar-logo" onClick={handleOpenGeneralHome}>
              <span style={{ fontWeight: 800, fontSize: 15, color: "var(--text-main)", letterSpacing: -0.3 }}>
                CORVUS X
              </span>
            </button>
          </div>

          <div className="sidebar__menu">
            <WorkspaceRow icon={<PlusIcon />} label={t("nav.newThread")} onClick={handleNewChat} />
            <WorkspaceRow active={sidebarView === "search"} icon={<SearchIcon />} label={t("nav.search")} onClick={handleOpenSearch} />
            <WorkspaceRow active={sidebarView === "images"} icon={<ImageIcon />} label={t("nav.images")} onClick={handleOpenImages} />
            <WorkspaceRow active={sidebarView === "dashboard"} icon={<DashboardIcon />} label={t("nav.dashboard")} onClick={handleOpenDashboard} />
          </div>

          <div className="sidebar__section-block">
            <div className="sidebar__section-header">
              <div className="sidebar__section-label sidebar__section-label--large">{t("sidebar.projects")}</div>
            </div>

            <div className="sidebar__project-list">
              <WorkspaceRow icon={<PlusIcon />} label={t("nav.newProject")} onClick={onCreateProject} emphasized />

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
                  onSelectProject={() => handleSelectProject(project.id)}
                  onSelectThread={handleSelectThread}
                  onRenameProject={onRenameProject}
                  onDeleteProject={onDeleteProject}
                  onRenameThread={onRenameThread}
                  onDeleteThread={onDeleteThread}
                  onMoveThread={onMoveThread}
                  onToggleProjectMemory={onToggleProjectMemory}
                  projects={sortedProjects}
                  openThreadMenuId={openMenuId?.startsWith("project-thread:") ? openMenuId.replace("project-thread:", "") : null}
                  onToggleThreadMenu={(threadId) => toggleMenu(`project-thread:${threadId}`)}
                  onCloseThreadMenu={() => setOpenMenuId(null)}
                />
              ))}
            </div>
          </div>

          <div className="sidebar__section-block">
            <div className="sidebar__section-label sidebar__section-label--large">{t("sidebar.recentChats")}</div>

            <div className="sidebar__recent-list">
              {(() => {
                const now = new Date();
                const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);
                const sevenDaysAgo = new Date(today);
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

                const groups: Record<string, typeof generalThreads> = {
                  [t("sidebar.today")]: [],
                  [t("sidebar.yesterday")]: [],
                  [t("sidebar.last7days")]: [],
                  [t("sidebar.older")]: []
                };

                for (const thread of generalThreads) {
                  const threadDate = new Date(thread.updatedAt);
                  const threadDay = new Date(threadDate.getFullYear(), threadDate.getMonth(), threadDate.getDate());

                  if (threadDay.getTime() === today.getTime()) {
                    groups[t("sidebar.today")].push(thread);
                  } else if (threadDay.getTime() === yesterday.getTime()) {
                    groups[t("sidebar.yesterday")].push(thread);
                  } else if (threadDay.getTime() >= sevenDaysAgo.getTime()) {
                    groups[t("sidebar.last7days")].push(thread);
                  } else {
                    groups[t("sidebar.older")].push(thread);
                  }
                }

                return Object.entries(groups).map(([groupLabel, threads]) =>
                  threads.length > 0 ? (
                    <div key={groupLabel}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-sub)", letterSpacing: "0.05em", marginTop: groupLabel === t("sidebar.today") ? 0 : 12, marginBottom: 8 }}>
                        {groupLabel}
                      </div>
                      {threads.map((thread) => (
                        <RecentThreadRow
                          key={thread.id}
                          thread={thread}
                          active={thread.id === activeThreadId && activeProjectId === "__general__"}
                          projects={sortedProjects}
                          menuOpen={openMenuId === `general-thread:${thread.id}`}
                          onToggleMenu={() => toggleMenu(`general-thread:${thread.id}`)}
                          onCloseMenu={() => setOpenMenuId(null)}
                          onClick={() => handleSelectThread(thread.id)}
                          onRenameThread={onRenameThread}
                          onDeleteThread={onDeleteThread}
                          onMoveThread={onMoveThread}
                          onToggleThreadPinned={onToggleThreadPinned}
                        />
                      ))}
                    </div>
                  ) : null
                );
              })()}
            </div>
          </div>
        </div>

        <div
          className="sidebar__footer"
          style={{
            flex: "0 0 auto",
            borderTop: "1px solid var(--border)",
            padding: "10px 2px 0",
            background: "transparent"
          }}
        >
          <div style={{ marginTop: "auto", borderTop: "1px solid var(--border-soft)" }} />
          <button
            type="button"
            onClick={() => onOpenSettings?.()}
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
              {t("nav.settings")}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
