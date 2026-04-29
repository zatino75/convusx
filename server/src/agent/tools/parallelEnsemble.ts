// parallelEnsemble.ts — 3-AI 병렬 드래프트 + 분석 도구
//
// 고가치 경로에서 Claude 에이전트 루프가 한 번에 Claude / GPT / Gemini 세 모델의
// 독립 초안을 받아 비교·종합할 때 호출한다. 각 모델은 완전히 동일한 instruction 을
// 받지만 내부 시스템 프롬프트·모델 특성 차이로 서로 다른 답을 생성한다.
//
// 중요: "원본 파일은 각 모델에 직접 전달" 한다 (CLAUDE.md 원칙). 첨부파일이 있으면
// Claude 에이전트가 요약해서 넘기지 말고 attachment_text 로 원본 텍스트 그대로 전달할 것.
//
// 반환: 3개 draft 전체 + 메타(latency·usage) + summary.
// 분석(공통/상충/고유) 은 Claude 에이전트가 반환된 draft 를 보고 직접 수행한다.

import { registerTool, type ToolResult } from "../toolRegistry.js"
import { openaiAdapter } from "../../adapters/openai.js"
import { claudeAdapter } from "../../adapters/claude.js"
import { geminiAdapter, GEMINI_MODEL_ID } from "../../adapters/gemini.js"
import { CLAUDE_MODEL_ID, OPENAI_MODEL_ID } from "../../adapters/wrappers.js"
import { logger } from "../../observability/logger.js"

// 2026-04-29: 정적 박제 제거 (CLAUDE.md #20/#25). Opus 호출 가능성 차단 + 단일 출처.
const MODELS = {
  openai: OPENAI_MODEL_ID,
  claude: CLAUDE_MODEL_ID,
  gemini: GEMINI_MODEL_ID,
} as const

const DEFAULT_MAX_TOKENS = 6000
const ENSEMBLE_TIMEOUT_MS = 180_000

function safeString(value: any): string {
  return String(value ?? "").trim()
}

function buildMessages(params: {
  instruction: string
  context?: string
  attachmentText?: string
  provider: "openai" | "claude" | "gemini"
}) {
  const sys = [
    "You are one of multiple independent drafters in CORVUS X workspace.",
    "Other parallel drafters will produce their own drafts in parallel — you do not see theirs.",
    "A synthesizing agent will then compare all drafts and pick or merge the best.",
    "Write substantive, directly-useful content. Do NOT reference 'the other models' or 'my draft' — just answer the task.",
    "No boilerplate, no hedging, no meta-commentary. Use Korean (존댓말) unless the user wrote in another language.",
  ].join(" ")

  const parts: string[] = []
  parts.push(`# Task\n${params.instruction}`)
  if (safeString(params.context)) {
    parts.push(`# Prior context\n${safeString(params.context)}`)
  }
  if (safeString(params.attachmentText)) {
    parts.push(`# Attached file (original text)\n${safeString(params.attachmentText)}`)
  }

  return [
    { role: "system" as const, content: sys },
    { role: "user" as const, content: parts.join("\n\n") },
  ]
}

type DraftOutcome = {
  provider: "openai" | "claude" | "gemini"
  model: string
  ok: boolean
  draft: string
  usage: any
  latency_ms: number
  error?: string
}

async function runOne(
  provider: "openai" | "claude" | "gemini",
  instruction: string,
  context: string,
  attachmentText: string,
  maxTokens: number,
  thread_id: string,
  project_id: string,
): Promise<DraftOutcome> {
  const startedAt = Date.now()
  const messages = buildMessages({ instruction, context, attachmentText, provider })
  const model = MODELS[provider]

  try {
    const adapter =
      provider === "openai" ? openaiAdapter : provider === "claude" ? claudeAdapter : geminiAdapter
    const resp = await adapter.generate({
      provider,
      model,
      messages: messages as any,
      temperature: 0.3,
      max_tokens: maxTokens,
      timeout_ms: ENSEMBLE_TIMEOUT_MS,
      thread_id,
      project_id,
      force_pro: true,
    } as any)

    const latency = Date.now() - startedAt
    const text = safeString(resp?.answer)
    if (!text) {
      return {
        provider,
        model,
        ok: false,
        draft: "",
        usage: resp?.usage ?? null,
        latency_ms: latency,
        error: safeString(resp?.error?.message) || "empty_draft",
      }
    }

    return {
      provider,
      model: safeString(resp?.model) || model,
      ok: true,
      draft: text,
      usage: resp?.usage ?? null,
      latency_ms: latency,
    }
  } catch (error: any) {
    return {
      provider,
      model,
      ok: false,
      draft: "",
      usage: null,
      latency_ms: Date.now() - startedAt,
      error: safeString(error?.message) || "exception",
    }
  }
}

registerTool({
  name: "parallel_ensemble",
  description:
    "여러 LLM 프로바이더를 병렬 호출하여 독립 초안을 생성하고 종합합니다. " +
    "고가치 task (답변서·계약서·사업계획·리스크 분석·상품 개발·법규 검토·전략 수립·최종 검토) 에만 사용. " +
    "일상 대화·간단 질문에는 호출하지 말 것. " +
    "반환된 draft 들은 호출한 에이전트가 직접 비교·비평·종합한다. " +
    "첨부파일이 있다면 사용자 요약본이 아닌 read_attachment 결과의 원본 텍스트를 그대로 " +
    "attachment_text 에 넣어야 한다 (정보 손실 금지). 비용·지연이 크므로 신중히 사용.",
  input_schema: {
    type: "object",
    properties: {
      instruction: {
        type: "string",
        description: "세 모델 모두에게 동일하게 전달될 task 기술 (사용자 원문 + 필요한 배경을 자기완결적으로)",
      },
      context: {
        type: "string",
        description: "(선택) 과거 대화 맥락 / 회상 결과 — 세 모델 모두에 동일하게 주입됨",
      },
      attachment_text: {
        type: "string",
        description: "(선택) 첨부파일 원본 텍스트 — 요약하지 말고 그대로 넣을 것",
      },
      providers: {
        type: "array",
        items: { type: "string", enum: ["openai", "claude", "gemini"] },
        description: "(선택) 호출할 모델 집합. 기본은 세 모델 전부. 리소스 절감 위해 일부만 호출 가능.",
      },
      max_tokens: {
        type: "number",
        description: "각 draft 응답 상한 (기본 6000, 상한 12000)",
      },
    },
    required: ["instruction"],
  },
  cost_tier: "expensive",
  async handler(input, ctx): Promise<ToolResult> {
    const instruction = safeString(input?.instruction)
    if (!instruction) {
      return {
        ok: false,
        output_text: JSON.stringify({ ok: false, error: "instruction is required" }),
        error: "missing_instruction",
      }
    }

    const context = safeString(input?.context)
    const attachmentText = safeString(input?.attachment_text)

    const maxTokensRaw = Number(input?.max_tokens ?? DEFAULT_MAX_TOKENS)
    const maxTokens = Math.max(512, Math.min(12000, Number.isFinite(maxTokensRaw) ? maxTokensRaw : DEFAULT_MAX_TOKENS))

    const requested = Array.isArray(input?.providers) && input.providers.length > 0
      ? (input.providers as string[]).filter((p): p is "openai" | "claude" | "gemini" =>
          p === "openai" || p === "claude" || p === "gemini",
        )
      : (["openai", "claude", "gemini"] as const)

    const uniqueProviders = Array.from(new Set(requested)) as ("openai" | "claude" | "gemini")[]
    if (uniqueProviders.length === 0) {
      return {
        ok: false,
        output_text: JSON.stringify({ ok: false, error: "no valid providers" }),
        error: "no_providers",
      }
    }

    const startedAt = Date.now()
    const outcomes = await Promise.all(
      uniqueProviders.map((p) =>
        runOne(p, instruction, context, attachmentText, maxTokens, ctx.thread_id, ctx.project_id),
      ),
    )
    const totalLatency = Date.now() - startedAt

    const successCount = outcomes.filter((o) => o.ok).length
    const failed = outcomes.filter((o) => !o.ok).map((o) => `${o.provider}:${o.error}`)

    if (successCount === 0) {
      logger.warn("[parallel_ensemble] all providers failed", { failed })
      return {
        ok: false,
        output_text: JSON.stringify({
          ok: false,
          error: "all_providers_failed",
          failed,
          outcomes,
        }),
        error: "all_providers_failed",
      }
    }

    return {
      ok: true,
      output_text: JSON.stringify({
        ok: true,
        success_count: successCount,
        total_providers: uniqueProviders.length,
        total_latency_ms: totalLatency,
        drafts: outcomes.map((o) => ({
          provider: o.provider,
          model: o.model,
          ok: o.ok,
          draft: o.draft,
          latency_ms: o.latency_ms,
          usage: o.usage,
          error: o.error ?? null,
        })),
        instruction_preview: instruction.slice(0, 200),
      }),
      summary: `parallel_ensemble ${successCount}/${uniqueProviders.length} ok (${totalLatency}ms)`,
    }
  },
})
