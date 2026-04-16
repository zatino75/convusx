import fs from "fs"
import { logger } from "../observability/logger.js"
// orchestra/benchmark.ts 에서 이전 (2026-04-16)
// logBenchmark / normalizeBenchmarkCase 를 benchmark/ 레이어로 통합

const LOG_PATH = "server/data/benchmark.jsonl"

function ensureDir() {
  try {
    fs.mkdirSync("server/data", { recursive: true })
  } catch (e) { logger.warn("[benchmark] ensureDir failed", { error: String(e) }) }
}

export function normalizeBenchmarkCase(payload: any) {
  const orchestration = payload?.meta?.orchestration ?? payload?.orchestration ?? {}

  return {
    timestamp: payload?.timestamp ?? new Date().toISOString(),
    task: payload?.task ?? null,
    case_id: payload?.case_id ?? null,
    mode: payload?.mode ?? null,
    primary_provider: payload?.primary_provider ?? orchestration?.primary_provider ?? null,
    verifier_providers: payload?.verifier_providers ?? orchestration?.verifier_providers ?? [],
    executed_providers: payload?.executed_providers ?? orchestration?.executed_providers ?? [],
    final_provider: payload?.final_provider ?? orchestration?.final_provider ?? null,
    latency_ms: Number(payload?.latency_ms ?? orchestration?.latency_ms ?? 0),
    estimated_cost_usd: Number(payload?.estimated_cost_usd ?? orchestration?.estimated_cost_usd ?? 0),
    fallback_used: Boolean(payload?.fallback_used ?? orchestration?.fallback_used),
    judge_confidence: Number(payload?.judge_confidence ?? orchestration?.judge_confidence ?? 0),
    conflict_count: Number(payload?.conflict_count ?? orchestration?.conflict_count ?? 0),
    provider_usage: payload?.provider_usage ?? orchestration?.provider_usage ?? []
  }
}

export async function logBenchmark(payload: any) {
  try {
    ensureDir()
    const record = normalizeBenchmarkCase(payload)
    fs.appendFileSync(LOG_PATH, JSON.stringify(record) + "\n", "utf-8")
    // rotation — 1000줄 초과 시 앞 200줄 제거
    try {
      const lines = fs.readFileSync(LOG_PATH, "utf-8").split("\n").filter(Boolean)
      if (lines.length > 1000) {
        fs.writeFileSync(LOG_PATH, lines.slice(lines.length - 800).join("\n") + "\n", "utf-8")
      }
    } catch (e) { logger.warn("[benchmark] log rotation failed", { error: String(e) }) }
    return record
  } catch (e) {
    logger.warn("[benchmark] logBenchmark failed", { error: String(e) })
    return null
  }
}
