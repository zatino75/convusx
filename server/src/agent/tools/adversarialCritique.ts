// adversarialCritique.ts — 적대적 비평 도구
//
// CLAUDE.md 원칙: "적대적 비평자는 draft 모델과 반드시 다른 모델".
// draft 원문 + draft 의 모델명을 받으면, 명시적으로 다른 모델을 선택해 호출한다.
// 비평자는 draft 를 옹호하지 않고, 오류·누락·논리적 허점·과장·outdated 정보를 찾는 역할.

import { registerTool, type ToolResult } from "../toolRegistry.js"
import { openaiAdapter } from "../../adapters/openai.js"
import { claudeAdapter } from "../../adapters/claude.js"
import { geminiAdapter, GEMINI_MODEL_ID } from "../../adapters/gemini.js"
import { logger } from "../../observability/logger.js"

// 2026-04-29: Opus 호출 가능성 제거 (CLAUDE.md #20). claude → sonnet, openai → gpt-5.
const MODEL_BY_PROVIDER = {
  openai: "gpt-5",
  claude: "claude-sonnet-4-6",
  gemini: GEMINI_MODEL_ID,
} as const

const DEFAULT_MAX_TOKENS = 3000
const CRITIQUE_TIMEOUT_MS = 120_000

function safeString(value: any): string {
  return String(value ?? "").trim()
}

/**
 * draft 를 만든 모델과 반드시 다른 모델을 선택.
 * 우선순위: claude → openai → gemini (draft 제공자가 앞선 모델이면 다음을 선택)
 */
function pickCritic(draftProvider: "openai" | "claude" | "gemini"): "openai" | "claude" | "gemini" {
  const order: Array<"openai" | "claude" | "gemini"> = ["claude", "openai", "gemini"]
  for (const p of order) {
    if (p !== draftProvider) return p
  }
  return "claude" // fallback (절대 도달 안 함)
}

function buildCritiqueMessages(params: {
  draftText: string
  draftProvider: string
  taskContext: string
  focus?: string
  critic: "openai" | "claude" | "gemini"
}) {
  const criticName =
    params.critic === "openai" ? "GPT (OpenAI)"
      : params.critic === "claude" ? "Claude (Sonnet)"
      : "Gemini"

  const sys = [
    `You are ${criticName} acting as an ADVERSARIAL CRITIC inside CORVUS X.`,
    `A draft was produced by ${params.draftProvider}. Your job is to find everything WRONG with it:`,
    "factual errors, outdated information, logical holes, unjustified claims, missing counter-evidence,",
    "overstated confidence, ignored edge cases, weak reasoning, superficial treatment of hard parts,",
    "inappropriate tone for the task, compliance/legal risks, and unmet user intent.",
    "Do NOT praise the draft. Do NOT rewrite it. Do NOT produce an alternative draft.",
    "Output format (Korean, 존댓말):",
    "## 치명적 문제 (critical)",
    "## 중요한 문제 (major)",
    "## 사소한 문제 (minor)",
    "## 놓친 관점 (missing angles)",
    "## 종합 판단",
    "각 항목은 번호 매긴 bullet 로 구체적 근거(draft 인용 또는 외부 사실)와 함께 제시. 근거 없는 트집은 금지.",
  ].join(" ")

  const userParts: string[] = []
  userParts.push(`# Task context\n${params.taskContext}`)
  if (safeString(params.focus)) {
    userParts.push(`# Focus areas\n${safeString(params.focus)}`)
  }
  userParts.push(`# Draft to critique (from ${params.draftProvider})\n<<<DRAFT_START\n${params.draftText}\nDRAFT_END>>>`)

  return [
    { role: "system" as const, content: sys },
    { role: "user" as const, content: userParts.join("\n\n") },
  ]
}

registerTool({
  name: "adversarial_critique",
  description:
    "draft 텍스트를 받아, draft 를 만든 모델과 반드시 다른 모델이 적대적 비평(치명/중요/사소/놓친 관점)을 " +
    "수행한다. 고가치 task 에서는 의무적으로 호출해야 한다. 예: Claude 가 draft 를 내면 OpenAI 또는 Gemini " +
    "로 비평, GPT draft 면 Claude 또는 Gemini 로 비평. task_context 에는 원래 task 요구사항을 요약해 전달. " +
    "focus 로 특정 관점(법규·재무·사실·논리) 을 강조할 수 있다. 비평자는 draft 를 옹호하거나 rewrite 하지 " +
    "않는다 — 약점만 지적한다.",
  input_schema: {
    type: "object",
    properties: {
      draft_text: {
        type: "string",
        description: "비평할 draft 원문",
      },
      draft_provider: {
        type: "string",
        enum: ["openai", "claude", "gemini"],
        description: "draft 를 만든 모델 제공자 — 이와 다른 모델이 자동 선택된다",
      },
      task_context: {
        type: "string",
        description: "원래 task 요구사항 / 사용자 의도 — 비평 기준이 된다",
      },
      focus: {
        type: "string",
        description: "(선택) 특히 검증할 관점 (예: '법규 위반 여부', '재무 숫자의 정합성', '출처 신뢰도')",
      },
      force_critic: {
        type: "string",
        enum: ["openai", "claude", "gemini"],
        description: "(선택) 강제 지정할 비평자. 지정되면 draft_provider 와 겹쳐도 사용하지만 경고 로깅됨.",
      },
      max_tokens: {
        type: "number",
        description: "비평 응답 상한 (기본 3000, 상한 6000)",
      },
    },
    required: ["draft_text", "draft_provider", "task_context"],
  },
  cost_tier: "paid",
  async handler(input, ctx): Promise<ToolResult> {
    const draftText = safeString(input?.draft_text)
    const draftProviderRaw = safeString(input?.draft_provider).toLowerCase()
    const taskContext = safeString(input?.task_context)

    if (!draftText) {
      return {
        ok: false,
        output_text: JSON.stringify({ ok: false, error: "draft_text is required" }),
        error: "missing_draft",
      }
    }
    if (draftProviderRaw !== "openai" && draftProviderRaw !== "claude" && draftProviderRaw !== "gemini") {
      return {
        ok: false,
        output_text: JSON.stringify({ ok: false, error: "draft_provider must be openai|claude|gemini" }),
        error: "invalid_provider",
      }
    }
    if (!taskContext) {
      return {
        ok: false,
        output_text: JSON.stringify({ ok: false, error: "task_context is required" }),
        error: "missing_context",
      }
    }

    const draftProvider = draftProviderRaw as "openai" | "claude" | "gemini"
    const forcedRaw = safeString(input?.force_critic).toLowerCase()
    const forced =
      forcedRaw === "openai" || forcedRaw === "claude" || forcedRaw === "gemini"
        ? (forcedRaw as "openai" | "claude" | "gemini")
        : null

    let critic: "openai" | "claude" | "gemini"
    if (forced) {
      critic = forced
      if (forced === draftProvider) {
        logger.warn("[adversarial_critique] forced critic matches draft provider — independence compromised", { forced })
      }
    } else {
      critic = pickCritic(draftProvider)
    }

    const maxTokensRaw = Number(input?.max_tokens ?? DEFAULT_MAX_TOKENS)
    const maxTokens = Math.max(512, Math.min(6000, Number.isFinite(maxTokensRaw) ? maxTokensRaw : DEFAULT_MAX_TOKENS))

    const messages = buildCritiqueMessages({
      draftText,
      draftProvider,
      taskContext,
      focus: safeString(input?.focus),
      critic,
    })

    const startedAt = Date.now()
    const adapter =
      critic === "openai" ? openaiAdapter : critic === "claude" ? claudeAdapter : geminiAdapter
    const criticModel = MODEL_BY_PROVIDER[critic]

    try {
      const resp = await adapter.generate({
        provider: critic,
        model: criticModel,
        messages: messages as any,
        temperature: 0.2,
        max_tokens: maxTokens,
        timeout_ms: CRITIQUE_TIMEOUT_MS,
        thread_id: ctx.thread_id,
        project_id: ctx.project_id,
        force_pro: true,
      } as any)

      const latency = Date.now() - startedAt
      const critique = safeString(resp?.answer)
      if (!critique) {
        return {
          ok: false,
          output_text: JSON.stringify({
            ok: false,
            critic_provider: critic,
            critic_model: criticModel,
            error: safeString(resp?.error?.message) || "empty_critique",
          }),
          error: "empty_critique",
        }
      }

      return {
        ok: true,
        output_text: JSON.stringify({
          ok: true,
          critic_provider: critic,
          critic_model: safeString(resp?.model) || criticModel,
          draft_provider: draftProvider,
          critique,
          latency_ms: latency,
          usage: resp?.usage ?? null,
        }),
        summary: `adversarial_critique ${draftProvider} → ${critic} (${critique.length} chars / ${latency}ms)`,
      }
    } catch (error: any) {
      const msg = safeString(error?.message) || "critique_exception"
      logger.warn("[adversarial_critique] failed", { error: msg })
      return {
        ok: false,
        output_text: JSON.stringify({ ok: false, critic_provider: critic, error: msg }),
        error: msg,
      }
    }
  },
})
