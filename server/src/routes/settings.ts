import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { logger } from "../observability/logger.js"
import { clearAllThreadMemory } from "../memory/threadMemory.js"
import { clearAllProjectMemory } from "../memory/projectMemory.js"
// NOTE (2026-04-11): orchestra/scoreboard 폐기 — resetModelScoreboardAll 제거
import { validateBody, settingsResetRules, validateKeyRules } from "../http/validation.js"
import type { ParsedRequest } from "../http/router.js"
import type { ExpressLikeResponse } from "../http/response.js"
import * as settingsStore from "../settingsStore.js"
import * as instructionsStore from "../instructionsStore.js"
import * as apiKeysStore from "../apiKeysStore.js"
import { reloadNow as reloadEnv } from "../configReloader.js"

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
      // scoreboard 폐기 — 리셋 대상 없음 (tool_call_log 기반으로 전환됨)
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

// ─── 2026-04-29 — 통합 설정 시스템 엔드포인트 ───────────────────────────────
//
// GET    /api/settings              → 전체 AppSettings
// PUT    /api/settings              → 부분 업데이트
// GET    /api/settings/instructions → 지침 목록 (scope 쿼리: 'global' | 'project:<id>')
// POST   /api/settings/instructions → 지침 생성
// PUT    /api/settings/instructions/:id     → 본문 수정
// DELETE /api/settings/instructions/:id     → 삭제
// POST   /api/settings/instructions/:id/toggle → enabled 토글
// GET    /api/settings/api-keys     → 마스킹된 6 프로바이더 키
// PUT    /api/settings/api-keys     → 키 갱신 { provider, key }
// DELETE /api/settings/api-keys/:provider
// POST   /api/settings/api-keys/:provider/test
// GET    /api/settings/export       → 전체 설정 JSON 다운로드
// POST   /api/settings/import       → JSON 업로드 후 일괄 적용

function readQuery(req: ParsedRequest): URLSearchParams {
  try { return new URL(req.url ?? "/", "http://localhost").searchParams }
  catch { return new URLSearchParams() }
}

function pathTail(req: ParsedRequest, prefix: string): string {
  const url = String(req.url ?? "")
  const noQuery = url.split("?")[0]
  const idx = noQuery.indexOf(prefix)
  if (idx < 0) return ""
  return decodeURIComponent(noQuery.slice(idx + prefix.length))
}

// ── GET /api/settings ──────────────────────────────────────────────────────
export function getAppSettingsRoute(_req: ParsedRequest, res: ExpressLikeResponse) {
  res.json({ ok: true, settings: settingsStore.getAll() })
}

// ── PUT /api/settings ──────────────────────────────────────────────────────
export function updateAppSettingsRoute(req: ParsedRequest, res: ExpressLikeResponse) {
  const body = (req?.body ?? {}) as Record<string, unknown>
  try {
    const updated = settingsStore.update(body as any)
    res.json({ ok: true, settings: updated })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "update_failed"
    res.json({ ok: false, error: msg })
  }
}

// ── 지침 — list/create ─────────────────────────────────────────────────────
export function listInstructionsRoute(req: ParsedRequest, res: ExpressLikeResponse) {
  const scope = readQuery(req).get("scope") || "global"
  try {
    if (scope === "global") {
      return res.json({ ok: true, instructions: instructionsStore.listGlobal() })
    }
    if (scope.startsWith("project:")) {
      return res.json({ ok: true, instructions: instructionsStore.listProject(scope.slice("project:".length)) })
    }
    res.json({ ok: false, error: "invalid_scope" })
  } catch (e) {
    res.json({ ok: false, error: e instanceof Error ? e.message : "list_failed" })
  }
}

export function createInstructionRoute(req: ParsedRequest, res: ExpressLikeResponse) {
  const body = (req?.body ?? {}) as Record<string, unknown>
  const scope = String(body.scope ?? "global")
  const content = String(body.content ?? "")
  const enabled = body.enabled === false ? false : true
  try {
    const inst = instructionsStore.create({ scope, content, enabled })
    res.json({ ok: true, instruction: inst })
  } catch (e) {
    res.json({ ok: false, error: e instanceof Error ? e.message : "create_failed" })
  }
}

export function updateInstructionRoute(req: ParsedRequest, res: ExpressLikeResponse) {
  const id = Number(pathTail(req, "/api/settings/instructions/"))
  if (!Number.isFinite(id) || id <= 0) return res.json({ ok: false, error: "invalid_id" })
  const body = (req?.body ?? {}) as Record<string, unknown>
  try {
    const inst = instructionsStore.update(id, String(body.content ?? ""))
    res.json({ ok: true, instruction: inst })
  } catch (e) {
    res.json({ ok: false, error: e instanceof Error ? e.message : "update_failed" })
  }
}

export function deleteInstructionRoute(req: ParsedRequest, res: ExpressLikeResponse) {
  const id = Number(pathTail(req, "/api/settings/instructions/"))
  if (!Number.isFinite(id) || id <= 0) return res.json({ ok: false, error: "invalid_id" })
  try {
    instructionsStore.remove(id)
    res.json({ ok: true })
  } catch (e) {
    res.json({ ok: false, error: e instanceof Error ? e.message : "delete_failed" })
  }
}

export function toggleInstructionRoute(req: ParsedRequest, res: ExpressLikeResponse) {
  // path: /api/settings/instructions/:id/toggle
  const tail = pathTail(req, "/api/settings/instructions/")
  const id = Number(tail.split("/")[0])
  if (!Number.isFinite(id) || id <= 0) return res.json({ ok: false, error: "invalid_id" })
  const body = (req?.body ?? {}) as Record<string, unknown>
  const enabled = body.enabled === false ? false : true
  try {
    const inst = instructionsStore.toggle(id, enabled)
    res.json({ ok: true, instruction: inst })
  } catch (e) {
    res.json({ ok: false, error: e instanceof Error ? e.message : "toggle_failed" })
  }
}

// ── API 키 ──────────────────────────────────────────────────────────────────
export function listApiKeysRoute(_req: ParsedRequest, res: ExpressLikeResponse) {
  res.json({ ok: true, keys: apiKeysStore.list() })
}

export function updateApiKeyRoute(req: ParsedRequest, res: ExpressLikeResponse) {
  const body = (req?.body ?? {}) as Record<string, unknown>
  const provider = String(body.provider ?? "").trim().toLowerCase()
  const key = String(body.key ?? "").trim()
  if (!provider || !key) return res.json({ ok: false, error: "provider_and_key_required" })
  try {
    const result = apiKeysStore.update(provider as any, key)
    // 핫리로드 강제 트리거 — 다른 모듈이 process.env 를 다시 읽도록
    try { reloadEnv() } catch { /* ignore */ }
    res.json({ ok: true, ...result })
  } catch (e) {
    res.json({ ok: false, error: e instanceof Error ? e.message : "update_failed" })
  }
}

export function deleteApiKeyRoute(req: ParsedRequest, res: ExpressLikeResponse) {
  const provider = pathTail(req, "/api/settings/api-keys/").split("/")[0].toLowerCase()
  if (!provider) return res.json({ ok: false, error: "provider_required" })
  try {
    apiKeysStore.remove(provider as any)
    try { reloadEnv() } catch { /* ignore */ }
    res.json({ ok: true })
  } catch (e) {
    res.json({ ok: false, error: e instanceof Error ? e.message : "delete_failed" })
  }
}

export async function testApiKeyRoute(req: ParsedRequest, res: ExpressLikeResponse) {
  // path: /api/settings/api-keys/:provider/test
  const tail = pathTail(req, "/api/settings/api-keys/")
  const provider = tail.split("/")[0].toLowerCase()
  if (!provider) return res.json({ ok: false, error: "provider_required" })
  try {
    const result = await apiKeysStore.test(provider as any)
    res.json(result)
  } catch (e) {
    res.json({ ok: false, valid: false, error: e instanceof Error ? e.message : "test_failed" })
  }
}

// ── Export / Import ────────────────────────────────────────────────────────
export function exportSettingsRoute(_req: ParsedRequest, res: ExpressLikeResponse) {
  const payload = {
    schema: "corvusx-settings/v1",
    exportedAt: new Date().toISOString(),
    settings: settingsStore.getAll(),
    instructions: {
      global: instructionsStore.listGlobal(),
    },
    apiKeys: apiKeysStore.list().map(k => ({
      provider: k.provider, hasKey: k.hasKey, isValid: k.isValid, lastTested: k.lastTested,
    })),
  }
  res.setHeader("Content-Disposition", `attachment; filename="corvusx-settings-${Date.now()}.json"`)
  res.json(payload)
}

export function importSettingsRoute(req: ParsedRequest, res: ExpressLikeResponse) {
  const body = (req?.body ?? {}) as Record<string, unknown>
  const settings = body.settings as Record<string, unknown> | undefined
  const instructions = body.instructions as { global?: Array<Record<string, unknown>> } | undefined

  let appliedSettings = false
  let appliedInstructions = 0
  try {
    if (settings && typeof settings === "object") {
      settingsStore.update(settings as any)
      appliedSettings = true
    }
    if (instructions?.global && Array.isArray(instructions.global)) {
      for (const item of instructions.global) {
        const content = String((item as any)?.content ?? "")
        if (!content) continue
        instructionsStore.create({
          scope: "global",
          content,
          enabled: (item as any)?.enabled !== false,
        })
        appliedInstructions += 1
      }
    }
    logger.info("[settings] import 적용", { appliedSettings, appliedInstructions })
    res.json({ ok: true, appliedSettings, appliedInstructions })
  } catch (e) {
    res.json({ ok: false, error: e instanceof Error ? e.message : "import_failed" })
  }
}
