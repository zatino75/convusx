import fs from "fs"
import { logger } from "../observability/logger.js"
import { updateScoreboardFromBenchmark } from "./scoreboard.js"

const LOG_PATH = "server/data/benchmark.jsonl"

function ensureDir() {
  try {
    fs.mkdirSync("server/data", { recursive: true })
  } catch (e) { logger.warn("[benchmark] ensureDir failed", { error: String(e) }) }
}

export function normalizeBenchmarkCase(payload: any) {
  // top-level 필드 우선 (이미 정규화된 payload를 재진입하는 경우 데이터 보존)
  // raw payload일 때는 meta.orchestration 또는 orchestration에서 추출
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
    // E17: rotation — 1000줄 초과 시 앞 200줄 제거
    try {
      const lines = fs.readFileSync(LOG_PATH, "utf-8").split("\n").filter(Boolean)
      if (lines.length > 1000) {
        fs.writeFileSync(LOG_PATH, lines.slice(lines.length - 800).join("\n") + "\n", "utf-8")
      }
    } catch (e) { logger.warn("[benchmark] log rotation failed", { error: String(e) }) }
    try {
      updateScoreboardFromBenchmark(record)
    } catch (e) { logger.warn("[benchmark] updateScoreboardFromBenchmark failed", { error: String(e) }) }
    try {
      // Also update model scoreboard with provider_usage details
      const { updateModelScoreboard } = await import("./scoreboard.js")
      const task = record?.task
      const finalProvider = record?.final_provider
      const providerUsage = record?.provider_usage ?? []
      if (task && finalProvider && Array.isArray(providerUsage)) {
        updateModelScoreboard({
          task,
          final_provider: finalProvider,
          provider_usage: providerUsage
        })
      }
    } catch (e) { logger.warn("[benchmark] updateModelScoreboard failed", { error: String(e) }) }
    return record
  } catch (e) {
    logger.warn("[benchmark] logBenchmark failed", { error: String(e) })
    return null
  }
}
