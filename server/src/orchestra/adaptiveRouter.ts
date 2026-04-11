// adaptiveRouter.ts — DEPRECATED stub (Phase 4)
export type AdaptiveTask = string
export type CodeSubtask = string
export type ExecutionStrategy = string
export type AdaptiveRouteDecision = {
  task: string
  providers: string[]
  selected_providers: string[]
  verifier_providers: string[]
  optional_providers: string[]
  strategy: string
  router_policy: string
  high_value: boolean
  requires_ensemble: boolean
  requires_critique: boolean
}
export function resolveAdaptiveRoute(_: any): AdaptiveRouteDecision {
  return {
    task: "dialogue", providers: ["claude"], selected_providers: ["claude"],
    verifier_providers: [], optional_providers: [],
    strategy: "single", router_policy: "default",
    high_value: false, requires_ensemble: false, requires_critique: false,
  }
}
