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

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DATA_DIR = resolve(__dirname, "../../data")

// ── 상수 ──
const LOG_ROTATION_INTERVAL_MS = 6 * 60 * 60 * 1000  // 6시간
const HEALTH_CHECK_INTERVAL_MS = 30 * 60 * 1000       // 30분
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

async function checkProviderHealth() {
  const providers = [
    { name: "openai", envKey: "OPENAI_API_KEY", url: "https://api.openai.com/v1/models", authHeader: "Bearer" },
    { name: "anthropic", envKey: "ANTHROPIC_API_KEY", url: "https://api.anthropic.com/v1/messages", authHeader: "x-api-key" },
    { name: "gemini", envKey: "GEMINI_API_KEY", url: "", authHeader: "" },
    { name: "perplexity", envKey: "PERPLEXITY_API_KEY", url: "https://api.perplexity.ai/chat/completions", authHeader: "Bearer" }
  ]

  for (const p of providers) {
    const key = process.env[p.envKey]
    if (!key || key.trim().length === 0) {
      healthState[p.name] = { provider: p.name, healthy: false, latency_ms: 0, error: "no_api_key" }
      continue
    }

    // Gemini은 key-in-URL 방식 — 별도 처리
    if (p.name === "gemini") {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
      const start = Date.now()
      try {
        const resp = await fetch(url, { method: "GET", signal: AbortSignal.timeout(10000) })
        healthState[p.name] = {
          provider: p.name,
          healthy: resp.ok,
          latency_ms: Date.now() - start,
          ...(resp.ok ? {} : { error: `status_${resp.status}` })
        }
      } catch (e) {
        healthState[p.name] = {
          provider: p.name,
          healthy: false,
          latency_ms: Date.now() - start,
          error: e instanceof Error ? e.message : String(e)
        }
      }
      continue
    }

    // OpenAI / Anthropic / Perplexity — 헤더 기반 인증
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (p.authHeader === "Bearer") {
      headers["Authorization"] = `Bearer ${key}`
    } else if (p.authHeader === "x-api-key") {
      headers["x-api-key"] = key
      headers["anthropic-version"] = "2023-06-01"
    }

    const start = Date.now()
    try {
      // HEAD/GET 으로 가벼운 체크 (모델 목록 등)
      const method = p.name === "anthropic" ? "POST" : "GET"
      const body = p.name === "anthropic"
        ? JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1, messages: [{ role: "user", content: "ping" }] })
        : undefined

      const resp = await fetch(p.url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(10000)
      })

      // Anthropic은 401=invalid key, 기타는 서버 접근 가능 = healthy
      const healthy = p.name === "anthropic" ? resp.status !== 401 : resp.ok
      healthState[p.name] = {
        provider: p.name,
        healthy,
        latency_ms: Date.now() - start,
        ...(healthy ? {} : { error: `status_${resp.status}` })
      }
    } catch (e) {
      healthState[p.name] = {
        provider: p.name,
        healthy: false,
        latency_ms: Date.now() - start,
        error: e instanceof Error ? e.message : String(e)
      }
    }
  }

  const summary = Object.values(healthState)
  const healthyCount = summary.filter(h => h.healthy).length
  logger.info("[scheduler] provider health check completed", {
    healthy: healthyCount,
    total: summary.length,
    details: summary.map(h => `${h.provider}:${h.healthy ? "ok" : h.error}(${h.latency_ms}ms)`).join(", ")
  })
}

// ── 스케줄러 상태 조회 ──

export function getSchedulerStatus() {
  return {
    running,
    intervals: {
      log_rotation_ms: LOG_ROTATION_INTERVAL_MS,
      health_check_ms: HEALTH_CHECK_INTERVAL_MS
    },
    provider_health: { ...healthState },
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
  }, 10_000)

  // 주기적 실행
  timers.push(setInterval(rotateLogFiles, LOG_ROTATION_INTERVAL_MS))
  timers.push(setInterval(() => { checkProviderHealth().catch(() => {}) }, HEALTH_CHECK_INTERVAL_MS))

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
    health_check: `${HEALTH_CHECK_INTERVAL_MS / 60000}min`
  })
}

export function stopScheduler() {
  for (const t of timers) clearInterval(t)
  timers.length = 0
  running = false
  logger.info("[scheduler] background scheduler stopped")
}
