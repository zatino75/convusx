/**
 * settingsStore.ts — 앱 설정 영구 저장 (SQLite).
 *
 * 2026-04-29 신규.
 * 설정값은 settings 테이블에 (key, JSON value, updated_at) 로 저장.
 * defaultModel 은 'claude-sonnet-4-6' 으로 잠금 (CLAUDE.md 규칙 #18/#20).
 *
 * 호출처:
 *   - routes/settings.ts: GET/PUT /api/settings
 *   - costGuard 통합: dailyWarn/dailyLimit/dailyBlock/monthlyLimit
 *   - DepartmentRegistry: 부서별 enabled 토글
 */

import { corvusxDb } from "./db/corvusxDb.js"
import { logger } from "./observability/logger.js"
import { PROVIDER_IDS, type ProviderId } from "./creditStore.js"

const LOCKED_DEFAULT_MODEL = "claude-sonnet-4-6"

export interface ProfileSettings {
  name?: string
  role?: string
  expertise?: string[]
}

export interface CostGuardSettings {
  dailyWarn: number      // USD 임계값 — 로그 경고
  dailyLimit: number     // director 모드 차단
  dailyBlock: number     // 모든 LLM 호출 503 차단
  monthlyLimit: number   // 월간 누적 한도
}

export interface DepartmentSetting {
  enabled: boolean
  primaryModel?: string
}

export interface ConnectorSetting {
  enabled: boolean
  config?: Record<string, unknown>
}

export interface NotificationSettings {
  email?: string
  alertOnLimit: boolean
  alertOnError: boolean
}

export interface AppSettings {
  profile: ProfileSettings
  defaultModel: string
  classifierModel: "gemini-flash" | "haiku"
  costGuard: CostGuardSettings
  departments: Record<string, DepartmentSetting>
  connectors: Record<string, ConnectorSetting>
  notifications: NotificationSettings
}

// ── 기본값 ────────────────────────────────────────────────────────
const DEFAULT_DEPT_IDS = [
  "market", "compete", "legal", "finance", "marketing",
  "rnd", "data", "content", "sns", "design",
] as const

const DEFAULT_CONNECTOR_IDS = [
  "tavily", "perplexity", "serper", "posthog",
  "pubmed", "supabase", "mfds_rss", "notion",
  "naver_news", "google",
] as const

function buildDefaults(): AppSettings {
  const departments: Record<string, DepartmentSetting> = {}
  for (const d of DEFAULT_DEPT_IDS) departments[d] = { enabled: true }
  const connectors: Record<string, ConnectorSetting> = {}
  for (const c of DEFAULT_CONNECTOR_IDS) connectors[c] = { enabled: false }
  return {
    profile: {},
    defaultModel: LOCKED_DEFAULT_MODEL,
    classifierModel: "gemini-flash",
    costGuard: {
      dailyWarn: 5,
      dailyLimit: 10,
      dailyBlock: 20,
      monthlyLimit: 100,
    },
    departments,
    connectors,
    notifications: {
      alertOnLimit: true,
      alertOnError: false,
    },
  }
}

// ── prepared statements ──────────────────────────────────────────
const stmtGet = corvusxDb.prepare(`SELECT value FROM settings WHERE key = ?`)
const stmtSet = corvusxDb.prepare(`
  INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`)
const stmtAll = corvusxDb.prepare(`SELECT key, value FROM settings`)
const stmtDelete = corvusxDb.prepare(`DELETE FROM settings WHERE key = ?`)

// ── 내부 헬퍼 ────────────────────────────────────────────────────
function readKey<T>(key: string): T | undefined {
  const row = stmtGet.get(key) as { value?: string } | undefined
  if (!row?.value) return undefined
  try { return JSON.parse(row.value) as T } catch { return undefined }
}

function writeKey(key: string, value: unknown): void {
  stmtSet.run(key, JSON.stringify(value), Date.now())
}

// ── 공개 API ─────────────────────────────────────────────────────

/** 단일 키 조회. 미존재 시 undefined. */
export function get<T = unknown>(key: string): T | undefined {
  return readKey<T>(key)
}

/** 단일 키 저장 (JSON 직렬화). */
export function set(key: string, value: unknown): void {
  writeKey(key, value)
}

/** 키 삭제. */
export function remove(key: string): void {
  stmtDelete.run(key)
}

/** 모든 키-값 (raw, JSON 파싱됨). */
function readAllRaw(): Record<string, unknown> {
  const rows = stmtAll.all() as Array<{ key: string; value: string }>
  const out: Record<string, unknown> = {}
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value) }
    catch { /* 파싱 실패 — 무시 */ }
  }
  return out
}

/** 전체 AppSettings 조회 (defaults 위에 저장값 merge). */
export function getAll(): AppSettings {
  const defaults = buildDefaults()
  const stored = readAllRaw()
  const merged: AppSettings = {
    profile:        (stored.profile        as ProfileSettings)               ?? defaults.profile,
    defaultModel:   LOCKED_DEFAULT_MODEL, // 항상 잠금 — 저장값 무시
    classifierModel:(stored.classifierModel as AppSettings["classifierModel"]) ?? defaults.classifierModel,
    costGuard:      { ...defaults.costGuard, ...(stored.costGuard as Partial<CostGuardSettings> ?? {}) },
    departments:    { ...defaults.departments, ...(stored.departments as Record<string, DepartmentSetting> ?? {}) },
    connectors:     { ...defaults.connectors,  ...(stored.connectors  as Record<string, ConnectorSetting> ?? {}) },
    notifications:  { ...defaults.notifications, ...(stored.notifications as Partial<NotificationSettings> ?? {}) },
  }
  return merged
}

/** AppSettings 부분 업데이트. defaultModel 변경 시도는 무시(잠금). */
export function update(partial: Partial<AppSettings>): AppSettings {
  if (partial.profile !== undefined)         writeKey("profile", partial.profile)
  if (partial.classifierModel !== undefined) writeKey("classifierModel", partial.classifierModel)
  if (partial.costGuard !== undefined) {
    const current = (readKey<CostGuardSettings>("costGuard")) ?? buildDefaults().costGuard
    writeKey("costGuard", { ...current, ...partial.costGuard })
  }
  if (partial.departments !== undefined) {
    const current = (readKey<Record<string, DepartmentSetting>>("departments")) ?? buildDefaults().departments
    writeKey("departments", { ...current, ...partial.departments })
  }
  if (partial.connectors !== undefined) {
    const current = (readKey<Record<string, ConnectorSetting>>("connectors")) ?? buildDefaults().connectors
    writeKey("connectors", { ...current, ...partial.connectors })
  }
  if (partial.notifications !== undefined) {
    const current = (readKey<NotificationSettings>("notifications")) ?? buildDefaults().notifications
    writeKey("notifications", { ...current, ...partial.notifications })
  }
  if (partial.defaultModel !== undefined && partial.defaultModel !== LOCKED_DEFAULT_MODEL) {
    logger.warn("[settingsStore] defaultModel 변경 시도 무시 — claude-sonnet-4-6 으로 잠금됨", { attempted: partial.defaultModel })
  }
  return getAll()
}

/** 전체 초기화 (기본값으로). */
export function resetAll(): void {
  corvusxDb.exec(`DELETE FROM settings`)
  logger.info("[settingsStore] all settings reset to defaults")
}

/** 부서 활성 여부 — 미설정 시 true. */
export function isDepartmentEnabled(deptId: string): boolean {
  const all = getAll()
  return all.departments[deptId]?.enabled ?? true
}

/** 비용 가드 설정 단축 접근. */
export function getCostGuard(): CostGuardSettings {
  return getAll().costGuard
}

export const PROVIDER_LIST: readonly ProviderId[] = PROVIDER_IDS
