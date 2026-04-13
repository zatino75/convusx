// externalTool.ts — CC HOMEPAGE → CORVUS X 외부 도구 API
//
// POST /api/external/tool/:tool
//
// CC HOMEPAGE 에서 CORVUS X 도메인 AI 도구를 호출하는 엔드포인트.
// Bearer 토큰 인증 (CORVUS_X_API_KEY env). PII 마스킹은 홈페이지 측에서 처리.
//
// 지원 도구:
//   ai_generate_copy, ai_regulation_check, ai_cs_suggest, ai_report,
//   ai_review_analyze, ai_pricing_support, ai_competitor_scan, ai_market_analyze

import type { IncomingMessage, ServerResponse } from "node:http"
import { logger } from "../observability/logger.js"
import { invokeTool, type ToolContext } from "../agent/toolRegistry.js"
import { readJsonBody } from "../http/middleware.js"

// ── 허용 도구 목록 (화이트리스트) ────────────────────────────────────────
const ALLOWED_TOOLS: Record<string, string> = {
  ai_generate_copy:    "claude_draft_alt",  // 도메인 힌트 포함 카피 생성
  ai_regulation_check: "ecig_regulation_check", // 규제 검증 — 카테고리로 분기
  ai_cs_suggest:       "claude_draft_alt",  // 고객 응답 초안
  ai_report:           "business_analyze",  // 판매·재고 리포트
  ai_review_analyze:   "claude_draft_alt",  // 리뷰 감성 분석
  ai_pricing_support:  "market_analyze",    // 가격 전략 지원
  ai_competitor_scan:  "ecig_competitor_scan", // 경쟁사 모니터링
  ai_market_analyze:   "market_analyze",    // 시장 분석
}

// ── 도구 → 시스템 힌트 매핑 ──────────────────────────────────────────────
function buildSystemHint(externalTool: string, payload: Record<string, unknown>): string {
  const category = String(payload.category ?? payload.product_category ?? "")
  const lang = "한국어(존댓말)로 답변해주세요."

  switch (externalTool) {
    case "ai_generate_copy":
      return [
        `당신은 프리미엄 시샤 브랜드 CLOUD COOKIE의 마케팅 카피라이터입니다.`,
        `브랜드: AL FAKHER(UAE) / MAZAYA(Egypt) / STARBUZZ(USA) / TICK TOCK(Worldwide).`,
        `카테고리: ${category || "일반"}.`,
        `담배사업법에 따라 온라인 직접 판매는 불가하며 도매 파트너십 중심으로 작성하세요.`,
        `표시광고법·담배사업법 위반 문구(효능 과장, 건강 주장 등)를 절대 포함하지 마세요.`,
        lang,
      ].join(" ")

    case "ai_regulation_check":
      return [
        `당신은 식품·담배·화장품 법규 전문가입니다.`,
        `아래 상품 정보가 담배사업법, 식품위생법, 화장품법, 표시광고법에 부합하는지 검토하세요.`,
        `결과를 JSON 형태로: { "pass": bool, "warnings": string[], "violations": string[], "recommendation": string }`,
        lang,
      ].join(" ")

    case "ai_cs_suggest":
      return [
        `당신은 CLOUD COOKIE 고객 서비스 담당자입니다.`,
        `고객 문의에 대한 친절하고 전문적인 응답 초안을 작성하세요.`,
        `B2B 도매 파트너십 관련 문의 시 도매팀 연결을 안내하세요.`,
        `이 응답은 스태프가 검토 후 발송합니다. 자동 발송되지 않습니다.`,
        lang,
      ].join(" ")

    case "ai_report":
      return [
        `당신은 비즈니스 데이터 분석가입니다.`,
        `아래 판매·재고·고객 데이터를 분석해 경영진용 리포트를 작성하세요.`,
        `핵심 지표, 전주 대비 변화, 이슈 및 기회, 권고 사항을 포함하세요.`,
        lang,
      ].join(" ")

    case "ai_review_analyze":
      return [
        `당신은 리뷰 분석 전문가입니다.`,
        `아래 상품 리뷰들의 감성(긍정/부정/중립), 핵심 키워드, 개선 포인트를 분석하세요.`,
        lang,
      ].join(" ")

    case "ai_pricing_support":
      return [
        `당신은 가격 전략 컨설턴트입니다.`,
        `아래 원가, 경쟁사 가격, 판매 추이 데이터를 바탕으로 최적 가격 전략을 제안하세요.`,
        lang,
      ].join(" ")

    case "ai_competitor_scan":
      return [
        `당신은 경쟁 시장 분석 전문가입니다.`,
        `프리미엄 시샤 시장의 경쟁사 동향을 분석하고 CLOUD COOKIE의 포지셔닝 기회를 찾으세요.`,
        lang,
      ].join(" ")

    case "ai_market_analyze":
      return [
        `당신은 시장 분석 전문가입니다.`,
        `아래 시장 데이터를 분석해 비즈니스 인사이트와 기회를 제안하세요.`,
        lang,
      ].join(" ")

    default:
      return lang
  }
}

// ── 요청 본문 → claude_draft_alt / 도메인 도구 인자 변환 ─────────────────
function buildToolInput(externalTool: string, internalTool: string, payload: Record<string, unknown>): Record<string, unknown> {
  const systemHint = buildSystemHint(externalTool, payload)

  // claude_draft_alt 인자 형식
  if (internalTool === "claude_draft_alt") {
    const userContent = JSON.stringify(payload, null, 2)
    return {
      instruction: userContent,
      system_hint: systemHint,
      max_tokens: 2000,
    }
  }

  // 도메인 도구 — payload 를 그대로 전달 + system_hint 추가
  return {
    ...payload,
    _system_hint: systemHint,
  }
}

// ── Bearer 토큰 검증 ─────────────────────────────────────────────────────
function verifyToken(req: IncomingMessage): boolean {
  const expectedKey = process.env.CORVUS_X_API_KEY
  if (!expectedKey) {
    logger.warn("[externalTool] CORVUS_X_API_KEY not set — blocking all external calls")
    return false
  }
  const auth = req.headers["authorization"] ?? ""
  const token = String(auth).replace(/^Bearer\s+/i, "").trim()
  return token === expectedKey
}

// ── 레이트 리밋 (간단 메모리 기반) ─────────────────────────────────────
const _rateMap = new Map<string, { count: number; resetAt: number }>()
const RATE_WINDOW_MS = 60_000
const RATE_LIMIT = 30  // 분당 30회

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = _rateMap.get(ip)
  if (!entry || now > entry.resetAt) {
    _rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }
  entry.count++
  if (entry.count > RATE_LIMIT) return false
  return true
}

// ── 메인 핸들러 ──────────────────────────────────────────────────────────
export async function externalToolRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? ""
  // URL 에서 도구 이름 추출: /api/external/tool/:tool
  const toolMatch = url.match(/\/api\/external\/tool\/([a-z_]+)/)
  const externalTool = toolMatch?.[1] ?? ""

  // 인증
  if (!verifyToken(req)) {
    res.writeHead(401, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: false, error: "unauthorized" }))
    return
  }

  // 화이트리스트 확인
  const internalTool = ALLOWED_TOOLS[externalTool]
  if (!internalTool) {
    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: false, error: `unknown tool: ${externalTool}` }))
    return
  }

  // 레이트 리밋
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown")
  if (!checkRateLimit(ip)) {
    res.writeHead(429, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: false, error: "rate_limit_exceeded" }))
    return
  }

  // 요청 본문
  let payload: Record<string, unknown> = {}
  try {
    const body = await readJsonBody(req)
    if (body && typeof body === "object") payload = body as Record<string, unknown>
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: false, error: "invalid_json" }))
    return
  }

  const callerCtx = String(req.headers["x-caller-ctx"] ?? "external")

  logger.info("[externalTool] call", { externalTool, internalTool, callerCtx, ip })

  const ctx: ToolContext = {
    thread_id: `ext_${Date.now()}`,
    project_id: "cc_homepage",
    user_id: null,
    normalizedInput: { message: JSON.stringify(payload) },
    startedAt: Date.now(),
    toolCallLog: [],
  }

  const toolInput = buildToolInput(externalTool, internalTool, payload)

  try {
    const result = await invokeTool(internalTool, toolInput, ctx)

    // 결과 파싱 시도 — JSON 이면 data 필드로, 아니면 text 로
    let data: unknown = result.output_text
    try { data = JSON.parse(result.output_text) } catch { /* text response */ }

    res.writeHead(result.ok ? 200 : 500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({
      ok: result.ok,
      tool: externalTool,
      data,
      latency_ms: Date.now() - ctx.startedAt,
    }))
  } catch (err: any) {
    logger.error("[externalTool] tool invocation error", { externalTool, error: String(err?.message ?? err) })
    res.writeHead(500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: false, error: "tool_error", detail: String(err?.message ?? err) }))
  }
}
