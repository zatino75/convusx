import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { logger } from "../observability/logger.js"
import { clearAllThreadMemory } from "../memory/threadMemory.js"
import { clearAllProjectMemory } from "../memory/projectMemory.js"
import { resetModelScoreboardAll } from "../orchestra/scoreboard.js"
import { validateBody, settingsResetRules, validateKeyRules } from "../http/validation.js"
import type { ParsedRequest } from "../http/router.js"
import type { ExpressLikeResponse } from "../http/response.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ENV_PATH = path.resolve(__dirname, "../../../.env")

const KEY_MAP: Record<string, string> = {
  openai:     "OPENAI_API_KEY",
  anthropic:  "ANTHROPIC_API_KEY",
  gemini:     "GEMINI_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  midjourney: "MIDJOURNEY_API_KEY",
  runway:     "RUNWAY_API_KEY"
}

function readEnv(): Record<string, string> {
  try {
    const raw = fs.readFileSync(ENV_PATH, "utf-8")
    const result: Record<string, string> = {}
    for (const line of raw.split("\n")) {
      const trimmed = line.trim().replace(/^\uFEFF/, "")
      if (!trimmed || trimmed.startsWith("#")) continue
      const idx = trimmed.indexOf("=")
      if (idx < 0) continue
      const key = trimmed.slice(0, idx).trim()
      const value = trimmed.slice(idx + 1).trim()
      result[key] = value
    }
    return result
  } catch (e) {
    logger.warn("env file read failed", { error: e })
    return {}
  }
}

function writeEnv(data: Record<string, string>) {
  const lines = Object.entries(data).map(([k, v]) => `${k}=${v}`)
  fs.writeFileSync(ENV_PATH, lines.join("\n") + "\n", "utf-8")
}

function maskKey(value: string): string {
  if (!value || value.length < 8) return ""
  return value.slice(0, 6) + "••••••••" + value.slice(-4)
}

// GET /api/settings/keys — 마스킹된 키 목록 반환
export function getSettingsKeys(_req: ParsedRequest | Record<string, unknown>, res: ExpressLikeResponse) {
  const env = readEnv()
  const result: Record<string, string> = {}
  for (const [provider, envKey] of Object.entries(KEY_MAP)) {
    result[provider] = env[envKey] ? maskKey(env[envKey]) : ""
  }
  res.json({ ok: true, keys: result })
}

// POST /api/settings/keys — 키 저장 (변경 내역 audit 로그 포함)
export function saveSettingsKeys(req: ParsedRequest, res: ExpressLikeResponse) {
  const body = (req?.body ?? {}) as Record<string, string>
  const env = readEnv()

  const changedProviders: string[] = []

  for (const [provider, envKey] of Object.entries(KEY_MAP)) {
    const value = String(body[provider] ?? "").trim()
    if (!value) continue
    // 마스킹된 값이 들어오면 무시 (변경 없음)
    if (value.includes("••••")) continue
    const wasSet = Boolean(env[envKey])
    env[envKey] = value
    changedProviders.push(`${provider}(${wasSet ? "updated" : "added"})`)
  }

  if (changedProviders.length === 0) {
    return res.json({ ok: true, changed: 0 })
  }

  try {
    writeEnv(env)
    // 런타임 즉시 반영
    for (const [provider, envKey] of Object.entries(KEY_MAP)) {
      const value = String(body[provider] ?? "").trim()
      if (!value || value.includes("••••")) continue
      process.env[envKey] = value
    }
    // audit 로그 — 어떤 키가 변경되었는지 기록 (값 자체는 기록하지 않음)
    logger.info("[settings] API keys modified", { changed: changedProviders })
    res.json({ ok: true, changed: changedProviders.length })
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : "write_failed"
    logger.error("[settings] API key save failed", { error: errMsg })
    res.json({ ok: false, error: errMsg })
  }
}

// POST /api/settings/validate-key — API 키 유효성 검증
export async function validateKey(req: ParsedRequest, res: ExpressLikeResponse) {
  const body = (req?.body ?? {}) as Record<string, string>

  const validation = validateBody(body, validateKeyRules)
  if (!validation.ok) return res.json({ ok: false, error: validation.error })

  const provider = String(body.provider ?? "").trim().toLowerCase()
  const envKey = KEY_MAP[provider]
  if (!envKey) return res.json({ ok: false, error: "unknown_provider" })

  const key = process.env[envKey] ?? readEnv()[envKey] ?? ""
  if (!key) return res.json({ ok: false, error: "no_key" })

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    let valid = false
    if (provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` }, signal: controller.signal })
      valid = r.ok
    } else if (provider === "anthropic") {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
        signal: controller.signal
      })
      // 200 또는 400 (valid key, bad request) 모두 키는 유효
      valid = r.status === 200 || r.status === 400
    } else if (provider === "gemini") {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, { signal: controller.signal })
      valid = r.ok
    } else if (provider === "perplexity") {
      const r = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "sonar", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
        signal: controller.signal
      })
      valid = r.status === 200 || r.status === 400
    } else {
      clearTimeout(timeout)
      return res.json({ ok: true, valid: true, note: "skip_validation" })
    }

    clearTimeout(timeout)
    res.json({ ok: true, valid })
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : "validation_failed"
    logger.warn("key validation failed", { provider, error: errMsg })
    res.json({ ok: false, error: errMsg })
  }
}

// POST /api/settings/reset — 데이터 초기화 (확인 헤더 필수)
export function resetSettings(req: ParsedRequest, res: ExpressLikeResponse) {
  // 파괴적 작업 보호: X-Confirm-Reset 헤더 필수
  const confirmHeader = String(
    req?.headers?.["x-confirm-reset"] ?? ""
  ).trim().toLowerCase()

  if (confirmHeader !== "true") {
    return res.json({ ok: false, error: "missing_confirmation", message: "X-Confirm-Reset: true 헤더가 필요합니다." })
  }

  const body = (req?.body ?? {}) as Record<string, string>

  const validation = validateBody(body, settingsResetRules)
  if (!validation.ok) {
    return res.json({ ok: false, error: validation.error })
  }

  const target = String(body.target ?? "").trim()

  try {
    const cleared: string[] = []
    if (target === "thread-memory" || target === "all") {
      clearAllThreadMemory()
      cleared.push("thread-memory")
    }
    if (target === "project-memory" || target === "all") {
      clearAllProjectMemory()
      cleared.push("project-memory")
    }
    if (target === "scoreboard" || target === "all") {
      resetModelScoreboardAll()
      cleared.push("scoreboard")
    }
    // audit 로그
    logger.info("[settings] data reset executed", { target, cleared })
    res.json({ ok: true, target, cleared })
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : "reset_failed"
    logger.error("[settings] data reset failed", { target, error: errMsg })
    res.json({ ok: false, error: errMsg })
  }
}
