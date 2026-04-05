import { buildFileAnalysisPrompt, detectFileTask, type AttachedFile } from "./fileHandlers.js"
import { buildVisionPrompt, isVisionAttachment } from "./visionHandlers.js"

export type OrchestrationPayload = {
  message: string
  thread_id: string
  project_id: string
  mode?: string
  attached_file?: AttachedFile
  [key: string]: any
}

export function normalizeOrchestrationPayload(input: any): OrchestrationPayload {
  return {
    ...input,
    message: String(input?.message ?? "").trim(),
    thread_id: String(input?.thread_id ?? "").trim(),
    project_id: String(input?.project_id ?? "").trim(),
    mode: String(input?.mode ?? "chat").trim(),
  }
}

export function classifyChatRequest(payload: OrchestrationPayload) {
  const file = payload?.attached_file
  if (file && isVisionAttachment(file)) {
    return buildVisionPrompt(file, payload.message)
  }
  if (file) {
    return buildFileAnalysisPrompt(file, payload.message)
  }
  return { task: "dialogue", prompt: payload.message }
}

export function buildOrchestrationContext(payload: OrchestrationPayload) {
  const fileTask = detectFileTask(payload?.attached_file)
  return {
    threadId: payload.thread_id,
    projectId: payload.project_id,
    mode: payload.mode,
    fileTask,
  }
}
