import { useMemo, type CSSProperties } from "react";

type SceneMode = "idle" | "dispatch" | "working" | "meeting";

type Position = {
  x: number;
  y: number;
};

type AgentColor = "mint" | "cobalt" | "amber" | "rose" | "violet";

type Agent = {
  id: string;
  label: string;
  team: string;
  color: AgentColor;
  desk: Position;
  move: Position;
  work: Position;
  meeting: Position;
};

const AGENTS: Agent[] = [
  { id: "strategy", label: "전략", team: "Strategy", color: "mint", desk: { x: 15, y: 30 }, move: { x: 34, y: 53 }, work: { x: 22, y: 34 }, meeting: { x: 52, y: 25 } },
  { id: "finance", label: "재무", team: "Finance", color: "amber", desk: { x: 31, y: 23 }, move: { x: 39, y: 53 }, work: { x: 36, y: 30 }, meeting: { x: 56, y: 25 } },
  { id: "legal", label: "법무", team: "Legal", color: "violet", desk: { x: 48, y: 20 }, move: { x: 44, y: 53 }, work: { x: 51, y: 28 }, meeting: { x: 60, y: 25 } },
  { id: "ops", label: "운영", team: "Ops", color: "rose", desk: { x: 67, y: 24 }, move: { x: 49, y: 53 }, work: { x: 65, y: 33 }, meeting: { x: 64, y: 25 } },
  { id: "data", label: "데이터", team: "Data", color: "cobalt", desk: { x: 17, y: 72 }, move: { x: 37, y: 61 }, work: { x: 26, y: 66 }, meeting: { x: 54, y: 33 } },
  { id: "marketing", label: "마케팅", team: "Marketing", color: "mint", desk: { x: 40, y: 75 }, move: { x: 43, y: 61 }, work: { x: 43, y: 69 }, meeting: { x: 58, y: 33 } },
  { id: "content", label: "콘텐츠", team: "Content", color: "cobalt", desk: { x: 63, y: 72 }, move: { x: 49, y: 61 }, work: { x: 61, y: 66 }, meeting: { x: 62, y: 33 } }
];

const KEYWORDS: Record<string, string[]> = {
  strategy: ["전략", "기획", "로드맵", "신사업", "시장"],
  finance: ["재무", "손익", "원가", "매출", "이익", "예산", "정산"],
  legal: ["법무", "약관", "규정", "컴플라이언스", "리스크", "계약"],
  ops: ["운영", "매장", "공급", "재고", "물류", "프로세스", "pos"],
  data: ["데이터", "지표", "분석", "대시보드", "kpi", "모니터링"],
  marketing: ["마케팅", "캠페인", "광고", "브랜딩", "전환", "리텐션"],
  content: ["콘텐츠", "이미지", "영상", "디자인", "크리에이티브", "스토리"]
};

function parseActiveDepartments(directive: string): Set<string> {
  const normalized = directive.trim().toLowerCase();
  if (!normalized) return new Set();

  const active = new Set<string>();
  for (const [dept, words] of Object.entries(KEYWORDS)) {
    if (words.some((word) => normalized.includes(word.toLowerCase()))) {
      active.add(dept);
    }
  }

  if (active.size === 0) {
    AGENTS.forEach((agent) => active.add(agent.id));
  }
  return active;
}

function phaseCopy(mode: SceneMode) {
  if (mode === "dispatch") return "지시 전달";
  if (mode === "working") return "부서 실행";
  if (mode === "meeting") return "미팅룸 보고";
  return "지시 대기";
}

function clipDirective(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "HQ에서 지시를 생성하면 각 부서 아바타가 이동·실행·보고 루프를 시작합니다.";
  return trimmed.length > 96 ? `${trimmed.slice(0, 96)}...` : trimmed;
}

function meetingSummary(input: string, totalTarget: number): string {
  const trimmed = input.trim();
  if (!trimmed) return `${totalTarget}개 부서 실행 결과를 상무가 대표에게 보고합니다.`;
  const clipped = trimmed.length > 72 ? `${trimmed.slice(0, 72)}...` : trimmed;
  return `상무 종합보고: ${clipped}`;
}

function actorPosition(agent: Agent, mode: SceneMode, isActive: boolean): Position {
  if (!isActive) return agent.desk;
  if (mode === "dispatch") return agent.move;
  if (mode === "working") return agent.work;
  if (mode === "meeting") return agent.meeting;
  return agent.desk;
}

function asPosStyle(position: Position): CSSProperties {
  return { left: `${position.x}%`, top: `${position.y}%` };
}

function asPacketStyle(from: Position, to: Position, index: number): CSSProperties {
  return {
    "--sx": `${from.x}%`,
    "--sy": `${from.y}%`,
    "--tx": `${to.x}%`,
    "--ty": `${to.y}%`,
    "--delay": `${index * 0.08}s`
  } as CSSProperties;
}

function asLinkStyle(from: Position, to: Position, index: number, isActive: boolean): CSSProperties {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt((dx * dx) + (dy * dy));
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  return {
    left: `${from.x}%`,
    top: `${from.y}%`,
    width: `${length}%`,
    transform: `translateY(-50%) rotate(${angle}deg)`,
    opacity: isActive ? 0.62 : 0.2,
    "--delay": `${index * 0.07}s`
  } as CSSProperties;
}

export default function OfficeWorld({ mode = "idle", directive = "" }: { mode?: SceneMode; directive?: string }) {
  const activeDepartments = useMemo(() => parseActiveDepartments(directive), [directive]);
  const activeAgents = useMemo(
    () => (activeDepartments.size > 0 ? AGENTS.filter((agent) => activeDepartments.has(agent.id)) : AGENTS),
    [activeDepartments]
  );
  const totalTarget = activeAgents.length > 0 ? activeAgents.length : AGENTS.length;

  const hq: Position = { x: 51, y: 55 };
  const board: Position = { x: 58, y: 26 };
  const director: Position = mode === "meeting" ? { x: 52, y: 24 } : mode === "working" ? { x: 50, y: 51 } : { x: 50, y: 56 };
  const ceo: Position = mode === "meeting" ? { x: 66, y: 24 } : { x: 62, y: 56 };

  return (
    <div className={`sim-world sim-world--${mode}`} aria-hidden="true">
      <div className="sim-world__bg" />
      <div className="sim-world__grid" />
      <div className="sim-world__rings" />
      <div className="sim-world__stage">
        <section className="sim-world__hud">
          <span className={`sim-world__phase is-${mode}`}>{phaseCopy(mode)}</span>
          <strong>{clipDirective(directive)}</strong>
          <b>회의 집결 {mode === "meeting" ? totalTarget : 0}/{totalTarget}</b>
        </section>

        <article className={`sim-world__room sim-world__room--hq${mode === "dispatch" ? " is-focus" : ""}`} style={asPosStyle(hq)}>
          <span>HQ CORE</span>
        </article>

        <article className={`sim-world__room sim-world__room--meeting${mode === "meeting" ? " is-focus" : ""}`} style={asPosStyle(board)}>
          <span>BOARD ROOM</span>
        </article>

        {mode === "meeting" ? (
          <article className="sim-world__report" style={asPosStyle({ x: 73, y: 17 })}>
            <strong>CEO 브리핑</strong>
            <p>{meetingSummary(directive, totalTarget)}</p>
          </article>
        ) : null}

        <div className="sim-world__links">
          {AGENTS.map((agent, index) => {
            const isActive = activeDepartments.size > 0 && activeDepartments.has(agent.id);
            return (
              <div
                key={`link-hq-${agent.id}`}
                className={`sim-world__link sim-world__link--hq${isActive ? " is-active" : ""}${mode !== "idle" ? ` is-${mode}` : ""}`}
                style={asLinkStyle(hq, agent.desk, index, isActive)}
              />
            );
          })}
          {AGENTS.map((agent, index) => {
            const isActive = activeDepartments.size > 0 && activeDepartments.has(agent.id);
            return (
              <div
                key={`link-meeting-${agent.id}`}
                className={`sim-world__link sim-world__link--meeting${isActive ? " is-active" : ""}${mode === "meeting" ? " is-meeting-focus" : ""}`}
                style={asLinkStyle(agent.desk, board, index + AGENTS.length, isActive)}
              />
            );
          })}
        </div>

        {AGENTS.map((agent) => {
          const isActive = activeDepartments.size > 0 && activeDepartments.has(agent.id);
          return (
            <article
              key={`node-${agent.id}`}
              className={`sim-world__node${isActive ? " is-active" : ""}`}
              style={asPosStyle(agent.desk)}
            >
              <small>{agent.team}</small>
              <strong>{agent.label}</strong>
            </article>
          );
        })}

        {mode === "dispatch" ? (
          <div className="sim-world__packets">
            {activeAgents.map((agent, index) => (
              <div key={`dispatch-${agent.id}`} className="sim-world__packet is-dispatch" style={asPacketStyle(hq, agent.move, index)} />
            ))}
          </div>
        ) : null}

        {mode === "working" ? (
          <div className="sim-world__packets">
            {activeAgents.map((agent, index) => (
              <div key={`working-${agent.id}`} className="sim-world__packet is-working" style={asPacketStyle(agent.work, board, index)} />
            ))}
          </div>
        ) : null}

        {mode === "meeting" ? (
          <div className="sim-world__packets">
            {activeAgents.map((agent, index) => (
              <div key={`meeting-${agent.id}`} className="sim-world__packet is-meeting" style={asPacketStyle(agent.meeting, board, index)} />
            ))}
          </div>
        ) : null}

        {AGENTS.map((agent) => {
          const isActive = activeDepartments.size > 0 && activeDepartments.has(agent.id);
          const position = actorPosition(agent, mode, isActive);
          return (
            <div
              key={`avatar-${agent.id}`}
              className={`sim-world__avatar sim-world__avatar--${agent.color}${isActive ? " is-active" : ""}`}
              style={asPosStyle(position)}
            >
              <span>{agent.label}</span>
            </div>
          );
        })}

        <div className={`sim-world__exec sim-world__exec--director is-${mode}`} style={asPosStyle(director)}>
          상무
        </div>
        <div className={`sim-world__exec sim-world__exec--ceo is-${mode}`} style={asPosStyle(ceo)}>
          대표
        </div>
      </div>
    </div>
  );
}
