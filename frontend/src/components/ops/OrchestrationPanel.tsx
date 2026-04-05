import React, { useState, useEffect } from "react";
import type { UsageSummaryResponse } from "../../api/chat";

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
  raw?: unknown;
};

type Props = {
  debugMeta: DebugMeta;
  artifactList?: Array<{ id: string; title: string; code: string; language: string }>;
};

const PROVIDER_COLOR: Record<string, string> = {
  openai: "#10a37f", claude: "#d97706", gemini: "#3b82f6", perplexity: "#8b5cf6", system: "#6b7280"
};
const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI", claude: "Claude", gemini: "Gemini", perplexity: "Perplexity", system: "System"
};
const TASK_LABEL: Record<string, string> = {
  dialogue: "대화", reasoning: "추론", research: "리서치", code: "코드",
  writing: "글쓰기", long_doc: "긴 문서", source_promote: "소스 저장", slide_generate: "슬라이드",
  image_generate: "이미지 생성", video_generate: "비디오 생성"
};

// 벤치마크 기반 라우팅 근거
const TASK_RATIONALE: Record<string, string> = {
  dialogue: "Claude — 자연스러운 대화 품질 1위 · OpenAI — 사실 검증",
  writing: "Claude — 글쓰기/문서 품질 1위 (128K 출력) · OpenAI — 보조",
  code: "Claude — SWE-bench 80.8% 코딩 1위 · OpenAI Codex — 검증",
  reasoning: "Gemini — ARC-AGI-2 추론 77.1% 1위 · OpenAI — 종합",
  research: "Perplexity — 실시간 리서치 팩트 93.9% · Claude — 분석/정리",
  long_doc: "Claude — primary · Gemini — 1M 컨텍스트 검증"
};
const BILLING_LINKS: Record<string, { url: string; label: string }> = {
  openai: { url: "https://platform.openai.com/usage", label: "OpenAI Usage" },
  claude: { url: "https://console.anthropic.com/usage", label: "Anthropic Console" },
  gemini: { url: "https://aistudio.google.com/apikey", label: "Google AI Studio" },
  perplexity: { url: "https://www.perplexity.ai/settings/api", label: "Perplexity API" }
};

// synthesis role → 표시 레이블
const SYNTHESIS_ROLE_LABEL: Record<string, { label: string; color: string }> = {
  verified:  { label: "논리 검증", color: "#3b82f6" },
  patched:   { label: "코드 수정", color: "#10a37f" },
  edited:    { label: "글 편집",   color: "#d97706" },
  extracted: { label: "문서 추출", color: "#8b5cf6" },
  critique:  { label: "크리틱",   color: "#ef4444" }
};

const PAGES = ["흐름", "비교", "코드"];

function pLabel(p: string | null | undefined) {
  const k = String(p ?? "").trim().toLowerCase();
  return PROVIDER_LABEL[k] ?? k ?? "-";
}
function pColor(p: string | null | undefined) {
  const k = String(p ?? "").trim().toLowerCase();
  return PROVIDER_COLOR[k] ?? "var(--text-sub)";
}
function normP(p: string | null | undefined) {
  return String(p ?? "").trim().toLowerCase();
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

// Judge 점수 비교용 한 줄 컴포넌트
function JudgeScoreRow({ provider, score, reasons, isWinner }: {
  provider: string;
  score: number;
  reasons: string[];
  isWinner: boolean;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, score)) * 100);
  const color = pColor(provider);
  // coverage/structure/specificity/conflict 제외하고 보너스/페널티만 표시
  const chips = reasons
    .filter(r => !r.startsWith("coverage") && !r.startsWith("structure") && !r.startsWith("specificity") && !r.startsWith("conflict_penalty:"))
    .slice(0, 5)
    .map(r => r.replace(/_bonus$/, "").replace(/_penalty$/, "⚠").replace(/_/g, " "));

  return (
    <div style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
        <ProviderBadge provider={provider} />
        {isWinner && <span style={{ fontSize: 10, color: "#10b981", fontWeight: 700 }}>✓ 선택</span>}
        <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color }}>{pct}pt</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: "var(--border)", marginBottom: 5 }}>
        <div style={{ width: pct + "%", height: "100%", borderRadius: 2, background: color + "80", transition: "width 0.4s ease" }} />
      </div>
      {chips.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 3 }}>
          {chips.map((chip, i) => (
            <span key={i} style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: color + "15", color, lineHeight: 1.5 }}>
              {chip}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PageOrchestration({ debugMeta }: { debugMeta: DebugMeta }) {
  const winner = debugMeta.displayWinner?.provider ?? debugMeta.winnerProvider;
  const task = debugMeta.routerTask ?? "";
  const isSourcePromote = task === "source_promote";
  const internalRationale = (debugMeta.raw as any)?.result?.internal_rationale ?? {};
  const conflicts: any[] = internalRationale.conflicts ?? [];
  const conflictCount = debugMeta.conflictCount ?? conflicts.length;
  const executedProviders: any[] = internalRationale.executed_providers ?? [];
  const threadFusionApplied = Boolean((debugMeta.raw as any)?.result?.response_meta?.orchestration?.thread_fusion_applied);

  // Judge 점수 비교 데이터
  const judgeScores: Array<{ provider: string; score: number; reasons: string[] }> =
    Array.isArray(internalRationale.judge?.scores) ? internalRationale.judge.scores : [];

  // 선택 근거 데이터
  const selectionTrace = internalRationale.selection_trace ?? {};
  const judgeRationale: string = selectionTrace.judge_rationale ?? "";
  const selectedReasons: string[] = Array.isArray(selectionTrace.selected_reasons)
    ? selectionTrace.selected_reasons : [];

  // synthesis 적용 여부 (role이 verified/patched/edited/extracted인 항목)
  const synthProviders = executedProviders.filter((ep: any) => SYNTHESIS_ROLE_LABEL[ep?.role]);

  const isImageGenerate = task === "image_generate";
  const isVideoGenerate = task === "video_generate";

  // 이미지 생성 패널
  if (isImageGenerate) {
    const imageUrl = (debugMeta.raw as any)?.image_url ?? (debugMeta.raw as any)?.result?.image_url ?? null;
    const imageUrls: string[] = (debugMeta.raw as any)?.image_urls ?? [];
    const provider = winner ?? "openai";
    const PROVIDER_LABEL: Record<string, string> = { openai: "DALL-E 3", gemini: "Gemini Imagen 4", midjourney: "Midjourney v6.1" };
    return (
      <Section title="이미지 생성">
        <div style={{ padding: 12, borderRadius: 8, background: "var(--bg-sub,#f8fafc)", border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <ProviderBadge provider={provider} />
            <span style={{ fontSize: 11, color: "var(--text-sub)" }}>{PROVIDER_LABEL[provider] ?? provider.toUpperCase()}</span>
          </div>
          {imageUrl && (
            <img src={imageUrl} alt="생성된 이미지" style={{ width: "100%", maxWidth: 320, borderRadius: 8, border: "1px solid var(--border)", display: "block" }}
              onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
          )}
          {imageUrls.length > 1 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
              {imageUrls.map((url, i) => (
                <img key={i} src={url} alt={`이미지 ${i+1}`} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }}
                  onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
              ))}
            </div>
          )}
          {!imageUrl && !imageUrls.length && (
            <div style={{ fontSize: 12, color: "var(--text-sub)" }}>이미지 URL을 불러오는 중...</div>
          )}
        </div>
      </Section>
    );
  }

  // 비디오 생성 패널
  if (isVideoGenerate) {
    const videoUrl = (debugMeta.raw as any)?.video_url ?? (debugMeta.raw as any)?.result?.video_url ?? null;
    const provider = winner ?? "gemini";
    const PROVIDER_LABEL: Record<string, string> = { runway: "Runway Gen4 Turbo", gemini: "Gemini Veo 3.1" };
    const isGcs = videoUrl && String(videoUrl).startsWith("gs://");
    return (
      <Section title="비디오 생성">
        <div style={{ padding: 12, borderRadius: 8, background: "var(--bg-sub,#f8fafc)", border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <ProviderBadge provider={provider} />
            <span style={{ fontSize: 11, color: "var(--text-sub)" }}>{PROVIDER_LABEL[provider] ?? provider.toUpperCase()}</span>
          </div>
          {videoUrl && !isGcs && (
            <video src={videoUrl} controls style={{ width: "100%", maxWidth: 320, borderRadius: 8, border: "1px solid var(--border)" }} />
          )}
          {videoUrl && isGcs && (
            <div style={{ fontSize: 12, color: "var(--text-sub)", wordBreak: "break-all" }}>
              <a href={videoUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent,#6366f1)", fontWeight: 600 }}>↗ 비디오 열기 (GCS)</a>
            </div>
          )}
          {!videoUrl && (
            <div style={{ fontSize: 12, color: "var(--text-sub)" }}>비디오 URL을 불러오는 중...</div>
          )}
        </div>
      </Section>
    );
  }

  if (isSourcePromote) {
    return (
      <Section title="소스 저장">
        <div style={{ padding: 12, borderRadius: 8, background: "#f0fdf4", border: "1px solid #86efac" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#15803d", marginBottom: 4 }}>✅ 프로젝트 소스 저장 완료</div>
          <div style={{ fontSize: 12, color: "#166534" }}>현재 스레드 내용이 프로젝트 지식 소스로 승격되었습니다.</div>
        </div>
      </Section>
    );
  }

  return (
    <>
      {/* 이번 요청 */}
      <Section title="이번 요청">
        <Row label="Winner">
          {winner ? <ProviderBadge provider={winner} /> : <span style={{ fontSize: 12, color: "var(--text-soft)" }}>-</span>}
        </Row>
        <Row label="Task">
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-main)" }}>
            {TASK_LABEL[task] ?? task ?? "-"}
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
      </Section>

      {/* Judge 점수 비교 - 2개 이상 candidate가 있을 때만 */}
      {judgeScores.length >= 2 && (
        <Section title="Judge 점수 비교">
          {judgeScores
            .slice()
            .sort((a, b) => b.score - a.score)
            .map((s: any) => (
              <JudgeScoreRow
                key={s.provider}
                provider={s.provider}
                score={s.score}
                reasons={Array.isArray(s.reasons) ? s.reasons : []}
                isWinner={normP(s.provider) === normP(winner)}
              />
            ))}
        </Section>
      )}

      {/* 선택 근거 */}
      {(judgeRationale || selectedReasons.length > 0) && (
        <Section title="선택 근거">
          {judgeRationale && (
            <div style={{ fontSize: 11, color: "var(--text-sub)", marginBottom: 8, lineHeight: 1.6, fontStyle: "italic", padding: "6px 8px", borderRadius: 6, background: "#f9fafb", border: "1px solid var(--border)" }}>
              "{judgeRationale}"
            </div>
          )}
          {selectedReasons.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 4 }}>
              {selectedReasons
                .filter(r => !r.startsWith("coverage") && !r.startsWith("structure") && !r.startsWith("specificity"))
                .slice(0, 8)
                .map((r, i) => (
                  <span key={i} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "#f3f4f6", color: "var(--text-sub)", lineHeight: 1.5 }}>
                    {r.replace(/_bonus$/, "").replace(/_penalty$/, " ⚠").replace(/_/g, " ")}
                  </span>
                ))}
            </div>
          )}
        </Section>
      )}

      {/* 라우팅 근거 */}
      {task && TASK_RATIONALE[task] && (
        <div style={{ padding: 10, borderRadius: 8, background: "#f9fafb", border: "1px solid var(--border)", marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-soft)", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 6 }}>라우팅 근거</div>
          <div style={{ fontSize: 11, color: "var(--text-sub)", lineHeight: 1.6 }}>{TASK_RATIONALE[task]}</div>
        </div>
      )}

      {/* Dynamic Router Score — v4 12지표 합산 */}
      {(() => {
        const dynScores: Record<string, { score: number; breakdown: Record<string, number> }> =
          internalRationale.route?.dynamic_scores ?? {};
        const providers = Object.keys(dynScores).sort((a, b) => (dynScores[b]?.score ?? 0) - (dynScores[a]?.score ?? 0));
        if (providers.length === 0) return null;
        const maxScore = Math.max(...providers.map(p => dynScores[p]?.score ?? 0), 1);
        const BREAKDOWN_LABEL: Record<string, string> = {
          quality: "품질", success: "성공률", latency: "속도", cost_efficiency: "비용효율",
          freshness: "최신성", confidence: "신뢰도", recent_winner_bonus: "최근승리",
          conflicts: "충돌↓", fallback: "폴백↓", claims: "근거", decisions: "판단"
        };
        return (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-soft)", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 8 }}>
              Dynamic Router Score <span style={{ fontSize: 9, fontWeight: 500, color: "var(--text-soft)", textTransform: "none" as const }}>v4 · 12지표</span>
            </div>
            {providers.map((p) => {
              const { score, breakdown } = dynScores[p] ?? { score: 0, breakdown: {} };
              const pct = Math.round((score / maxScore) * 100);
              const isWinner = normP(p) === normP(winner);
              const topItems = Object.entries(breakdown ?? {})
                .filter(([k]) => k !== "cost_penalty")
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .slice(0, 3);
              return (
                <div key={p} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <ProviderBadge provider={p} />
                    {isWinner && <span style={{ fontSize: 10, color: "#10b981", fontWeight: 700 }}>선택됨</span>}
                    <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "var(--text-main)", fontVariantNumeric: "tabular-nums" as const }}>
                      {score.toFixed(0)}<span style={{ fontSize: 9, color: "var(--text-soft)", fontWeight: 400 }}>/1000</span>
                    </span>
                  </div>
                  <div style={{ height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden", marginBottom: 5 }}>
                    <div style={{ height: "100%", width: `${pct}%`, borderRadius: 2, background: isWinner ? pColor(p) : pColor(p) + "80", transition: "width 0.3s" }} />
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 3 }}>
                    {topItems.map(([k, v]) => (
                      <span key={k} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: "#f3f4f6", color: "var(--text-sub)" }}>
                        {BREAKDOWN_LABEL[k] ?? k} {(v as number).toFixed(0)}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Retrieval meta — thread fusion + source 매칭 정보 */}
      {(() => {
        const rm = internalRationale.retrieval_meta;
        if (!rm) return null;
        const hasInfo = rm.thread_fusions > 0 || rm.matched_sources > 0 || rm.project_facts > 0;
        if (!hasInfo) return null;
        return (
          <div style={{ padding: 10, borderRadius: 8, background: "#eff6ff", border: "1px solid #bfdbfe", marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#1d4ed8", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 6 }}>Retrieval 주입</div>
            <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6 }}>
              {rm.thread_fusions > 0 && (
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "#dbeafe", color: "#1d4ed8", fontWeight: 600 }}>
                  🔗 스레드 {rm.thread_fusions}개
                </span>
              )}
              {rm.matched_sources > 0 && (
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "#dbeafe", color: "#1d4ed8", fontWeight: 600 }}>
                  📄 소스 {rm.matched_sources}개
                </span>
              )}
              {rm.project_facts > 0 && (
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "#dbeafe", color: "#1d4ed8", fontWeight: 600 }}>
                  📌 Facts {rm.project_facts}개
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {(debugMeta.selectedProviders.length > 0 || (debugMeta.verifierProviders?.length ?? 0) > 0) && (
        <Section title="Provider 구성">
          {debugMeta.selectedProviders.map(p => <div key={p} style={{ marginBottom: 4 }}><ProviderBadge provider={p} role="primary" /></div>)}
          {(debugMeta.verifierProviders ?? []).map(p => <div key={p} style={{ marginBottom: 4 }}><ProviderBadge provider={p} role="verifier" /></div>)}
        </Section>
      )}

      {executedProviders.length > 0 && (
        <Section title="실행 결과">
          {executedProviders.map((ep: any, idx: number) => {
            const synthInfo = SYNTHESIS_ROLE_LABEL[ep.role];
            return (
              <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <ProviderBadge provider={ep.provider} />
                  {synthInfo ? (
                    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: synthInfo.color + "18", color: synthInfo.color, fontWeight: 600 }}>
                      {synthInfo.label}
                    </span>
                  ) : ep.role && ep.role !== "optional" ? (
                    <span style={{ fontSize: 10, color: "var(--text-sub)" }}>{ep.role}</span>
                  ) : null}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {ep.model && <span style={{ fontSize: 10, color: "var(--text-sub)", fontFamily: "monospace" }}>{String(ep.model).split("-").slice(-1)[0]}</span>}
                  <span style={{ fontSize: 11, fontWeight: 600, color: ep.success ? "#10b981" : "#ef4444" }}>{ep.success ? "✓" : "✗"}</span>
                  {ep.latency_ms > 0 && <span style={{ fontSize: 10, color: "var(--text-sub)" }}>{(ep.latency_ms / 1000).toFixed(1)}s</span>}
                </div>
              </div>
            );
          })}
        </Section>
      )}

      {/* Synthesis 적용 요약 - synthesis가 실행된 경우 */}
      {synthProviders.length > 0 && (
        <div style={{ padding: 10, borderRadius: 8, background: "#fefce8", border: "1px solid #fde68a", marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#92400e", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 6 }}>Synthesis 적용</div>
          <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 5 }}>
            {synthProviders.map((ep: any, i: number) => {
              const info = SYNTHESIS_ROLE_LABEL[ep.role];
              return (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, padding: "2px 8px", borderRadius: 10, background: info.color + "15", color: info.color, fontWeight: 600 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: info.color, flexShrink: 0 }} />
                  {pLabel(ep.provider)} → {info.label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <Section title="검증">
        <Row label="충돌">
          <span style={{ fontSize: 12, fontWeight: 600, color: conflictCount > 0 ? "#f59e0b" : "#10b981" }}>
            {conflictCount > 0 ? `${conflictCount}건 감지` : "없음 ✓"}
          </span>
        </Row>
        {conflicts.slice(0, 2).map((c: any, idx: number) => (
          <div key={idx} style={{ padding: "6px 8px", borderRadius: 6, background: "#fffbeb", border: "1px solid #fde68a", marginTop: 6 }}>
            <div style={{ fontSize: 11, color: "#92400e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
              {c.type?.replace(/_/g, " ")} — {c.summary?.slice(0, 60)}
            </div>
          </div>
        ))}
        {debugMeta.primaryRecovered && (
          <Row label="복구"><span style={{ fontSize: 11, color: "#f59e0b" }}>Primary 복구됨</span></Row>
        )}
      </Section>

      {/* Conflict Decision 레코드 — 충돌에서 신뢰 provider 판단 */}
      {(() => {
        const decisions: any[] = internalRationale.conflict_decisions ?? [];
        if (decisions.length === 0) return null;
        return (
          <Section title="Conflict Decision">
            {decisions.slice(0, 4).map((d: any, idx: number) => {
              const ctype = String(d.conflict_type ?? "").replace(/_conflict$/, "").replace(/_/g, " ");
              const severityColor = d.severity === "high" ? "#ef4444" : d.severity === "medium" ? "#f59e0b" : "#6b7280";
              const confidencePct = Math.round(Math.min(1, Math.max(0, Number(d.confidence ?? 0))) * 100);
              return (
                <div key={idx} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", marginBottom: 6, background: d.judge_backed ? "#f0fdf4" : "#fafafa" }}>
                  {/* 헤더 */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: severityColor + "20", color: severityColor, fontWeight: 700, textTransform: "uppercase" as const }}>
                      {d.severity}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-sub)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                      {ctype}
                    </span>
                    {d.judge_backed && (
                      <span style={{ fontSize: 10, color: "#10b981", fontWeight: 700 }}>⚖ Judge</span>
                    )}
                  </div>
                  {/* Winner / Loser */}
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
                    {d.winner_provider && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, padding: "1px 7px", borderRadius: 10, background: pColor(d.winner_provider) + "18", color: pColor(d.winner_provider), fontWeight: 600 }}>
                        ✓ {pLabel(d.winner_provider)}
                      </span>
                    )}
                    {d.loser_provider && (
                      <>
                        <span style={{ fontSize: 10, color: "var(--text-soft)" }}>vs</span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, padding: "1px 7px", borderRadius: 10, background: "rgba(0,0,0,0.05)", color: "var(--text-sub)", fontWeight: 500 }}>
                          {pLabel(d.loser_provider)}
                        </span>
                      </>
                    )}
                    <span style={{ marginLeft: "auto", fontSize: 10, color: confidencePct >= 70 ? "#10b981" : "var(--text-sub)", fontWeight: 600 }}>
                      {confidencePct}%
                    </span>
                  </div>
                  {/* 판단 근거 */}
                  {d.rationale && (
                    <div style={{ fontSize: 10, color: "var(--text-soft)", lineHeight: 1.5 }}>
                      {String(d.rationale).slice(0, 100)}
                    </div>
                  )}
                </div>
              );
            })}
          </Section>
        );
      })()}
    </>
  );
}

function PageComparison({ debugMeta }: { debugMeta: DebugMeta }) {
  const winner = debugMeta.displayWinner?.provider ?? debugMeta.winnerProvider ?? null;
  const losers: string[] = debugMeta.displayLosers ?? [];
  const drafts: Array<{ provider: string; content: string }> = (debugMeta as any).providerDrafts ?? [];
  const executed: any[] = (debugMeta.raw as any)?.result?.internal_rationale?.executed_providers ?? [];

  // provider → 응답 텍스트 매핑
  const textMap: Record<string, string> = {};
  for (const ep of executed) {
    if (ep?.provider && ep?.text) textMap[String(ep.provider)] = String(ep.text);
  }
  for (const d of drafts) {
    if (d.provider && d.content && !textMap[d.provider]) textMap[d.provider] = d.content;
  }

  const candidates = [winner, ...losers].filter(Boolean) as string[];
  const allProviders = Array.from(new Set([...candidates, ...Object.keys(textMap)]));

  if (allProviders.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-soft)", fontSize: 13 }}>
        대화를 시작하면 AI 응답 비교가 표시됩니다
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {allProviders.map(provider => {
        const isWinner = normP(provider) === normP(winner);
        const text = textMap[provider] ?? "";
        return (
          <div key={provider} style={{
            borderRadius: 10,
            border: `1px solid ${isWinner ? pColor(provider) : "var(--border)"}`,
            background: isWinner ? pColor(provider) + "08" : "var(--surface-1)",
            overflow: "hidden"
          }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 12px",
              borderBottom: "1px solid var(--border)",
              background: isWinner ? pColor(provider) + "12" : "transparent"
            }}>
              <ProviderBadge provider={provider} />
              {isWinner && (
                <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20, background: pColor(provider), color: "#fff" }}>
                  ✓ Winner
                </span>
              )}
            </div>
            <div style={{
              padding: "10px 12px",
              fontSize: 12, color: "var(--text-main)", lineHeight: 1.65,
              whiteSpace: "pre-wrap", wordBreak: "break-word",
              maxHeight: 220, overflowY: "auto"
            }}>
              {text || <span style={{ color: "var(--text-soft)", fontStyle: "italic" }}>응답 없음</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}


function PageCodeFiles({ artifactList }: { artifactList: Array<{ id: string; title: string; code: string; language: string }> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const selected = artifactList.find(a => a.id === selectedId) ?? null;

  function handleCopy() {
    if (!selected) return;
    navigator.clipboard.writeText(selected.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (artifactList.length === 0) {
    return <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-soft)", fontSize: 13 }}>대화 중 생성된 코드 파일이 없습니다</div>;
  }

  return (
    <>
      <Section title="파일 목록">
        {artifactList.map(artifact => (
          <button key={artifact.id} type="button"
            onClick={() => setSelectedId(artifact.id === selectedId ? null : artifact.id)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 8, border: "none", marginBottom: 4, cursor: "pointer", background: artifact.id === selectedId ? pColor("openai") + "12" : "var(--surface-1)", textAlign: "left" as const }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ flexShrink: 0, color: "var(--text-sub)" }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
              </svg>
              <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{artifact.title}</span>
            </div>
            {artifact.language && (
              <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4, background: "rgba(0,0,0,0.07)", color: "var(--text-sub)", flexShrink: 0 }}>{artifact.language}</span>
            )}
          </button>
        ))}
      </Section>

      {selected && (
        <div style={{ marginTop: 4 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-main)" }}>{selected.title}</span>
            <button type="button" onClick={handleCopy}
              style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: copied ? "#10b981" : "transparent", color: copied ? "#fff" : "var(--text-sub)", cursor: "pointer" }}>
              {copied ? "복사됨 ✓" : "복사"}
            </button>
          </div>
          <textarea readOnly value={selected.code}
            style={{ width: "100%", height: 280, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10, background: "#f8f9fa", color: "var(--text-main)", fontSize: 12, lineHeight: 1.6, fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, Menlo, Consolas, monospace", resize: "vertical" as const, boxSizing: "border-box" as const }} />
        </div>
      )}
    </>
  );
}

function PagePreviews({ debugMeta }: { debugMeta: DebugMeta }) {
  const winner = debugMeta.displayWinner?.provider ?? debugMeta.winnerProvider;
  const summaries = debugMeta.providerStreamSummary ?? {};
  const hasData = Object.keys(summaries).length > 0;

  return (
    <>
      {Object.entries(summaries).map(([provider, summary]: [string, any]) => (
        <div key={provider} style={{ marginBottom: 12, padding: 12, borderRadius: 10, border: "1px solid var(--border)", background: provider === winner ? pColor(provider) + "06" : "transparent" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <ProviderBadge provider={provider} />
            {provider === winner && <span style={{ fontSize: 10, color: "#10b981", fontWeight: 700 }}>✓ 선택됨</span>}
            {summary?.chunk_count > 0 && <span style={{ fontSize: 10, color: "var(--text-sub)", marginLeft: "auto" }}>{summary.chunk_count} chunks</span>}
          </div>
          {summary?.preview_excerpt && (
            <div style={{ fontSize: 12, color: "var(--text-sub)", lineHeight: 1.6 }}>{String(summary.preview_excerpt).slice(0, 200)}</div>
          )}
        </div>
      ))}
    </>
  );
}

export default function OrchestrationPanel({ debugMeta, artifactList = [], initialPage = 0 }: Props & { initialPage?: number }) {
  const [pageIndex, setPageIndex] = useState(initialPage);

  // initialPage 변경 시 탭 전환 (코드 응답 → 코드탭, 닫힘 → 흐름탭)
  const prevInitialPage = React.useRef(initialPage);
  React.useEffect(() => {
    if (initialPage !== prevInitialPage.current) {
      setPageIndex(initialPage);
      prevInitialPage.current = initialPage;
    }
  }, [initialPage]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "linear-gradient(135deg, #fefef9 0%, #fcfaf2 30%, #f9f5ea 55%, #fcfaf3 80%, #fefef9 100%)" }}>
      {/* 헤더 */}
      <div style={{ padding: "12px 16px 0", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)", display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          오케스트레이션
        </div>
        {/* 탭 */}
        <div style={{ display: "flex", alignItems: "center", gap: 1 }}>
          {PAGES.map((label, idx) => (
            <button key={idx} type="button" onClick={() => setPageIndex(idx)}
              style={{ flexShrink: 0, padding: "5px 12px", border: "none", borderRadius: "6px 6px 0 0", background: "transparent", cursor: "pointer", fontSize: 12, fontWeight: pageIndex === idx ? 700 : 500, color: pageIndex === idx ? "var(--text-main)" : "var(--text-sub)", borderBottom: pageIndex === idx ? "2px solid var(--text-main)" : "2px solid transparent", marginBottom: -1, position: "relative" as const }}>
              {label}
              {idx === 2 && artifactList.length > 0 && (
                <span style={{ marginLeft: 3, fontSize: 10, fontWeight: 700, padding: "1px 4px", borderRadius: 8, background: "#10a37f", color: "#fff" }}>{artifactList.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* 컨텐츠 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        {pageIndex === 0
          ? <PageOrchestration debugMeta={debugMeta} />
          : pageIndex === 1
            ? <PageComparison debugMeta={debugMeta} />
            : <PageCodeFiles artifactList={artifactList} />}
      </div>
    </div>
  );
}
