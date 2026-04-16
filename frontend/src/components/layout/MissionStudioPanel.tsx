import { useMemo, useState } from "react";

type SceneMode = "idle" | "dispatch" | "working" | "meeting";

type Props = {
  mode: SceneMode;
  latestDirective?: string;
  workflowNotes?: {
    pmo?: string;
    critic?: string;
    ceo?: string;
  };
  onLaunchMission?: (directive: string) => void;
  onResetMission?: () => void;
  onOpenWorkforce?: () => void;
  onOpenStoreOps?: () => void;
  onOpenPos?: () => void;
  onOpenSales?: () => void;
  activeProjects?: number;
  totalProjects?: number;
};

const TEMPLATE_DIRECTIVES = [
  {
    label: "매출+POS",
    directive: "매장별 전환율 저하 원인을 분석하고 POS 병목 해결안까지 오늘 18시까지 보고"
  },
  {
    label: "수익성",
    directive: "온라인·오프라인 통합 매출 관점에서 수익성 저하 리스크를 우선순위화해 보고"
  },
  {
    label: "리스크",
    directive: "법무·재무·운영 이슈를 프로젝트 단위로 분류하고 실행 가능한 조치안으로 정리"
  }
];

const MISSION_HISTORY_KEY = "convusx.mission.history.v1";

function readMissionHistory(): string[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(MISSION_HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .slice(0, 6);
  } catch {
    return [];
  }
}

function writeMissionHistory(history: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MISSION_HISTORY_KEY, JSON.stringify(history.slice(0, 6)));
}

function phaseLabel(mode: SceneMode) {
  if (mode === "dispatch") return "지시 전달 중";
  if (mode === "working") return "부서 실행 중";
  if (mode === "meeting") return "미팅룸 보고 중";
  return "지시 대기";
}

function clipDirective(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "HQ에서 미션을 생성하면 오피스 월드가 즉시 실행됩니다.";
  return trimmed.length > 110 ? `${trimmed.slice(0, 110)}...` : trimmed;
}

export default function MissionStudioPanel({
  mode,
  latestDirective = "",
  workflowNotes,
  onLaunchMission,
  onResetMission,
  onOpenWorkforce,
  onOpenStoreOps,
  onOpenPos,
  onOpenSales,
  activeProjects = 0,
  totalProjects = 0
}: Props) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [draftDirective, setDraftDirective] = useState("");
  const [history, setHistory] = useState<string[]>(() => readMissionHistory());

  const defaultDirective = useMemo(() => {
    const normalized = latestDirective.trim();
    return normalized || TEMPLATE_DIRECTIVES[0].directive;
  }, [latestDirective]);

  function openComposer() {
    setDraftDirective(defaultDirective);
    setIsModalOpen(true);
  }

  function closeComposer() {
    setIsModalOpen(false);
  }

  function launchMission(nextDirective: string) {
    const normalized = nextDirective.trim();
    if (!normalized) return;
    onLaunchMission?.(normalized);
    setDraftDirective(normalized);
    setHistory((prev) => {
      const deduped = [normalized, ...prev.filter((item) => item !== normalized)].slice(0, 6);
      writeMissionHistory(deduped);
      return deduped;
    });
    setIsModalOpen(false);
  }

  return (
    <aside className="mission-studio" aria-label="Mission Studio">
      <header className="mission-studio__header">
        <strong>MISSION STUDIO</strong>
        <span>{phaseLabel(mode)}</span>
      </header>

      <section className="mission-studio__status">
        <article>
          <span>프로젝트</span>
          <b>{activeProjects}/{Math.max(totalProjects, activeProjects)} ACTIVE</b>
        </article>
        <article>
          <span>현재 지시</span>
          <b>{clipDirective(latestDirective)}</b>
        </article>
      </section>

      {(workflowNotes?.pmo || workflowNotes?.critic || workflowNotes?.ceo) ? (
        <section className="mission-studio__status" aria-label="워크플로 검증 노트">
          <article>
            <span>PMO</span>
            <b>{workflowNotes?.pmo?.trim() || "대기"}</b>
          </article>
          <article>
            <span>Critic</span>
            <b>{workflowNotes?.critic?.trim() || "대기"}</b>
          </article>
          <article>
            <span>상무 보고</span>
            <b>{workflowNotes?.ceo?.trim() || "대기"}</b>
          </article>
        </section>
      ) : null}

      <section className="mission-studio__actions" aria-label="미션 명령">
        <button type="button" className="mission-studio__primary" onClick={openComposer}>
          업무 생성
        </button>
        <button
          type="button"
          className="mission-studio__secondary"
          onClick={() => launchMission(defaultDirective)}
        >
          최근 지시 재실행
        </button>
        {mode !== "idle" ? (
          <button
            type="button"
            className="mission-studio__tertiary"
            onClick={onResetMission}
          >
            미션 종료
          </button>
        ) : null}
      </section>

      <section className="mission-studio__routes" aria-label="운영 이동">
        <button type="button" onClick={onOpenWorkforce}>Workforce</button>
        <button type="button" onClick={onOpenStoreOps}>StoreOps</button>
        <button type="button" onClick={onOpenPos}>POS</button>
        <button type="button" onClick={onOpenSales}>Revenue</button>
      </section>

      {history.length > 0 ? (
        <section className="mission-studio__history" aria-label="최근 미션">
          <span>최근 지시</span>
          <div>
            {history.slice(0, 4).map((item) => (
              <button
                key={`mission-history-${item}`}
                type="button"
                onClick={() => launchMission(item)}
                title={item}
              >
                {item}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {isModalOpen ? (
        <>
          <button
            type="button"
            className="mission-studio__modal-backdrop"
            aria-label="업무 생성 닫기"
            onClick={closeComposer}
          />
          <article className="mission-studio__modal" role="dialog" aria-modal="true" aria-label="업무 생성">
            <header>
              <strong>업무 생성</strong>
              <button type="button" onClick={closeComposer}>닫기</button>
            </header>
            <textarea
              value={draftDirective}
              onChange={(event) => setDraftDirective(event.target.value)}
              rows={5}
              placeholder="예: 부서별 KPI 재정렬과 POS 병목 개선안을 18시까지 대표 보고"
            />
            <div className="mission-studio__quick">
              {TEMPLATE_DIRECTIVES.map((item) => (
                <button key={`modal-${item.label}`} type="button" onClick={() => setDraftDirective(item.directive)}>
                  {item.label}
                </button>
              ))}
            </div>
            <footer>
              <button type="button" className="is-ghost" onClick={closeComposer}>취소</button>
              <button type="button" onClick={() => launchMission(draftDirective)}>Workforce 실행</button>
            </footer>
          </article>
        </>
      ) : null}
    </aside>
  );
}
