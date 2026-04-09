/**
 * CORVUS X — Application Performance Monitoring (D5)
 *
 * 자체 구현 경량 APM:
 *  - 요청 지연시간 추적 (p50, p95, p99)
 *  - 에러 집계 및 최근 에러 기록
 *  - Provider별 응답 시간 추적
 *  - 메모리/CPU 사용량 스냅샷
 *
 * 외부 서비스 (Sentry, Datadog 등) 연동 시 captureError/captureMetric 에
 * SDK 호출을 추가하면 됨.
 */

import { logger } from "./logger.js"

// ── 타입 ──

interface ErrorRecord {
  timestamp: string
  path: string
  method: string
  error: string
  stack?: string
  statusCode?: number
}

interface RequestMetric {
  path: string
  method: string
  statusCode: number
  durationMs: number
  timestamp: number
}

interface ProviderMetric {
  provider: string
  durationMs: number
  success: boolean
  timestamp: number
}

// ── 상태 ──

const MAX_ERRORS = 100
const MAX_METRICS = 1000
const recentErrors: ErrorRecord[] = []
const requestMetrics: RequestMetric[] = []
const providerMetrics: ProviderMetric[] = []

// ── 에러 캡처 ──

export function captureError(error: Error | string, context?: {
  path?: string
  method?: string
  statusCode?: number
}) {
  const errObj = typeof error === "string" ? new Error(error) : error

  const record: ErrorRecord = {
    timestamp: new Date().toISOString(),
    path: context?.path ?? "unknown",
    method: context?.method ?? "unknown",
    error: errObj.message,
    stack: errObj.stack?.split("\n").slice(0, 5).join("\n"),
    statusCode: context?.statusCode,
  }

  recentErrors.push(record)
  if (recentErrors.length > MAX_ERRORS) recentErrors.shift()

  // Sentry 연동 포인트: Sentry.captureException(errObj, { extra: context })
  logger.error("[APM] error captured", { error: record.error, path: record.path })
}

// ── 요청 메트릭 ──

export function recordRequest(metric: Omit<RequestMetric, "timestamp">) {
  requestMetrics.push({ ...metric, timestamp: Date.now() })
  if (requestMetrics.length > MAX_METRICS) requestMetrics.shift()
}

// ── Provider 메트릭 ──

export function recordProviderCall(provider: string, durationMs: number, success: boolean) {
  providerMetrics.push({ provider, durationMs, success, timestamp: Date.now() })
  if (providerMetrics.length > MAX_METRICS) providerMetrics.shift()
}

// ── 통계 계산 ──

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.ceil(sorted.length * (p / 100)) - 1
  return sorted[Math.max(0, idx)]
}

function getRequestStats(windowMs = 3600_000) {
  const cutoff = Date.now() - windowMs
  const recent = requestMetrics.filter(m => m.timestamp >= cutoff)
  if (recent.length === 0) return { count: 0, p50: 0, p95: 0, p99: 0, errorRate: 0 }

  const durations = recent.map(m => m.durationMs)
  const errors = recent.filter(m => m.statusCode >= 400).length

  return {
    count: recent.length,
    p50: Math.round(percentile(durations, 50)),
    p95: Math.round(percentile(durations, 95)),
    p99: Math.round(percentile(durations, 99)),
    errorRate: +(errors / recent.length).toFixed(4),
  }
}

function getProviderStats(windowMs = 3600_000) {
  const cutoff = Date.now() - windowMs
  const recent = providerMetrics.filter(m => m.timestamp >= cutoff)

  const byProvider: Record<string, { count: number; errors: number; durations: number[] }> = {}
  for (const m of recent) {
    if (!byProvider[m.provider]) byProvider[m.provider] = { count: 0, errors: 0, durations: [] }
    byProvider[m.provider].count++
    if (!m.success) byProvider[m.provider].errors++
    byProvider[m.provider].durations.push(m.durationMs)
  }

  return Object.fromEntries(
    Object.entries(byProvider).map(([provider, stats]) => [
      provider,
      {
        count: stats.count,
        errorRate: +(stats.errors / stats.count).toFixed(4),
        p50: Math.round(percentile(stats.durations, 50)),
        p95: Math.round(percentile(stats.durations, 95)),
        avgMs: Math.round(stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length),
      }
    ])
  )
}

function getSystemMetrics() {
  const mem = process.memoryUsage()
  const uptime = process.uptime()
  return {
    uptime_seconds: Math.round(uptime),
    memory: {
      rss_mb: Math.round(mem.rss / 1048576),
      heap_used_mb: Math.round(mem.heapUsed / 1048576),
      heap_total_mb: Math.round(mem.heapTotal / 1048576),
      external_mb: Math.round(mem.external / 1048576),
    },
    pid: process.pid,
    node_version: process.version,
  }
}

// ── APM 상태 조회 (라우트용) ──

export function getApmSnapshot() {
  return {
    system: getSystemMetrics(),
    requests: getRequestStats(),
    providers: getProviderStats(),
    errors: {
      total: recentErrors.length,
      recent: recentErrors.slice(-10).reverse(),
    },
  }
}

// ── 요청 타이밍 미들웨어 헬퍼 ──

export function createRequestTimer(method: string, path: string) {
  const start = Date.now()
  return {
    end(statusCode: number) {
      recordRequest({ path, method, statusCode, durationMs: Date.now() - start })
    }
  }
}
