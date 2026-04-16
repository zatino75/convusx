import { useMemo } from "react";

type SceneMode = "idle" | "dispatch" | "working" | "meeting";

type Props = {
  mode: SceneMode;
  directive: string;
  projectTitle: string;
  threadTitle?: string;
  missionPhase?: "idle" | "dispatch" | "working" | "meeting" | "review" | "done" | "error";
};

type FlowItem = {
  key: string;
  label: string;
  state: "pending" | "active" | "done";
};

const ROUTE_KEYWORDS: Array<{ label: string; words: string[] }> = [
  { label: "전략", words: ["전략", "기획", "로드맵", "시장"] },
  { label: "재무", words: ["재무", "매출", "예산", "원가", "이익"] },
  { label: "법무", words: ["법무", "리스크", "계약", "약관"] },
  { label: "운영", words: ["운영", "매장", "재고", "공급", "물류"] },
  { label: "데이터", words: ["데이터", "지표", "분석", "대시보드"] },
  { label: "마케팅", words: ["마케팅", "캠페인", "광고", "브랜딩"] },
  { label: "콘텐츠", words: ["콘텐츠", "이미지", "영상", "디자인"] }
];

function resolveState(
  mode: SceneMode,
  missionPhase: Props["missionPhase"],
  order: number,
): FlowItem["state"] {
  if (missionPhase === "error") return order <= 3 ? "done" : "pending";
  if (missionPhase === "done") return "done";
  if (missionPhase === "review") return order <= 3 ? "done" : order === 4 ? "active" : "pending";
  if (missionPhase === "working") return order <= 2 ? "done" : order === 3 ? "active" : "pending";
  if (missionPhase === "dispatch") return order === 1 ? "done" : order === 2 ? "active" : "pending";
  if (mode === "dispatch") return order === 1 ? "active" : "pending";
  if (mode === "working") return order <= 2 ? "done" : order === 3 ? "active" : "pending";
  if (mode === "meeting") return order <= 4 ? "done" : order === 5 ? "active" : "pending";
  return "pending";
}

function trimDirective(text: string): string {
  const value = text.trim();
  if (!value) return "지시 대기 중";
  return value.length > 84 ? `${value.slice(0, 84)}...` : value;
}

export default function OfficeHudPanel({ mode, directive, projectTitle, threadTitle, missionPhase = "idle" }: Props) {
  const targets = useMemo(() => {
    const normalized = directive.toLowerCase();
    const hits = ROUTE_KEYWORDS.filter((item) =>
      item.words.some((word) => normalized.includes(word.toLowerCase()))
    ).map((item) => item.label);
    if (hits.length === 0) return ["전략", "운영", "재무"];
    return hits.slice(0, 4);
  }, [directive]);

  const flow: FlowItem[] = useMemo(
    () => [
      { key: "ceo", label: "CEO 지시", state: resolveState(mode, missionPhase, 1) },
      { key: "pmo", label: "PMO 분해", state: resolveState(mode, missionPhase, 2) },
      { key: "execute", label: "부서 실행", state: resolveState(mode, missionPhase, 3) },
      { key: "critic", label: "Critic 검증", state: resolveState(mode, missionPhase, 4) },
      { key: "meeting", label: "상무 보고", state: resolveState(mode, missionPhase, 5) }
    ],
    [mode, missionPhase]
  );

  return (
    <aside className="office-hud" aria-label="오피스 진행 HUD">
      <header className="office-hud__header">
        <strong>LIVE OPS</strong>
        <span>{projectTitle}</span>
      </header>

      <div className="office-hud__directive">
        <b>현재 지시</b>
        <p>{trimDirective(directive)}</p>
        {threadTitle ? <small>스레드: {threadTitle}</small> : null}
      </div>

      <div className="office-hud__flow">
        {flow.map((item) => (
          <article key={item.key} className={`office-hud__flow-item is-${item.state}`}>
            <span>{item.label}</span>
          </article>
        ))}
      </div>

      <div className="office-hud__targets">
        <b>투입 부서</b>
        <div>
          {targets.map((item) => (
            <em key={item}>{item}</em>
          ))}
        </div>
      </div>
    </aside>
  );
}
