/**
 * configReloader.ts — .env 파일 변경 시 process.env 핫리로드.
 *
 * 2026-04-29 신규.
 *
 * 동작:
 *   - apiKeysStore.getEnvPath() 가 가리키는 .env 파일을 fs.watch.
 *   - 변경 감지 시 파일을 다시 파싱해서 process.env 의 알려진 키만 갱신.
 *   - 알 수 없는 키는 무시 (security: PATH 등 시스템 변수 덮어쓰기 방지).
 *
 * ⚠️ CLAUDE.md 규칙 #21 — 백그라운드 LLM 호출 금지.
 *    이 모듈은 fs 이벤트만 처리하고 LLM API 호출하지 않는다.
 */

import fs from "node:fs"
import { logger } from "./observability/logger.js"
import { PROVIDER_KEY_MAP, getEnvPath } from "./apiKeysStore.js"

const RELOADABLE_KEYS = new Set<string>([
  ...Object.values(PROVIDER_KEY_MAP),
  "SERPER_API_KEY",
  "TAVILY_API_KEY",
  "POSTHOG_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_KEY",
  "NAVER_CLIENT_ID",
  "NAVER_CLIENT_SECRET",
  "NOTION_API_KEY",
  "GOOGLE_API_KEY",
  "DEFAULT_MODEL",
  "GEMINI_DISPLAY_LABEL",
  "CORVUS_ACCESS_PASSWORD_HASH",
])

let watcher: fs.FSWatcher | null = null
let lastReloadAt = 0
const DEBOUNCE_MS = 500

function readEnvFile(filePath: string): Record<string, string> {
  let raw: string
  try { raw = fs.readFileSync(filePath, "utf-8") }
  catch { return {} }
  const out: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^\uFEFF/, "")
    if (!trimmed || trimmed.startsWith("#")) continue
    const idx = trimmed.indexOf("=")
    if (idx < 0) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()
    if (key) out[key] = value
  }
  return out
}

function reload(): void {
  const now = Date.now()
  if (now - lastReloadAt < DEBOUNCE_MS) return
  lastReloadAt = now

  const envPath = getEnvPath()
  const next = readEnvFile(envPath)
  let changed = 0
  for (const [k, v] of Object.entries(next)) {
    if (!RELOADABLE_KEYS.has(k)) continue
    if (process.env[k] !== v) {
      process.env[k] = v
      changed += 1
    }
  }
  if (changed > 0) {
    logger.info("[configReloader] env reloaded", { envPath, changed })
  }
}

export function startConfigReloader(): void {
  if (watcher) return
  const envPath = getEnvPath()
  if (!fs.existsSync(envPath)) {
    logger.info("[configReloader] env file not found — skip watcher", { envPath })
    return
  }
  try {
    watcher = fs.watch(envPath, { persistent: false }, (event) => {
      if (event === "change" || event === "rename") {
        // 'rename' 케이스: 일부 OS 에서 atomic write 가 rename 으로 보임 — 재바인딩 필요할 수 있음
        try { reload() } catch (e) {
          logger.warn("[configReloader] reload failed", { error: String(e) })
        }
      }
    })
    logger.info("[configReloader] watching", { envPath })
  } catch (e) {
    logger.warn("[configReloader] watch failed", { envPath, error: String(e) })
  }
}

export function stopConfigReloader(): void {
  if (!watcher) return
  try { watcher.close() } catch { /* ignore */ }
  watcher = null
  logger.info("[configReloader] stopped")
}

/** 외부 강제 reload — apiKeysStore.update 가 호출. */
export function reloadNow(): void {
  reload()
}
