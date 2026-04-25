/**
 * smoke-test.ts — CORVUS X 종단 스모크 테스트.
 *
 * 2026-04-25 신규 (Phase 8).
 *
 * 두 가지 시나리오를 자동 실행해 분류기/라우팅/비용 추적이 살아있는지 검증.
 *
 *   Test A — "안녕하세요"
 *     기대: Classifier intent=simple_qa → single_agent (Sonnet) 1회 호출.
 *     비용 ~$0.005~0.05.
 *
 *   Test B — "액상전자담배 시장 분석과 경쟁사 전략을 종합적으로 분석해줘"
 *     기대: intent=research 또는 strategic → ExecutiveGate Planner → 다부서 호출.
 *     비용 ~$0.10~0.50.
 *
 * 실행:
 *   1. 브라우저에서 로그인 → DevTools → Application → Cookies 에서 `corvus_session` 값 복사.
 *   2. PowerShell:
 *        $env:SMOKE_TEST_COOKIE = "corvus_session=<copied-value>"
 *        $env:SMOKE_TEST_BASE   = "https://app.cloudcookie.co.kr"   # 또는 http://localhost:8000
 *        npm run smoke-test
 *
 * 출력: 각 테스트의 status, 응답 시간(ms), 분류 intent, 사용 모델, cost delta.
 *
 * ⚠️ 실제 API 호출이므로 운영 비용에 반영된다 (보통 < $1 총합).
 */

const BASE = process.env.SMOKE_TEST_BASE?.trim() || "https://app.cloudcookie.co.kr"
const COOKIE = process.env.SMOKE_TEST_COOKIE?.trim() || ""

interface CostStats {
  todayTotal?: number
  recentCalls?: Array<{ time: string; model: string; dept: string; cost: number }>
}

async function fetchJson(path: string, init: RequestInit = {}): Promise<{ status: number; body: any; ms: number }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(COOKIE ? { Cookie: COOKIE } : {}),
    ...((init.headers as Record<string, string>) ?? {}),
  }
  const start = Date.now()
  const res = await fetch(BASE + path, { ...init, headers })
  const ms = Date.now() - start
  let body: any = null
  try { body = await res.json() } catch { body = null }
  return { status: res.status, body, ms }
}

async function getCostSnapshot(): Promise<CostStats> {
  const r = await fetchJson("/api/cost/stats")
  if (r.status !== 200 || !r.body?.ok) return {}
  return {
    todayTotal: Number(r.body.todayTotal ?? 0),
    recentCalls: r.body.recentCalls ?? [],
  }
}

interface TestSpec {
  name: string
  message: string
  expectIntent: string
  threadId: string
}

const TESTS: TestSpec[] = [
  {
    name: "A. simple_qa",
    message: "안녕하세요",
    expectIntent: "simple_qa",
    threadId: `smoke-A-${Date.now()}`,
  },
  {
    name: "B. research/strategic (다부서)",
    message: "액상전자담배 시장 분석과 경쟁사 전략을 종합적으로 분석해줘",
    expectIntent: "research|strategic",
    threadId: `smoke-B-${Date.now()}`,
  },
]

async function runTest(t: TestSpec): Promise<void> {
  console.log("\n──────────────────────────────────────────────────────────")
  console.log(`▶ ${t.name}`)
  console.log(`  msg: ${t.message}`)
  console.log(`  thread: ${t.threadId}`)

  const before = await getCostSnapshot()
  const start = Date.now()

  const r = await fetchJson("/api/chat", {
    method: "POST",
    body: JSON.stringify({
      message: t.message,
      thread_id: t.threadId,
    }),
  })

  const elapsed = Date.now() - start

  if (r.status !== 200 || !r.body) {
    console.log(`  ❌ HTTP ${r.status} — body=${JSON.stringify(r.body).slice(0, 200)}`)
    return
  }
  const ok = r.body?.ok !== false
  const intent = r.body?.intent ?? r.body?.task ?? "(intent 미반환)"
  const modelsUsed = r.body?.models_used ?? r.body?.providers ?? []
  const provider = r.body?.provider ?? "?"
  const messagePreview = String(r.body?.message ?? r.body?.response ?? "").slice(0, 120).replace(/\s+/g, " ")

  console.log(`  ${ok ? "✅" : "❌"} status=${r.status} elapsed=${elapsed}ms`)
  console.log(`  intent=${intent} (기대: ${t.expectIntent})`)
  console.log(`  provider=${provider} models=${JSON.stringify(modelsUsed)}`)
  console.log(`  preview="${messagePreview}${messagePreview.length >= 120 ? "..." : ""}"`)

  // 비용 delta
  await new Promise(r => setTimeout(r, 1500))  // SQLite write 반영 대기
  const after = await getCostSnapshot()
  const beforeT = Number(before.todayTotal ?? 0)
  const afterT = Number(after.todayTotal ?? 0)
  const delta = +(afterT - beforeT).toFixed(6)
  console.log(`  todayTotal: $${beforeT.toFixed(6)} → $${afterT.toFixed(6)}  (Δ +$${delta.toFixed(6)})`)
  const recent = (after.recentCalls ?? []).slice(0, 3)
  if (recent.length > 0) {
    console.log(`  최근 호출:`)
    for (const c of recent) {
      console.log(`    - ${c.time} ${c.model} (${c.dept}) $${Number(c.cost).toFixed(6)}`)
    }
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════")
  console.log("  CORVUS X — Smoke Test")
  console.log(`  base: ${BASE}`)
  console.log(`  cookie: ${COOKIE ? "(set)" : "(MISSING — set SMOKE_TEST_COOKIE)"}`)
  console.log("═══════════════════════════════════════════════════════════")

  if (!COOKIE) {
    console.error("\n환경변수 SMOKE_TEST_COOKIE 가 비어 있어 인증된 요청이 불가능합니다.")
    console.error("브라우저 DevTools → Application → Cookies 에서 corvus_session 값을 복사 후")
    console.error("  $env:SMOKE_TEST_COOKIE = \"corvus_session=...\"  (PowerShell)")
    console.error("  export SMOKE_TEST_COOKIE='corvus_session=...'   (bash)")
    process.exit(2)
  }

  for (const t of TESTS) {
    try {
      await runTest(t)
    } catch (err: any) {
      console.error(`  ❌ runTest 예외: ${err?.message ?? err}`)
    }
  }

  console.log("\n══════════════════════════════════════════════════════════")
  console.log("  완료 — 위 출력에서 intent / models / cost delta 확인")
  console.log("══════════════════════════════════════════════════════════")
}

main().catch(err => {
  console.error("[smoke-test] fatal:", err)
  process.exit(1)
})
