// Structured JSON logger
// Replaces console.log with structured logging for observability
// Correlation ID 자동 삽입 지원

import { getCorrelationId } from "../http/correlationId.js"

type LogLevel = "debug" | "info" | "warn" | "error"

interface LogEntry {
  level: LogLevel
  msg: string
  timestamp: string
  correlation_id?: string
  [key: string]: any
}

function formatEntry(level: LogLevel, msg: string, data?: Record<string, any>): string {
  const correlationId = getCorrelationId()
  const entry: LogEntry = {
    level,
    msg,
    timestamp: new Date().toISOString(),
    ...(correlationId !== "unknown" ? { correlation_id: correlationId } : {}),
    ...data
  }
  return JSON.stringify(entry)
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
}

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? "info"

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLevel]
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeLogArgs(
  arg1: string | Record<string, any>,
  arg2?: unknown,
): { msg: string; data?: Record<string, any> } {
  if (typeof arg1 === "string") {
    return { msg: arg1, data: isRecord(arg2) ? arg2 : undefined }
  }
  if (typeof arg2 === "string") {
    return { msg: arg2, data: arg1 }
  }
  return { msg: "log", data: arg1 }
}

export const logger = {
  debug(arg1: string | Record<string, any>, arg2?: unknown) {
    const { msg, data } = normalizeLogArgs(arg1, arg2)
    if (shouldLog("debug")) console.log(formatEntry("debug", msg, data))
  },
  info(arg1: string | Record<string, any>, arg2?: unknown) {
    const { msg, data } = normalizeLogArgs(arg1, arg2)
    if (shouldLog("info")) console.log(formatEntry("info", msg, data))
  },
  warn(arg1: string | Record<string, any>, arg2?: unknown) {
    const { msg, data } = normalizeLogArgs(arg1, arg2)
    if (shouldLog("warn")) console.warn(formatEntry("warn", msg, data))
  },
  error(arg1: string | Record<string, any>, arg2?: unknown) {
    const { msg, data } = normalizeLogArgs(arg1, arg2)
    if (shouldLog("error")) console.error(formatEntry("error", msg, data))
  }
}
