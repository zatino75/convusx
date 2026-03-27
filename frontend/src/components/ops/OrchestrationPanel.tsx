import type { DashboardResponse, ScoreboardResponse, UsageSummaryResponse } from "../../api/chat";

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
};

type Props = {
  debugMeta: DebugMeta;
  usage: UsageSummaryResponse | null;
  scoreboard: ScoreboardResponse | null;
  dashboard: DashboardResponse | null;
  opsLoading: boolean;
  opsError: string | null;
};

const PROVIDER_COLOR: Record<string, string> = {
  openai: "#10a37f", claude: "#d97706", gemini: "#3b82f6", perplexity: "#8b5cf6"
};
const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI", claude: "Claude", gemini: "Gemini", perplexity: "Perplexity"
};
const TASK_LABEL: Record<string, string> = {
  dialogue: "대화", reasoning: "추론", research: "리서치", code: "코드"
};

function pLabel(p: string | null | undefined) {
  const k = String(p ?? "").trim().toLowerCase();
  return PROVIDER_LABEL[k] ?? k ?? "-";
}
function pColor(p: string | null | undefined) {
  const k = String(p ?? "").trim().toLowerCase();
  return PROVIDER_COLOR[k] ?? "var(--text-sub)";
}

function ProviderBadge({ provider, role }: { provider: string; role?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 20, background: pColor(provider) + "18", color: pColor(provider), fontSize: 12, fontWeight: 600 }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: pColor(provider), flexShrink: 0 }} />
      {pLabel(provider)}
      {role && <span style={{ opacity: 0.6, fontWeight: 400 }}> · {role}</span>}
    </span>
  );
}

function ConfidenceBar({ value }: { value: number | null | undefined }) {
  const pct = Math.round(Math.min(1, Math.max(0, Number(value ?? 0))) * 100);
  const color = pct >= 80 ? "#10b981" : pct >= 60 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 5, borderRadius: 3, background: "var(--border)" }}>
        <div style={{ width: pct + "%", height: "100%", borderRadius: 3, background: color, transition: "width 0.4s ease" }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color, minWidth: 32, textAlign: "right" }}>{pct}%</span>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 12, color: "var(--text-sub)", flexShrink: 0 }}>{label}</span>
      <div style={{ textAlign: "right" }}>{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "var(--text-soft)", textTransform: "uppercase" as const, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

export default function OrchestrationPanel({ debugMeta }: Props) {
  const winner = debugMeta.displayWinner?.provider ?? debugMeta.winnerProvider;
  const hasData = Boolean(winner || debugMeta.routerTask);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--surface-1, #f9fafb)" }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)", display: "flex", alignItems: "center", gap: 6 }}>
          <span>🎼</span> 오케스트레이션
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        {!hasData ? (
          <div style={{ textAlign: "center", padding: "40px 16px", color: "var(--text-soft)" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🎼</div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>대기 중</div>
            <div style={{ fontSize: 12 }}>메시지를 보내면<br />오케스트레이션 결과가 표시됩니다</div>
          </div>
        ) : (
          <>
            <Section title="이번 요청">
              <Row label="Winner">
                {winner ? <ProviderBadge provider={winner} /> : <span style={{ fontSize: 12, color: "var(--text-soft)" }}>-</span>}
              </Row>
              <Row label="Task">
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-main)" }}>
                  {TASK_LABEL[debugMeta.routerTask ?? ""] ?? debugMeta.routerTask ?? "-"}
                </span>
              </Row>
              {debugMeta.judgeConfidence != null && (
                <div style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 6 }}>Judge 신뢰도</div>
                  <ConfidenceBar value={debugMeta.judgeConfidence} />
                </div>
              )}
              {debugMeta.executionStrategy && (
                <Row label="전략">
                  <span style={{ fontSize: 11, color: "var(--text-sub)", fontFamily: "monospace" }}>{debugMeta.executionStrategy}</span>
                </Row>
              )}
              {(debugMeta.requestLatencyMs ?? 0) > 0 && (
                <Row label="응답 시간">
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-main)" }}>{((debugMeta.requestLatencyMs ?? 0) / 1000).toFixed(1)}s</span>
                </Row>
              )}
              {(debugMeta.requestCostUsd ?? 0) > 0 && (
                <Row label="비용">
                  <span style={{ fontSize: 12, color: "var(--text-sub)" }}>${((debugMeta.requestCostUsd ?? 0) * 1000).toFixed(3)}/1K</span>
                </Row>
              )}
            </Section>

            {(debugMeta.selectedProviders.length > 0 || (debugMeta.verifierProviders?.length ?? 0) > 0) && (
              <Section title="Provider 구성">
                {debugMeta.selectedProviders.map(p => <div key={p} style={{ marginBottom: 4 }}><ProviderBadge provider={p} role="primary" /></div>)}
                {(debugMeta.verifierProviders ?? []).map(p => <div key={p} style={{ marginBottom: 4 }}><ProviderBadge provider={p} role="verifier" /></div>)}
              </Section>
            )}

            <Section title="검증">
              <Row label="충돌">
                <span style={{ fontSize: 12, fontWeight: 600, color: debugMeta.conflictCount > 0 ? "#f59e0b" : "#10b981" }}>
                  {debugMeta.conflictCount > 0 ? debugMeta.conflictCount + "건 감지" : "없음 ✓"}
                </span>
              </Row>
              {debugMeta.primaryRecovered && (
                <Row label="복구"><span style={{ fontSize: 11, color: "#f59e0b" }}>Primary 복구됨</span></Row>
              )}
            </Section>

            {debugMeta.providerStreamSummary && Object.keys(debugMeta.providerStreamSummary).length > 0 && (
              <Section title="응답 미리보기">
                {Object.entries(debugMeta.providerStreamSummary).map(([provider, summary]: [string, any]) => (
                  <div key={provider} style={{ marginBottom: 10, padding: 10, borderRadius: 8, border: "1px solid var(--border)", background: provider === winner ? pColor(provider) + "08" : "transparent" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                      <ProviderBadge provider={provider} />
                      {provider === winner && <span style={{ fontSize: 10, color: "#10b981", fontWeight: 700 }}>✓ 선택됨</span>}
                    </div>
                    {summary?.preview_excerpt && (
                      <div style={{ fontSize: 11, color: "var(--text-sub)", lineHeight: 1.5, overflow: "hidden" }}>
                        {String(summary.preview_excerpt).slice(0, 120)}
                      </div>
                    )}
                  </div>
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
