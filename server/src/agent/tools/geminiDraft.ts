// geminiDraft.ts — Gemini 3.1 Pro Ultra 드래프트 생성 도구
//
// 2M context 활용 — 장문 / 대용량 PDF / 프로젝트 전체 맥락 주입 시 유일한
// 선택지. parallelEnsemble 에서 "장문 관점" 으로 자동 편입.

import { registerTool, type ToolResult } from "../toolRegistry.js"
import { geminiAdapter } from "../../adapters/gemini.js"
import { logger } from "../../observability/logger.js"

const DEFAULT_MODEL = "gemini-3.1-pro-ultra"
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
      "You are Gemini 3.1 Pro Ultra acting as an independent long-form drafter in CORVUS X.",
      "Your 2M context lets you absorb the full project memory, prior threads, and attachments.",
      "Produce a substantive, directly-useful draft — not a summary, not boilerplate.",
      "Another agent (Claude Opus 4.6) will critique and synthesize. Write as if that review is certain.",
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
  name: "gemini_draft",
  description:
    "Gemini 3.1 Pro Ultra 를 호출해 현재 task 에 대한 장문·대용량 맥락 기반 초안(draft) 을 생성한다. " +
    "장문 문서 / 대용량 PDF / 프로젝트 전체 스레드 맥락이 필요한 task 에 특히 강하다. " +
    "병렬 앙상블 경로에서 Claude/GPT 와 함께 3-AI draft 로 편성된다. " +
    "사용자에게 직접 보여질 최종 답변이 아니라, Claude 가 종합·비평·채택할 재료로 쓰인다. " +
    "비용·지연이 적지 않으므로 일상 대화에는 호출하지 말 것.",
  input_schema: {
    type: "object",
    properties: {
      instruction: {
        type: "string",
        description: "수행할 task 를 자기완결적으로 기술한 텍스트",
      },
      context: {
        type: "string",
        description: "(선택) 과거 맥락 / 프로젝트 메모리 / 이전 스레드 요약",
      },
      attachment_text: {
        type: "string",
        description: "(선택) 첨부파일 텍스트 — Gemini 는 대용량 입력에 강하므로 그대로 주입해도 됨",
      },
      system_override: {
        type: "string",
        description: "(선택) 시스템 프롬프트 덮어쓰기",
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
      const resp = await geminiAdapter.generate({
        provider: "gemini",
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
          output_text: JSON.stringify({ ok: false, provider: "gemini", model: DEFAULT_MODEL, error: errMsg }),
          error: errMsg,
        }
      }

      return {
        ok: true,
        output_text: JSON.stringify({
          ok: true,
          provider: "gemini",
          model: resp?.model ?? DEFAULT_MODEL,
          draft: text,
          usage: resp?.usage ?? null,
          latency_ms: latency,
        }),
        summary: `gemini_draft ${resp?.model ?? DEFAULT_MODEL} ${text.length} chars (${latency}ms)`,
      }
    } catch (error: any) {
      const msg = safeString(error?.message) || "gemini_draft_exception"
      logger.warn("[gemini_draft] failed", { error: msg })
      return {
        ok: false,
        output_text: JSON.stringify({ ok: false, provider: "gemini", model: DEFAULT_MODEL, error: msg }),
        error: msg,
      }
    }
  },
})
