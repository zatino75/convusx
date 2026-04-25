/**
 * creditStore.ts — provider 별 크레딧 충전/사용 추적 (SQLite 영구 저장).
 *
 * 2026-04-25 Phase 8: JSON 파일 → SQLite 전환.
 * 진실 소스(source of truth) = `corvusx.db` 의 credit_entries 테이블.
 *
 * 모델:
 *   - credit_entries: append-only [charge|usage] 거래.
 *   - 각 entry 에 provider 포함 → provider 별 잔액 = SUM(charge) - SUM(usage).
 *   - 레거시 entry(provider 없음)는 "unknown" 으로 분류.
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

export type CreditEntryType = "charge" | "usage"

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
  amount: number      // USD, 항상 양수.
  memo?: string
  timestamp: number   // unix ms
  /** SQL view: SUM(charge) - SUM(usage) WHERE id <= 자기. (조회 시 계산) */
  balanceAfter: number
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

const stmtAggProvider = corvusxDb.prepare(`
  SELECT
    COALESCE(SUM(CASE WHEN type='charge' THEN amount ELSE 0 END), 0) AS charged,
    COALESCE(SUM(CASE WHEN type='usage'  THEN amount ELSE 0 END), 0) AS used
  FROM credit_entries
  WHERE provider = ?
`)

const stmtAggAll = corvusxDb.prepare(`
  SELECT
    COALESCE(SUM(CASE WHEN type='charge' THEN amount ELSE 0 END), 0) AS charged,
    COALESCE(SUM(CASE WHEN type='usage'  THEN amount ELSE 0 END), 0) AS used
  FROM credit_entries
`)

/** provider 충전 history (최신순). balanceAfter 는 조회 시 누적 합산해서 계산. */
const stmtChargesByProvider = corvusxDb.prepare(`
  SELECT id, amount, memo, timestamp
  FROM credit_entries
  WHERE provider = ? AND type='charge'
  ORDER BY id DESC
  LIMIT ?
`)

/** provider 의 N번째 entry 까지 누적 잔액. (history 의 balanceAfter 계산용) */
const stmtBalanceUpToId = corvusxDb.prepare(`
  SELECT
    COALESCE(SUM(CASE WHEN type='charge' THEN amount ELSE 0 END), 0)
    -
    COALESCE(SUM(CASE WHEN type='usage'  THEN amount ELSE 0 END), 0) AS bal
  FROM credit_entries
  WHERE provider = ? AND id <= ?
`)

/** 전체 충전 history (모든 provider). */
const stmtAllCharges = corvusxDb.prepare(`
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
  const bal = (stmtBalanceUpToId.get(p, id) as { bal: number })?.bal ?? 0
  logger.info("[creditStore] charge", { provider: p, amount: v, memo: memoStr, balance: bal })
  return { id, balanceAfter: +Number(bal).toFixed(6) }
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
  const p = String(provider || "").toLowerCase()
  const r = stmtAggProvider.get(p) as { charged: number; used: number }
  return +(Number(r?.charged ?? 0) - Number(r?.used ?? 0)).toFixed(6)
}

/** 단일 provider 요약 (history 포함). */
export function getProviderSummary(provider: string, historyLimit = 10): ProviderCreditSummary {
  const p = String(provider || "").toLowerCase()
  const agg = stmtAggProvider.get(p) as { charged: number; used: number }
  const charged = Number(agg?.charged ?? 0)
  const used = Number(agg?.used ?? 0)
  const charges = stmtChargesByProvider.all(p, historyLimit) as Array<{
    id: number; amount: number; memo: string | null; timestamp: number
  }>
  const history: CreditChargeView[] = charges.map(c => {
    const balRow = stmtBalanceUpToId.get(p, c.id) as { bal: number }
    return {
      date: new Date(Number(c.timestamp)).toISOString(),
      amount: Number(c.amount),
      memo: c.memo ?? "",
      balance: +Number(balRow?.bal ?? 0).toFixed(6),
      provider: p,
    }
  })
  return {
    provider: p,
    balance: +(charged - used).toFixed(6),
    totalCharged: +charged.toFixed(6),
    totalUsed: +used.toFixed(6),
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
  const agg = stmtAggAll.get() as { charged: number; used: number }
  const charged = Number(agg?.charged ?? 0)
  const used = Number(agg?.used ?? 0)
  const charges = stmtAllCharges.all(historyLimit) as Array<{
    id: number; provider: string; amount: number; memo: string | null; timestamp: number
  }>
  // 전역 history 의 balance 는 누적 의미가 모호 → 0 으로 둠 (UI 가 provider 별을 우선).
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
