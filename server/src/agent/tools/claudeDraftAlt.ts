// claudeDraftAlt.ts — Claude Opus 4.6 독립 드래프트 도구
//
// 주의: 에이전트 루프 자체도 Claude Opus 4.6 이다. 이 도구는 "같은 모델이지만
// 도구 접근 없이, 별도 시스템 프롬프트 하에서 독립 초안을 생성" 하고 싶을 때 쓴다.
// 병렬 앙상블에서 Claude 라인을 담당 (GPT / Gemini 와 병렬).

import { registerTool, type ToolResult } from "../toolRegistry.js"
import { claudeAdapter } from "../../adapters/claude.js"
import { logger } from "../../observability/logger.js"

const DEFAULT_MODEL = "claude-opus-4-6"
const DEFAULT_MAX_TOKENS = 8000
const DRAFT_TIMEOUT_MS = 150_000

function safeString(value: any): string {
  return String(value ?? "").trim()
}

function buildMessages(params: {
  instruction: string
  context?: string
  attachmentText?: string
  system?: string
}) {
  const msgs: Array<{ role: "system" | "user" | "assistant"; content: any }> = []

  const sys =
    safeString(params.system) ||
    [
      "You are Claude Opus 4.6 acting as an independent drafter inside the CORVUS X workspace.",
      "You are NOT the orchestrator agent — you are producing a clean, independent draft",
      "without tool use, to be compared against GPT-5.4-pro and Gemini 3.1 Pro Ultra drafts.",
      "Write substantive, directly-useful content. No hedging, no boilerplate, no meta-commentary.",
      "Use Korean (존댓말) unless the user wrote in another language.",
    ].join(" ")
  msgs.push({ role: "system", content: sys })

  const parts: string[] = []
  parts.push(`# Task\n${params.instruction}`)
  if (safeString(params.context)) {
    parts.push(`# Prior context\n${safeString(params.context)}`)
  }
  if (safeString(params.attachmentText)) {
    parts.push(`# Attached file (text preview)\n${safeString(params.attachmentText)}`)
  }
  msgs.push({ role: "user", content: parts.join("\n\n") })

  return msgs
}

registerTool({
  name: "claude_draft_alt",
  description:
    "Claude Opus 4.6 를 별도 컨텍스트(도구 비활성 + 독립 시스템 프롬프트)로 호출해 초안(draft)을 생성한다. " +
    "에이전트 루프의 Claude 와는 다른 사고 경로를 얻기 위한 것 — 병렬 앙상블에서 Claude 라인을 " +
    "담당한다. 일반 대화에는 쓰지 말 것. 고가치 경로에서만 parallel_ensemble 이 내부적으로 호출하거나, " +
    "Claude 에이전트가 '다른 Claude 관점이 필요하다' 고 판단할 때 직접 호출.",
  input_schema: {
    type: "object",
    properties: {
      instruction: {
        type: "string",
        description: "수행할 task 를 자기완결적으로 기술한 텍스트",
      },
      context: {
        type: "string",
        description: "(선택) 과거 맥락",
      },
      attachment_text: {
        type: "string",
        description: "(선택) 첨부파일 텍스트 일부",
      },
      system_override: {
        type: "string",
        description: "(선택) 시스템 프롬프트 덮어쓰기 — 비평자 역할 등으로 전환할 때 사용",
      },
      max_tokens: {
        type: "number",
        description: "응답 상한 (기본 8000, 상한 16000)",
      },
    },
    required: ["instruction"],
  },
  cost_tier: "paid",
  async handler(input, ctx): Promise<ToolResult> {
    const instruction = safeString(input?.instruction)
    if (!instruction) {
      return {
        ok: false,
        output_text: JSON.stringify({ ok: false, error: "instruction is required" }),
        error: "missing_instruction",
      }
    }

    const maxTokensRaw = Number(input?.max_tokens ?? DEFAULT_MAX_TOKENS)
    const maxTokens = Math.max(512, Math.min(16000, Number.isFinite(maxTokensRaw) ? maxTokensRaw : DEFAULT_MAX_TOKENS))

    const messages = buildMessages({
      instruction,
      context: safeString(input?.context),
      attachmentText: safeString(input?.attachment_text),
      system: safeString(input?.system_override),
    })

    const startedAt = Date.now()
    try {
      const resp = await claudeAdapter.generate({
        provider: "claude",
        model: DEFAULT_MODEL,
        messages: messages as any,
        temperature: 0.3,
        max_tokens: maxTokens,
        timeout_ms: DRAFT_TIMEOUT_MS,
        thread_id: ctx.thread_id,
        project_id: ctx.project_id,
        force_pro: true,
      } as any)

      const latency = Date.now() - startedAt
      const text = safeString(resp?.answer)
      if (!text) {
        const errMsg = safeString(resp?.error?.message) || "empty_draft"
        return {
          ok: false,
          output_text: JSON.stringify({ ok: false, provider: "claude", model: DEFAULT_MODEL, error: errMsg }),
          error: errMsg,
        }
      }

      return {
        ok: true,
        output_text: JSON.stringify({
          ok: true,
          provider: "claude",
          model: resp?.model ?? DEFAULT_MODEL,
          draft: text,
          usage: resp?.usage ?? null,
          latency_ms: latency,
        }),
        summary: `claude_draft_alt ${resp?.model ?? DEFAULT_MODEL} ${text.length} chars (${latency}ms)`,
      }
    } catch (error: any) {
      const msg = safeString(error?.message) || "claude_draft_alt_exception"
      logger.warn("[claude_draft_alt] failed", { error: msg })
      return {
        ok: false,
        output_text: JSON.stringify({ ok: false, provider: "claude", model: DEFAULT_MODEL, error: msg }),
        error: msg,
      }
    }
  },
})
