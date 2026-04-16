import { useEffect, useState } from "react";
import { apiFetch } from "../../api/url";
import { devLog } from "../../utils/helpers";

/**
 * Phase 5 타이쿤 게임 카드.
 * Director 가 각 부서 task 를 끝낼 때마다 누적하는 XP/레벨/성공률/비용을
 * 30초마다 폴링해서 진척도 바 + 요약 수치로 렌더한다.
 */
type DeptStat = {
  dept_id: string;
  xp: number;
  level: number;
  tasks_completed: number;
  tasks_failed: number;
  total_cost_usd: number;
  last_updated: string;
  success_rate: number;
  next_level_xp: number;
  progress_to_next: number;
};

type StatsResponse = {
  ok: boolean;
  departments: DeptStat[];
  aggregate: {
    total_xp: number;
    total_tasks: number;
    total_cost_usd: number;
    overall_success_rate: number;
  };
};

const DEPT_NAMES: Record<string, string> = {
  marketing: "마케팅팀",
  finance: "재무팀",
  legal: "법무팀",
  market: "시장조사팀",
  compete: "경쟁사분석팀",
  rnd: "R&D팀",
  data: "데이터분석팀",
  content: "콘텐츠팀",
  sns: "SNS팀",
};

function formatCurrency(usd: number): string {
  if (usd < 0.01) return "$0.00";
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatPct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export default function DeptStatsCard() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const resp = await apiFetch("/api/departments/stats");
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = (await resp.json()) as StatsResponse;
        if (!stopped) setStats(data);
      } catch (err) {
        if (!stopped) {
          devLog.warn("[DeptStatsCard] load failed", err);
          setError(err instanceof Error ? err.message : "unknown_error");
        }
      }
    }
    load();
    const id = window.setInterval(load, 30_000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, []);

  if (error && !stats) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: "var(--text-sub)" }}>
        부서 통계 로드 실패: {error}
      </div>
    );
  }

  if (!stats) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: "var(--text-sub)" }}>
        부서 통계 로딩 중...
      </div>
    );
  }

  const { departments, aggregate } = stats;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          fontSize: 11,
        }}
      >
        <span style={{ opacity: 0.6 }}>부서 총 XP</span>
        <strong>{aggregate.total_xp.toLocaleString()}</strong>
        <span style={{ opacity: 0.6 }}>총 task</span>
        <strong>{aggregate.total_tasks.toLocaleString()}</strong>
        <span style={{ opacity: 0.6 }}>프로젝트 성공률</span>
        <strong>{formatPct(aggregate.overall_success_rate)}</strong>
        <span style={{ opacity: 0.6 }}>누적 비용</span>
        <strong>{formatCurrency(aggregate.total_cost_usd)}</strong>
      </div>

      {departments.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.6 }}>
          아직 부서 task 실행 기록 없음. Director 모드로 업무 지시를 보내면 부서가 XP 를 쌓기 시작합니다.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {departments.map((d) => {
            const name = DEPT_NAMES[d.dept_id] ?? d.dept_id;
            const pct = Math.round(d.progress_to_next * 100);
            return (
              <div
                key={d.dept_id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "120px 40px 1fr 90px 70px 70px",
                  gap: 8,
                  alignItems: "center",
                  fontSize: 11,
                }}
              >
                <span>{name}</span>
                <span style={{ opacity: 0.75 }}>L{d.level}</span>
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: "rgba(255,255,255,0.07)",
                    overflow: "hidden",
                  }}
                  title={`${d.xp} / ${d.next_level_xp} XP`}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      background: "linear-gradient(90deg, rgba(120,180,255,0.65), rgba(80,200,180,0.85))",
                    }}
                  />
                </div>
                <span style={{ opacity: 0.75 }}>
                  {d.xp.toLocaleString()} XP
                </span>
                <span style={{ opacity: 0.75 }}>
                  {d.tasks_completed}/{d.tasks_completed + d.tasks_failed}
                </span>
                <span style={{ opacity: 0.75 }}>
                  {formatPct(d.success_rate)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
