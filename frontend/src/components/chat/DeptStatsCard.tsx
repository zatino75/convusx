import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../api/url";
import { devLog } from "../../utils/helpers";
import { useWebSocket } from "../../hooks/useWebSocket";

/**
 * Phase 5 타이쿤 게임 카드 + Phase 7 실시간 레벨업 이펙트.
 * /api/departments/stats 30초 폴링 + dept:levelup WS 이벤트로 즉시 반영.
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

type LevelupToast = {
  id: string;
  dept_id: string;
  previous_level: number;
  new_level: number;
  xp: number;
  createdAt: number;
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
  const [toasts, setToasts] = useState<LevelupToast[]>([]);
  const [glowingDept, setGlowingDept] = useState<string | null>(null);
  const glowTimerRef = useRef<number | null>(null);
  const loadRef = useRef<() => Promise<void>>(async () => {});

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
    loadRef.current = load;
    load();
    const id = window.setInterval(load, 30_000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, []);

  useWebSocket({
    onEvent: (msg) => {
      if (msg.type !== "dept:levelup") return;
      const payload = msg.payload as Record<string, unknown>;
      const deptId = String(payload?.dept_id ?? "");
      const newLevel = Number(payload?.new_level ?? 0);
      const prevLevel = Number(payload?.previous_level ?? 0);
      const xp = Number(payload?.xp ?? 0);
      if (!deptId) return;

      const toast: LevelupToast = {
        id: `${deptId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        dept_id: deptId,
        previous_level: prevLevel,
        new_level: newLevel,
        xp,
        createdAt: Date.now(),
      };
      setToasts((prev) => [...prev, toast].slice(-5));
      setGlowingDept(deptId);
      if (glowTimerRef.current) window.clearTimeout(glowTimerRef.current);
      glowTimerRef.current = window.setTimeout(() => setGlowingDept(null), 4500);

      // 즉시 통계 재조회 (XP/레벨 반영)
      loadRef.current?.();

      // 4s 후 토스트 자동 제거
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, 4500);
    },
  });

  useEffect(() => {
    return () => {
      if (glowTimerRef.current) window.clearTimeout(glowTimerRef.current);
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
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 12,
      }}
    >
      {/* 레벨업 토스트 스택 (우상단) */}
      {toasts.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            zIndex: 50,
            pointerEvents: "none",
          }}
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                background:
                  "linear-gradient(135deg, rgba(255,215,90,0.95), rgba(255,120,170,0.95))",
                color: "#1a0f2e",
                boxShadow: "0 6px 24px rgba(255,180,90,0.35)",
                fontSize: 12,
                fontWeight: 700,
                animation: "levelup-slide-in 260ms ease-out",
                minWidth: 220,
              }}
            >
              🎉 {DEPT_NAMES[t.dept_id] ?? t.dept_id} 레벨업! L{t.previous_level} → L{t.new_level}
              <div style={{ fontSize: 10, fontWeight: 500, opacity: 0.85, marginTop: 2 }}>
                누적 {t.xp.toLocaleString()} XP
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes levelup-slide-in {
          from { opacity: 0; transform: translateX(20px) scale(0.95); }
          to { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes levelup-row-glow {
          0%, 100% { background: transparent; }
          40% { background: linear-gradient(90deg, rgba(255,215,90,0.18), rgba(255,120,170,0.14)); }
        }
      `}</style>

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
            const isGlowing = glowingDept === d.dept_id;
            return (
              <div
                key={d.dept_id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "120px 40px 1fr 90px 70px 70px 70px",
                  gap: 8,
                  alignItems: "center",
                  fontSize: 11,
                  padding: "2px 4px",
                  borderRadius: 6,
                  animation: isGlowing ? "levelup-row-glow 2.8s ease-in-out" : undefined,
                  transition: "background 0.3s ease",
                }}
              >
                <span>{name}</span>
                <span
                  style={{
                    opacity: 0.85,
                    fontWeight: isGlowing ? 700 : 500,
                    color: isGlowing ? "#f59e0b" : undefined,
                  }}
                >
                  L{d.level}
                </span>
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
                <span style={{ opacity: 0.75 }} title="누적 AI 호출 비용 (USD)">
                  {formatCurrency(d.total_cost_usd)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
