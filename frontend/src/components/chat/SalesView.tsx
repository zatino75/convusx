// SalesView.tsx — CORVUS X 매출 대시보드
import { useCallback, useEffect, useState, type CSSProperties } from "react"
import { apiFetch } from "../../api/url"
import {
  getLatestExecutiveReport,
  syncExecutiveReports,
  type ExecutiveReport
} from "../../store/executiveStore"
import { OpsKpiCard, OpsMeterRow, OpsMiniStat, OpsPanel, OpsTabButton } from "../ops/OpsGamePrimitives"

type Platform = "smartstore" | "coupang" | "own" | "other"
type TabKey = "summary" | "input" | "history"

interface SalesEntry {
  id: string
  date: string
  platform: Platform
  revenue: number
  orders: number
  memo?: string
  createdAt: string
}

interface SalesData {
  entries: SalesEntry[]
  monthly: Record<string, { revenue: number; orders: number; count: number }>
  daily: Record<string, { revenue: number; orders: number }>
  platforms: Record<string, { revenue: number; orders: number }>
  thisMonth: { revenue: number; orders: number; count: number }
  lastMonth: { revenue: number; orders: number; count: number }
}

type PosPaymentMethod = "card" | "cash" | "qr" | "gift"

interface PosInsightData {
  stores: Array<{ id: string; name: string; city: string }>
  summaryByStore: Record<string, { total: number; orders: number; transactions: number }>
  paymentSummary: Record<PosPaymentMethod, { total: number; orders: number; transactions: number }>
  promotionSummary: Record<string, { total: number; transactions: number; discount: number }>
  daily7d: Array<{ date: string; total: number; transactions: number }>
  transactions: Array<{ id: string; createdAt: string; storeName: string; paymentMethod: PosPaymentMethod; total: number; itemCount: number }>
}

interface RetailSnapshotSummary {
  snapshotDate: string
  createdAt: string
  totalRevenue: number
  monthTransactions: number
  executiveReportsMonth: number
}

type SalesUiSnapshot = {
  tab?: TabKey
  formDate?: string
  formPlatform?: Platform
  formMemo?: string
}

type Props = {
  onOpenWorkforce?: () => void
  onOpenStoreOps?: () => void
  onOpenPos?: () => void
}

const PLATFORM_LABELS: Record<Platform, string> = {
  smartstore: "스마트스토어",
  coupang: "쿠팡",
  own: "자사몰",
  other: "기타",
}

const PLATFORM_COLORS: Record<Platform, string> = {
  smartstore: "#03c75a",
  coupang: "#c00d45",
  own: "#4f46e5",
  other: "#6b7280",
}

const POS_PAYMENT_LABELS: Record<PosPaymentMethod, string> = {
  card: "카드",
  cash: "현금",
  qr: "QR",
  gift: "상품권",
}

const SALES_UI_SNAPSHOT_KEY = "convusx.sales.ui.v1"

function readSalesUiSnapshot(): SalesUiSnapshot {
  if (typeof window === "undefined") return {}
  const raw = window.localStorage.getItem(SALES_UI_SNAPSHOT_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as SalesUiSnapshot
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function writeSalesUiSnapshot(snapshot: SalesUiSnapshot) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(SALES_UI_SNAPSHOT_KEY, JSON.stringify(snapshot))
}

function platformClass(platform: Platform): string {
  return `is-${platform}`
}

function formatKRW(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString()}만`
  return n.toLocaleString()
}

function formatFull(n: number): string {
  return n.toLocaleString() + "원"
}

function getPctChange(current: number, prev: number): number {
  if (prev === 0) return current > 0 ? 100 : 0
  return ((current - prev) / prev) * 100
}

export function SalesView({ onOpenWorkforce, onOpenStoreOps, onOpenPos }: Props) {
  const initialUiSnapshot = readSalesUiSnapshot()
  const [data, setData] = useState<SalesData | null>(null)
  const [posInsight, setPosInsight] = useState<PosInsightData | null>(null)
  const [latestExecutiveReport, setLatestExecutiveReport] = useState<ExecutiveReport | null>(() => getLatestExecutiveReport())
  const [retailSnapshot, setRetailSnapshot] = useState<RetailSnapshotSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [tab, setTab] = useState<TabKey>(initialUiSnapshot.tab ?? "summary")

  // ── 입력 폼 상태 ──
  const [form, setForm] = useState({
    date: initialUiSnapshot.formDate ?? new Date().toISOString().slice(0, 10),
    platform: initialUiSnapshot.formPlatform ?? ("smartstore" as Platform),
    revenue: "",
    orders: "",
    memo: initialUiSnapshot.formMemo ?? "",
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitMsg, setSubmitMsg] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const salesMission = latestExecutiveReport?.summary || "채널 매출과 POS 트랜잭션을 묶어 상무 보고용으로 자동 정리합니다."

  // ── 데이터 페치 ──
  const fetchData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    setLoadError(false)

    try {
      const salesRes = await apiFetch("/api/sales")
      const salesData = await salesRes.json() as SalesData & { ok: boolean }
      if (!salesData.ok) {
        setLoadError(true)
      } else {
        setData(salesData)
      }
    } catch {
      setLoadError(true)
    }

    try {
      const posRes = await apiFetch("/api/pos")
      const posData = await posRes.json() as {
        ok: boolean
        stores?: PosInsightData["stores"]
        summaryByStore?: PosInsightData["summaryByStore"]
        paymentSummary?: PosInsightData["paymentSummary"]
        promotionSummary?: PosInsightData["promotionSummary"]
        daily7d?: PosInsightData["daily7d"]
        transactions?: PosInsightData["transactions"]
      }
      if (posData.ok) {
        setPosInsight({
          stores: Array.isArray(posData.stores) ? posData.stores : [],
          summaryByStore: posData.summaryByStore ?? {},
          paymentSummary: posData.paymentSummary ?? {
            card: { total: 0, orders: 0, transactions: 0 },
            cash: { total: 0, orders: 0, transactions: 0 },
            qr: { total: 0, orders: 0, transactions: 0 },
            gift: { total: 0, orders: 0, transactions: 0 }
          },
          promotionSummary: posData.promotionSummary ?? {},
          daily7d: Array.isArray(posData.daily7d) ? posData.daily7d : [],
          transactions: Array.isArray(posData.transactions) ? posData.transactions : []
        })
      }
    } catch {
      setPosInsight(null)
    }

    try {
      const snapshotRes = await apiFetch("/api/retail/reports/latest")
      const snapshotData = await snapshotRes.json() as {
        ok: boolean
        snapshot?: {
          snapshotDate?: string
          createdAt?: string
          payload?: {
            channels?: { totalRevenue?: number }
            periodKpi?: { monthToDate?: { transactions?: number } }
            executive?: { reportsMonth?: number }
          }
        }
      }
      if (snapshotData.ok && snapshotData.snapshot) {
        setRetailSnapshot({
          snapshotDate: String(snapshotData.snapshot.snapshotDate ?? "-"),
          createdAt: String(snapshotData.snapshot.createdAt ?? ""),
          totalRevenue: Number(snapshotData.snapshot.payload?.channels?.totalRevenue ?? 0),
          monthTransactions: Number(snapshotData.snapshot.payload?.periodKpi?.monthToDate?.transactions ?? 0),
          executiveReportsMonth: Number(snapshotData.snapshot.payload?.executive?.reportsMonth ?? 0),
        })
      }
    } catch {
      setRetailSnapshot(null)
    }

    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    writeSalesUiSnapshot({
      tab,
      formDate: form.date,
      formPlatform: form.platform,
      formMemo: form.memo
    })
  }, [tab, form.date, form.platform, form.memo])

  useEffect(() => {
    void syncExecutiveReports(8).then((reports) => {
      setLatestExecutiveReport(reports[0] ?? null)
    })

    const handleStorage = (event: StorageEvent) => {
      if (event.key === "convusx.executive-reports.v1") {
        setLatestExecutiveReport(getLatestExecutiveReport())
      }
    }

    window.addEventListener("storage", handleStorage)
    return () => {
      window.removeEventListener("storage", handleStorage)
    }
  }, [])

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (!(event.altKey || event.metaKey || event.ctrlKey)) return
      if (event.key === "1") {
        event.preventDefault()
        setTab("summary")
      } else if (event.key === "2") {
        event.preventDefault()
        setTab("input")
      } else if (event.key === "3") {
        event.preventDefault()
        setTab("history")
      }
    }

    window.addEventListener("keydown", handleShortcut)
    return () => window.removeEventListener("keydown", handleShortcut)
  }, [])

  // ── 입력 저장 ──
  async function handleSubmit() {
    if (!form.revenue || !form.orders) {
      setSubmitMsg("매출액과 주문수를 입력하세요.")
      return
    }
    setSubmitting(true)
    setSubmitMsg(null)
    try {
      const r = await apiFetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: form.date,
          platform: form.platform,
          revenue: Number(form.revenue.replace(/,/g, "")),
          orders: Number(form.orders),
          memo: form.memo || undefined,
        }),
      })
      const d = await r.json()
      if (d.ok) {
        setSubmitMsg("✓ 저장됐습니다.")
        setForm(prev => ({ ...prev, revenue: "", orders: "", memo: "" }))
        fetchData(false)
      } else {
        setSubmitMsg("저장 실패: " + String(d.error ?? "오류"))
      }
    } catch {
      setSubmitMsg("서버 연결 오류")
    } finally {
      setSubmitting(false)
    }
  }

  // ── 항목 삭제 ──
  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      await apiFetch("/api/sales/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      fetchData(false)
    } finally {
      setDeletingId(null)
    }
  }

  // ── 요약 탭 ──────────────────────────────────────────────────────────────
  function renderSummary() {
    if (!data) return null
    const { thisMonth, lastMonth, daily, platforms } = data
    const pct = getPctChange(thisMonth.revenue, lastMonth.revenue)
    const avgOrder = thisMonth.orders > 0 ? Math.round(thisMonth.revenue / thisMonth.orders) : 0
    const totalRevenue = Object.values(platforms).reduce((s, p) => s + p.revenue, 0)
    const posStoreRows = (posInsight?.stores ?? []).map((store) => {
      const summary = posInsight?.summaryByStore?.[store.id] ?? { total: 0, orders: 0, transactions: 0 }
      return {
        ...store,
        total: summary.total,
        orders: summary.orders,
        transactions: summary.transactions
      }
    }).sort((a, b) => b.total - a.total)
    const posTotalRevenue = posStoreRows.reduce((sum, row) => sum + row.total, 0)
    const posTotalTransactions = posStoreRows.reduce((sum, row) => sum + row.transactions, 0)
    const paymentRows = (Object.entries(posInsight?.paymentSummary ?? {}) as Array<[PosPaymentMethod, { total: number; orders: number; transactions: number }]>)
      .sort((a, b) => b[1].total - a[1].total)
    const promoRows = Object.entries(posInsight?.promotionSummary ?? {})
      .map(([code, value]) => ({ code, ...value }))
      .sort((a, b) => b.total - a.total)

    // 최근 30일 일별 배열 (오름차순)
    const dailyArr = Object.entries(daily).sort(([a], [b]) => a.localeCompare(b))
    const maxRev = Math.max(...dailyArr.map(([, v]) => v.revenue), 1)
    const salesStage = totalRevenue <= 0
      ? 1
      : posTotalRevenue <= 0
        ? 2
        : latestExecutiveReport
          ? 4
          : 3
    const salesFlow = [
      { step: 1, label: "채널 집계" },
      { step: 2, label: "POS 집계" },
      { step: 3, label: "리스크 정렬" },
      { step: 4, label: "상무 보고" }
    ]

    return (
      <div className="sales-summary-stack">
        <OpsPanel>
          <div className="sales-panel-kicker">상무 승인 지시</div>
          {latestExecutiveReport ? (
            <>
              <div className="sales-exec-title">{latestExecutiveReport.topic}</div>
              <div className="sales-exec-body">{latestExecutiveReport.summary || latestExecutiveReport.directive}</div>
              <div className="sales-exec-time">{new Date(latestExecutiveReport.createdAt).toLocaleString()}</div>
            </>
          ) : (
            <div className="sales-panel-help">Workforce에서 상무 보고를 생성하면 이 대시보드 KPI와 자동으로 연결됩니다.</div>
          )}
        </OpsPanel>

        {retailSnapshot ? (
          <OpsPanel>
            <div className="sales-snapshot-head">
              <div>Retail Snapshot</div>
              <div>{retailSnapshot.snapshotDate}</div>
            </div>
            <div className="ops-mini-grid">
              <OpsMiniStat label="월 누적 매출" value={`${formatKRW(retailSnapshot.totalRevenue)}원`} />
              <OpsMiniStat label="월 누적 트랜잭션" value={`${retailSnapshot.monthTransactions.toLocaleString()}건`} />
              <OpsMiniStat label="월 상무보고" value={`${retailSnapshot.executiveReportsMonth}건`} />
            </div>
          </OpsPanel>
        ) : null}

        <section className="sales-flow-strip" aria-label="매출 운영 단계">
          {salesFlow.map((item) => (
            <article
              key={item.step}
              className={[
                "sales-flow-strip__item",
                salesStage === item.step ? "is-active" : "",
                salesStage > item.step ? "is-done" : ""
              ]
                .join(" ")
                .trim()}
            >
              <span>{item.step}</span>
              <strong>{item.label}</strong>
            </article>
          ))}
        </section>

        {/* KPI 카드 4개 */}
        <div className="ops-kpi-grid">
          {[
            {
              label: "이번달 매출",
              value: formatKRW(thisMonth.revenue) + "원",
              sub: lastMonth.revenue > 0
                ? `전월 대비 ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`
                : "전월 데이터 없음",
              accent: pct >= 0 ? "#10a37f" : "#ef4444",
            },
            {
              label: "이번달 주문",
              value: `${thisMonth.orders.toLocaleString()}건`,
              sub: `${thisMonth.count}일 입력`,
              accent: "#4f46e5",
            },
            {
              label: "평균 주문액",
              value: formatKRW(avgOrder) + "원",
              sub: "이번달 기준",
              accent: "#f59e0b",
            },
            {
              label: "전월 매출",
              value: formatKRW(lastMonth.revenue) + "원",
              sub: `주문 ${lastMonth.orders.toLocaleString()}건`,
              accent: "var(--text-sub)",
            },
          ].map(card => (
            <OpsKpiCard
              key={card.label}
              label={card.label}
              value={card.value}
              sub={card.sub}
              accent={card.accent}
            />
          ))}
        </div>

        {/* 최근 30일 매출 차트 */}
        <OpsPanel>
          <div className="sales-panel-title">최근 30일 매출</div>
          <div className="sales-chart-bars">
            {dailyArr.map(([date, v]) => {
              const heightPct = maxRev > 0 ? Math.max((v.revenue / maxRev) * 100, v.revenue > 0 ? 6 : 0) : 0
              return (
                <div
                  key={date}
                  title={`${date.slice(5)}\n${formatFull(v.revenue)}\n주문 ${v.orders}건`}
                  className={`sales-chart-bar${v.revenue > 0 ? " is-active" : ""}`}
                  style={{
                    "--bar-height": `${heightPct}%`
                  } as CSSProperties}
                  onMouseEnter={e => { if (v.revenue > 0) (e.currentTarget.style.opacity = "0.75") }}
                  onMouseLeave={e => { (e.currentTarget.style.opacity = "1") }}
                />
              )
            })}
          </div>
          <div className="sales-chart-axis">
            <span>{dailyArr[0]?.[0]?.slice(5) ?? ""}</span>
            <span>{dailyArr[dailyArr.length - 1]?.[0]?.slice(5) ?? ""}</span>
          </div>
        </OpsPanel>

        {/* 플랫폼별 매출 */}
        {totalRevenue > 0 ? (
          <OpsPanel>
            <div className="sales-panel-title">플랫폼별 매출</div>
            <div className="sales-meter-stack">
              {(["smartstore", "coupang", "own", "other"] as Platform[]).map(pl => {
                const p = platforms[pl] ?? { revenue: 0, orders: 0 }
                if (p.revenue === 0) return null
                const ratio = (p.revenue / totalRevenue) * 100
                return (
                  <OpsMeterRow
                    key={pl}
                    label={
                      <span className="sales-meter-label">
                        <span
                          className={`sales-meter-dot ${platformClass(pl)}`}
                        />
                        <span className="sales-meter-main">{PLATFORM_LABELS[pl]}</span>
                        <span className="sales-meter-sub">주문 {p.orders}건</span>
                      </span>
                    }
                    valueText={
                      <span className="sales-meter-value">
                        {formatKRW(p.revenue)}원 · {ratio.toFixed(1)}%
                      </span>
                    }
                    ratio={ratio}
                    color={PLATFORM_COLORS[pl]}
                  />
                )
              })}
            </div>
          </OpsPanel>
        ) : (
          <div className="sales-empty">
            아직 입력된 매출 데이터가 없습니다.
            <br />
            <button
              type="button"
              onClick={() => setTab("input")}
              className="sales-empty-cta"
            >
              매출 입력하기 →
            </button>
          </div>
        )}

        <OpsPanel>
          <div className="sales-pos-head">
            <div>오프라인 POS 라이브</div>
            <div>
              {posInsight ? `총 결제 ${posTotalTransactions.toLocaleString()}건` : "POS 연결 대기"}
            </div>
          </div>

          {posInsight ? (
            <>
              <div className="ops-mini-grid sales-mini-grid-gap">
                <OpsMiniStat label="오프라인 매출 합계" value={`${formatKRW(posTotalRevenue)}원`} />
                <OpsMiniStat label="운영 매장 수" value={`${posStoreRows.length}개`} />
                <OpsMiniStat label="최근 결제 건수" value={`${posTotalTransactions.toLocaleString()}건`} />
              </div>

              <div className="sales-pos-grid">
                <div className="sales-pos-card">
                  <div className="sales-pos-card-title">매장별 POS 매출</div>
                  <div className="sales-pos-card-body">
                    {posStoreRows.length > 0 ? posStoreRows.map((row) => {
                      const ratio = posTotalRevenue > 0 ? (row.total / posTotalRevenue) * 100 : 0
                      return (
                        <OpsMeterRow
                          key={row.id}
                          label={<span className="sales-meter-sub">{row.name}</span>}
                          valueText={<span className="sales-meter-pos-value">{formatKRW(row.total)}원</span>}
                          ratio={ratio}
                          color="#56798b"
                        />
                      )
                    }) : (
                      <div className="sales-panel-help">매장 데이터 없음</div>
                    )}
                  </div>
                </div>

                <div className="sales-pos-card">
                  <div className="sales-pos-card-title">결제 수단 비중</div>
                  <div className="sales-pos-card-body">
                    {paymentRows.length > 0 ? paymentRows.map(([method, value]) => {
                      const ratio = posTotalRevenue > 0 ? (value.total / posTotalRevenue) * 100 : 0
                      return (
                        <OpsMeterRow
                          key={method}
                          label={<span className="sales-meter-sub">{POS_PAYMENT_LABELS[method]}</span>}
                          valueText={<span className="sales-meter-pos-value">{ratio.toFixed(1)}%</span>}
                          ratio={ratio}
                          color="#7f9a8f"
                        />
                      )
                    }) : (
                      <div className="sales-panel-help">결제 수단 데이터 없음</div>
                    )}
                  </div>
                </div>
              </div>

              {promoRows.length > 0 ? (
                <div className="sales-pos-card sales-pos-card--promo">
                  <div className="sales-pos-card-title">프로모션 성과</div>
                  <div className="sales-pos-card-body">
                    {promoRows.slice(0, 4).map((row) => (
                      <div key={row.code} className="sales-pos-row">
                        <span>{row.code}</span>
                        <div>
                          <strong>{formatKRW(row.total)}원</strong>
                          <span>할인 {formatKRW(row.discount)}원</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="sales-pos-recent">
                최근 결제: {(posInsight.transactions ?? []).slice(0, 3).map((tx) => `${new Date(tx.createdAt).toLocaleTimeString()} ${tx.storeName} ${formatKRW(tx.total)}원`).join(" · ") || "없음"}
              </div>
            </>
          ) : (
            <div className="sales-panel-help">POS API 연결 후 오프라인 지표가 표시됩니다.</div>
          )}
        </OpsPanel>
      </div>
    )
  }

  // ── 입력 탭 ──────────────────────────────────────────────────────────────
  function renderInput() {
    return (
      <div className="sales-input-form">
        <div className="sales-input-help">
          날짜·플랫폼·매출액·주문수를 입력하고 저장하세요.
        </div>

        {/* 날짜 */}
        <div className="sales-input-group">
          <label className="sales-input-label">날짜</label>
          <input
            type="date"
            value={form.date}
            onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
            className="sales-input-control"
          />
        </div>

        {/* 플랫폼 선택 */}
        <div className="sales-input-group">
          <label className="sales-input-label">플랫폼</label>
          <div className="sales-platform-grid">
            {(["smartstore", "coupang", "own", "other"] as Platform[]).map(pl => (
              <button
                key={pl}
                type="button"
                onClick={() => setForm(p => ({ ...p, platform: pl }))}
                className={`sales-platform-btn${form.platform === pl ? " is-active" : ""}`}
                data-platform={pl}
              >
                {form.platform === pl && (
                  <span className="sales-platform-btn__dot" />
                )}
                {PLATFORM_LABELS[pl]}
              </button>
            ))}
          </div>
        </div>

        {/* 매출액 */}
        <div className="sales-input-group">
          <label className="sales-input-label">매출액 (원)</label>
          <input
            type="text"
            inputMode="numeric"
            value={form.revenue}
            onChange={e => setForm(p => ({ ...p, revenue: e.target.value.replace(/[^0-9]/g, "") }))}
            placeholder="예: 1500000"
            className="sales-input-control"
          />
          {form.revenue && (
            <div className="sales-input-meta">
              = {formatFull(Number(form.revenue))}
            </div>
          )}
        </div>

        {/* 주문수 */}
        <div className="sales-input-group">
          <label className="sales-input-label">주문수 (건)</label>
          <input
            type="number"
            min="0"
            value={form.orders}
            onChange={e => setForm(p => ({ ...p, orders: e.target.value }))}
            placeholder="예: 45"
            className="sales-input-control"
          />
          {form.revenue && form.orders && Number(form.orders) > 0 && (
            <div className="sales-input-meta">
              평균 주문액: {formatFull(Math.round(Number(form.revenue) / Number(form.orders)))}
            </div>
          )}
        </div>

        {/* 메모 */}
        <div className="sales-input-group">
          <label className="sales-input-label">메모 (선택)</label>
          <input
            type="text"
            value={form.memo}
            onChange={e => setForm(p => ({ ...p, memo: e.target.value }))}
            placeholder="특이사항, 프로모션 등"
            className="sales-input-control"
          />
        </div>

        {/* 저장 버튼 */}
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting}
          className="sales-submit-btn"
        >
          {submitting ? "저장 중..." : "매출 저장"}
        </button>

        {submitMsg && (
          <div className={`sales-submit-msg${submitMsg.startsWith("✓") ? " is-success" : " is-error"}`}>
            {submitMsg}
          </div>
        )}
      </div>
    )
  }

  // ── 내역 탭 ──────────────────────────────────────────────────────────────
  function renderHistory() {
    if (!data?.entries.length) {
      return (
        <div className="sales-empty">
          입력된 데이터가 없습니다.
        </div>
      )
    }

    return (
      <div className="sales-history-wrap">
        <div className="sales-history-count">
          총 {data.entries.length}건
        </div>
        <div className="sales-history-table-wrap">
          <table className="sales-history-table">
            <thead>
              <tr>
                {["날짜", "플랫폼", "매출액", "주문수", "평균 주문액", "메모", ""].map(h => (
                  <th key={h}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e, i) => (
                <tr
                  key={e.id}
                  className={i % 2 === 0 ? "" : "is-alt"}
                >
                  <td className="is-date">{e.date}</td>
                  <td>
                    <span className="sales-platform-badge">
                      <span
                        className={`sales-platform-dot ${platformClass(e.platform)}`}
                      />
                      <span>{PLATFORM_LABELS[e.platform]}</span>
                    </span>
                  </td>
                  <td className="is-revenue">
                    {e.revenue.toLocaleString()}원
                  </td>
                  <td className="is-muted">{e.orders}건</td>
                  <td className="is-soft">
                    {e.orders > 0 ? Math.round(e.revenue / e.orders).toLocaleString() + "원" : "—"}
                  </td>
                  <td className="is-memo">
                    {e.memo ?? ""}
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => void handleDelete(e.id)}
                      disabled={deletingId === e.id}
                      className="sales-delete-btn"
                    >
                      {deletingId === e.id ? "..." : "삭제"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  return (
    <div className="ops-game-screen ops-game-screen--sales">
      <div className="sales-layout">
        <div className="sales-layout__inner">

        <div className="ops-game-screen__eyebrow">REVENUE COMMAND</div>

        {/* 헤더 */}
        <div className="ops-game-screen__title-row sales-title-row">
          <div className="ops-game-screen__title">매출 대시보드</div>
          <button
            type="button"
            onClick={() => fetchData()}
            className="sales-refresh-btn"
          >
            새로고침
          </button>
        </div>

        <section className="sales-mission-strip">
          <strong>REVENUE MISSION</strong>
          <p>{salesMission}</p>
        </section>

        <section className="ops-route-strip" aria-label="운영 라우팅">
          <span>NEXT OPS</span>
          <div>
            <button type="button" onClick={onOpenWorkforce}>Workforce 이동</button>
            <button type="button" onClick={onOpenStoreOps}>StoreOps 이동</button>
            <button type="button" onClick={onOpenPos}>POS 이동</button>
          </div>
        </section>

        {/* 탭 */}
        <div className="ops-tabbar sales-tabbar">
          {([["summary", "요약"], ["input", "매출 입력"], ["history", "전체 내역"]] as [TabKey, string][]).map(([key, label]) => (
            <OpsTabButton
              key={key}
              active={tab === key}
              label={label}
              onClick={() => { setTab(key); if (key !== "input") setSubmitMsg(null) }}
            />
          ))}
        </div>
        <div className="sales-shortcut-hint">단축키: `Alt/⌘/Ctrl + 1` 요약 · `+2` 입력 · `+3` 내역</div>

        {/* 탭 내용 */}
        {loading ? (
          <div className="sales-loading">
            불러오는 중...
          </div>
        ) : loadError ? (
          <div className="sales-error">
            <div className="sales-error__text">
              데이터를 불러올 수 없습니다.
            </div>
            <button
              type="button"
              onClick={() => fetchData()}
              className="sales-error__retry"
            >
              다시 시도
            </button>
          </div>
        ) : (
          <>
            {tab === "summary" && renderSummary()}
            {tab === "input" && renderInput()}
            {tab === "history" && renderHistory()}
          </>
        )}
        </div>
      </div>
    </div>
  )
}
