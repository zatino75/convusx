/**
 * creditStore.ts — 프로바이더별 크레딧 충전/사용 추적 (영구 저장).
 *
 * 2026-04-25 신규 + Phase 7 확장 (provider 분리).
 *
 * 저장: server/data/credits.json
 *
 * 모델:
 *   - entries: append-only [charge|usage] 거래.
 *   - 각 entry 는 provider 를 포함 → 프로바이더별 잔액 집계.
 *   - 레거시 entry(provider 없음)는 "unknown" 으로 분류.
 *
 * 동시성: 단일 노드 프로세스 + 동기 fs. LLM 호출 빈도엔 충분.
 */

import fs from "node:fs"
import path from "node:path"
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
  id: string
  type: CreditEntryType
  provider: string      // ProviderId 권장. 레거시는 "unknown" 가능.
  amount: number        // USD, 항상 양수. 차감은 type 으로 구분.
  memo?: string
  timestamp: number     // unix ms
  balanceAfter: number  // 해당 provider 의 누적 잔액(charge - usage)
}

export interface CreditChargeView {
  date: string
  amount: number
  memo: string
  balance: number
  provider: string
}

export interface ProviderCreditSummary {
  provider: string
  /** 수동 충전 - 사용 누적. (= 충전 fallback 잔액) */
  balance: number
  totalCharged: number
  totalUsed: number
  /** 해당 provider 충전 내역 (최신순, 최대 historyLimit) */
  history: CreditChargeView[]
}

const STORE_PATH = "server/data/credits.json"

interface FileShape {
  entries: CreditEntry[]
}

let cache: FileShape | null = null

function ensureDataDir(): void {
  const dir = path.dirname(STORE_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function load(): FileShape {
  if (cache) return cache
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, "utf-8")
      const parsed = JSON.parse(raw) as FileShape
      if (parsed && Array.isArray(parsed.entries)) {
        cache = { entries: parsed.entries.map(e => ({ ...e, provider: e.provider ?? "unknown" })) }
        return cache
      }
    }
  } catch (e) {
    logger.warn("[creditStore] load failed, starting empty", { error: String(e) })
  }
  cache = { entries: [] }
  return cache
}

function persist(): void {
  if (!cache) return
  try {
    ensureDataDir()
    fs.writeFileSync(STORE_PATH, JSON.stringify(cache, null, 2), "utf-8")
  } catch (e) {
    logger.warn("[creditStore] persist failed", { error: String(e) })
  }
}

function nextId(): string {
  return `cr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** provider 별 직전 잔액 = 같은 provider 의 마지막 entry.balanceAfter. */
function lastBalanceFor(provider: string): number {
  const data = load()
  for (let i = data.entries.length - 1; i >= 0; i--) {
    if (data.entries[i].provider === provider) return data.entries[i].balanceAfter
  }
  return 0
}

function append(type: CreditEntryType, provider: string, amount: number, memo?: string): CreditEntry {
  const data = load()
  const sign = type === "charge" ? 1 : -1
  const prevBal = lastBalanceFor(provider)
  const balanceAfter = +(prevBal + sign * amount).toFixed(6)
  const entry: CreditEntry = {
    id: nextId(),
    type,
    provider,
    amount: +amount.toFixed(6),
    memo: memo?.trim() || undefined,
    timestamp: Date.now(),
    balanceAfter,
  }
  data.entries.push(entry)
  persist()
  return entry
}

// ── 모델 → provider 매핑 ──────────────────────────────────────────
/**
 * adapter 레벨에서 provider 가 명시 안 된 경우 모델 ID prefix 로 추론.
 * 매핑 누락 시 "unknown".
 */
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

/** 수동 충전. provider 가 PROVIDER_IDS 외면 그대로 저장하되 UI 는 무시. */
export function addCredit(provider: string, amount: number, memo?: string): CreditEntry {
  const v = Number(amount)
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error("amount must be a positive number")
  }
  const p = String(provider || "").toLowerCase().trim() || "unknown"
  const entry = append("charge", p, v, memo)
  logger.info("[creditStore] charge", {
    provider: p, amount: entry.amount, memo: entry.memo, balance: entry.balanceAfter,
  })
  return entry
}

/**
 * LLM 호출 cost_usd 차감.
 * provider 미지정 시 model ID 로부터 추론 (둘 다 없으면 "unknown").
 */
export function recordUsage(amount: number, opts?: { provider?: string; model?: string; memo?: string }): void {
  const v = Number(amount)
  if (!Number.isFinite(v) || v <= 0) return
  const explicit = String(opts?.provider ?? "").toLowerCase().trim()
  const inferred = providerFromModel(opts?.model)
  const p = explicit || inferred
  append("usage", p, v, opts?.memo)
}

/** 단일 provider 의 잔액(누적 charge - usage). 없으면 0. */
export function getBalance(provider: string): number {
  return lastBalanceFor(String(provider || "").toLowerCase())
}

/** 단일 provider 요약 (history 포함). */
export function getProviderSummary(provider: string, historyLimit = 10): ProviderCreditSummary {
  const data = load()
  const p = String(provider || "").toLowerCase()
  let charged = 0
  let used = 0
  for (const e of data.entries) {
    if (e.provider !== p) continue
    if (e.type === "charge") charged += e.amount
    else if (e.type === "usage") used += e.amount
  }
  const history = data.entries
    .filter(e => e.provider === p && e.type === "charge")
    .slice(-historyLimit)
    .reverse()
    .map(e => ({
      date: new Date(e.timestamp).toISOString(),
      amount: e.amount,
      memo: e.memo ?? "",
      balance: e.balanceAfter,
      provider: e.provider,
    }))
  return {
    provider: p,
    balance: +(charged - used).toFixed(6),
    totalCharged: +charged.toFixed(6),
    totalUsed: +used.toFixed(6),
    history,
  }
}

/** PROVIDER_IDS 전체에 대한 요약. UI 카드 6개에 매핑. */
export function getAllProviderSummaries(historyLimit = 10): Record<ProviderId, ProviderCreditSummary> {
  const out = {} as Record<ProviderId, ProviderCreditSummary>
  for (const p of PROVIDER_IDS) out[p] = getProviderSummary(p, historyLimit)
  return out
}

/** 전체(모든 provider 합산) 요약 — 기존 stats 응답 호환용. */
export interface GlobalCreditSummary {
  balance: number
  totalCharged: number
  totalUsed: number
  history: CreditChargeView[]
}
export function getSummary(historyLimit = 10): GlobalCreditSummary {
  const data = load()
  let charged = 0
  let used = 0
  for (const e of data.entries) {
    if (e.type === "charge") charged += e.amount
    else if (e.type === "usage") used += e.amount
  }
  const history = data.entries
    .filter(e => e.type === "charge")
    .slice(-historyLimit)
    .reverse()
    .map(e => ({
      date: new Date(e.timestamp).toISOString(),
      amount: e.amount,
      memo: e.memo ?? "",
      balance: e.balanceAfter,
      provider: e.provider,
    }))
  return {
    balance: +(charged - used).toFixed(6),
    totalCharged: +charged.toFixed(6),
    totalUsed: +used.toFixed(6),
    history,
  }
}

/** 테스트용 — 캐시/파일 모두 초기화. */
export function _reset(): void {
  cache = { entries: [] }
  persist()
}
