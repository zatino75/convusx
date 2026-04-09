import { recordProviderExecution, recordProviderConflict } from "../orchestra/scoreboard.js"
import { logger } from "../observability/logger.js"
import { validateBody, feedbackRules, sanitizeProvider, sanitizeString } from "../http/validation.js"

type RouteRequest = { body?: any }
type RouteResponse = {
  json?: (data: any) => void
  status?: (code: number) => RouteResponse
}

export async function runFeedbackRoute(req: RouteRequest, res: RouteResponse) {
  const body = req?.body ?? {}

  // 입력 검증
  const validation = validateBody(body, feedbackRules)
  if (!validation.ok) {
    res.status?.(400).json?.({ ok: false, error: validation.error })
    return
  }

  const feedback = sanitizeString(body?.feedback, 10)
  const provider = sanitizeProvider(body?.provider)
  const task = sanitizeString(body?.task ?? "dialogue", 50).toLowerCase()
  const messageId = sanitizeString(body?.message_id, 128)
  const runnerUp = sanitizeProvider(body?.runner_up)

  try {
    const isPositive = feedback === "up"

    if (isPositive) {
      // 👍 — winner provider 강하게 기록 (weight 1.5)
      recordProviderExecution(provider, {
        success: true,
        selected_as_final: true,
        effective: true,
        weight: 1.5,
        task,
        latency_ms: 0,
        estimated_cost_usd: 0,
        error_code: null
      })

      // 👍 — runner_up이 있으면 약하게 승점 (사용자가 winner를 선택했지만 runner_up도 참여했으므로)
      if (runnerUp && runnerUp !== provider) {
        recordProviderExecution(runnerUp, {
          success: true,
          selected_as_final: false,
          effective: true,
          weight: 0.3,
          task,
          latency_ms: 0,
          estimated_cost_usd: 0,
          error_code: null
        })
      }
    } else {
      // 👎 — 패배 기록 (weight 1.2 — 일반 실행보다 강하게 반영)
      recordProviderExecution(provider, {
        success: false,
        selected_as_final: false,
        effective: true,
        weight: 1.2,
        task,
        latency_ms: 0,
        estimated_cost_usd: 0,
        error_code: "user_negative_feedback"
      })

      // 👎 — conflict penalty 추가 (recommendation_conflict 유형)
      recordProviderConflict(provider, {
        context_conflicts: 0,
        provider_conflicts: 1,
        penalty: 0.4,
        weight: 1.2,
        task,
        conflict_types: [{ type: "recommendation_conflict", count: 1, weight: 0.4 }]
      })

      // 👎 — runner_up이 있으면 그쪽에 승점 부여 (더 나은 대안)
      if (runnerUp && runnerUp !== provider) {
        recordProviderExecution(runnerUp, {
          success: true,
          selected_as_final: true,
          effective: true,
          weight: 0.8,
          task,
          latency_ms: 0,
          estimated_cost_usd: 0,
          error_code: null
        })
      }
    }

    logger.info(`[FEEDBACK] ${feedback} → provider:${provider} runner_up:${runnerUp || "none"} task:${task} msg:${messageId}`)

    res.json?.({ ok: true, feedback, provider, task })
  } catch (e: any) {
    res.status?.(500).json?.({ ok: false, error: e?.message ?? "internal error" })
  }
}

export const feedbackRoutes = [
  {
    method: "post" as const,
    path: "/api/feedback",
    handler: runFeedbackRoute
  }
]
