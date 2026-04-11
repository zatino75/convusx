// triggerDetection.ts — 고가치 경로(high-value path) 자동 감지 모듈
//
// agentLoopBridge.ts 에서 분리. HIGH_VALUE_KEYWORDS 배열 + 감지 함수를
// 한 곳에서 관리해 재사용성·테스트 용이성을 확보한다.
//
// 사용:
//   import { decideHighValue } from "./triggerDetection.js"
//   const highValue = decideHighValue(effectiveInput)

function safeStr(v: any): string {
  return String(v ?? "").trim()
}

/**
 * 고가치 경로 자동 감지 키워드 (한국어·영어 혼용).
 * 아래 패턴이 포함되면 parallel_ensemble + adversarial_critique 자동 발동.
 */
export const HIGH_VALUE_KEYWORDS: RegExp[] = [
  // ── 법률/계약/규제 (한국어) ────────────────────────────────────────────
  /답변서/, /준비서면/, /소장/, /계약(서|조항|검토)/, /약관\s*검토/, /법률\s*검토/,
  /규제\s*(검토|분석|확인)/, /컴플라이언스/, /인허가/, /고시\s*(검토|변경)/,

  // ── 비즈니스/전략/재무 (한국어) ──────────────────────────────────────
  /사업\s*계획/, /비즈니스\s*플랜/, /IR\s*자료/, /투자\s*제안/, /M&A/, /IPO/,
  /리스크\s*(분석|평가|검토)/, /전략\s*(수립|분석|기획)/, /최종\s*검토/,
  /재무\s*(분석|모델|검토)/, /밸류에이션/, /DCF/,

  // ── 상품/브랜드 (한국어, 사용자 도메인 핵심) ──────────────────────────
  /상품\s*(개발|기획|런칭)/, /브랜드\s*(전략|포지셔닝|런칭)/, /제품\s*개발/,
  /식품\s*(규제|인증|성분|레시피)/, /전자담배\s*(규제|성분|인증)/,
  /화장품\s*(성분|규제|제조|인증)/,

  // ── 리서치/분석 (한국어) ─────────────────────────────────────────────
  /심층\s*분석/, /경쟁사\s*분석/, /시장\s*조사/, /시장\s*분석/,

  // ── 영어 ─────────────────────────────────────────────────────────────
  /\blegal\s+(review|opinion|memo)\b/i,
  /\bcontract\s+review\b/i,
  /\bcompliance\b/i,
  /\bbusiness\s+plan\b/i,
  /\bpitch\s+deck\b/i,
  /\bdue\s+diligence\b/i,
  /\brisk\s+(analysis|assessment)\b/i,
  /\bfinal\s+review\b/i,
  /\bM&A\b/i,
  /\bvaluation\b/i,
  /\bproduct\s+(development|launch)\b/i,
  /\bmarket\s+(analysis|research)\b/i,
  /\bcompetitive\s+(analysis|intelligence)\b/i,
]

/**
 * 단일 메시지 문자열을 키워드 배열로 검사.
 * 15자 미만 초단문은 잡음 방지를 위해 즉시 false.
 */
export function detectHighValueByKeywords(message: string): boolean {
  const m = safeStr(message)
  if (!m || m.length < 15) return false
  return HIGH_VALUE_KEYWORDS.some((re) => re.test(m))
}

/**
 * effectiveInput 전체를 보고 high-value path 여부를 최종 결정.
 *
 * 우선순위:
 *  1) effectiveInput.force_high_value === true  → 즉시 true (UI 토글)
 *  2) task 기반 매핑
 *  3) 마지막 user 메시지 키워드 자동 감지
 */
export function decideHighValue(effectiveInput: any): boolean {
  // 1) 명시적 UI 토글 — 최우선
  if (effectiveInput?.force_high_value === true) return true

  // 2) task 기반 매핑
  const task = safeStr(effectiveInput?.task)
  if (task && task !== "dialogue") {
    const hv = new Set([
      "code_debug", "code_implement", "code_refactor_review",
      "legal_review", "finance_analysis", "product_development",
      "writing_business", "long_doc", "deep_research",
      "data_analysis", "research",
    ])
    if (hv.has(task)) return true
  }

  // 3) 마지막 user 메시지 키워드 자동 감지
  const msg = (() => {
    const direct = safeStr(effectiveInput?.message)
    if (direct) return direct
    const msgs = Array.isArray(effectiveInput?.messages) ? effectiveInput.messages : []
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const m = msgs[i]
      if (m?.role === "user") {
        if (typeof m.content === "string") return safeStr(m.content)
        if (Array.isArray(m.content)) {
          return m.content
            .map((p: any) => (typeof p === "string" ? p : safeStr(p?.text)))
            .filter(Boolean)
            .join("\n")
            .trim()
        }
      }
    }
    return ""
  })()
  if (detectHighValueByKeywords(msg)) return true

  return false
}

/**
 * domain_profile 에 따른 도메인 도구 힌트 문자열 반환.
 * agentLoopBridge.ts 에서 extra_system 에 주입된다.
 */
export function buildDomainHint(domainProfile: string): string {
  switch (domainProfile) {
    case "food":
      return [
        "【도메인 프로파일: 식품】",
        "이 요청은 식품 도메인으로 설정돼 있습니다.",
        "가능하면 food_market_analyze / food_regulation_check / food_recipe_design /",
        "food_equipment_search / food_brand_retail 도구를 우선 고려하세요.",
        "식품위생법·식약처 고시·HACCP 관련 최신 규제 정보를 기반으로 답변하세요.",
      ].join(" ")

    case "ecig":
      return [
        "【도메인 프로파일: 액상전자담배】",
        "이 요청은 액상전자담배(e-cigarette) 도메인으로 설정돼 있습니다.",
        "가능하면 ecig_market_analyze / ecig_regulation_check / ecig_competitor_scan /",
        "ecig_brand_retail 도구를 우선 고려하세요.",
        "담배사업법·기재부 고시·FDA PMTA·EU TPD 최신 규제 정보를 기반으로 답변하세요.",
      ].join(" ")

    case "cosmetic":
      return [
        "【도메인 프로파일: 화장품】",
        "이 요청은 화장품 도메인으로 설정돼 있습니다.",
        "가능하면 cosmetic_market_analyze / cosmetic_competitor_scan / cosmetic_recipe_design /",
        "cosmetic_manufacturing_check 도구를 우선 고려하세요.",
        "화장품법·화장품 안전기준·식약처 화장품 고시 최신 규제 정보를 기반으로 답변하세요.",
      ].join(" ")

    case "general":
    default:
      return "" // 범용 프로파일은 힌트 없음
  }
}
