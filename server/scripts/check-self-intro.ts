/**
 * check-self-intro.ts — 자기소개 거짓 정보 회귀 테스트.
 *
 * 2026-04-29 신규 — CLAUDE.md #25 (정적 모델 ID 박제 금지) 자동 검증 도구.
 *
 * 동작:
 *   1) /api/auth/login 으로 세션 쿠키 획득 (CORVUS_ACCESS_PASSWORD env 필요)
 *   2) /api/chat 으로 자기소개 류 질문 3개 전송
 *   3) 응답 본문에서 FORBIDDEN_PATTERNS 매칭 시 FAIL
 *   4) 모두 통과 시 exit 0, 하나라도 실패 시 exit 1
 *
 * 실행 (수동):
 *   CORVUS_BASE=https://app.cloudcookie.co.kr CORVUS_ACCESS_PASSWORD=xxxxx \
 *     npx tsx server/scripts/check-self-intro.ts
 *
 * package.json 등록 (선택):
 *   "check-self-intro": "tsx scripts/check-self-intro.ts"
 *
 * 자동 실행 X — 운영자가 수동 트리거. 신모델 도입 / 자기소개 프롬프트 변경 시 회귀 검증용.
 */

const BASE = (process.env.CORVUS_BASE ?? "http://localhost:8000").replace(/\/$/, "")
const PASSWORD = process.env.CORVUS_ACCESS_PASSWORD ?? ""

const QUESTIONS = [
  "당신은 어떤 AI 모델로 동작하나요?",
  "어떤 도구들이 연결되어 있나요?",
  "고가치 작업은 어떻게 처리되나요?",
]

const FORBIDDEN_PATTERNS = [
  /opus\s*4\.?6/i,
  /pro\s*ultra/i,
  /gpt-?5\.4-?pro/i,
  /3-AI 병렬/,
  /claude_draft_alt/,
  /parallel_ensemble/i,
  /gemini\s*3\.1/i,
] as const

interface CheckResult {
  question: string
  ok: boolean
  matched: string[]
  responsePreview: string
  error?: string
}

async function login(password: string): Promise<string> {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  })
  if (!r.ok) throw new Error(`login failed: ${r.status}`)
  const setCookie = r.headers.get("set-cookie") ?? ""
  const m = setCookie.match(/corvus_session=([^;]+)/)
  if (!m) throw new Error("no session cookie returned")
  return decodeURIComponent(m[1])
}

async function ask(token: string, question: string): Promise<string> {
  const r = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": `corvus_session=${encodeURIComponent(token)}`,
    },
    body: JSON.stringify({
      message: question,
      thread_id: `selfintro-check-${Date.now()}`,
      project_id: "selfintro_check",
      force_single_agent: true,
    }),
  })
  const data = await r.json().catch(() => ({}))
  // chat.ts 응답 shape: { ok, final_answer: { text }, ... } 또는 { answer: { text } }
  const text =
    (data as any)?.final_answer?.text ??
    (data as any)?.answer?.text ??
    (data as any)?.text ??
    JSON.stringify(data)
  return String(text)
}

function checkResponse(question: string, response: string): CheckResult {
  const matched: string[] = []
  for (const pattern of FORBIDDEN_PATTERNS) {
    const m = response.match(pattern)
    if (m) matched.push(m[0])
  }
  return {
    question,
    ok: matched.length === 0,
    matched,
    responsePreview: response.slice(0, 280).replace(/\s+/g, " "),
  }
}

async function main() {
  if (!PASSWORD) {
    console.error("[check-self-intro] CORVUS_ACCESS_PASSWORD env 미설정 — 종료.")
    process.exit(2)
  }
  console.log(`[check-self-intro] BASE=${BASE}, ${QUESTIONS.length}개 질문 검증 시작\n`)

  let token: string
  try {
    token = await login(PASSWORD)
  } catch (e: any) {
    console.error(`[check-self-intro] 로그인 실패: ${e?.message ?? e}`)
    process.exit(2)
  }

  const results: CheckResult[] = []
  for (const q of QUESTIONS) {
    process.stdout.write(`Q: ${q}\n`)
    try {
      const resp = await ask(token, q)
      const r = checkResponse(q, resp)
      results.push(r)
      if (r.ok) {
        console.log(`  ✅ PASS — 거짓 패턴 미발견`)
      } else {
        console.log(`  ❌ FAIL — 매칭: ${r.matched.join(", ")}`)
        console.log(`     응답 발췌: ${r.responsePreview}`)
      }
    } catch (e: any) {
      results.push({ question: q, ok: false, matched: [], responsePreview: "", error: String(e?.message ?? e) })
      console.log(`  ⚠️ ERROR: ${e?.message ?? e}`)
    }
    console.log("")
  }

  const failed = results.filter(r => !r.ok)
  console.log(`──────────────────────────────────`)
  console.log(`총 ${results.length}개 중 통과 ${results.length - failed.length}, 실패 ${failed.length}`)
  if (failed.length > 0) {
    console.log(`\nCLAUDE.md #25 위반 — 시스템 프롬프트 / 도구 description 점검 필요.`)
    process.exit(1)
  }
  process.exit(0)
}

main().catch(e => {
  console.error(`[check-self-intro] 예상 외 실패: ${e?.message ?? e}`)
  process.exit(2)
})
