import type { UsageProviderNode } from "../../api/chat";

type Props = {
  providers?: UsageProviderNode[];
  taskProvidersByTask?: Record<string, UsageProviderNode[]>;
  title?: string;
};

function safeNum(value: any, digits = 2): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(digits);
}

function providerColor(provider: string | null | undefined) {
  const n = String(provider ?? "").trim().toLowerCase();
  if (n === "openai") return "#10a37f";
  if (n === "claude") return "#c96442";
  if (n === "gemini") return "#4285f4";
  if (n === "perplexity") return "#8b5cf6";
  return "#8e8ea0";
}

function Row({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11, lineHeight: 1.6 }}>
      <span style={{ color: "#9ca3af" }}>{label}</span>
      <span style={{ color: accent ?? "#e5e7eb", fontWeight: 500, textAlign: "right" }}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "2px 0" }} />;
}

function ProviderCard({ row }: { row: UsageProviderNode }) {
  const color = providerColor(row.provider);
  const bandit = Number(row.bandit_score);
  const winRate = Number(row.blended_win_rate ?? row.win_rate ?? 0);
  const conflictPenalty = Number(row.conflict_penalty_recent ?? 0);

  return (
    <div
      style={{
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(255,255,255,0.03)",
        padding: "10px 12px",
        display: "grid",
        gap: 6
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color }}>{row.provider ?? "-"}</span>
        {Number.isFinite(bandit) ? (
          <span style={{ fontSize: 11, color: "#818cf8", fontWeight: 600 }}>
            {bandit.toFixed(3)}
          </span>
        ) : null}
      </div>

      {row.task ? (
        <span style={{ fontSize: 10, color: "#7c3aed", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {row.task}
        </span>
      ) : null}

      <Row
        label="Win Rate"
        value={`${(winRate * 100).toFixed(1)}%`}
        accent={winRate >= 0.6 ? "#34d399" : winRate >= 0.4 ? "#fbbf24" : "#f87171"}
      />
      <Row label="Uses / Wins" value={`${safeNum(row.uses, 0)} / ${safeNum(row.wins, 0)}`} />
      <Row label="Routing Score" value={safeNum(row.routing_score, 3)} />

      {conflictPenalty > 0 ? (
        <>
          <Divider />
          <Row label="Conflict Penalty" value={safeNum(row.conflict_penalty_recent, 3)} accent="#f87171" />
          {Number(row.context_conflicts_recent ?? 0) > 0 ? (
            <Row label="Context Conflicts" value={safeNum(row.context_conflicts_recent, 0)} accent="#fbbf24" />
          ) : null}
        </>
      ) : null}

      <Divider />
      <Row label="Avg Latency" value={`${safeNum(row.avg_latency, 0)}ms`} />
      <Row label="Avg Cost" value={`$${safeNum(row.avg_cost, 6)}`} />
    </div>
  );
}

function TaskSection({ task, providers }: { task: string; providers: UsageProviderNode[] }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.1em" }}>
        {task}
      </div>
      {providers.map((row, i) => (
        <ProviderCard key={`${row.provider}-${i}`} row={row} />
      ))}
    </div>
  );
}

export default function ScoreboardCard({ providers = [], taskProvidersByTask = {} }: Props) {
  const taskKeys = Object.keys(taskProvidersByTask).sort();
  const hasGlobal = providers.length > 0;
  const hasTask = taskKeys.length > 0;

  if (!hasGlobal && !hasTask) {
    return <div style={{ fontSize: 12, color: "#4b5563" }}>데이터 없음</div>;
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {hasGlobal ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Global
          </div>
          {providers.map((row, i) => (
            <ProviderCard key={`global-${row.provider}-${i}`} row={row} />
          ))}
        </div>
      ) : null}

      {hasTask ? (
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            By Task
          </div>
          {taskKeys.map((task) => (
            <TaskSection
              key={task}
              task={task}
              providers={Array.isArray(taskProvidersByTask[task]) ? taskProvidersByTask[task] : []}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}