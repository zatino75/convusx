// SalesView.tsx — CORVUS X 매출 대시보드
import { useCallback, useEffect, useState } from "react"
import { apiFetch } from "../../api/url"

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

export function SalesView() {
  const [data, setData] = useState<SalesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [tab, setTab] = useState<TabKey>("summary")

  // ── 입력 폼 상태 ──
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    platform: "smartstore" as Platform,
    revenue: "",
    orders: "",
    memo: "",
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitMsg, setSubmitMsg] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ── 데이터 페치 ──
  const fetchData = useCallback((showLoading = true) => {
    if (showLoading) setLoading(true)
    setLoadError(false)
    apiFetch("/api/sales")
      .then(r => r.json())
      .then((d: SalesData & { ok: boolean }) => {
        if (d.ok) setData(d)
        else setLoadError(true)
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

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

    // 최근 30일 일별 배열 (오름차순)
    const dailyArr = Object.entries(daily).sort(([a], [b]) => a.localeCompare(b))
    const maxRev = Math.max(...dailyArr.map(([, v]) => v.revenue), 1)

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

        {/* KPI 카드 4개 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))", gap: 10 }}>
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
            <div
              key={card.label}
              style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-1)" }}
            >
              <div style={{ fontSize: 11, color: "var(--text-soft)", marginBottom: 6 }}>{card.label}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text-main)", lineHeight: 1.1 }}>{card.value}</div>
              <div style={{ fontSize: 11, color: card.accent, marginTop: 4 }}>{card.sub}</div>
            </div>
          ))}
        </div>

        {/* 최근 30일 매출 차트 */}
        <div style={{ borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-1)", padding: "14px 16px" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-sub)", marginBottom: 12 }}>최근 30일 매출</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 80 }}>
            {dailyArr.map(([date, v]) => {
              const heightPct = maxRev > 0 ? Math.max((v.revenue / maxRev) * 100, v.revenue > 0 ? 6 : 0) : 0
              return (
                <div
                  key={date}
                  title={`${date.slice(5)}\n${formatFull(v.revenue)}\n주문 ${v.orders}건`}
                  style={{
                    flex: 1,
                    height: `${heightPct}%`,
                    background: v.revenue > 0 ? "#4f46e5" : "var(--border)",
                    borderRadius: "2px 2px 0 0",
                    minHeight: v.revenue > 0 ? 3 : 2,
                    cursor: v.revenue > 0 ? "pointer" : "default",
                    transition: "opacity 0.1s",
                  }}
                  onMouseEnter={e => { if (v.revenue > 0) (e.currentTarget.style.opacity = "0.75") }}
                  onMouseLeave={e => { (e.currentTarget.style.opacity = "1") }}
                />
              )
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span style={{ fontSize: 9, color: "var(--text-soft)" }}>{dailyArr[0]?.[0]?.slice(5) ?? ""}</span>
            <span style={{ fontSize: 9, color: "var(--text-soft)" }}>{dailyArr[dailyArr.length - 1]?.[0]?.slice(5) ?? ""}</span>
          </div>
        </div>

        {/* 플랫폼별 매출 */}
        {totalRevenue > 0 ? (
          <div style={{ borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-1)", padding: "14px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-sub)", marginBottom: 14 }}>플랫폼별 매출</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {(["smartstore", "coupang", "own", "other"] as Platform[]).map(pl => {
                const p = platforms[pl] ?? { revenue: 0, orders: 0 }
                if (p.revenue === 0) return null
                const ratio = (p.revenue / totalRevenue) * 100
                return (
                  <div key={pl}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: PLATFORM_COLORS[pl], flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: "var(--text-main)", fontWeight: 600 }}>{PLATFORM_LABELS[pl]}</span>
                        <span style={{ fontSize: 11, color: "var(--text-soft)" }}>주문 {p.orders}건</span>
                      </div>
                      <span style={{ fontSize: 12, color: "var(--text-sub)" }}>
                        {formatKRW(p.revenue)}원 · {ratio.toFixed(1)}%
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
                      <div style={{ width: `${ratio}%`, height: "100%", background: PLATFORM_COLORS[pl], borderRadius: 3, transition: "width 0.4s ease" }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-soft)", fontSize: 13 }}>
            아직 입력된 매출 데이터가 없습니다.
            <br />
            <button
              type="button"
              onClick={() => setTab("input")}
              style={{ marginTop: 12, padding: "7px 18px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--surface-1)", color: "var(--text-main)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
            >
              매출 입력하기 →
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── 입력 탭 ──────────────────────────────────────────────────────────────
  function renderInput() {
    const inputStyle: React.CSSProperties = {
      width: "100%",
      padding: "9px 11px",
      borderRadius: 7,
      border: "1px solid var(--border)",
      background: "var(--bg-main)",
      color: "var(--text-main)",
      fontSize: 13,
      boxSizing: "border-box",
      outline: "none",
      fontFamily: "inherit",
    }
    const labelStyle: React.CSSProperties = {
      fontSize: 12,
      fontWeight: 600,
      color: "var(--text-sub)",
      display: "block",
      marginBottom: 6,
    }

    return (
      <div style={{ maxWidth: 480, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ fontSize: 13, color: "var(--text-soft)" }}>
          날짜·플랫폼·매출액·주문수를 입력하고 저장하세요.
        </div>

        {/* 날짜 */}
        <div>
          <label style={labelStyle}>날짜</label>
          <input
            type="date"
            value={form.date}
            onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
            style={inputStyle}
          />
        </div>

        {/* 플랫폼 선택 */}
        <div>
          <label style={labelStyle}>플랫폼</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {(["smartstore", "coupang", "own", "other"] as Platform[]).map(pl => (
              <button
                key={pl}
                type="button"
                onClick={() => setForm(p => ({ ...p, platform: pl }))}
                style={{
                  padding: "9px 12px",
                  borderRadius: 8,
                  border: `2px solid ${form.platform === pl ? PLATFORM_COLORS[pl] : "var(--border)"}`,
                  background: form.platform === pl ? PLATFORM_COLORS[pl] + "15" : "transparent",
                  color: form.platform === pl ? PLATFORM_COLORS[pl] : "var(--text-soft)",
                  fontSize: 13,
                  fontWeight: form.platform === pl ? 700 : 400,
                  cursor: "pointer",
                  transition: "all 0.15s",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                {form.platform === pl && (
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: PLATFORM_COLORS[pl], display: "inline-block" }} />
                )}
                {PLATFORM_LABELS[pl]}
              </button>
            ))}
          </div>
        </div>

        {/* 매출액 */}
        <div>
          <label style={labelStyle}>매출액 (원)</label>
          <input
            type="text"
            inputMode="numeric"
            value={form.revenue}
            onChange={e => setForm(p => ({ ...p, revenue: e.target.value.replace(/[^0-9]/g, "") }))}
            placeholder="예: 1500000"
            style={inputStyle}
          />
          {form.revenue && (
            <div style={{ fontSize: 11, color: "var(--text-soft)", marginTop: 4 }}>
              = {formatFull(Number(form.revenue))}
            </div>
          )}
        </div>

        {/* 주문수 */}
        <div>
          <label style={labelStyle}>주문수 (건)</label>
          <input
            type="number"
            min="0"
            value={form.orders}
            onChange={e => setForm(p => ({ ...p, orders: e.target.value }))}
            placeholder="예: 45"
            style={inputStyle}
          />
          {form.revenue && form.orders && Number(form.orders) > 0 && (
            <div style={{ fontSize: 11, color: "var(--text-soft)", marginTop: 4 }}>
              평균 주문액: {formatFull(Math.round(Number(form.revenue) / Number(form.orders)))}
            </div>
          )}
        </div>

        {/* 메모 */}
        <div>
          <label style={labelStyle}>메모 (선택)</label>
          <input
            type="text"
            value={form.memo}
            onChange={e => setForm(p => ({ ...p, memo: e.target.value }))}
            placeholder="특이사항, 프로모션 등"
            style={inputStyle}
          />
        </div>

        {/* 저장 버튼 */}
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting}
          style={{
            padding: "11px 20px",
            borderRadius: 8,
            border: "none",
            background: submitting ? "var(--border)" : "#4f46e5",
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            cursor: submitting ? "not-allowed" : "pointer",
            transition: "background 0.15s",
          }}
        >
          {submitting ? "저장 중..." : "매출 저장"}
        </button>

        {submitMsg && (
          <div style={{ fontSize: 13, color: submitMsg.startsWith("✓") ? "#10a37f" : "#ef4444", fontWeight: 600 }}>
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
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-soft)", fontSize: 13 }}>
          입력된 데이터가 없습니다.
        </div>
      )
    }

    return (
      <div>
        <div style={{ fontSize: 12, color: "var(--text-soft)", marginBottom: 12 }}>
          총 {data.entries.length}건
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 540 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)" }}>
                {["날짜", "플랫폼", "매출액", "주문수", "평균 주문액", "메모", ""].map(h => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 11, color: "var(--text-soft)", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e, i) => (
                <tr
                  key={e.id}
                  style={{ borderBottom: "1px solid var(--border-soft)", background: i % 2 === 0 ? "transparent" : "var(--surface-1)" }}
                >
                  <td style={{ padding: "8px 10px", color: "var(--text-sub)", whiteSpace: "nowrap" }}>{e.date}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: PLATFORM_COLORS[e.platform], display: "inline-block", flexShrink: 0 }} />
                      <span style={{ color: "var(--text-main)", fontWeight: 600 }}>{PLATFORM_LABELS[e.platform]}</span>
                    </span>
                  </td>
                  <td style={{ padding: "8px 10px", fontWeight: 700, color: "var(--text-main)", whiteSpace: "nowrap" }}>
                    {e.revenue.toLocaleString()}원
                  </td>
                  <td style={{ padding: "8px 10px", color: "var(--text-sub)" }}>{e.orders}건</td>
                  <td style={{ padding: "8px 10px", color: "var(--text-soft)", whiteSpace: "nowrap" }}>
                    {e.orders > 0 ? Math.round(e.revenue / e.orders).toLocaleString() + "원" : "—"}
                  </td>
                  <td style={{ padding: "8px 10px", color: "var(--text-soft)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {e.memo ?? ""}
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <button
                      type="button"
                      onClick={() => void handleDelete(e.id)}
                      disabled={deletingId === e.id}
                      style={{
                        fontSize: 11,
                        color: "#ef4444",
                        border: "1px solid #ef444430",
                        borderRadius: 5,
                        padding: "2px 8px",
                        background: "transparent",
                        cursor: deletingId === e.id ? "not-allowed" : "pointer",
                        opacity: deletingId === e.id ? 0.5 : 1,
                      }}
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
    <div style={{ padding: "16px 20px", overflowY: "auto", height: "100%", boxSizing: "border-box" as const }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>

        {/* 헤더 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-main)" }}>매출 대시보드</div>
          <button
            type="button"
            onClick={() => fetchData()}
            style={{ fontSize: 11, color: "var(--text-soft)", border: "1px solid var(--border)", borderRadius: 5, padding: "2px 8px", background: "transparent", cursor: "pointer" }}
          >
            새로고침
          </button>
        </div>

        {/* 탭 */}
        <div style={{ display: "flex", gap: 2, marginBottom: 20, borderBottom: "1px solid var(--border)" }}>
          {([["summary", "요약"], ["input", "매출 입력"], ["history", "전체 내역"]] as [TabKey, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => { setTab(key); if (key !== "input") setSubmitMsg(null) }}
              style={{
                padding: "8px 16px",
                border: "none",
                background: "transparent",
                fontSize: 13,
                fontWeight: tab === key ? 700 : 400,
                color: tab === key ? "var(--text-main)" : "var(--text-soft)",
                cursor: "pointer",
                borderBottom: tab === key ? "2px solid #4f46e5" : "2px solid transparent",
                marginBottom: -1,
                transition: "all 0.15s",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 탭 내용 */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--text-soft)", fontSize: 13 }}>
            불러오는 중...
          </div>
        ) : loadError ? (
          <div style={{ textAlign: "center", padding: 40 }}>
            <div style={{ color: "var(--text-soft)", fontSize: 13, marginBottom: 12 }}>
              데이터를 불러올 수 없습니다.
            </div>
            <button
              type="button"
              onClick={() => fetchData()}
              style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-1)", color: "var(--text-main)", cursor: "pointer", fontSize: 12 }}
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
  )
}
