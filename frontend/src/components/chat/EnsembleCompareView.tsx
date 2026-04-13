// EnsembleCompareView.tsx — 병렬 앙상블 4탭 비교 뷰
//
// parallel_ensemble 도구 결과를 메시지 상세 뷰에서 탭 UI 로 렌더.
// 4탭 구성: Claude / GPT / Gemini / 통합(synth 결과 = 메시지 최종 텍스트).
// 각 탭에는 draft 원본·모델명·latency·usage 배지, 하단에 "이 draft 를 최종본으로 채택"
// 버튼(선택적, prop 으로 콜백 주입).

import React, { useState } from "react"

export type EnsembleDraft = {
  provider: "openai" | "claude" | "gemini" | string
  model: string
  ok: boolean
  draft: string
  latency_ms?: number
  usage?: any
  error?: string | null
}

export type EnsembleCompareData = {
  drafts: EnsembleDraft[]
  synthesized?: string // 에이전트가 최종 종합한 결과 (= 메시지 본문 텍스트)
  instruction_preview?: string
  total_latency_ms?: number
  critique?: {
    critic_provider?: string
    critic_model?: string
    draft_provider?: string
    critique?: string
  }
}

type Props = {
  data: EnsembleCompareData
  onAdoptDraft?: (draft: EnsembleDraft) => void
}

const PROVIDER_LABEL: Record<string, string> = {
  openai: "GPT-5.4-pro",
  claude: "Claude Sonnet 4.6",
  gemini: "Gemini 3.1 Pro Ultra",
}

const PROVIDER_COLOR: Record<string, string> = {
  openai: "#10a37f",
  claude: "#d97757",
  gemini: "#4285f4",
}

function fmtLatency(ms?: number): string {
  if (typeof ms !== "number" || !isFinite(ms)) return "-"
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function fmtUsage(u: any): string {
  if (!u || typeof u !== "object") return ""
  const inT = u.input_tokens ?? u.prompt_tokens
  const outT = u.output_tokens ?? u.completion_tokens
  if (typeof inT === "number" && typeof outT === "number") {
    return `in ${inT} / out ${outT}`
  }
  if (typeof u.total_tokens === "number") return `total ${u.total_tokens}`
  return ""
}

export default function EnsembleCompareView({ data, onAdoptDraft }: Props) {
  const drafts = Array.isArray(data?.drafts) ? data.drafts : []
  const hasSynth = typeof data?.synthesized === "string" && data.synthesized.trim().length > 0
  const hasCritique = Boolean(data?.critique?.critique)

  // 기본 탭 = 통합(synth) 있으면 그거, 없으면 첫 draft
  const tabs = [
    ...(hasSynth ? [{ id: "synth" as const, label: "통합 답변", color: "#333" }] : []),
    ...drafts.map((d) => ({
      id: `draft:${d.provider}` as const,
      label: PROVIDER_LABEL[d.provider] ?? d.provider,
      color: PROVIDER_COLOR[d.provider] ?? "#666",
    })),
    ...(hasCritique ? [{ id: "critique" as const, label: "비평", color: "#9b2c2c" }] : []),
  ]
  const [active, setActive] = useState<string>(tabs[0]?.id ?? "synth")

  if (tabs.length === 0) return null

  const activeDraft = active.startsWith("draft:")
    ? drafts.find((d) => `draft:${d.provider}` === active)
    : null

  return (
    <div
      style={{
        margin: "12px 0",
        border: "1px solid rgba(120, 140, 170, 0.22)",
        borderRadius: 12,
        background: "#ffffff",
        overflow: "hidden",
      }}
      aria-label="병렬 앙상블 비교"
    >
      {/* 헤더 탭 */}
      <div
        role="tablist"
        style={{
          display: "flex",
          borderBottom: "1px solid rgba(120, 140, 170, 0.18)",
          background: "rgba(248, 250, 253, 0.9)",
          overflowX: "auto",
        }}
      >
        {tabs.map((t) => {
          const isActive = active === t.id
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(t.id)}
              style={{
                padding: "9px 14px",
                border: "none",
                background: isActive ? "#ffffff" : "transparent",
                borderBottom: isActive ? `2px solid ${t.color}` : "2px solid transparent",
                color: isActive ? t.color : "#5a6a80",
                fontWeight: isActive ? 700 : 500,
                fontSize: 13,
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "background 0.15s",
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* 본문 */}
      <div style={{ padding: "12px 16px" }}>
        {active === "synth" && hasSynth && (
          <div>
            <div style={{ fontSize: 11, color: "#7a8798", marginBottom: 6 }}>
              Claude 에이전트가 3-AI 초안을 비교·비평·종합한 최종 답변
              {typeof data.total_latency_ms === "number" && (
                <span style={{ marginLeft: 8 }}>전체 {fmtLatency(data.total_latency_ms)}</span>
              )}
            </div>
            <div
              style={{
                whiteSpace: "pre-wrap",
                fontSize: 14,
                lineHeight: 1.6,
                color: "#222",
              }}
            >
              {data.synthesized}
            </div>
          </div>
        )}

        {activeDraft && (
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                marginBottom: 8,
                fontSize: 11,
                color: "#7a8798",
              }}
            >
              <span
                style={{
                  background: PROVIDER_COLOR[activeDraft.provider] ?? "#666",
                  color: "#fff",
                  padding: "2px 8px",
                  borderRadius: 10,
                  fontWeight: 600,
                  fontSize: 10,
                  letterSpacing: 0.3,
                }}
              >
                {activeDraft.model}
              </span>
              <span>{fmtLatency(activeDraft.latency_ms)}</span>
              {fmtUsage(activeDraft.usage) && <span>{fmtUsage(activeDraft.usage)}</span>}
              {!activeDraft.ok && (
                <span style={{ color: "#b03838", fontWeight: 600 }}>
                  실패: {activeDraft.error ?? "unknown"}
                </span>
              )}
              {onAdoptDraft && activeDraft.ok && (
                <button
                  type="button"
                  onClick={() => onAdoptDraft(activeDraft)}
                  style={{
                    marginLeft: "auto",
                    padding: "4px 10px",
                    border: "1px solid rgba(120, 140, 170, 0.3)",
                    borderRadius: 6,
                    background: "#f6f8fc",
                    color: "#333",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  이 draft 를 최종본으로 채택
                </button>
              )}
            </div>
            <div
              style={{
                whiteSpace: "pre-wrap",
                fontSize: 13,
                lineHeight: 1.6,
                color: "#2a2a2a",
                background: "rgba(248, 250, 253, 0.6)",
                borderRadius: 8,
                padding: "10px 12px",
                border: "1px solid rgba(120, 140, 170, 0.12)",
                maxHeight: 520,
                overflowY: "auto",
              }}
            >
              {activeDraft.draft || "(빈 응답)"}
            </div>
          </div>
        )}

        {active === "critique" && hasCritique && (
          <div>
            <div
              style={{
                fontSize: 11,
                color: "#7a8798",
                marginBottom: 6,
              }}
            >
              비평자: <b>{data.critique?.critic_model ?? data.critique?.critic_provider}</b>{" "}
              / 대상 draft: <b>{data.critique?.draft_provider}</b>
            </div>
            <div
              style={{
                whiteSpace: "pre-wrap",
                fontSize: 13,
                lineHeight: 1.6,
                color: "#5a1d1d",
                background: "rgba(253, 246, 246, 0.8)",
                borderRadius: 8,
                padding: "10px 12px",
                border: "1px solid rgba(180, 80, 80, 0.18)",
                maxHeight: 520,
                overflowY: "auto",
              }}
            >
              {data.critique?.critique}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
