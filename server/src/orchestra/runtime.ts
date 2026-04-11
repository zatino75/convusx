// runtime.ts — DEPRECATED (Phase 4 orchestra deletion)
// executeOrchestra \ub294 agentLoopBridge \ub85c \uc644\uc804 \ub300\uccb4\ub418\uc5c8\ub2e4.
import { logger } from "../observability/logger.js"

export type OrchestraEventType = string
export type OrchestraEvent = { type: string; [k: string]: any }
export type OrchestraEmitFn = (event: OrchestraEvent) => Promise<void>

export async function executeOrchestra(input: any, stream?: OrchestraEmitFn): Promise<any> {
  logger.warn("[orchestra/runtime] executeOrchestra called on stub — use agentLoopBridge instead")
  return {
    final_answer: { text: "[orchestra stub] \uc5d0\uc774\uc804\ud2b8 \ub8e8\ud504\ub97c \uc0ac\uc6a9\ud558\uc138\uc694. (CORVUS_USE_AGENT_LOOP=1)", ok: false },
    meta: { orchestration: {} },
    orchestration: {},
    bandit: {},
    derived: {},
    internal: {},
  }
}
