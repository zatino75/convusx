import fs from "fs"
import { updateScoreboardFromBenchmark } from "./scoreboard.js"

const LOG_PATH = "server/data/benchmark.jsonl"

function ensureDir() {
  try {
    fs.mkdirSync("server/data", { recursive: true })
  } catch {}
}

export function normalizeBenchmarkCase(payload: any) {
  const orchestration = payload?.meta?.orchestration ?? payload?.orchestration ?? {}

  return {
    timestamp: payload?.timestamp ?? new Date().toISOString(),
    task: payload?.task ?? null,
    primary_provider: orchestration?.primary_provider ?? null,
    verifier_providers: orchestration?.verifier_providers ?? [],
    executed_providers: orchestration?.executed_providers ?? [],
    final_provider: orchestration?.final_provider ?? null,
    latency_ms: Number(orchestration?.latency_ms ?? 0),
    estimated_cost_usd: Number(orchestration?.estimated_cost_usd ?? 0),
    fallback_used: Boolean(orchestration?.fallback_used),
    judge_confidence: Number(orchestration?.judge_confidence ?? 0),
    conflict_count: Number(orchestration?.conflict_count ?? 0),
    provider_usage: orchestration?.provider_usage ?? []
  }
}

export async function logBenchmark(payload: any) {
  try {
    ensureDir()
    const record = normalizeBenchmarkCase(payload)
    fs.appendFileSync(LOG_PATH, JSON.stringify(record) + "\n", "utf-8")
    try {
      updateScoreboardFromBenchmark(record)
    } catch {}
    return record
  } catch {
    return null
  }
}
