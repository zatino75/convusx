import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ProjectGroup, Thread, WorkspaceKind } from "../../types/workspace";
import ProjectHomeView from "../project/ProjectHomeView";

type Props = {
  workspaceKind: WorkspaceKind;
  activeProject: ProjectGroup | null;
  generalThreads: Thread[];
  projectThreads: Thread[];
  sidebarView: "default" | "search" | "images";
  isSending: boolean;
  onOpenThread: (threadId: string) => void;
  onSubmitPrompt: (value: string) => void;
  onRenameThread?: (threadId: string, nextTitle: string) => void;
  onMoveThread?: (threadId: string, nextProjectId: string) => void;
  onRemoveFromProject?: (threadId: string) => void;
  onDeleteThread?: (threadId: string) => void;
  projectGroups?: ProjectGroup[];
};

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 5a4 4 0 0 1 4 4v3a4 4 0 0 1-8 0V9a4 4 0 0 1 4-4z" />
      <path d="M19 11a7 7 0 0 1-14 0M12 18v3" />
    </svg>
  );
}

function WaveIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <rect x="4" y="10" width="2" height="4" rx="1" />
      <rect x="8" y="8" width="2" height="8" rx="1" />
      <rect x="12" y="6" width="2" height="12" rx="1" />
      <rect x="16" y="8" width="2" height="8" rx="1" />
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
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 1 0-4-4L4.5 16v4z" />
    </svg>
  );
}

function MoveIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 4H4v4" />
      <path d="M16 4h4v4" />
      <path d="M20 16v4h-4" />
      <path d="M4 16v4h4" />
      <path d="M4 8l5-5" />
      <path d="M20 8l-5-5" />
      <path d="M4 16l5 5" />
      <path d="M20 16l-5 5" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 12h14" />
      <path d="M12 5v14" opacity="0.35" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function formatUpdatedAt(value?: string) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleDateString("ko-KR", {
      month: "long",
      day: "numeric"
    });
  } catch {
    return "-";
  }
}

function SearchPlaceholder() {
  return (
    <div className="utility-view">
      <div className="utility-view__icon">⌕</div>
      <div className="utility-view__title">채팅 검색</div>
      <div className="utility-view__desc">전체 채팅 검색 UI를 여기에 연결합니다.</div>
    </div>
  );
}

function ImagesPlaceholder() {
  return (
    <div className="utility-view">
      <div className="utility-view__icon">▣</div>
      <div className="utility-view__title">이미지</div>
      <div className="utility-view__desc">채팅에서 생성된 이미지를 이 화면에 모아 노출합니다.</div>
    </div>
  );
}

function HomeComposer({
  placeholder,
  isSending,
  onSubmit
}: {
  placeholder: string;
  isSending: boolean;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState("");

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed || isSending) return;
    onSubmit(trimmed);
    setValue("");
  }

  return (
    <div className="launcher-composer">
      <div className="launcher-composer__input-wrap">
        <button type="button" className="launcher-composer__ghost">
          <PlusIcon />
        </button>

        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={placeholder}
          className="launcher-composer__input"
        />

        <div className="launcher-composer__actions">
          <button type="button" className="launcher-composer__ghost">
            <MicIcon />
          </button>
          <button
            type="button"
            className="launcher-composer__submit"
            onClick={handleSubmit}
            disabled={isSending || !value.trim()}
          >
            <WaveIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

function GeneralHome({
  isSending,
  onSubmitPrompt
}: {
  isSending: boolean;
  onSubmitPrompt: (value: string) => void;
}) {
  return (
    <div className="general-home">
      <div className="general-home__center">
        <h1 className="general-home__title">Mr.T 님, 어떻게 도와드릴까요?</h1>

        <HomeComposer placeholder="무엇이든 물어보세요" isSending={isSending} onSubmit={onSubmitPrompt} />
      </div>
    </div>
  );
}

export default function HomeView({
  workspaceKind,
  activeProject,
  generalThreads,
  projectThreads,
  sidebarView,
  isSending,
  onOpenThread,
  onSubmitPrompt,
  onRenameThread,
  onMoveThread,
  onRemoveFromProject,
  onDeleteThread,
  projectGroups
}: Props) {
  if (sidebarView === "search") {
    return (
      <div className="home-view">
        <div className="home-view__scroll">
          <div className="home-view__inner utility-view__inner">
            <SearchPlaceholder />
          </div>
        </div>
      </div>
    );
  }

  if (sidebarView === "images") {
    return (
      <div className="home-view">
        <div className="home-view__scroll">
          <div className="home-view__inner utility-view__inner">
            <ImagesPlaceholder />
          </div>
        </div>
      </div>
    );
  }

  if (workspaceKind === "project") {
    return (
      <ProjectHomeView
        project={activeProject}
        activeThreadId={null}
        onOpenThread={onOpenThread}
        onRenameThread={onRenameThread ? (threadId: string) => onRenameThread(threadId, "") : undefined}
        onMoveThread={onMoveThread ? (threadId: string) => onMoveThread(threadId, "__general__") : undefined}
        onDeleteThread={onDeleteThread}
        onRemoveFromProject={onRemoveFromProject}
        onSubmitPrompt={onSubmitPrompt}
        isSending={isSending}
      />
    );
  }

  if (workspaceKind === "general") {
    return (
      <div className="home-view">
        <div className="home-view__scroll">
          <GeneralHome isSending={isSending} onSubmitPrompt={onSubmitPrompt} />
        </div>
      </div>
    );
  }

  return <div className="home-view" />;
}
