/**
 * creditStore.ts — 수동 크레딧 충전 + 사용량 차감 추적 (영구 저장).
 *
 * 2026-04-25 신규.
 *
 * 저장 위치: server/data/credits.json (cwd 기준 상대 경로 — pos/sales 와 동일 패턴)
 *
 * 모델:
 *   - 모든 거래(충전/사용)를 entries 배열에 append-only 로 저장.
 *   - balance = sum(charge) - sum(usage).
 *   - 충전은 사용자가 명시적으로 추가, 사용은 costStore.record() 호출 시 자동 차감.
 *
 * 동시성: 단일 노드 프로세스 내 in-memory 캐시 + 동기 파일 쓰기.
 *   - 호출량이 분당 수백 건 미만 (LLM 호출 빈도) → 동기 fs 로 충분.
 *   - 서버 재시작 시 파일에서 복원.
 */

import fs from "node:fs"
import path from "node:path"
import { logger } from "./observability/logger.js"

export type CreditEntryType = "charge" | "usage"

export interface CreditEntry {
  id: string
  type: CreditEntryType
  amount: number      // USD. 항상 양수. 차감은 type 으로 구분.
  memo?: string
  timestamp: number   // unix ms
  balanceAfter: number
}

export interface CreditChargeView {
  date: string        // ISO (KST 표시는 UI 에서)
  amount: number
  memo: string
  balance: number
}

export interface CreditSummary {
  balance: number
  totalCharged: number
  totalUsed: number
  history: CreditChargeView[]   // 최근 충전 내역 (최신순, 기본 10건)
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
        cache = { entries: parsed.entries }
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

function recompute(): number {
  const data = load()
  let bal = 0
  for (const e of data.entries) {
    if (e.type === "charge") bal += e.amount
    else if (e.type === "usage") bal -= e.amount
  }
  return +bal.toFixed(6)
}

function append(type: CreditEntryType, amount: number, memo?: string): CreditEntry {
  const data = load()
  const sign = type === "charge" ? 1 : -1
  const prevBal = data.entries.length > 0
    ? data.entries[data.entries.length - 1].balanceAfter
    : 0
  const balanceAfter = +(prevBal + sign * amount).toFixed(6)
  const entry: CreditEntry = {
    id: nextId(),
    type,
    amount: +amount.toFixed(6),
    memo: memo?.trim() || undefined,
    timestamp: Date.now(),
    balanceAfter,
  }
  data.entries.push(entry)
  persist()
  return entry
}

// ── 공개 API ─────────────────────────────────────────────────────

export function addCredit(amount: number, memo?: string): CreditEntry {
  const v = Number(amount)
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error("amount must be a positive number")
  }
  const entry = append("charge", v, memo)
  logger.info("[creditStore] charge", {
    amount: entry.amount, memo: entry.memo, balance: entry.balanceAfter,
  })
  return entry
}

/** LLM 호출 cost_usd 를 잔액에서 차감. 0/음수/NaN 은 무시. */
export function recordUsage(amount: number, memo?: string): void {
  const v = Number(amount)
  if (!Number.isFinite(v) || v <= 0) return
  append("usage", v, memo)
}

export function getBalance(): number {
  return recompute()
}

export function getHistory(limit = 10): CreditChargeView[] {
  const data = load()
  return data.entries
    .filter(e => e.type === "charge")
    .slice(-limit)
    .reverse()
    .map(e => ({
      date: new Date(e.timestamp).toISOString(),
      amount: e.amount,
      memo: e.memo ?? "",
      balance: e.balanceAfter,
    }))
}

export function getSummary(historyLimit = 10): CreditSummary {
  const data = load()
  let charged = 0
  let used = 0
  for (const e of data.entries) {
    if (e.type === "charge") charged += e.amount
    else if (e.type === "usage") used += e.amount
  }
  return {
    balance: +(charged - used).toFixed(6),
    totalCharged: +charged.toFixed(6),
    totalUsed: +used.toFixed(6),
    history: getHistory(historyLimit),
  }
}

/** 테스트용 — 캐시와 파일 모두 초기화. */
export function _reset(): void {
  cache = { entries: [] }
  persist()
}
