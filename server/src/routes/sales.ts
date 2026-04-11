// sales.ts — CORVUS X 매출 대시보드 라우트
import fs from "fs"
import path from "path"
import { logger } from "../observability/logger.js"

const SALES_PATH = "server/data/sales.jsonl"

export interface SalesEntry {
  id: string
  date: string          // YYYY-MM-DD
  platform: "smartstore" | "coupang" | "own" | "other"
  revenue: number       // 원
  orders: number
  memo?: string
  createdAt: string
}

// ── 파일 유틸 ──────────────────────────────────────────────────────────────

function ensureDataDir() {
  const dir = path.dirname(SALES_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function readAll(): SalesEntry[] {
  try {
    if (!fs.existsSync(SALES_PATH)) return []
    const raw = fs.readFileSync(SALES_PATH, "utf-8")
    return raw
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line) as SalesEntry)
  } catch (e) {
    logger.warn("[sales] jsonl read failed", { error: String(e) })
    return []
  }
}

function writeAll(entries: SalesEntry[]) {
  ensureDataDir()
  const content = entries.map(e => JSON.stringify(e)).join("\n")
  fs.writeFileSync(SALES_PATH, content + (entries.length > 0 ? "\n" : ""), "utf-8")
}

// ── 집계 헬퍼 ─────────────────────────────────────────────────────────────

function buildMonthlySummary(entries: SalesEntry[]) {
  const monthly: Record<string, { revenue: number; orders: number; count: number }> = {}
  for (const e of entries) {
    const month = e.date.slice(0, 7)
    if (!monthly[month]) monthly[month] = { revenue: 0, orders: 0, count: 0 }
    monthly[month].revenue += e.revenue
    monthly[month].orders += e.orders
    monthly[month].count++
  }
  return monthly
}

function buildDailySummary(entries: SalesEntry[], days = 30) {
  const daily: Record<string, { revenue: number; orders: number }> = {}
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    daily[key] = { revenue: 0, orders: 0 }
  }
  for (const e of entries) {
    if (daily[e.date] !== undefined) {
      daily[e.date].revenue += e.revenue
      daily[e.date].orders += e.orders
    }
  }
  return daily
}

function buildPlatformSummary(entries: SalesEntry[]) {
  const platforms: Record<string, { revenue: number; orders: number }> = {}
  for (const e of entries) {
    if (!platforms[e.platform]) platforms[e.platform] = { revenue: 0, orders: 0 }
    platforms[e.platform].revenue += e.revenue
    platforms[e.platform].orders += e.orders
  }
  return platforms
}

// ── 라우트 핸들러 ─────────────────────────────────────────────────────────

/** GET /api/sales — 전체 데이터 + 집계 */
export async function getSalesRoute(_req: any, res: any) {
  const entries = readAll()
  const monthly = buildMonthlySummary(entries)
  const daily = buildDailySummary(entries, 30)
  const platforms = buildPlatformSummary(entries)

  const now = new Date()
  const thisMonth = now.toISOString().slice(0, 7)
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonth = lastMonthDate.toISOString().slice(0, 7)

  return res.json({
    ok: true,
    entries: entries.slice().sort((a, b) => b.date.localeCompare(a.date)),
    monthly,
    daily,
    platforms,
    thisMonth: monthly[thisMonth] ?? { revenue: 0, orders: 0, count: 0 },
    lastMonth: monthly[lastMonth] ?? { revenue: 0, orders: 0, count: 0 },
  })
}

/** POST /api/sales — 항목 추가 */
export async function addSalesRoute(req: any, res: any) {
  const body = (req.body ?? {}) as Record<string, unknown>
  const { date, platform, revenue, orders, memo } = body

  if (!date || !platform || revenue === undefined || orders === undefined) {
    return res.json({ ok: false, error: "date, platform, revenue, orders 필수" })
  }

  const validPlatforms = ["smartstore", "coupang", "own", "other"]
  if (!validPlatforms.includes(String(platform))) {
    return res.json({ ok: false, error: "platform은 smartstore|coupang|own|other 중 하나" })
  }

  const revenueNum = Number(String(revenue).replace(/,/g, ""))
  const ordersNum = Number(orders)
  if (!Number.isFinite(revenueNum) || revenueNum < 0) {
    return res.json({ ok: false, error: "revenue는 0 이상 숫자" })
  }
  if (!Number.isInteger(ordersNum) || ordersNum < 0) {
    return res.json({ ok: false, error: "orders는 0 이상 정수" })
  }

  const entry: SalesEntry = {
    id: `sales_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    date: String(date),
    platform: String(platform) as SalesEntry["platform"],
    revenue: revenueNum,
    orders: ordersNum,
    memo: memo ? String(memo) : undefined,
    createdAt: new Date().toISOString(),
  }

  const entries = readAll()
  entries.push(entry)
  writeAll(entries)

  logger.info("[sales] entry added", { id: entry.id, date: entry.date, platform: entry.platform, revenue: entry.revenue })
  return res.json({ ok: true, entry })
}

/** POST /api/sales/delete — 항목 삭제 (body: { id }) */
export async function deleteSalesRoute(req: any, res: any) {
  const id = String((req.body as Record<string, unknown>)?.id ?? "")
  if (!id) return res.json({ ok: false, error: "id required" })

  const entries = readAll()
  const next = entries.filter(e => e.id !== id)
  if (next.length === entries.length) {
    return res.json({ ok: false, error: "not_found" })
  }

  writeAll(next)
  logger.info("[sales] entry deleted", { id })
  return res.json({ ok: true })
}
