/**
 * CORVUS X — Background Scheduler (B6)
 *
 * 서버 가동 중 주기적으로 실행되는 백그라운드 작업:
 *  1. 로그 파일 로테이션 (pairwise-log.jsonl, benchmark.jsonl)
 *  2. Provider 헬스체크 (API 키 유효성 검증)
 *  3. 벤치마크 자동 실행 (기존 startBenchmarkScheduler 위임)
 */

import fs from "fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { logger } from "../observability/logger.js"
import { generateAndStoreRetailSnapshot, listRetailSnapshots } from "../reports/retailSnapshot.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DATA_DIR = resolve(__dirname, "../../data")

// ── 상수 ──
const LOG_ROTATION_INTERVAL_MS = 6 * 60 * 60 * 1000  // 6시간
const HEALTH_CHECK_INTERVAL_MS = 30 * 60 * 1000       // 30분
const RETAIL_SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000    // 1시간
const CREDIT_REFRESH_INTERVAL_MS = 5 * 60 * 1000      // 5분 — billing endpoints만, LLM 호출 없음
const LOG_MAX_LINES = 2000
const LOG_KEEP_LINES = 1500

// ── 타이머 핸들 ──
const timers: ReturnType<typeof setInterval>[] = []
let running = false

// ── 로그 파일 로테이션 ──

const LOG_FILES = [
  { name: "pairwise-log.jsonl", maxLines: LOG_MAX_LINES, keepLines: LOG_KEEP_LINES },
  { name: "benchmark.jsonl", maxLines: 1000, keepLines: 800 }
]

function rotateLogFiles() {
  for (const spec of LOG_FILES) {
    const filePath = resolve(DATA_DIR, spec.name)
    try {
      if (!fs.existsSync(filePath)) continue
      const content = fs.readFileSync(filePath, "utf-8")
      const lines = content.split("\n").filter(Boolean)
      if (lines.length <= spec.maxLines) continue

      const trimmed = lines.slice(-spec.keepLines)
      fs.writeFileSync(filePath, trimmed.join("\n") + "\n", "utf-8")
      logger.info(`[scheduler] rotated ${spec.name}`, {
        before: lines.length,
        after: trimmed.length
      })
    } catch (e) {
      logger.warn(`[scheduler] log rotation failed for ${spec.name}`, {
        error: e instanceof Error ? e.message : String(e)
      })
    }
  }
}

// ── Provider 헬스체크 ──

interface HealthResult {
  provider: string
  healthy: boolean
  latency_ms: number
  error?: string
}

const healthState: Record<string, HealthResult> = {}

// 2026-04-25 긴급: LLM 호출 제거. env key 존재만 검사 (HTTP 200 등가).
// 이전엔 anthropic/perplexity POST 가 30분마다 토큰 소비 → 누적 비용.
// 진짜 API 가용성은 실제 채팅 호출 시점에 검증되므로 여기 ping 은 불필요.
async function checkProviderHealth() {
  const providers = ["openai", "anthropic", "gemini", "perplexity"] as const
  const envMap: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    gemini: "GEMINI_API_KEY",
    perplexity: "PERPLEXITY_API_KEY",
  }
  for (const name of providers) {
    const key = process.env[envMap[name]]
    const present = !!(key && key.trim().length > 0)
    healthState[name] = {
      provider: name,
      healthy: present,
      latency_ms: 0,
      ...(present ? {} : { error: "no_api_key" }),
    }
  }
  const summary = Object.values(healthState)
  const healthyCount = summary.filter(h => h.healthy).length
  logger.info("[scheduler] provider health check (env-only, no LLM call)", {
    healthy: healthyCount,
    total: summary.length,
    details: summary.map(h => `${h.provider}:${h.healthy ? "key_set" : "missing"}`).join(", "),
  })
}

// ── 스케줄러 상태 조회 ──

export function getSchedulerStatus() {
  const latestRetailSnapshot = listRetailSnapshots("retail_kpi", 1)[0] ?? null
  return {
    running,
    intervals: {
      log_rotation_ms: LOG_ROTATION_INTERVAL_MS,
      health_check_ms: HEALTH_CHECK_INTERVAL_MS,
      retail_snapshot_ms: RETAIL_SNAPSHOT_INTERVAL_MS
    },
    provider_health: { ...healthState },
    retail_snapshot: latestRetailSnapshot
      ? {
        snapshot_date: latestRetailSnapshot.snapshotDate,
        created_at: latestRetailSnapshot.createdAt
      }
      : null,
    log_files: LOG_FILES.map(f => {
      const filePath = resolve(DATA_DIR, f.name)
      try {
        if (!fs.existsSync(filePath)) return { name: f.name, exists: false, lines: 0 }
        const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean).length
        return { name: f.name, exists: true, lines, max: f.maxLines }
      } catch {
        return { name: f.name, exists: false, lines: 0 }
      }
    })
  }
}

// ── 수동 트리거 ──

export async function triggerTask(task: string): Promise<{ ok: boolean; task: string; result?: string; error?: string }> {
  switch (task) {
    case "log_rotation":
      rotateLogFiles()
      return { ok: true, task, result: "log rotation executed" }
    case "health_check":
      await checkProviderHealth()
      return { ok: true, task, result: "health check executed" }
    case "retail_snapshot":
      generateAndStoreRetailSnapshot("retail_kpi")
      return { ok: true, task, result: "retail snapshot executed" }
    default:
      return { ok: false, task, error: `unknown task: ${task}` }
  }
}

// ── 시작 / 중지 ──

export function startScheduler() {
  if (running) return
  running = true

  // 초기 실행 (서버 시작 후 10초 뒤)
  setTimeout(() => {
    rotateLogFiles()
    checkProviderHealth().catch(() => {})
    try {
      generateAndStoreRetailSnapshot("retail_kpi")
    } catch {
      // ignore snapshot bootstrap error
    }
    // billing 잔액 초기 채움 (LLM 호출 아님 — 규칙 #21 준수)
    import("../connectors/creditFetcher.js")
      .then(m => m.backgroundRefresh())
      .catch(() => {})
  }, 10_000)

  // 주기적 실행
  timers.push(setInterval(rotateLogFiles, LOG_ROTATION_INTERVAL_MS))
  timers.push(setInterval(() => { checkProviderHealth().catch(() => {}) }, HEALTH_CHECK_INTERVAL_MS))
  timers.push(setInterval(() => {
    try {
      generateAndStoreRetailSnapshot("retail_kpi")
    } catch (e) {
      logger.warn("[scheduler] retail snapshot failed", {
        error: e instanceof Error ? e.message : String(e)
      })
    }
  }, RETAIL_SNAPSHOT_INTERVAL_MS))
  // 5분마다 모든 API 가능 provider 잔액 캐시 갱신 (billing endpoints 만)
  timers.push(setInterval(() => {
    import("../connectors/creditFetcher.js")
      .then(m => m.backgroundRefresh())
      .catch(() => {})
  }, CREDIT_REFRESH_INTERVAL_MS))

  // 30분마다 prefetch_cache 만료 항목 정리 (Session 8, 2026-04-29)
  timers.push(setInterval(() => {
    try {
      import("../db/corvusxDb.js").then(m => {
        const r = m.purgeExpiredPrefetchCache()
        if (r.deleted > 0) logger.info("[scheduler] prefetch_cache 정리", { deleted: r.deleted })
      }).catch(() => {})
    } catch { /* ignore */ }
  }, 30 * 60 * 1000))

  // .unref() — 프로세스 종료 방해 안 함
  for (const t of timers) t.unref()

  // 벤치마크 자동 스케줄러 (기존 모듈 위임)
  try {
    import("../routes/benchmark.js").then(mod => {
      if (typeof mod.startBenchmarkScheduler === "function") {
        mod.startBenchmarkScheduler()
        logger.info("[scheduler] benchmark auto-scheduler started")
      }
    }).catch(() => {})
  } catch { /* 벤치마크 모듈 미존재 시 무시 */ }

  logger.info("[scheduler] background scheduler started", {
    log_rotation: `${LOG_ROTATION_INTERVAL_MS / 3600000}h`,
    health_check: `${HEALTH_CHECK_INTERVAL_MS / 60000}min`,
    retail_snapshot: `${RETAIL_SNAPSHOT_INTERVAL_MS / 60000}min`,
    credit_refresh: `${CREDIT_REFRESH_INTERVAL_MS / 60000}min`,
  })
}

export function stopScheduler() {
  for (const t of timers) clearInterval(t)
  timers.length = 0
  running = false
  logger.info("[scheduler] background scheduler stopped")
}
