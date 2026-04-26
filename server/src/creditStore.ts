/**
 * creditStore.ts — provider 별 크레딧 충전/사용 추적 (SQLite 영구 저장).
 *
 * 2026-04-25 Phase 8: JSON 파일 → SQLite 전환.
 * 2026-04-26: 잔액 직접 설정(set_balance) / 사용량 리셋(reset) / entry 수정·삭제 도입.
 * 진실 소스(source of truth) = `corvusx.db` 의 credit_entries 테이블.
 *
 * 모델:
 *   - credit_entries: append-only(+ 개별 수정/삭제 가능) 거래.
 *     type: charge | usage | set_balance | reset
 *   - 각 entry 에 provider 포함 → provider 별 잔액 = 가장 최근 set_balance 이후의 차감 합산.
 *   - 레거시 entry(provider 없음)는 "unknown" 으로 분류.
 *
 * 잔액 계산 anchor 방식:
 *   - balance anchor = 가장 최근 set_balance entry. 그 이후 charge/usage 만 합산.
 *     없으면 모든 charge - 모든 usage.
 *   - usage display anchor = 가장 최근 set_balance OR reset (둘 중 timestamp 가 더 큰 것).
 *     이 anchor 이후의 usage 합계만 "사용" 으로 표시.
 *
 * 마이그레이션:
 *   서버 시작 시 server/data/credits.json 또는
 *   server/server/data/credits.json (구 버그 경로) 가 있으면 자동 import 후 .bak 으로 보관.
 *
 * ⚠️ CLAUDE.md 규칙 #22 — in-memory/JSON 회귀 금지. SQLite 만 진실.
 */

import fs from "node:fs"
import path from "node:path"
import { corvusxDb } from "./db/corvusxDb.js"
import { logger } from "./observability/logger.js"

export type CreditEntryType = "charge" | "usage" | "set_balance" | "reset"

/** 정식 프로바이더 ID. fetcher / UI 와 동일한 키 셋. */
export const PROVIDER_IDS = [
  "anthropic",
  "openai",
  "google",
  "deepseek",
  "perplexity",
  "fal",
] as const
export type ProviderId = typeof PROVIDER_IDS[number]

export interface CreditEntry {
  id: number
  type: CreditEntryType
  provider: string
  amount: number      // USD
  memo?: string
  timestamp: number   // unix ms
}

export interface CreditChargeView {
  date: string        // ISO
  amount: number
  memo: string
  balance: number     // 해당 충전 시점의 누적 잔액 (계산값)
  provider: string
}

export interface ProviderCreditSummary {
  provider: string
  balance: number
  totalCharged: number
  totalUsed: number
  history: CreditChargeView[]
}

// ── prepared statements ──────────────────────────────────────────
const stmtInsert = corvusxDb.prepare(`
  INSERT INTO credit_entries (provider, type, amount, memo, timestamp)
  VALUES (?, ?, ?, ?, ?)
`)

/** 가장 최근 set_balance entry (provider 별). */
const stmtLatestSetBalance = corvusxDb.prepare(`
  SELECT id, amount, timestamp
  FROM credit_entries
  WHERE provider = ? AND type='set_balance'
  ORDER BY id DESC
  LIMIT 1
`)

/** 가장 최근 reset entry (provider 별). */
const stmtLatestReset = corvusxDb.prepare(`
  SELECT id, timestamp
  FROM credit_entries
  WHERE provider = ? AND type='reset'
  ORDER BY id DESC
  LIMIT 1
`)

/** 특정 entry id 이후 (id > anchorId) 의 charge/usage 합계. */
const stmtAggAfterId = corvusxDb.prepare(`
  SELECT
    COALESCE(SUM(CASE WHEN type='charge' THEN amount ELSE 0 END), 0) AS charged,
    COALESCE(SUM(CASE WHEN type='usage'  THEN amount ELSE 0 END), 0) AS used
  FROM credit_entries
  WHERE provider = ? AND id > ?
`)

/** anchor 없을 때 — 전체 charge/usage 합계. */
const stmtAggAllForProvider = corvusxDb.prepare(`
  SELECT
    COALESCE(SUM(CASE WHEN type='charge' THEN amount ELSE 0 END), 0) AS charged,
    COALESCE(SUM(CASE WHEN type='usage'  THEN amount ELSE 0 END), 0) AS used
  FROM credit_entries
  WHERE provider = ?
`)

/** 전역 합산 (모든 provider, 모든 type) — 후방 호환 getSummary 용. */
const stmtAggAll = corvusxDb.prepare(`
  SELECT
    COALESCE(SUM(CASE WHEN type='charge' THEN amount ELSE 0 END), 0) AS charged,
    COALESCE(SUM(CASE WHEN type='usage'  THEN amount ELSE 0 END), 0) AS used
  FROM credit_entries
`)

/** provider 충전 history (set_balance anchor 이후 charge 만, 최신순). */
const stmtChargesAfterId = corvusxDb.prepare(`
  SELECT id, amount, memo, timestamp
  FROM credit_entries
  WHERE provider = ? AND type='charge' AND id > ?
  ORDER BY id DESC
  LIMIT ?
`)

/** anchor 없을 때 — 모든 charge entry. */
const stmtChargesAll = corvusxDb.prepare(`
  SELECT id, amount, memo, timestamp
  FROM credit_entries
  WHERE provider = ? AND type='charge'
  ORDER BY id DESC
  LIMIT ?
`)

/** provider 의 모든 entry (수정/삭제 UI용). */
const stmtAllEntries = corvusxDb.prepare(`
  SELECT id, provider, type, amount, memo, timestamp
  FROM credit_entries
  WHERE provider = ?
  ORDER BY id DESC
`)

/** 단일 entry 조회 (id). */
const stmtEntryById = corvusxDb.prepare(`
  SELECT id, provider, type, amount, memo, timestamp
  FROM credit_entries
  WHERE id = ?
`)

const stmtUpdateEntry = corvusxDb.prepare(`
  UPDATE credit_entries SET amount = ?, memo = ? WHERE id = ?
`)

const stmtDeleteById = corvusxDb.prepare(`
  DELETE FROM credit_entries WHERE id = ?
`)

const stmtAllChargesGlobal = corvusxDb.prepare(`
  SELECT id, provider, amount, memo, timestamp
  FROM credit_entries
  WHERE type='charge'
  ORDER BY id DESC
  LIMIT ?
`)

/** 전체 entry 수 — 마이그레이션 idempotent 판정용. */
const stmtCount = corvusxDb.prepare(`SELECT COUNT(*) AS n FROM credit_entries`)

const stmtDeleteAll = corvusxDb.prepare(`DELETE FROM credit_entries`)

// ── 모델 → provider 매핑 ──────────────────────────────────────────
export function providerFromModel(modelId: string | undefined | null): ProviderId | "unknown" {
  const m = String(modelId ?? "").toLowerCase()
  if (!m) return "unknown"
  if (m.startsWith("claude") || m.startsWith("anthropic")) return "anthropic"
  if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("openai")) return "openai"
  if (m.startsWith("gemini") || m.startsWith("google")) return "google"
  if (m.startsWith("deepseek")) return "deepseek"
  if (m.startsWith("sonar") || m.startsWith("perplexity") || m.startsWith("pplx")) return "perplexity"
  if (m.startsWith("fal") || m.includes("nano_banana") || m.startsWith("flux")) return "fal"
  return "unknown"
}

// ── 내부 헬퍼: anchor 기반 잔액/사용 계산 ─────────────────────────
interface SummaryParts {
  balance: number
  totalCharged: number
  totalUsed: number
  setBalanceAnchorId: number | null
  setBalanceAmount: number
  usageAnchorId: number   // 0 이면 anchor 없음
}

function computeSummary(provider: string): SummaryParts {
  const p = String(provider || "").toLowerCase()
  const sb = stmtLatestSetBalance.get(p) as { id: number; amount: number; timestamp: number } | undefined
  const rs = stmtLatestReset.get(p) as { id: number; timestamp: number } | undefined

  // 1) balance: set_balance anchor 기준
  let balance: number
  let totalCharged: number
  if (sb) {
    const after = stmtAggAfterId.get(p, sb.id) as { charged: number; used: number }
    const charged = Number(after?.charged ?? 0)
    const used = Number(after?.used ?? 0)
    balance = Number(sb.amount) + charged - used
    totalCharged = Number(sb.amount) + charged
  } else {
    const agg = stmtAggAllForProvider.get(p) as { charged: number; used: number }
    const charged = Number(agg?.charged ?? 0)
    const used = Number(agg?.used ?? 0)
    balance = charged - used
    totalCharged = charged
  }

  // 2) totalUsed: set_balance OR reset 중 더 최근 anchor 이후 usage 만
  const sbId = sb?.id ?? 0
  const rsId = rs?.id ?? 0
  const usageAnchorId = Math.max(sbId, rsId)
  let totalUsed: number
  if (usageAnchorId > 0) {
    const after = stmtAggAfterId.get(p, usageAnchorId) as { charged: number; used: number }
    totalUsed = Number(after?.used ?? 0)
  } else {
    const agg = stmtAggAllForProvider.get(p) as { charged: number; used: number }
    totalUsed = Number(agg?.used ?? 0)
  }

  return {
    balance: +balance.toFixed(6),
    totalCharged: +totalCharged.toFixed(6),
    totalUsed: +totalUsed.toFixed(6),
    setBalanceAnchorId: sbId || null,
    setBalanceAmount: sb ? Number(sb.amount) : 0,
    usageAnchorId,
  }
}

// ── 공개 API ─────────────────────────────────────────────────────

/** 수동 충전. */
export function addCredit(provider: string, amount: number, memo?: string): { id: number; balanceAfter: number } {
  const v = Number(amount)
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error("amount must be a positive number")
  }
  const p = String(provider || "").toLowerCase().trim() || "unknown"
  const memoStr = memo?.trim() || null
  const ts = Date.now()
  const result = stmtInsert.run(p, "charge", +v.toFixed(6), memoStr, ts)
  const id = Number(result.lastInsertRowid)
  const parts = computeSummary(p)
  logger.info("[creditStore] charge", { provider: p, amount: v, memo: memoStr, balance: parts.balance })
  return { id, balanceAfter: parts.balance }
}

/**
 * 현재 잔액을 newBalance 로 강제 설정.
 * 누적 차감 결과를 무시하고 입력값을 새 baseline 으로 만든다.
 * (이후 잔액 = newBalance + (이후 charge) - (이후 usage))
 */
export function setBalance(provider: string, newBalance: number, memo?: string): { id: number; balance: number } {
  const v = Number(newBalance)
  if (!Number.isFinite(v) || v < 0) {
    throw new Error("balance must be a non-negative number")
  }
  const p = String(provider || "").toLowerCase().trim() || "unknown"
  const memoStr = memo?.trim() || null
  const ts = Date.now()
  const result = stmtInsert.run(p, "set_balance", +v.toFixed(6), memoStr, ts)
  const id = Number(result.lastInsertRowid)
  logger.info("[creditStore] set_balance", { provider: p, balance: v, memo: memoStr })
  return { id, balance: +v.toFixed(6) }
}

/**
 * 사용량 카운터 리셋. 충전 기록은 유지.
 * 이 시점 이후 usage 만 "사용"으로 표시되며, 잔액 계산에도 영향.
 */
export function resetUsage(provider: string, memo?: string): { id: number } {
  const p = String(provider || "").toLowerCase().trim() || "unknown"
  const memoStr = memo?.trim() || null
  const ts = Date.now()
  const result = stmtInsert.run(p, "reset", 0, memoStr, ts)
  const id = Number(result.lastInsertRowid)
  logger.info("[creditStore] reset_usage", { provider: p, memo: memoStr })
  return { id }
}

/** entry 수정 (amount/memo). type/provider/timestamp 는 불변. */
export function updateEntry(id: number, newAmount: number, newMemo?: string): { ok: boolean } {
  const numericId = Number(id)
  if (!Number.isFinite(numericId) || numericId <= 0) {
    throw new Error("invalid entry id")
  }
  const v = Number(newAmount)
  if (!Number.isFinite(v) || v < 0) {
    throw new Error("amount must be a non-negative number")
  }
  const existing = stmtEntryById.get(numericId) as { id: number; type: string } | undefined
  if (!existing) throw new Error("entry not found")
  const memoStr = newMemo === undefined ? null : (String(newMemo).trim() || null)
  stmtUpdateEntry.run(+v.toFixed(6), memoStr, numericId)
  logger.info("[creditStore] update", { id: numericId, amount: v, memo: memoStr })
  return { ok: true }
}

/** entry 삭제. */
export function deleteEntry(id: number): { ok: boolean } {
  const numericId = Number(id)
  if (!Number.isFinite(numericId) || numericId <= 0) {
    throw new Error("invalid entry id")
  }
  const existing = stmtEntryById.get(numericId) as { id: number } | undefined
  if (!existing) throw new Error("entry not found")
  stmtDeleteById.run(numericId)
  logger.info("[creditStore] delete", { id: numericId })
  return { ok: true }
}

/** 해당 provider 의 모든 entry (수정/삭제 UI용). */
export function getAllEntries(provider: string): CreditEntry[] {
  const p = String(provider || "").toLowerCase()
  const rows = stmtAllEntries.all(p) as Array<{
    id: number; provider: string; type: string; amount: number; memo: string | null; timestamp: number
  }>
  return rows.map(r => ({
    id: r.id,
    type: r.type as CreditEntryType,
    provider: r.provider,
    amount: Number(r.amount),
    memo: r.memo ?? "",
    timestamp: Number(r.timestamp),
  }))
}

/** LLM 호출 cost_usd 차감. provider 미지정 시 model ID 로부터 추론. */
export function recordUsage(amount: number, opts?: { provider?: string; model?: string; memo?: string }): void {
  const v = Number(amount)
  if (!Number.isFinite(v) || v <= 0) return
  const explicit = String(opts?.provider ?? "").toLowerCase().trim()
  const inferred = providerFromModel(opts?.model)
  const p = explicit || inferred
  const memo = opts?.memo?.trim() || null
  stmtInsert.run(p, "usage", +v.toFixed(6), memo, Date.now())
}

/** 단일 provider 잔액. */
export function getBalance(provider: string): number {
  return computeSummary(provider).balance
}

/** 단일 provider 요약 (history 포함). */
export function getProviderSummary(provider: string, historyLimit = 10): ProviderCreditSummary {
  const p = String(provider || "").toLowerCase()
  const parts = computeSummary(p)

  // history: set_balance anchor 가 있으면 그 이후 charge 만 (이전 충전은 baseline 에 흡수됨).
  const charges = parts.setBalanceAnchorId
    ? (stmtChargesAfterId.all(p, parts.setBalanceAnchorId, historyLimit) as Array<{
        id: number; amount: number; memo: string | null; timestamp: number
      }>)
    : (stmtChargesAll.all(p, historyLimit) as Array<{
        id: number; amount: number; memo: string | null; timestamp: number
      }>)

  // 각 charge 시점 누적 잔액 = anchor baseline + (anchor 이후 ~ 이 charge 까지) charge - usage
  const history: CreditChargeView[] = charges.map(c => {
    const after = stmtAggAfterId.get(p, parts.setBalanceAnchorId ?? 0) as { charged: number; used: number }
    // 위 stmtAggAfterId 는 anchor 이후 전체 합. 시점별 누적이 정확하려면 id <= c.id 로 좁혀야 함.
    void after
    const balRow = corvusxDb
      .prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN type='charge' THEN amount ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN type='usage' THEN amount ELSE 0 END), 0) AS bal
        FROM credit_entries
        WHERE provider = ? AND id > ? AND id <= ?
      `)
      .get(p, parts.setBalanceAnchorId ?? 0, c.id) as { bal: number }
    const baselineBal = parts.setBalanceAnchorId ? parts.setBalanceAmount : 0
    return {
      date: new Date(Number(c.timestamp)).toISOString(),
      amount: Number(c.amount),
      memo: c.memo ?? "",
      balance: +(baselineBal + Number(balRow?.bal ?? 0)).toFixed(6),
      provider: p,
    }
  })

  return {
    provider: p,
    balance: parts.balance,
    totalCharged: parts.totalCharged,
    totalUsed: parts.totalUsed,
    history,
  }
}

/** PROVIDER_IDS 전체 요약. UI 카드 6 개에 매핑. */
export function getAllProviderSummaries(historyLimit = 10): Record<ProviderId, ProviderCreditSummary> {
  const out = {} as Record<ProviderId, ProviderCreditSummary>
  for (const p of PROVIDER_IDS) out[p] = getProviderSummary(p, historyLimit)
  return out
}

/** 전체 합산 요약 (후방 호환). */
export interface GlobalCreditSummary {
  balance: number
  totalCharged: number
  totalUsed: number
  history: CreditChargeView[]
}
export function getSummary(historyLimit = 10): GlobalCreditSummary {
  // 전역 합산은 anchor 적용이 모호하므로 단순 SUM 으로 유지 (후방 호환).
  const agg = stmtAggAll.get() as { charged: number; used: number }
  const charged = Number(agg?.charged ?? 0)
  const used = Number(agg?.used ?? 0)
  const charges = stmtAllChargesGlobal.all(historyLimit) as Array<{
    id: number; provider: string; amount: number; memo: string | null; timestamp: number
  }>
  const history: CreditChargeView[] = charges.map(c => ({
    date: new Date(Number(c.timestamp)).toISOString(),
    amount: Number(c.amount),
    memo: c.memo ?? "",
    balance: 0,
    provider: String(c.provider),
  }))
  return {
    balance: +(charged - used).toFixed(6),
    totalCharged: +charged.toFixed(6),
    totalUsed: +used.toFixed(6),
    history,
  }
}

/** 디버그/테스트용 — 모든 entry 삭제. */
export function _reset(): void {
  stmtDeleteAll.run()
}

// ── credits.json 마이그레이션 (1회) ──────────────────────────────
/**
 * 서버 시작 시 1회 실행.
 * 후보 경로:
 *   - server/data/credits.json (이상)
 *   - server/server/data/credits.json (이전 cwd 버그 경로)
 * 발견되면 entries 를 SQLite 에 import 한 뒤 파일을 .bak 으로 rename.
 * 이미 SQLite 에 데이터가 있으면 import 건너뜀(idempotent).
 */
function migrateJsonOnce(): void {
  try {
    const count = (stmtCount.get() as { n: number })?.n ?? 0
    if (count > 0) return  // 이미 데이터 있음 → 스킵

    const candidates = [
      path.resolve(process.cwd(), "data", "credits.json"),     // cwd=/opt/corvusx/server
      path.resolve(process.cwd(), "server", "data", "credits.json"),  // 구 버그 경로
    ]
    for (const p of candidates) {
      if (!fs.existsSync(p)) continue
      try {
        const raw = fs.readFileSync(p, "utf-8")
        const parsed = JSON.parse(raw) as { entries?: any[] }
        const entries = Array.isArray(parsed?.entries) ? parsed.entries : []
        if (entries.length === 0) {
          fs.renameSync(p, p + ".bak")
          continue
        }
        const tx = corvusxDb.transaction((rows: any[]) => {
          for (const e of rows) {
            const type = e.type === "usage" ? "usage" : "charge"
            const amount = Number(e.amount)
            if (!Number.isFinite(amount) || amount <= 0) continue
            const provider = String(e.provider ?? "unknown").toLowerCase()
            const memo = e.memo ? String(e.memo).slice(0, 200) : null
            const ts = Number(e.timestamp ?? Date.now())
            stmtInsert.run(provider, type, amount, memo, ts)
          }
        })
        tx(entries)
        fs.renameSync(p, p + ".bak")
        logger.info("[creditStore] migrated credits.json → SQLite", {
          from: p, imported: entries.length,
        })
        return
      } catch (e) {
        logger.warn("[creditStore] migration failed", { path: p, error: String(e) })
      }
    }
  } catch (e) {
    logger.warn("[creditStore] migrateJsonOnce error", { error: String(e) })
  }
}

migrateJsonOnce()
