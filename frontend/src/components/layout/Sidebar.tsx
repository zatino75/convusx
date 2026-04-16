import { useMemo, type ReactNode } from "react";
import type { ProjectGroup, Thread } from "../../types/workspace";
import { t } from "../../i18n";
import {
  BenchmarkIcon,
  DashboardIcon,
  PlusIcon,
  PosIcon,
  SalesIcon,
  SearchIcon,
  SettingsIcon,
  StoreOpsIcon,
  WorkforceIcon
} from "./SidebarIcons";

type SidebarView = "default" | "search" | "images" | "benchmark" | "dashboard" | "sales" | "workforce" | "storeops" | "pos";

type Props = {
  generalThreads: Thread[];
  projectThreads: Thread[];
  projects: ProjectGroup[];
  activeProjectId: string;
  activeThreadId: string | null;
  sidebarView: SidebarView;
  artifacts?: Array<{ id: string; title: string; code: string; language: string }>;
  onOpenArtifact?: (title: string, code: string, language: string) => void;
  onOpenGeneralHome: () => void;
  onOpenSearch: () => void;
  onOpenImages: () => void;
  onOpenBenchmark: () => void;
  onOpenDashboard: () => void;
  onOpenSales: () => void;
  onOpenWorkforce: () => void;
  onOpenStoreOps: () => void;
  onOpenPos: () => void;
  onSelectProject: (projectId: string) => void;
  onSelectThread: (threadId: string) => void;
  onNewChat: () => void;
  onCreateProject: () => void;
  onCreateNamedProject?: (title: string) => void;
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

type NavItem = {
  key: string;
  label: string;
  caption: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
};

function buildTemplateProjectTitle(base: string) {
  const now = new Date();
  const stamp = `${now.getMonth() + 1}.${String(now.getDate()).padStart(2, "0")}`;
  return `${base} · ${stamp}`;
}

function resolveProjectStatus(project: ProjectGroup): "running" | "stalled" | "idle" {
  if (project.threadCount >= 3) return "running";
  if (project.threadCount >= 1) return "stalled";
  return "idle";
}

export default function Sidebar({
  generalThreads,
  projectThreads,
  projects,
  activeProjectId,
  activeThreadId,
  sidebarView,
  onOpenGeneralHome,
  onOpenSearch,
  onOpenBenchmark,
  onOpenDashboard,
  onOpenSales,
  onOpenWorkforce,
  onOpenStoreOps,
  onOpenPos,
  onSelectProject,
  onSelectThread,
  onCreateProject,
  onCreateNamedProject,
  onCreateThreadInProject,
  onOpenSettings,
  onClose,
  onOpenImages,
  onNewChat,
  onRenameProject,
  onDeleteProject,
  onRenameThread,
  onDeleteThread,
  onMoveThread,
  onToggleProjectMemory,
  onToggleThreadPinned,
  artifacts,
  onOpenArtifact
}: Props) {
  void onOpenImages;
  void onNewChat;
  void onRenameProject;
  void onDeleteProject;
  void onRenameThread;
  void onDeleteThread;
  void onMoveThread;
  void onToggleProjectMemory;
  void onToggleThreadPinned;
  void artifacts;
  void onOpenArtifact;

  const sortedProjects = useMemo(
    () =>
      [...projects]
        .filter((item) => item.id !== "__general__")
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [projects]
  );

  const recentThreads = useMemo(() => {
    return [...generalThreads, ...projectThreads]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5);
  }, [generalThreads, projectThreads]);

  const projectStats = useMemo(() => {
    const running = sortedProjects.filter((item) => resolveProjectStatus(item) === "running").length;
    const stalled = sortedProjects.filter((item) => resolveProjectStatus(item) === "stalled").length;
    return { running, stalled, total: sortedProjects.length };
  }, [sortedProjects]);

  function withClose(action: () => void) {
    action();
    if (window.matchMedia("(max-width: 980px)").matches) {
      onClose?.();
    }
  }

  function createTemplateProject(title: string) {
    if (onCreateNamedProject) {
      withClose(() => onCreateNamedProject(buildTemplateProjectTitle(title)));
      return;
    }
    withClose(onCreateProject);
  }

  const commandNav: NavItem[] = [
    {
      key: "hq",
      label: "HQ Map",
      caption: "월드 씬",
      icon: <DashboardIcon />,
      active: sidebarView === "default",
      onClick: () => withClose(onOpenGeneralHome)
    },
    {
      key: "mission",
      label: "Mission Loop",
      caption: "지시 · 실행 · 보고",
      icon: <WorkforceIcon />,
      active: sidebarView === "workforce",
      onClick: () => withClose(onOpenWorkforce)
    }
  ];

  const retailNav: NavItem[] = [
    {
      key: "storeops",
      label: "StoreOps",
      caption: "매장 리스크 대응",
      icon: <StoreOpsIcon />,
      active: sidebarView === "storeops",
      onClick: () => withClose(onOpenStoreOps)
    },
    {
      key: "pos",
      label: "POS Grid",
      caption: "결제/바코드 관제",
      icon: <PosIcon />,
      active: sidebarView === "pos",
      onClick: () => withClose(onOpenPos)
    },
    {
      key: "sales",
      label: "Revenue",
      caption: "매출 대시보드",
      icon: <SalesIcon />,
      active: sidebarView === "sales",
      onClick: () => withClose(onOpenSales)
    },
    {
      key: "kpi",
      label: "Ops KPI",
      caption: "핵심 지표",
      icon: <DashboardIcon />,
      active: sidebarView === "dashboard",
      onClick: () => withClose(onOpenDashboard)
    }
  ];

  return (
    <div className="sidebar sidebar--game-console sidebar-v3">
      <div className="sidebar-console__scroll">
        <button type="button" className="sidebar-v3__brand" onClick={() => withClose(onOpenGeneralHome)}>
          <strong>CONVUS X COMMAND</strong>
          <span>Autonomous Office Control Grid</span>
        </button>

        <section className="sidebar-v3__section" aria-label="명령 네비게이션">
          <header>
            <span>COMMAND</span>
            <b>HQ CORE</b>
          </header>
          <div className="sidebar-v3__nav-grid">
            {commandNav.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`sidebar-v3__nav-btn${item.active ? " is-active" : ""}`}
                onClick={item.onClick}
              >
                <span>{item.icon}</span>
                <strong>{item.label}</strong>
                <em>{item.caption}</em>
              </button>
            ))}
          </div>
        </section>

        <section className="sidebar-v3__section" aria-label="리테일 네비게이션">
          <header>
            <span>RETAIL CIRCUIT</span>
            <b>SALES + POS</b>
          </header>
          <div className="sidebar-v3__nav-grid">
            {retailNav.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`sidebar-v3__nav-btn${item.active ? " is-active" : ""}`}
                onClick={item.onClick}
              >
                <span>{item.icon}</span>
                <strong>{item.label}</strong>
                <em>{item.caption}</em>
              </button>
            ))}
          </div>
        </section>

        <section className="sidebar-v3__section" aria-label="프로젝트">
          <header>
            <span>PROJECT GRID</span>
            <b>{projectStats.running} RUNNING</b>
          </header>

          <div className="sidebar-v3__stats">
            <article><span>Running</span><b>{projectStats.running}</b></article>
            <article><span>Stalled</span><b>{projectStats.stalled}</b></article>
            <article><span>Total</span><b>{projectStats.total}</b></article>
          </div>

          <div className="sidebar-v3__project-actions">
            <button type="button" onClick={() => withClose(onCreateProject)}>
              <PlusIcon />
              <span>{t("nav.newProject")}</span>
            </button>
            <button type="button" onClick={() => createTemplateProject("매출 성장")}>성장 템플릿</button>
            <button type="button" onClick={() => createTemplateProject("매장 운영")}>매장 템플릿</button>
            <button type="button" onClick={() => createTemplateProject("리스크 대응")}>리스크 템플릿</button>
          </div>

          <div className="sidebar-v3__project-list">
            {sortedProjects.length > 0 ? sortedProjects.map((project) => {
              const status = resolveProjectStatus(project);
              const isActive = project.id === activeProjectId;
              return (
                <article key={project.id} className={`sidebar-v3__project-card${isActive ? " is-active" : ""}`}>
                  <button type="button" onClick={() => withClose(() => onSelectProject(project.id))}>
                    <strong>{project.title}</strong>
                    <span>{project.threadCount} threads</span>
                  </button>
                  <div>
                    <em className={`is-${status}`}>{status.toUpperCase()}</em>
                    <button type="button" onClick={() => withClose(() => onCreateThreadInProject(project.id))}>
                      + thread
                    </button>
                  </div>
                </article>
              );
            }) : <div className="sidebar-v3__empty">프로젝트를 생성하면 자동 루프가 실행됩니다.</div>}
          </div>
        </section>

        <section className="sidebar-v3__section" aria-label="라이브 피드">
          <header>
            <span>SIGNAL FEED</span>
            <b>RECENT THREADS</b>
          </header>
          <div className="sidebar-v3__recent-list">
            {recentThreads.length > 0 ? recentThreads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className={`sidebar-v3__recent-item${thread.id === activeThreadId ? " is-active" : ""}`}
                onClick={() => withClose(() => onSelectThread(thread.id))}
              >
                <strong>{thread.title}</strong>
                <span>{new Date(thread.updatedAt).toLocaleString()}</span>
              </button>
            )) : <div className="sidebar-v3__empty">보고 이력이 없습니다.</div>}
          </div>
        </section>

        <section className="sidebar-v3__section" aria-label="도구">
          <header>
            <span>TOOLS</span>
            <b>UTILITY</b>
          </header>
          <div className="sidebar-v3__system-actions">
            <button type="button" onClick={() => withClose(onOpenSearch)}><SearchIcon /><span>{t("nav.search")}</span></button>
            <button type="button" onClick={() => withClose(onOpenBenchmark)}><BenchmarkIcon /><span>{t("nav.benchmark")}</span></button>
            <button type="button" onClick={() => onOpenSettings?.()}><SettingsIcon /><span>{t("nav.settings")}</span></button>
          </div>
        </section>
      </div>
    </div>
  );
}
