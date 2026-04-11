// dashboard.ts — CORVUS X Dashboard Route (Phase 4)
// NOTE (2026-04-11): orchestra/scoreboard 폐기. scoreboard/bandit 필드는 빈 배열/객체로 반환.
// 실시간 통계는 tool_call_log 기반으로 전환 예정.
import fs from "fs"
import { logger } from "../observability/logger.js"
import { readFeedbackLog } from "./feedback.js"

const BENCH_PATH = "server/data/benchmark.jsonl"

function readJsonl(filePath: string) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8")
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  } catch (e) {
    logger.warn("benchmark jsonl read failed", { error: e })
    return []
  }
}

function safeNumber(value: any, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function buildRecentSummary(records: any[]) {
  const total = records.length
  const avgLatency = records.reduce((sum, row) => sum + safeNumber(row?.latency_ms), 0) / (total || 1)
  const avgCost = records.reduce((sum, row) => sum + safeNumber(row?.estimated_cost_usd), 0) / (total || 1)
  const fallbackCount = records.reduce((sum, row) => sum + (row?.fallback_used ? 1 : 0), 0)
  return {
    total_requests: total,
    avg_latency_ms: Number(avgLatency.toFixed(2)),
    avg_cost_usd: Number(avgCost.toFixed(8)),
    fallback_rate: Number((fallbackCount / (total || 1)).toFixed(4)),
  }
}

function buildTaskSummary(records: any[]) {
  const grouped: Record<string, any[]> = {}
  for (const row of records) {
    const task = String(row?.task ?? "unknown")
    if (!grouped[task]) grouped[task] = []
    grouped[task].push(row)
  }
  return Object.keys(grouped).sort().reduce((acc: any, task) => {
    const rows = grouped[task]
    const total = rows.length
    const avgLatency = rows.reduce((sum, row) => sum + safeNumber(row?.latency_ms), 0) / (total || 1)
    const avgCost = rows.reduce((sum, row) => sum + safeNumber(row?.estimated_cost_usd), 0) / (total || 1)
    acc[task] = { total_requests: total, avg_latency_ms: Number(avgLatency.toFixed(2)), avg_cost_usd: Number(avgCost.toFixed(8)) }
    return acc
  }, {})
}

function buildRecentRecords(records: any[]) {
  return records
    .slice(-20)
    .reverse()
    .map((row: any) => ({
      timestamp: row?.timestamp ?? null,
      task: row?.task ?? null,
      primary_provider: row?.primary_provider ?? null,
      final_provider: row?.final_provider ?? null,
      executed_providers: Array.isArray(row?.executed_providers) ? row.executed_providers : [],
      latency_ms: safeNumber(row?.latency_ms),
      estimated_cost_usd: safeNumber(row?.estimated_cost_usd),
      fallback_used: Boolean(row?.fallback_used),
    }))
}

function buildFeedbackSummary() {
  const logs = readFeedbackLog()
  const up = logs.filter((l: any) => l?.feedback === "up").length
  const down = logs.filter((l: any) => l?.feedback === "down").length
  return { total: logs.length, up, down }
}

export async function runDashboardRoute(_req: any, res: any) {
  const records = readJsonl(BENCH_PATH)

  return res.json({
    ok: true,
    stats: buildRecentSummary(records),
    by_task: buildTaskSummary(records),
    feedback: buildFeedbackSummary(),
    // scoreboard/bandit 폐기 — 빈 데이터로 반환 (프론트 호환 유지)
    scoreboard: [],
    bandit: [],
    task_bandit: {},
    model_scoreboard: {},
    recent: buildRecentRecords(records)
  })
}

export const dashboardRoute = {
  path: "/api/dashboard",
  handler: runDashboardRoute
}
