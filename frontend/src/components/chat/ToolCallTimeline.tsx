// ToolCallTimeline.tsx — 에이전트 루프 도구 호출 실시간 타임라인
//
// 서버가 SSE 로 보내는 tool_call 이벤트를 수신해 메시지 상단 또는 내부에
// 타임라인 형태로 표시한다. 호출 순서, 도구 이름, 상태(성공/실패), latency,
// 요약을 한 줄씩 보여준다. 최종 답변이 나오기 전 실시간 피드백 역할.

import React from "react"

export type ToolCallTimelineEntry = {
  tool_name: string
  ok: boolean
  latency_ms?: number
  summary?: string
  error?: string | null
  started_at?: number
}

type Props = {
  entries: ToolCallTimelineEntry[]
  compact?: boolean
}

function iconFor(tool: string): string {
  if (tool.startsWith("perplexity")) return "🔍"
  if (tool === "web_fetch" || tool.startsWith("web_fetch")) return "🌐"
  if (tool.startsWith("read_attachment")) return "📎"
  if (tool === "promote_to_source" || tool.startsWith("promote_to_source")) return "📌"
  if (tool.startsWith("recall_")) return "🧠"
  if (tool.startsWith("parallel_ensemble")) return "⚡"
  if (tool.startsWith("adversarial_critique")) return "⚔️"
  if (tool.includes("draft")) return "✏️"
  if (tool.includes("regulation") || tool.includes("legal")) return "⚖️"
  if (tool.includes("food") || tool.includes("ecig") || tool.includes("cosmetic")) return "🏷️"
  if (tool.includes("finance") || tool.includes("market") || tool.includes("business")) return "📈"
  if (tool === "generate_video" || tool.includes("video_generate") || tool.includes("video")) return "🎬"
  if (tool === "generate_image" || tool.includes("image_generate") || tool.includes("image")) return "🎨"
  if (tool.includes("slide")) return "📊"
  return "🔧"
}

function fmtLatency(ms?: number): string {
  if (typeof ms !== "number" || !isFinite(ms)) return ""
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export default function ToolCallTimeline({ entries, compact = false }: Props) {
  if (!entries || entries.length === 0) return null

  return (
    <div
      style={{
        margin: compact ? "4px 0" : "8px 0 12px",
        padding: compact ? "6px 10px" : "10px 14px",
        background: "rgba(240, 244, 250, 0.72)",
        border: "1px solid rgba(150, 170, 200, 0.28)",
        borderRadius: 10,
        fontSize: compact ? 12 : 13,
        lineHeight: 1.5,
        color: "#333",
      }}
      aria-label="도구 호출 타임라인"
    >
      <div
        style={{
          fontSize: compact ? 11 : 12,
          fontWeight: 600,
          color: "#5a6a80",
          marginBottom: compact ? 4 : 6,
          letterSpacing: 0.3,
        }}
      >
        에이전트 도구 호출 ({entries.length})
      </div>
      <ol
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: compact ? 2 : 4,
        }}
      >
        {entries.map((e, i) => {
          const ok = e.ok !== false && !e.error
          return (
            <li
              key={`${e.tool_name}-${i}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: compact ? "2px 0" : "3px 0",
                borderTop: i === 0 ? "none" : "1px dashed rgba(150, 170, 200, 0.18)",
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "inline-flex",
                  width: 20,
                  justifyContent: "center",
                  fontSize: compact ? 13 : 14,
                  flexShrink: 0,
                }}
              >
                {iconFor(e.tool_name)}
              </span>
              <span
                style={{
                  fontFamily:
                    'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                  fontWeight: 600,
                  color: ok ? "#2b5fbe" : "#b03838",
                  flexShrink: 0,
                }}
              >
                {e.tool_name}
              </span>
              {typeof e.latency_ms === "number" && (
                <span style={{ color: "#7a8798", flexShrink: 0 }}>
                  {fmtLatency(e.latency_ms)}
                </span>
              )}
              <span
                style={{
                  color: ok ? "#4a5a70" : "#a04040",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                  minWidth: 0,
                }}
                title={e.summary ?? e.error ?? ""}
              >
                {ok ? e.summary ?? "" : e.error ?? "실패"}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
