// gptDraft.ts — OpenAI 어댑터 기반 독립 드래프트 도구
//
// 고가치 task 에서 에이전트 루프가 "다른 관점의 초안" 또는
// "독립적인 비평자" 가 필요할 때 호출한다. parallelEnsemble 도구에서
// 내부적으로도 이 도구를 재사용할 수 있도록 설계.
// 모델 ID 는 wrappers.OPENAI_MODEL_ID 단일 출처 (CLAUDE.md #25).

import { registerTool, type ToolResult } from "../toolRegistry.js"
import { openaiAdapter } from "../../adapters/openai.js"
import { OPENAI_MODEL_ID } from "../../adapters/wrappers.js"
import { logger } from "../../observability/logger.js"

const DEFAULT_MODEL = OPENAI_MODEL_ID
const DEFAULT_MAX_TOKENS = 6000
const DRAFT_TIMEOUT_MS = 120_000

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
      "You are NOT the user-facing final answer — you are producing a high-quality draft",
      "that another agent will consume, critique, and synthesize.",
      "Write substantive, directly-useful content. No boilerplate, no hedging, no meta-commentary.",
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
  name: "gpt_draft",
  description:
    "OpenAI 어댑터로 독립 초안을 생성합니다. " +
    "병렬 앙상블 경로에서 또는 단독 에이전트 루프 중 '다른 모델 관점이 필요하다' 고 " +
    "판단될 때 호출. 사용자에게 직접 보여질 최종 답변이 아니라, 호출한 에이전트가 종합·비평·채택할 " +
    "재료로 쓰인다. instruction 은 task 를 자기완결적으로 기술해야 한다(사용자 원문 그대로 전달 권장). " +
    "context 로 과거 맥락을, attachment_text 로 첨부파일 텍스트 일부를 주입할 수 있다. " +
    "비용·지연이 적지 않으므로 일상 대화에는 호출하지 말 것.",
  input_schema: {
    type: "object",
    properties: {
      instruction: {
        type: "string",
        description: "수행할 task 를 자기완결적으로 기술한 텍스트 (사용자 원문을 그대로 넣어도 됨)",
      },
      context: {
        type: "string",
        description: "(선택) 과거 맥락 / 이전 턴 요약 / 회상 결과 등",
      },
      attachment_text: {
        type: "string",
        description: "(선택) 첨부파일의 텍스트 일부 — read_attachment 결과를 그대로 넣어도 됨",
      },
      system_override: {
        type: "string",
        description: "(선택) 시스템 프롬프트 덮어쓰기",
      },
      max_tokens: {
        type: "number",
        description: "응답 상한 (기본 6000, 상한 12000)",
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
    const maxTokens = Math.max(512, Math.min(12000, Number.isFinite(maxTokensRaw) ? maxTokensRaw : DEFAULT_MAX_TOKENS))

    const messages = buildMessages({
      instruction,
      context: safeString(input?.context),
      attachmentText: safeString(input?.attachment_text),
      system: safeString(input?.system_override),
    })

    const startedAt = Date.now()
    try {
      const resp = await openaiAdapter.generate({
        provider: "openai",
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
          output_text: JSON.stringify({ ok: false, provider: "openai", model: DEFAULT_MODEL, error: errMsg }),
          error: errMsg,
        }
      }

      return {
        ok: true,
        output_text: JSON.stringify({
          ok: true,
          provider: "openai",
          model: resp?.model ?? DEFAULT_MODEL,
          draft: text,
          usage: resp?.usage ?? null,
          latency_ms: latency,
        }),
        summary: `gpt_draft ${resp?.model ?? DEFAULT_MODEL} ${text.length} chars (${latency}ms)`,
      }
    } catch (error: any) {
      const msg = safeString(error?.message) || "gpt_draft_exception"
      logger.warn("[gpt_draft] failed", { error: msg })
      return {
        ok: false,
        output_text: JSON.stringify({ ok: false, provider: "openai", model: DEFAULT_MODEL, error: msg }),
        error: msg,
      }
    }
  },
})
