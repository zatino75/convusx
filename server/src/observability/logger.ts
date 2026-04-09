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

export const logger = {
  debug(msg: string, data?: Record<string, any>) {
    if (shouldLog("debug")) console.log(formatEntry("debug", msg, data))
  },
  info(msg: string, data?: Record<string, any>) {
    if (shouldLog("info")) console.log(formatEntry("info", msg, data))
  },
  warn(msg: string, data?: Record<string, any>) {
    if (shouldLog("warn")) console.warn(formatEntry("warn", msg, data))
  },
  error(msg: string, data?: Record<string, any>) {
    if (shouldLog("error")) console.error(formatEntry("error", msg, data))
  }
}
