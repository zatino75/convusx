import fs from "fs"
import { updateScoreboardFromBenchmark } from "./scoreboard.js"

const LOG_PATH = "server/data/benchmark.jsonl"

function ensureDir() {
  try {
    fs.mkdirSync("server/data", { recursive: true })
  } catch {}
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
    try {
      updateScoreboardFromBenchmark(record)
    } catch {}
    return record
  } catch {
    return null
  }
}
