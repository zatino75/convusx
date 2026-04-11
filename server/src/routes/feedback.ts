// NOTE (2026-04-11): scoreboard/adaptiveRouter 폐기 — feedback 은 tool_call_log 기반
// 단순 JSONL 파일에 피드백을 append 하고, 에이전트 루프 system prompt 힌트로 반영한다.
import fs from "node:fs"
import path from "node:path"
import { logger } from "../observability/logger.js"
import { validateBody, feedbackRules, sanitizeProvider, sanitizeString } from "../http/validation.js"

const FEEDBACK_LOG = path.resolve(process.cwd(), "server", "data", "feedback.jsonl")

function appendFeedbackLog(entry: Record<string, unknown>) {
  try {
    const dir = path.dirname(FEEDBACK_LOG)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(FEEDBACK_LOG, JSON.stringify(entry) + "\n", "utf-8")
  } catch { /* 로그 실패는 무시 — 메인 응답 막으면 안 됨 */ }
}

export function readFeedbackLog(): Record<string, unknown>[] {
  try {
    if (!fs.existsSync(FEEDBACK_LOG)) return []
    return fs.readFileSync(FEEDBACK_LOG, "utf-8")
      .split("\n").filter(Boolean)
      .map((line) => JSON.parse(line))
  } catch { return [] }
}

type RouteRequest = { body?: any }
type RouteResponse = {
  json?: (data: any) => void
  status?: (code: number) => RouteResponse
}

export async function runFeedbackRoute(req: RouteRequest, res: RouteResponse) {
  const body = req?.body ?? {}

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
    // tool_call_log 기반 피드백 — JSONL 에 append
    appendFeedbackLog({
      timestamp: new Date().toISOString(),
      feedback,          // "up" | "down"
      provider,
      runner_up: runnerUp || null,
      task,
      message_id: messageId || null,
    })

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
