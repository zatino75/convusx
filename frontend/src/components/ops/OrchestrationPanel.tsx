import type { DashboardResponse, ScoreboardResponse, UsageSummaryResponse } from "../../api/chat";
import ScoreboardCard from "./ScoreboardCard";

type DebugMeta = {
  winnerProvider: string | null;
  routerTask: string | null;
  selectedProviders: string[];
  verifierProviders: string[];
  executionStrategy: string | null;
  parallelWidth: number | null;
  conflictCount: number;
  judgeConfidence?: number | null;
  requestLatencyMs?: number | null;
  requestCostUsd?: number | null;
  displayWinner?: { provider?: string; role?: string } | null;
  displayLosers?: string[];
  primaryRecovered?: boolean;
  recoveryFromModel?: string | null;
  recoveryToModel?: string | null;
  providerStatusMap?: Record<string, any>;
  providerStreamSummary?: Record<string, any>;
  [key: string]: any;
};

type Props = {
  debugMeta: DebugMeta;
  usage: UsageSummaryResponse | null;
  scoreboard: ScoreboardResponse | null;
  dashboard: DashboardResponse | null;
  opsLoading: boolean;
  opsError: string | null;
};

function providerLabel(provider: string | null | undefined) {
  const n = String(provider ?? "").trim().toLowerCase();
  if (!n) return "-";
  if (n === "openai") return "OpenAI";
  if (n === "claude") return "Claude";
  if (n === "gemini") return "Gemini";
  if (n === "perplexity") return "Perplexity";
  if (n === "memory") return "Memory";
  return n;
}

function providerColor(provider: string | null | undefined) {
  const n = String(provider ?? "").trim().toLowerCase();
  if (n === "openai") return "#10a37f";
  if (n === "claude") return "#c96442";
  if (n === "gemini") return "#4285f4";
  if (n === "perplexity") return "#8b5cf6";
  if (n === "memory") return "#6366f1";
  return "#8e8ea0";
}

function confidenceColor(v: number) {
  if (v >= 0.85) return "#34d399";
  if (v >= 0.65) return "#fbbf24";
  return "#f87171";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(255,255,255,0.03)",
        padding: "12px 14px",
        display: "grid",
        gap: 8
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "#6b7280"
        }}
      >
        {title}
      </div>
      {children}
    </section>
  );
}

function MetaRow({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12 }}>
      <span style={{ color: "#6b7280", flexShrink: 0 }}>{label}</span>
      <span style={{ color: accent ?? "#d1d5db", fontWeight: 500, textAlign: "right", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </span>
    </div>
  );
}

function Badge({ text, color }: { text: string; color?: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 7px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        background: `${color ?? "#6366f1"}22`,
        color: color ?? "#818cf8",
        border: `1px solid ${color ?? "#6366f1"}33`
      }}
    >
      {text}
    </span>
  );
}

function ProviderStatusRow({ label, status }: { label: string; status: any }) {
  const isWinner = status?.status === "winner";
  const isSurvived = status?.status === "survived";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          flexShrink: 0,
          background: isWinner ? "#34d399" : isSurvived ? "#fbbf24" : "#4b5563"
        }}
      />
      <span style={{ color: isWinner ? "#d1fae5" : isSurvived ? "#fef3c7" : "#6b7280", fontWeight: isWinner ? 600 : 400 }}>
        {providerLabel(label)}
      </span>
      <span style={{ color: "#4b5563", marginLeft: "auto", fontSize: 11 }}>
        {status?.role ?? ""}
        {status?.latency_ms ? ` · ${status.latency_ms}ms` : ""}
      </span>
    </div>
  );
}

export default function OrchestrationPanel({
  debugMeta,
  usage,
  scoreboard,
  dashboard,
  opsLoading,
  opsError
}: Props) {
  const winner = debugMeta.displayWinner?.provider ?? debugMeta.winnerProvider ?? null;
  const confidence = debugMeta.judgeConfidence;
  const latency = debugMeta.requestLatencyMs;
  const cost = debugMeta.requestCostUsd;
  const conflicts = debugMeta.conflictCount ?? 0;
  const task = debugMeta.routerTask;
  const strategy = debugMeta.executionStrategy;
  const reused = debugMeta.reused ?? (debugMeta as any).orchestration?.reused ?? false;
  const reuseSource = debugMeta.reuse_source ?? (debugMeta as any).orchestration?.reuse_source ?? null;
  const reuseScore = debugMeta.reuse_score ?? (debugMeta as any).orchestration?.reuse_score ?? null;
  const threadFusion = debugMeta.thread_fusion_injected ?? (debugMeta as any).orchestration?.thread_fusion_injected ?? false;
  const providerStatusMap = debugMeta.providerStatusMap ?? {};
  const statusEntries = Object.entries(providerStatusMap);

  return (
    <aside
      className="xl:flex xl:flex-col"
      style={{
        display: "none",
        height: "100%",
        width: 320,
        flexShrink: 0,
        borderLeft: "1px solid rgba(255,255,255,0.07)",
        background: "#161616",
        flexDirection: "column"
      }}
    >
      <div
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          gap: 8
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb" }}>운영 패널</span>
        {reused ? <Badge text="REUSED" color="#6366f1" /> : null}
        {threadFusion ? <Badge text="FUSION" color="#0ea5e9" /> : null}
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px",
          display: "grid",
          gap: 10,
          alignContent: "start"
        }}
      >
        <Section title="Current Request">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: providerColor(winner), flexShrink: 0 }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: providerColor(winner) }}>
              {providerLabel(winner)}
            </span>
            {reused && reuseSource ? (
              <Badge
                text={reuseSource === "similar_query" ? "유사질문" : "past winner"}
                color="#6366f1"
              />
            ) : null}
          </div>

          {task ? <MetaRow label="Task" value={task} /> : null}
          {strategy ? <MetaRow label="Strategy" value={strategy} /> : null}
          {confidence != null ? (
            <MetaRow label="Confidence" value={`${(confidence * 100).toFixed(0)}%`} accent={confidenceColor(confidence)} />
          ) : null}
          <MetaRow
            label="Conflicts"
            value={conflicts > 0 ? `⚡ ${conflicts}` : "0"}
            accent={conflicts > 0 ? "#f87171" : "#34d399"}
          />
          {latency != null ? <MetaRow label="Latency" value={`${latency}ms`} /> : null}
          {cost != null && cost > 0 ? <MetaRow label="Cost" value={`$${cost.toFixed(6)}`} /> : null}
          {reused && reuseScore != null ? (
            <MetaRow label="Reuse Score" value={`${(reuseScore * 100).toFixed(0)}%`} accent="#818cf8" />
          ) : null}
        </Section>

        {statusEntries.length > 0 ? (
          <Section title="Providers">
            <div style={{ display: "grid", gap: 5 }}>
              {statusEntries.map(([provider, status]) => (
                <ProviderStatusRow key={provider} label={provider} status={status} />
              ))}
            </div>
          </Section>
        ) : null}

        {threadFusion ? (
          <Section title="Thread Fusion">
            <div style={{ fontSize: 12, color: "#7dd3fc" }}>다른 스레드 컨텍스트 자동 주입됨</div>
          </Section>
        ) : null}

        {!opsLoading && Array.isArray(dashboard?.bandit) && dashboard.bandit.length > 0 ? (
          <Section title="Bandit Scoreboard">
            <ScoreboardCard
              providers={dashboard.bandit}
              taskProvidersByTask={dashboard.task_bandit ?? {}}
            />
          </Section>
        ) : opsLoading ? (
          <Section title="Bandit Scoreboard">
            <div style={{ fontSize: 12, color: "#4b5563" }}>로딩 중...</div>
          </Section>
        ) : null}

        {opsError ? (
          <div style={{ fontSize: 12, color: "#f87171", padding: "4px 0" }}>{opsError}</div>
        ) : null}
      </div>
    </aside>
  );
}