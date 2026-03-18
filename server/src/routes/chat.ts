import { executeOrchestra } from "../orchestra/runtime.js"

type RouteRequest = {
  body?: any
}

type RouteResponse = {
  json: (payload: unknown) => unknown
}

function buildDerived(result: any) {
  const routerDecision = result?.router_decision ?? {}
  const finalAnswer = result?.final_answer ?? {}
  const winnerSnapshot = finalAnswer?.winner_snapshot ?? {}
  const runnerUpSnapshot = finalAnswer?.runner_up_snapshot ?? {}

  return {
    detected_task:
      result?.planner_plan?.task ??
      result?.judge_trace?.task ??
      routerDecision?.task ??
      null,
    execution_strategy: routerDecision?.execution_strategy ?? null,
    selected_providers: Array.isArray(routerDecision?.selected_providers) ? routerDecision.selected_providers : [],
    verifier_providers: Array.isArray(routerDecision?.verifier_providers) ? routerDecision.verifier_providers : [],
    provider_chain: Array.isArray(result?.provider_chain) ? result.provider_chain : [],
    winner: winnerSnapshot?.provider ?? result?.winner_provider ?? null,
    runner_up: runnerUpSnapshot?.provider ?? null,
    conflict_count: typeof result?.conflict_count === "number" ? result.conflict_count : 0
  }
}

export async function runChatRoute(req: RouteRequest, res: RouteResponse) {
  const input = req?.body ?? {}

  try {
    const result = await executeOrchestra({
      ...input,
      mode: input?.mode ?? "runtime_orchestra",
      thread_id: input?.thread_id ?? "chat_thread",
      project_id: input?.project_id ?? "chat_project"
    })

    return res.json({
      ok: true,
      derived: buildDerived(result),
      result
    })
  } catch (error: any) {
    return res.json({
      ok: false,
      error: String(error?.message ?? "unknown_error")
    })
  }
}

export const chatRoute = {
  path: "/api/chat",
  handler: runChatRoute
}
