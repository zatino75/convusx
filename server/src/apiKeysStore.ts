/**
 * apiKeysStore.ts — 6 프로바이더 API 키 관리.
 *
 * 2026-04-29 신규.
 * 키 자체는 .env 파일(systemd EnvironmentFile / 로컬 dotenv) 에 저장.
 * 메타데이터(masked, is_valid, last_tested) 만 SQLite api_keys_meta 에 기록.
 *
 * .env 경로 우선순위:
 *   1) process.env.CORVUS_ENV_FILE
 *   2) /etc/corvusx/.env (운영)
 *   3) <repo>/server/.env (index.ts dotenv 경로)
 *   4) <repo>/.env (기존 routes/settings.ts 경로)
 *
 * 키 갱신 시 .env 파일 갱신 + process.env 즉시 반영.
 * configReloader.ts 의 fs.watch 트리거가 함께 작동해 다른 워커에도 전파.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { corvusxDb } from "./db/corvusxDb.js"
import { logger } from "./observability/logger.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const PROVIDER_KEY_MAP = {
  anthropic:  "ANTHROPIC_API_KEY",
  openai:     "OPENAI_API_KEY",
  gemini:     "GEMINI_API_KEY",
  deepseek:   "DEEPSEEK_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  fal:        "FAL_API_KEY",
} as const

export type KeyProvider = keyof typeof PROVIDER_KEY_MAP

export interface ApiKeyMeta {
  provider: KeyProvider
  maskedKey: string
  isValid: boolean
  lastTested: number | null
  hasKey: boolean
}

// ── .env 경로 결정 ────────────────────────────────────────────────
function envCandidates(): string[] {
  const out: string[] = []
  if (process.env.CORVUS_ENV_FILE) out.push(process.env.CORVUS_ENV_FILE)
  out.push("/etc/corvusx/.env")
  // dist/apiKeysStore.js → ../../.env == server/.env
  out.push(path.resolve(__dirname, "../../.env"))
  // dist/apiKeysStore.js → ../../../.env == repo root .env (legacy routes/settings.ts 경로)
  out.push(path.resolve(__dirname, "../../../.env"))
  return out
}

function resolveEnvPath(forWrite: boolean): string {
  const candidates = envCandidates()
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        if (!forWrite) return c
        fs.accessSync(c, fs.constants.W_OK)
        return c
      }
    } catch { /* not writable — try next */ }
  }
  // write 인 경우 마지막 후보로 fallback (없으면 생성 시도)
  return candidates[candidates.length - 1]
}

// ── .env 파싱/직렬화 ──────────────────────────────────────────────
interface EnvLine {
  raw: string
  key?: string
  value?: string
}

function parseEnvFile(filePath: string): EnvLine[] {
  let raw: string
  try { raw = fs.readFileSync(filePath, "utf-8") }
  catch { return [] }
  const lines = raw.split(/\r?\n/)
  return lines.map((ln) => {
    const trimmed = ln.trim().replace(/^\uFEFF/, "")
    if (!trimmed || trimmed.startsWith("#")) return { raw: ln }
    const idx = trimmed.indexOf("=")
    if (idx < 0) return { raw: ln }
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()
    return { raw: ln, key, value }
  })
}

function serializeEnv(lines: EnvLine[]): string {
  return lines.map(l => l.key !== undefined ? `${l.key}=${l.value ?? ""}` : l.raw).join("\n")
}

function readEnvAsMap(filePath: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const l of parseEnvFile(filePath)) {
    if (l.key) out[l.key] = l.value ?? ""
  }
  return out
}

function upsertEnvKey(filePath: string, envKey: string, value: string): void {
  const lines = parseEnvFile(filePath)
  const idx = lines.findIndex(l => l.key === envKey)
  if (idx >= 0) {
    lines[idx] = { raw: `${envKey}=${value}`, key: envKey, value }
  } else {
    lines.push({ raw: `${envKey}=${value}`, key: envKey, value })
  }
  fs.writeFileSync(filePath, serializeEnv(lines), "utf-8")
}

function removeEnvKey(filePath: string, envKey: string): void {
  const lines = parseEnvFile(filePath).filter(l => l.key !== envKey)
  fs.writeFileSync(filePath, serializeEnv(lines), "utf-8")
}

// ── 마스킹 ────────────────────────────────────────────────────────
export function maskKey(value: string): string {
  if (!value) return ""
  const v = value.trim()
  if (v.length < 12) return "•".repeat(v.length)
  // 'sk-ant-api03-XXXX...YQAA' 형식 — 앞 16자 + ...뒤 4자
  const head = v.slice(0, 16)
  const tail = v.slice(-4)
  return `${head}...${tail}`
}

// ── api_keys_meta SQLite ─────────────────────────────────────────
const stmtMetaUpsert = corvusxDb.prepare(`
  INSERT INTO api_keys_meta (provider, masked_key, is_valid, last_tested, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(provider) DO UPDATE SET
    masked_key  = excluded.masked_key,
    is_valid    = excluded.is_valid,
    last_tested = excluded.last_tested,
    updated_at  = excluded.updated_at
`)

const stmtMetaGet = corvusxDb.prepare(`
  SELECT provider, masked_key, is_valid, last_tested
  FROM api_keys_meta WHERE provider = ?
`)

const stmtMetaDelete = corvusxDb.prepare(`DELETE FROM api_keys_meta WHERE provider = ?`)

function persistMeta(provider: KeyProvider, maskedKey: string, isValid: boolean | null, lastTested: number | null): void {
  stmtMetaUpsert.run(
    provider,
    maskedKey,
    isValid === null ? 0 : (isValid ? 1 : 0),
    lastTested,
    Date.now(),
  )
}

// ── 공개 API ─────────────────────────────────────────────────────

/** 6 프로바이더 키 메타 목록. 마스킹된 키만 반환. */
export function list(): ApiKeyMeta[] {
  const envPath = resolveEnvPath(false)
  const env = readEnvAsMap(envPath)
  const out: ApiKeyMeta[] = []
  for (const [provider, envKey] of Object.entries(PROVIDER_KEY_MAP) as [KeyProvider, string][]) {
    const value = env[envKey] || process.env[envKey] || ""
    const meta = stmtMetaGet.get(provider) as
      | { provider: string; masked_key: string; is_valid: number; last_tested: number | null }
      | undefined
    out.push({
      provider,
      maskedKey: value ? maskKey(value) : "",
      isValid: meta ? Number(meta.is_valid) === 1 : false,
      lastTested: meta?.last_tested ?? null,
      hasKey: Boolean(value),
    })
  }
  return out
}

/** 키 갱신 — .env 파일 + process.env + 메타 동시 반영. */
export function update(provider: KeyProvider, newKey: string): { provider: KeyProvider; maskedKey: string } {
  if (!PROVIDER_KEY_MAP[provider]) throw new Error("unknown_provider")
  const v = String(newKey ?? "").trim()
  if (!v) throw new Error("empty_key")
  if (v.includes("•") || v.includes("...")) throw new Error("masked_value_rejected")
  const envKey = PROVIDER_KEY_MAP[provider]
  const envPath = resolveEnvPath(true)
  upsertEnvKey(envPath, envKey, v)
  process.env[envKey] = v
  const masked = maskKey(v)
  persistMeta(provider, masked, null, null)
  logger.info("[apiKeysStore] update", { provider, envKey, maskedKey: masked, envPath })
  return { provider, maskedKey: masked }
}

/** 키 삭제 — .env 라인 + process.env + 메타 모두 제거. */
export function remove(provider: KeyProvider): void {
  if (!PROVIDER_KEY_MAP[provider]) throw new Error("unknown_provider")
  const envKey = PROVIDER_KEY_MAP[provider]
  const envPath = resolveEnvPath(true)
  removeEnvKey(envPath, envKey)
  delete process.env[envKey]
  stmtMetaDelete.run(provider)
  logger.info("[apiKeysStore] delete", { provider, envKey })
}

/**
 * 키 유효성 검증.
 * 가벼운 호출(모델 리스트, /v1/models, billing) 위주 — LLM 직접 호출 회피.
 * 결과는 api_keys_meta.is_valid + last_tested 에 기록.
 */
export async function test(provider: KeyProvider): Promise<{ ok: boolean; valid: boolean; error?: string }> {
  if (!PROVIDER_KEY_MAP[provider]) return { ok: false, valid: false, error: "unknown_provider" }
  const envKey = PROVIDER_KEY_MAP[provider]
  const key = process.env[envKey] || readEnvAsMap(resolveEnvPath(false))[envKey] || ""
  if (!key) return { ok: false, valid: false, error: "no_key" }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)

  try {
    let valid = false
    if (provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal,
      })
      valid = r.ok
    } else if (provider === "anthropic") {
      // /v1/models 는 일부 워크스페이스에서 미지원 → 가장 짧은 messages 호출로 검증.
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1,
          messages: [{ role: "user", content: "ok" }],
        }),
        signal: controller.signal,
      })
      // 200 = ok, 400 = bad request 이지만 키는 valid, 401/403 만 invalid
      valid = r.status === 200 || r.status === 400
    } else if (provider === "gemini") {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
        signal: controller.signal,
      })
      valid = r.ok
    } else if (provider === "deepseek") {
      const r = await fetch("https://api.deepseek.com/user/balance", {
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal,
      })
      valid = r.ok
    } else if (provider === "perplexity") {
      const r = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "sonar",
          messages: [{ role: "user", content: "ok" }],
          max_tokens: 1,
        }),
        signal: controller.signal,
      })
      valid = r.status === 200 || r.status === 400
    } else if (provider === "fal") {
      // fal.ai 는 v1 status endpoint 가 키 검증에 충분 (호출당 비용 없음).
      const r = await fetch("https://queue.fal.run/", {
        headers: { Authorization: `Key ${key}` },
        signal: controller.signal,
      })
      // 인증된 클라이언트는 200 이외에도 405/404 가능 — 401 만 명확한 invalid.
      valid = r.status !== 401 && r.status !== 403
    }
    persistMeta(provider, maskKey(key), valid, Date.now())
    return { ok: true, valid }
  } catch (e: any) {
    const errMsg = e?.message ?? String(e)
    persistMeta(provider, maskKey(key), false, Date.now())
    logger.warn("[apiKeysStore] test failed", { provider, error: errMsg })
    return { ok: false, valid: false, error: errMsg }
  } finally {
    clearTimeout(timer)
  }
}

/** 다른 모듈에서 공통으로 쓰는 헬퍼 — 현재 .env 파일 경로. */
export function getEnvPath(): string {
  return resolveEnvPath(false)
}
