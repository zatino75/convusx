/**
 * Classifier.ts — 의도 기반 라우팅 게이트 (Session 5 Phase 2, 2026-04-24)
 *
 * Primary: Gemini 2.5 Flash (~5s, ~$0.001)
 * Fallback: Claude Haiku 4.5 (~8s)
 *
 * ExecutiveGate 진입점에서 Planner(Sonnet) 호출 전에 먼저 실행.
 * intent === 'simple_qa' 면 즉시 single_agent 로 라우팅하여 Planner 비용 회피.
 * 그 외는 maxDepts 만 결정해서 Planner 에 넘김.
 *
 * CLAUDE.md 규칙 #6 (MAX_DEPTS 증가 금지) 준수: 모든 intent 가 ≤ 4 부서.
 *   simple_qa: 0  (single_agent 즉시)
 *   operational: 2
 *   research: 3
 *   strategic: 4
 */

import { logger } from "../observability/logger.js"
import { GEMINI_FLASH_MODEL_ID } from "../config/defaults.js"

export type Intent = "simple_qa" | "operational" | "research" | "strategic"
export type Domain = "food" | "ecig" | "cosmetic" | "general"

export interface ClassifierResult {
  intent: Intent
  domain: Domain
  maxDepts: number
  reason: string
}

const INTENT_MAX_DEPTS: Record<Intent, number> = {
  simple_qa: 0,
  operational: 2,
  research: 3,
  strategic: 4,
}

const VALID_INTENTS: ReadonlySet<string> = new Set(Object.keys(INTENT_MAX_DEPTS))
const VALID_DOMAINS: ReadonlySet<string> = new Set(["food", "ecig", "cosmetic", "general"])

const FLASH_TIMEOUT_MS = 5_000
const HAIKU_TIMEOUT_MS = 15_000
const MAX_TOKENS = 400

const CLASSIFIER_SYSTEM = `당신은 비즈니스 질문 분류기입니다. 아래 기준으로 분류하세요.

의도 분류:
- simple_qa: 간단한 사실 확인, 정의, 시스템 질문, "~가 뭐야?" 형태
- operational: 매출/현황/보고 등 운영 데이터 조회
- research: 시장/규제/경쟁사 조사. "분석","조사","검토","파악","알아봐" 포함 시 반드시 research 이상
- strategic: 전략 수립, 신제품 기획, 런칭 계획, 여러 관점이 필요한 복합 과제

⚠️ 핵심 규칙:
- "분석/조사/검토/파악/알아봐" 키워드 → research 이상 (simple_qa 절대 금지)
- "전략/계획/런칭/기획" 키워드 → strategic
- 짧아도 복잡한 질문이면 research 이상으로 분류

도메인: food(식품), ecig(전자담배), cosmetic(화장품), general(일반)

JSON만 반환 (다른 텍스트 없이):
{"intent":"research","domain":"ecig","reason":"한 줄 이유"}`

function tryParseClassification(raw: string): ClassifierResult | null {
  if (!raw) return null
  // <thinking> 제거 + code fence 제거
  let cleaned = raw.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
  cleaned = cleaned.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim()
  // 균형 잡힌 첫 JSON object 추출
  const m = cleaned.match(/\{[\s\S]*?\}/)
  if (!m) return null
  try {
    const obj = JSON.parse(m[0])
    const intentRaw = String(obj.intent ?? "").toLowerCase().trim()
    if (!VALID_INTENTS.has(intentRaw)) return null
    const intent = intentRaw as Intent
    const domainRaw = String(obj.domain ?? "general").toLowerCase().trim()
    const domain = (VALID_DOMAINS.has(domainRaw) ? domainRaw : "general") as Domain
    return {
      intent,
      domain,
      maxDepts: INTENT_MAX_DEPTS[intent],
      reason: String(obj.reason ?? "").slice(0, 200),
    }
  } catch {
    return null
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number, tag: string): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${tag}_timeout`)), ms)),
  ])
}

async function callFlashPrimary(query: string): Promise<string> {
  const apiKey = String(process.env.GEMINI_API_KEY ?? "").trim()
  if (!apiKey) throw new Error("missing_gemini_api_key")
  const { geminiAdapter } = await import("../adapters/gemini.js")
  const resp = await withTimeout(
    geminiAdapter.generate({
      provider: "gemini",
      model: GEMINI_FLASH_MODEL_ID,
      messages: [
        { role: "system", content: CLASSIFIER_SYSTEM },
        { role: "user", content: `질문: ${query}` },
      ],
      max_tokens: MAX_TOKENS,
    } as any),
    FLASH_TIMEOUT_MS,
    "classifier_flash",
  )
  if (resp.error) throw new Error(resp.error.message)
  return String(resp.answer ?? "")
}

async function callHaikuFallback(query: string): Promise<string> {
  const apiKey = String(process.env.ANTHROPIC_API_KEY ?? "").trim()
  if (!apiKey) throw new Error("missing_anthropic_api_key")
  const { callClaudeHaiku } = await import("../adapters/wrappers.js")
  return await withTimeout(
    callClaudeHaiku(CLASSIFIER_SYSTEM, `질문: ${query}`, MAX_TOKENS),
    HAIKU_TIMEOUT_MS,
    "classifier_haiku",
  )
}

export async function classify(query: string): Promise<ClassifierResult> {
  const trimmed = String(query ?? "").trim()
  if (!trimmed) {
    return { intent: "simple_qa", domain: "general", maxDepts: 0, reason: "empty_query" }
  }

  // Primary: Gemini Flash
  try {
    const raw = await callFlashPrimary(trimmed)
    const parsed = tryParseClassification(raw)
    if (parsed) {
      logger.info("[Classifier] flash ok", { intent: parsed.intent, domain: parsed.domain, maxDepts: parsed.maxDepts })
      return parsed
    }
    logger.warn("[Classifier] flash parse 실패", { preview: raw.slice(0, 200) })
  } catch (err: any) {
    logger.warn("[Classifier] flash 호출 실패", { error: String(err?.message ?? err) })
  }

  // Fallback: Claude Haiku
  try {
    const raw = await callHaikuFallback(trimmed)
    const parsed = tryParseClassification(raw)
    if (parsed) {
      logger.info("[Classifier] haiku fallback ok", { intent: parsed.intent, domain: parsed.domain })
      return parsed
    }
    logger.warn("[Classifier] haiku parse 실패", { preview: raw.slice(0, 200) })
  } catch (err: any) {
    logger.warn("[Classifier] haiku 호출 실패", { error: String(err?.message ?? err) })
  }

  // 최종 안전망: research 로 분류 (simple_qa 오분류 → 비용 폭발 방지)
  logger.warn("[Classifier] 모든 provider 실패 → research 기본값")
  return {
    intent: "research",
    domain: "general",
    maxDepts: 3,
    reason: "classifier_failed_default_research",
  }
}
