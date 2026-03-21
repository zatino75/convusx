import { useMemo, useState } from "react";
import type { ProjectGroup } from "../../App";

type Props = {
  projects: ProjectGroup[];
  activeThreadId: string;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
  onNewThreadInProject: (projectId: string) => void;
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("ko-KR");
  } catch {
    return "-";
  }
}

function ProjectHeader({
  title,
  meta,
  isOpen,
  onToggle,
  onCreate
}: {
  title: string;
  meta: string;
  isOpen: boolean;
  onToggle: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onToggle}
          className="min-w-0 flex-1 text-left"
        >
          <div className="truncate text-sm font-medium text-white">{title}</div>
          <div className="mt-1 text-xs text-[#8e8ea0]">{meta}</div>
        </button>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onCreate}
            className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-[#d7d7d7] transition hover:bg-white/5"
          >
            +
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-[#8e8ea0] transition hover:bg-white/5"
          >
            {isOpen ? "−" : "+"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Sidebar({
  projects,
  activeThreadId,
  onSelectThread,
  onNewThread,
  onNewThreadInProject
}: Props) {
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});

  const normalizedOpenState = useMemo(() => {
    const next: Record<string, boolean> = {};
    for (const project of projects) {
      next[project.id] = openProjects[project.id] ?? true;
    }
    return next;
  }, [openProjects, projects]);

  function toggleProject(projectId: string) {
    setOpenProjects((current) => ({
      ...current,
      [projectId]: !(current[projectId] ?? true)
    }));
  }

  return (
    <aside className="hidden h-full w-[280px] shrink-0 border-r border-white/10 bg-[#171717] md:flex md:flex-col">
      <div className="px-3 py-3">
        <button
          type="button"
          onClick={onNewThread}
          className="flex w-full items-center justify-center rounded-xl border border-white/10 bg-[#2f2f2f] px-3 py-3 text-sm font-medium text-white transition hover:bg-[#3a3a3a]"
        >
          새 채팅
        </button>
      </div>

      <div className="px-3 pb-2 text-[11px] tracking-[0.16em] text-[#8e8ea0]">PROJECTS</div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {projects.length > 0 ? (
          projects.map((project) => {
            const isOpen = normalizedOpenState[project.id] ?? true;

            return (
              <div key={project.id} className="mb-2 overflow-hidden rounded-2xl border border-white/8 bg-[#151515]">
                <ProjectHeader
                  title={project.title}
                  meta={`thread ${project.threadCount} · ${formatDate(project.updatedAt)}`}
                  isOpen={isOpen}
                  onToggle={() => toggleProject(project.id)}
                  onCreate={() => onNewThreadInProject(project.id)}
                />

                {isOpen ? (
                  <div className="border-t border-white/8 px-2 py-2">
                    {project.threads.map((thread) => {
                      const isActive = thread.id === activeThreadId;

                      return (
                        <button
                          key={thread.id}
                          type="button"
                          onClick={() => onSelectThread(thread.id)}
                          className={[
                            "mb-1 flex w-full flex-col rounded-xl px-3 py-3 text-left transition",
                            isActive ? "bg-[#2f2f2f]" : "hover:bg-[#242424]"
                          ].join(" ")}
                        >
                          <span className="truncate text-sm text-white">{thread.title}</span>
                          <span className="mt-1 truncate text-xs text-[#8e8ea0]">
                            {formatDate(thread.updatedAt)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="rounded-2xl border border-white/10 bg-[#1b1b1b] px-4 py-4 text-xs text-[#8e8ea0]">
            프로젝트가 없습니다.
          </div>
        )}
      </div>
    </aside>
  );
}
