/**
 * CORVUS X — Built-in Logging Enhancer Plugin
 *
 * 채팅 요청/응답 흐름을 구조화된 로그로 기록.
 * Hook: beforeChat, afterChat, onError
 */

import { logger } from "../../observability/logger.js"
import type { PluginManifest, HookHandler, HookName } from "../pluginManager.js"

export const loggingPluginManifest: PluginManifest = {
  id: "corvus-builtin-logging",
  name: "Logging Enhancer",
  version: "1.0.0",
  description: "채팅 요청/응답 흐름을 구조화된 로그로 기록하는 내장 플러그인",
  author: "CORVUS X",
  hooks: ["beforeChat", "afterChat", "onError"] as HookName[],
}

const beforeChat: HookHandler = (context) => {
  const { data } = context
  const message = typeof data.message === "string" ? data.message.slice(0, 80) : ""
  const provider = String(data.provider ?? "unknown")
  const threadId = String(data.thread_id ?? "")

  logger.info("[Plugin:Logging] beforeChat", {
    provider,
    thread_id: threadId,
    message_preview: message + (message.length >= 80 ? "..." : ""),
    timestamp: new Date().toISOString(),
  })

  return context
}

const afterChat: HookHandler = (context) => {
  const { data } = context
  const provider = String(data.provider ?? "unknown")
  const latencyMs = typeof data.latency_ms === "number" ? data.latency_ms : 0
  const answerLength = typeof data.answer === "string" ? data.answer.length : 0
  const model = String(data.model ?? "unknown")

  logger.info("[Plugin:Logging] afterChat", {
    provider,
    model,
    latency_ms: latencyMs,
    answer_length: answerLength,
    timestamp: new Date().toISOString(),
  })

  return context
}

const onError: HookHandler = (context) => {
  const { data } = context
  const provider = String(data.provider ?? "unknown")
  const errorCode = String(data.error_code ?? "unknown")
  const errorMessage = String(data.error_message ?? "")

  logger.warn("[Plugin:Logging] onError", {
    provider,
    error_code: errorCode,
    error_message: errorMessage.slice(0, 200),
    timestamp: new Date().toISOString(),
  })

  return context
}

export const loggingPluginHandlers: Partial<Record<HookName, HookHandler>> = {
  beforeChat,
  afterChat,
  onError,
}
