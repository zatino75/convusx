import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectGroup, Thread, WorkspaceKind } from "../../types/workspace";
import ProjectHomeView from "../project/ProjectHomeView";
import { t } from "../../i18n";

type Props = {
  workspaceKind: WorkspaceKind;
  activeProject: ProjectGroup | null;
  generalThreads: Thread[];
  projectThreads: Thread[];
  sidebarView: "default" | "search" | "images" | "benchmark" | "dashboard" | "sales" | "workforce" | "storeops" | "pos";
  isSending: boolean;
  onOpenThread: (threadId: string) => void;
  onRenameThread?: (threadId: string, nextTitle: string) => void;
  onMoveThread?: (threadId: string, nextProjectId: string) => void;
  onRemoveFromProject?: (threadId: string) => void;
  onDeleteThread?: (threadId: string) => void;
  onLaunchWorkforceMission?: (directive: string) => void;
  onOpenStoreOps?: () => void;
  onOpenPos?: () => void;
  onOpenSales?: () => void;
  projectGroups?: ProjectGroup[];
  sceneMode?: "idle" | "dispatch" | "working" | "meeting";
  sceneDirective?: string;
};

function stripMd(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\[\d+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const escaped = query.replace(/[$()*+.?[\]^{|}]/g, "\\$&");
  const parts = text.split(new RegExp("(" + escaped + ")", "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} style={{ background: "#fef08a", color: "#78350f", borderRadius: 2, padding: "0 1px" }}>{part}</mark>
      : part
  );
}

function SearchView({
  threads,
  projectGroups,
  onOpenThread
}: {
  threads: Thread[];
  projectGroups?: ProjectGroup[];
  onOpenThread?: (threadId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const q = query.trim().toLowerCase();

  type SearchResult = {
    threadId: string;
    threadTitle: string;
    projectTitle?: string;
    matchContent: string;
  };

  const results: SearchResult[] = useMemo(() => {
    if (!q) return [];
    const out: SearchResult[] = [];
    for (const thread of threads) {
      const titleMatch = thread.title.toLowerCase().includes(q);
      const matchingMsg = thread.messages
        .filter(m => !m.isHidden && m.content?.trim())
        .find(m => m.content.toLowerCase().includes(q));
      if (!titleMatch && !matchingMsg) continue;
      const projectTitle = projectGroups?.find(p => p.id === thread.projectId)?.title;
      const raw = matchingMsg?.content ?? thread.title;
      const clean = stripMd(raw);
      const idx = clean.toLowerCase().indexOf(q);
      const start = Math.max(0, idx - 40);
      const excerpt = (start > 0 ? "..." : "") + clean.slice(start, start + 120) + (start + 120 < clean.length ? "..." : "");
      out.push({ threadId: thread.id, threadTitle: thread.title, projectTitle, matchContent: excerpt });
    }
    return out.slice(0, 50);
  }, [q, threads, projectGroups]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", maxWidth: 720, margin: "0 auto", padding: "24px 20px 0", width: "100%" }}>
      <div style={{ position: "relative", marginBottom: 24 }}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"
          style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-sub)", pointerEvents: "none" }}>
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t("home.searchPlaceholder")}
          style={{ width: "100%", padding: "12px 40px", borderRadius: 12, border: "1px solid var(--border)", fontSize: 14, color: "var(--text-main)", background: "var(--surface-1, #f9fafb)", outline: "none", boxSizing: "border-box" }}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", cursor: "pointer", color: "var(--text-sub)", display: "flex", alignItems: "center" }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        )}
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {!q ? (
          <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--text-soft)" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⌕</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{t("home.searchAll")}</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>{t("home.searchHint")}</div>
          </div>
        ) : results.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--text-soft)" }}>
            <div style={{ fontSize: 14 }}>{t("home.noResults").replace("{query}", query)}</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 12 }}>{t("home.resultCount").replace("{count}", String(results.length))}</div>
            {results.map(r => (
              <button
                key={r.threadId}
                type="button"
                onClick={() => onOpenThread?.(r.threadId)}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 14px", marginBottom: 6, border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface-1, #f9fafb)", cursor: "pointer" }}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2, #f3f4f6)")}
                onMouseLeave={e => (e.currentTarget.style.background = "var(--surface-1, #f9fafb)")}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                  {r.projectTitle && (
                    <span style={{ fontSize: 11, color: "var(--text-sub)", background: "var(--border)", borderRadius: 4, padding: "1px 6px" }}>{r.projectTitle}</span>
                  )}
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-main)" }}>{highlight(r.threadTitle, query)}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-sub)", lineHeight: 1.5 }}>{highlight(r.matchContent, query)}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ImagesPlaceholder() {
  return (
    <div className="utility-view">
      <div className="utility-view__icon">▣</div>
      <div className="utility-view__title">{t("home.imagesTitle")}</div>
      <div className="utility-view__desc">{t("home.imagesDesc")}</div>
    </div>
  );
}

function homePhaseLabel(mode: "idle" | "dispatch" | "working" | "meeting") {
  if (mode === "dispatch") return "지시 전달";
  if (mode === "working") return "부서 실행";
  if (mode === "meeting") return "상무 보고";
  return "대기";
}

function clipHomeDirective(value: string) {
  const normalized = value.trim();
  if (!normalized) return "아직 실행 중인 지시가 없습니다. 새 업무를 생성하면 부서 아바타가 즉시 움직입니다.";
  return normalized.length > 92 ? `${normalized.slice(0, 92)}...` : normalized;
}

function GeneralHome({
  onLaunchWorkforceMission,
  onOpenStoreOps,
  onOpenPos,
  onOpenSales,
  sceneMode = "idle",
  sceneDirective = ""
}: {
  onLaunchWorkforceMission?: (directive: string) => void;
  onOpenStoreOps?: () => void;
  onOpenPos?: () => void;
  onOpenSales?: () => void;
  sceneMode?: "idle" | "dispatch" | "working" | "meeting";
  sceneDirective?: string;
}) {
  const [missionModalOpen, setMissionModalOpen] = useState(false);
  const [missionDirective, setMissionDirective] = useState("신규 시즌 매출 확대, 매장 운영 리스크 완화, POS KPI 재정렬 계획을 오늘 18시까지 보고");

  function launchMission() {
    const nextDirective = missionDirective.trim();
    if (!nextDirective) return;
    onLaunchWorkforceMission?.(nextDirective);
    setMissionModalOpen(false);
  }

  return (
    <div className="general-home general-home--simple">
      <div className="general-home__center">
        <section className="general-home__hero general-home__hero--simple">
          <span className={`general-home__phase is-${sceneMode}`}>
            {homePhaseLabel(sceneMode)}
          </span>
          <h1>오피스를 게임처럼 운영하세요.</h1>
          <p>핵심만 남긴 HQ 화면입니다. 업무 생성 후 부서 실행과 상무 보고가 자동으로 이어집니다.</p>
        </section>

        <section className="general-home__status-card" aria-label="현재 상태">
          <article>
            <span>현재 단계</span>
            <strong>{homePhaseLabel(sceneMode)}</strong>
          </article>
          <article>
            <span>현재 지시</span>
            <p>{clipHomeDirective(sceneDirective || missionDirective)}</p>
          </article>
        </section>

        <div className="general-home__actions">
          <button
            type="button"
            className="general-home__launch-btn"
            onClick={() => setMissionModalOpen(true)}
          >
            업무 생성
          </button>
        </div>

        <section className="general-home__ops-board general-home__ops-board--simple" aria-label="운영 이동">
          <button type="button" onClick={onOpenStoreOps}>
            <span>STOREOPS</span>
            <strong>매장 이슈 대응실</strong>
          </button>
          <button type="button" onClick={onOpenPos}>
            <span>POS</span>
            <strong>결제 현장 관제</strong>
          </button>
          <button type="button" onClick={onOpenSales}>
            <span>SALES</span>
            <strong>매출 집계 대시보드</strong>
          </button>
        </section>

        <p className="general-home__ops-note">
          지금 화면은 최소 조작 모드입니다. 상세 분석은 각 운영 화면으로 이동해 진행하세요.
        </p>
      </div>

      {missionModalOpen ? (
        <div className="mission-modal-overlay" role="dialog" aria-modal="true" aria-label="업무 생성">
          <article className="mission-modal">
            <header>
              <strong>업무 생성</strong>
              <button type="button" onClick={() => setMissionModalOpen(false)} aria-label="닫기">닫기</button>
            </header>
            <p>지시문을 작성하면 Workforce 모드에서 부서 아바타가 즉시 실행 루프를 시작합니다.</p>
            <textarea
              value={missionDirective}
              onChange={(event) => setMissionDirective(event.target.value)}
              rows={5}
              placeholder="예: 매장별 이익률 개선안과 운영 리스크 대응안을 오늘 18시까지 보고"
            />
            <div className="mission-modal__templates">
              <button type="button" onClick={() => setMissionDirective("오프라인 매장 전환율 개선, 재고 회전율 최적화, POS 결제 병목 해소안을 오늘 18시까지 보고")}>매장 운영</button>
              <button type="button" onClick={() => setMissionDirective("신규 캠페인 ROI 개선, 부서별 KPI 재배치, 주간 실행 우선순위를 오늘 18시까지 보고")}>매출 성장</button>
              <button type="button" onClick={() => setMissionDirective("법무·재무·운영 리스크를 우선순위화하고 즉시 실행안과 보완안을 오늘 18시까지 보고")}>리스크 대응</button>
            </div>
            <footer>
              <button type="button" className="is-ghost" onClick={onOpenStoreOps}>StoreOps 열기</button>
              <button type="button" className="is-ghost" onClick={onOpenPos}>POS 열기</button>
              <button type="button" className="is-ghost" onClick={() => setMissionModalOpen(false)}>취소</button>
              <button type="button" onClick={launchMission}>Workforce 실행</button>
            </footer>
          </article>
        </div>
      ) : null}
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
  onRenameThread,
  onMoveThread,
  onRemoveFromProject,
  onDeleteThread,
  projectGroups,
  onLaunchWorkforceMission,
  onOpenStoreOps,
  onOpenPos,
  onOpenSales,
  sceneMode = "idle",
  sceneDirective = ""
}: Props) {
  if (sidebarView === "search") {
    return (
      <div className="home-view office-stage-view">
        <div className="home-view__scroll" style={{ display: "flex", flexDirection: "column" }}>
          <SearchView threads={[...generalThreads, ...projectThreads]} projectGroups={projectGroups} onOpenThread={onOpenThread} />
        </div>
      </div>
    );
  }

  if (sidebarView === "images") {
    return (
      <div className="home-view office-stage-view">
        <div className="home-view__scroll">
          <div className="home-view__inner utility-view__inner"><ImagesPlaceholder /></div>
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
        isSending={isSending}
      />
    );
  }

  if (workspaceKind === "general") {
    return (
      <div className="home-view office-stage-view">
        <div className="home-view__scroll">
          <GeneralHome
            onLaunchWorkforceMission={onLaunchWorkforceMission}
            onOpenStoreOps={onOpenStoreOps}
            onOpenPos={onOpenPos}
            onOpenSales={onOpenSales}
            sceneMode={sceneMode}
            sceneDirective={sceneDirective}
          />
        </div>
      </div>
    );
  }

  return <div className="home-view" />;
}
