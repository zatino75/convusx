// claudeDraftAlt.ts — Claude (Anthropic) 어댑터 기반 독립 드래프트 도구
//
// 에이전트 루프의 Claude 와는 별도로 "도구 접근 없이, 독립 시스템 프롬프트 하에서
// 깨끗한 초안" 을 생성. 병렬 앙상블에서 Claude 라인을 담당 (GPT / Gemini 와 병렬).
// 모델 ID 는 wrappers.CLAUDE_MODEL_ID 단일 출처 (CLAUDE.md #25).

import { registerTool, type ToolResult } from "../toolRegistry.js"
import { claudeAdapter } from "../../adapters/claude.js"
import { CLAUDE_MODEL_ID } from "../../adapters/wrappers.js"
import { logger } from "../../observability/logger.js"

// 2026-04-29: Opus 박제 제거 (CLAUDE.md #20). Sonnet 단일 출처 사용.
const DEFAULT_MODEL = CLAUDE_MODEL_ID
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
      "You are an independent drafter inside the CORVUS X workspace.",
      "Generate a draft from a fresh angle. Your draft will be compared",
      "with other parallel drafts for ensemble synthesis.",
      "You are NOT the orchestrator agent — produce a clean, independent draft without tool use.",
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
    "Anthropic Claude 어댑터를 별도 컨텍스트(도구 비활성 + 독립 시스템 프롬프트)로 호출해 초안(draft)을 생성합니다. " +
    "에이전트 루프의 Claude 와는 다른 사고 경로를 얻기 위한 것 — 병렬 앙상블에서 Claude 라인을 " +
    "담당한다. 일반 대화에는 쓰지 말 것. 고가치 경로에서만 parallel_ensemble 이 내부적으로 호출하거나, " +
    "에이전트가 '다른 관점이 필요하다' 고 판단할 때 직접 호출.",
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
