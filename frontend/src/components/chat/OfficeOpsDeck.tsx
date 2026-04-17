import { useMemo } from "react";

type Phase = "idle" | "dispatch" | "working" | "meeting";

type Props = {
  phase: Phase;
  directive?: string;
  compact?: boolean;
};

type Dept = {
  id: string;
  name: string;
  progress: number;
  state: "standby" | "dispatch" | "working" | "done";
};

const BASE_DEPTS = ["전략", "재무", "법무", "운영", "데이터", "마케팅", "콘텐츠"];

function hashText(source: string) {
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash << 5) - hash + source.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function phaseLabel(phase: Phase) {
  if (phase === "dispatch") return "지시 전달";
  if (phase === "working") return "부서 실행";
  if (phase === "meeting") return "상무 보고";
  return "대기";
}

function buildDepartments(phase: Phase, directive: string): Dept[] {
  const seed = hashText(directive || "office");
  return BASE_DEPTS.map((name, index) => {
    const jitter = (seed + index * 31) % 15;
    if (phase === "meeting") {
      return { id: `${name}-${index}`, name, progress: 100, state: "done" };
    }
    if (phase === "working") {
      return { id: `${name}-${index}`, name, progress: 58 + jitter, state: "working" };
    }
    if (phase === "dispatch") {
      return { id: `${name}-${index}`, name, progress: 18 + jitter, state: "dispatch" };
    }
    return { id: `${name}-${index}`, name, progress: 8 + jitter, state: "standby" };
  });
}

export default function OfficeOpsDeck({ phase, directive = "", compact = false }: Props) {
  const departments = useMemo(() => buildDepartments(phase, directive), [phase, directive]);
  const doneCount = departments.filter((item) => item.progress >= 100).length;

  return (
    <section className={`office-ops-deck${compact ? " is-compact" : ""}`} aria-label="오피스 작업 보드">
      <header className="office-ops-deck__head">
        <div>
          <span className="office-ops-deck__eyebrow">OFFICE OPS</span>
          <strong className="office-ops-deck__title">{phaseLabel(phase)} · {departments.length}개 부서 동시 실행</strong>
        </div>
        <div className="office-ops-deck__stat">
          <span>회의실 집결</span>
          <b>{doneCount}/{departments.length}</b>
        </div>
      </header>

      <div className="office-ops-deck__grid">
        {departments.map((item) => (
          <article key={item.id} className={`office-ops-deck__card is-${item.state}`}>
            <div className="office-ops-deck__card-head">
              <strong>{item.name}</strong>
              <span>{item.progress}%</span>
            </div>
            <div className="office-ops-deck__bar">
              <span style={{ width: `${item.progress}%` }} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
