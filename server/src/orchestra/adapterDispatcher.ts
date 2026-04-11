// adapterDispatcher.ts — DEPRECATED (Phase 4 orchestra deletion)
import { logger } from "../observability/logger.js"
export async function dispatchProvider(_: any): Promise<any> {
  logger.warn("[adapterDispatcher] stub called — use agentLoopBridge instead")
  return { ok: false, error: "deprecated" }
}
export const runAdapter = dispatchProvider
export const dispatchAdapter = dispatchProvider
export const executeAdapter = dispatchProvider
