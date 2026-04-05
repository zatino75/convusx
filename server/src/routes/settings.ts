import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { clearAllThreadMemory } from "../memory/threadMemory.js"
import { clearAllProjectMemory } from "../memory/projectMemory.js"

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
  } catch {
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
export function getSettingsKeys(_req: any, res: any) {
  const env = readEnv()
  const result: Record<string, string> = {}
  for (const [provider, envKey] of Object.entries(KEY_MAP)) {
    result[provider] = env[envKey] ? maskKey(env[envKey]) : ""
  }
  res.json({ ok: true, keys: result })
}

// POST /api/settings/keys — 키 저장
export function saveSettingsKeys(req: any, res: any) {
  const body = req?.body ?? {}
  const env = readEnv()

  for (const [provider, envKey] of Object.entries(KEY_MAP)) {
    const value = String(body[provider] ?? "").trim()
    if (!value) continue
    // 마스킹된 값이 들어오면 무시 (변경 없음)
    if (value.includes("••••")) continue
    env[envKey] = value
  }

  try {
    writeEnv(env)
    // 런타임 즉시 반영
    for (const [provider, envKey] of Object.entries(KEY_MAP)) {
      const value = String(body[provider] ?? "").trim()
      if (!value || value.includes("••••")) continue
      process.env[envKey] = value
    }
    res.json({ ok: true })
  } catch (e: any) {
    res.json({ ok: false, error: String(e?.message ?? "write_failed") })
  }
}

// POST /api/settings/reset — 데이터 초기화
export function resetSettings(req: any, res: any) {
  const body = req?.body ?? {}
  const target = String(body.target ?? "").trim()

  try {
    if (target === "thread-memory" || target === "all") {
      clearAllThreadMemory()
    }
    if (target === "project-memory" || target === "all") {
      clearAllProjectMemory()
    }
    if (target === "scoreboard" || target === "all") {
      const scoreboardPath = path.resolve(__dirname, "../../../scoreboard.json")
      if (fs.existsSync(scoreboardPath)) fs.writeFileSync(scoreboardPath, "{}", "utf-8")
      const usagePath = path.resolve(__dirname, "../../../usage.json")
      if (fs.existsSync(usagePath)) fs.writeFileSync(usagePath, "{}", "utf-8")
    }
    res.json({ ok: true, target })
  } catch (e: any) {
    res.json({ ok: false, error: String(e?.message ?? "reset_failed") })
  }
}
