import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../api/url";
import { devLog } from "../../utils/helpers";
import { useWebSocket } from "../../hooks/useWebSocket";

/**
 * Phase 7 CEO 전략 대시보드.
 * /api/departments/stats 를 상위 관점으로 재가공해 보여준다.
 * - 전체 부서 성과 한 줄 KPI
 * - 프로젝트 성공률 (task 기준)
 * - 비용 vs 성과 바 차트 (부서별 효율성 = success_rate / cost)
 * - Top/Weakest 부서 자동 선별
 */
type DeptStat = {
  dept_id: string;
  xp: number;
  level: number;
  tasks_completed: number;
  tasks_failed: number;
  total_cost_usd: number;
  success_rate: number;
  next_level_xp: number;
  progress_to_next: number;
};

type StatsResponse = {
  ok?: boolean;
  departments: DeptStat[];
  aggregate: {
    total_xp: number;
    total_tasks: number;
    total_cost_usd: number;
    overall_success_rate: number;
  };
};

const DEPT_NAMES: Record<string, string> = {
  marketing: "마케팅",
  finance: "재무",
  legal: "법무",
  market: "시장조사",
  compete: "경쟁사",
  rnd: "R&D",
  data: "데이터",
  content: "콘텐츠",
  sns: "SNS",
};

function formatCurrency(usd: number): string {
  if (usd < 0.01) return "$0.00";
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatPct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

// 부서 효율: 완료 task 당 USD — 낮을수록 효율이 좋음.
// 비교용 "efficiency index" = success_rate / (cost_per_task + 0.001)
// 높을수록 "성공률 대비 저비용" 부서.
function efficiencyScore(d: DeptStat): number {
  const costPerTask = d.tasks_completed > 0 ? d.total_cost_usd / d.tasks_completed : 0;
  return d.success_rate / (costPerTask + 0.001);
}

export default function CeoStrategyCard() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const resp = await apiFetch("/api/departments/stats");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as StatsResponse;
      setStats(data);
      setError(null);
    } catch (err) {
      devLog.warn("[CeoStrategyCard] load failed", err);
      setError(err instanceof Error ? err.message : "unknown_error");
    }
  };

  useEffect(() => {
    load();
    const id = window.setInterval(load, 30_000);
    return () => window.clearInterval(id);
  }, []);

  // 레벨업 시 즉시 갱신
  useWebSocket({
    onEvent: (msg) => {
      if (msg.type === "dept:levelup") load();
    },
  });

  const derived = useMemo(() => {
    if (!stats) return null;
    const depts = stats.departments ?? [];
    const activeDepts = depts.filter((d) => d.tasks_completed + d.tasks_failed > 0);
    const avgLevel =
      activeDepts.length > 0
        ? activeDepts.reduce((sum, d) => sum + d.level, 0) / activeDepts.length
        : 0;
    const avgCostPerTask =
      stats.aggregate.total_tasks > 0
        ? stats.aggregate.total_cost_usd / stats.aggregate.total_tasks
        : 0;

    const ranked = [...activeDepts]
      .map((d) => ({ ...d, _efficiency: efficiencyScore(d) }))
      .sort((a, b) => b._efficiency - a._efficiency);
    const top = ranked[0] ?? null;
    const weakest = ranked[ranked.length - 1] ?? null;

    // 차트용: 부서별 비용(달러) + 성공 task 수
    const chartData = activeDepts.map((d) => ({
      dept_id: d.dept_id,
      cost: d.total_cost_usd,
      successTasks: d.tasks_completed,
      successRate: d.success_rate,
    }));
    const maxCost = Math.max(0.01, ...chartData.map((c) => c.cost));
    const maxTasks = Math.max(1, ...chartData.map((c) => c.successTasks));

    return { activeDepts, avgLevel, avgCostPerTask, top, weakest, chartData, maxCost, maxTasks };
  }, [stats]);

  if (error && !stats) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: "var(--text-sub)" }}>
        CEO 대시보드 로드 실패: {error}
      </div>
    );
  }

  if (!stats || !derived) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: "var(--text-sub)" }}>
        CEO 대시보드 로딩 중...
      </div>
    );
  }

  const { aggregate } = stats;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 12 }}>
      {/* 최상단 KPI 4종 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 10,
        }}
      >
        <KpiTile label="총 부서 XP" value={aggregate.total_xp.toLocaleString()} sub={`평균 L${derived.avgLevel.toFixed(1)}`} />
        <KpiTile
          label="프로젝트 성공률"
          value={formatPct(aggregate.overall_success_rate)}
          sub={`${aggregate.total_tasks.toLocaleString()} task`}
        />
        <KpiTile
          label="누적 비용"
          value={formatCurrency(aggregate.total_cost_usd)}
          sub={`task당 ${formatCurrency(derived.avgCostPerTask)}`}
        />
        <KpiTile
          label="활성 부서"
          value={`${derived.activeDepts.length} / 9`}
          sub={
            derived.top
              ? `Top: ${DEPT_NAMES[derived.top.dept_id] ?? derived.top.dept_id}`
              : "데이터 대기"
          }
        />
      </div>

      {/* 비용 vs 성과 차트 — 부서별 */}
      {derived.chartData.length > 0 ? (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, opacity: 0.85 }}>
            부서별 비용 vs 성공 task 수
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {derived.chartData.map((c) => {
              const costPct = (c.cost / derived.maxCost) * 100;
              const taskPct = (c.successTasks / derived.maxTasks) * 100;
              return (
                <div
                  key={c.dept_id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "90px 1fr 70px 60px",
                    gap: 8,
                    alignItems: "center",
                    fontSize: 11,
                  }}
                >
                  <span>{DEPT_NAMES[c.dept_id] ?? c.dept_id}</span>
                  <div
                    style={{
                      position: "relative",
                      height: 12,
                      background: "rgba(255,255,255,0.05)",
                      borderRadius: 3,
                      overflow: "hidden",
                    }}
                    title={`비용 ${formatCurrency(c.cost)} · 성공 task ${c.successTasks}`}
                  >
                    {/* 비용 바 (하단) */}
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        bottom: 0,
                        height: "50%",
                        width: `${costPct}%`,
                        background: "linear-gradient(90deg, rgba(239,68,68,0.55), rgba(244,114,182,0.55))",
                      }}
                    />
                    {/* 성공 task 바 (상단) */}
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        height: "50%",
                        width: `${taskPct}%`,
                        background: "linear-gradient(90deg, rgba(120,180,255,0.7), rgba(80,200,180,0.85))",
                      }}
                    />
                  </div>
                  <span style={{ opacity: 0.75, textAlign: "right" }}>{formatCurrency(c.cost)}</span>
                  <span style={{ opacity: 0.75, textAlign: "right" }}>{c.successTasks}건</span>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 10, opacity: 0.65 }}>
            <span>
              <span style={{ display: "inline-block", width: 10, height: 6, background: "rgba(120,180,255,0.8)", verticalAlign: "middle", marginRight: 4 }} />
              성공 task 수
            </span>
            <span>
              <span style={{ display: "inline-block", width: 10, height: 6, background: "rgba(239,68,68,0.55)", verticalAlign: "middle", marginRight: 4 }} />
              누적 비용
            </span>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, opacity: 0.55 }}>
          아직 Director 실행 기록이 없어 부서별 차트를 그릴 수 없습니다.
        </div>
      )}

      {/* Top / Weakest 부서 요약 */}
      {derived.top && derived.weakest && derived.top.dept_id !== derived.weakest.dept_id ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
            fontSize: 11,
          }}
        >
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              background: "rgba(80,200,180,0.08)",
              border: "1px solid rgba(80,200,180,0.25)",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 2 }}>
              ✅ 효율 Top: {DEPT_NAMES[derived.top.dept_id] ?? derived.top.dept_id}
            </div>
            <div style={{ opacity: 0.75 }}>
              성공률 {formatPct(derived.top.success_rate)} / task당 {formatCurrency(
                derived.top.tasks_completed > 0
                  ? derived.top.total_cost_usd / derived.top.tasks_completed
                  : 0
              )}
            </div>
          </div>
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.25)",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 2 }}>
              ⚠️ 개선 필요: {DEPT_NAMES[derived.weakest.dept_id] ?? derived.weakest.dept_id}
            </div>
            <div style={{ opacity: 0.75 }}>
              성공률 {formatPct(derived.weakest.success_rate)} / task당 {formatCurrency(
                derived.weakest.tasks_completed > 0
                  ? derived.weakest.total_cost_usd / derived.weakest.tasks_completed
                  : 0
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function KpiTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 8,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
      {sub ? <div style={{ fontSize: 10, opacity: 0.55, marginTop: 3 }}>{sub}</div> : null}
    </div>
  );
}
