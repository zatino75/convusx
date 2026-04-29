/**
 * availableTools.ts — 동적 도구 가용성 빌더 (CLAUDE.md #25/#26).
 *
 * 2026-04-29 신규.
 * 목적: 등록된 도구 중 *환경변수 키가 실제로 채워진* 도구만 system prompt 에 노출.
 *   미연결 어댑터(Midjourney/Runway 등)가 키 없이 description 만 노출되어
 *   모델이 "이 기능 가능합니다" 라고 거짓 자기소개하는 회귀 방지.
 *
 * 사용:
 *   agentLoop.ts → toAnthropicTools(listAvailableTools())
 *   상태 디버그 → buildAvailableToolsList()
 */

import { listTools, type ToolDefinition } from "./toolRegistry.js"

/**
 * 도구별 환경변수 의존성 매핑.
 *
 * 한 도구가 여러 키 조합 중 하나만 있으면 작동하는 경우 OR 그룹(이중 배열)으로 표현.
 *   예) generate_image: dall-e=OPENAI / imagen,flash=GEMINI / midjourney=MJ key
 *       → 어느 하나라도 있으면 도구 자체는 활성 (특정 sub-model 만 비활성).
 *
 * 키 자체가 없으면 도구 통째 비활성. 빈 배열은 "키 불필요".
 */
type EnvAny = string | string[]
const TOOL_ENV_REQUIREMENTS: Record<string, EnvAny[]> = {
  // 핵심 도구 — 키 불필요
  read_attachment:        [],
  recall_thread_history:  [],
  recall_project_memory:  [],
  promote_to_source:      [],

  // LLM 어댑터 사용 도구
  perplexity_search:      ["PERPLEXITY_API_KEY"],
  web_fetch:              [],  // 외부 URL 직접 fetch — 키 불필요

  // Draft / Ensemble (provider 별 키 OR 그룹)
  gpt_draft:              ["OPENAI_API_KEY"],
  gemini_draft:           ["GEMINI_API_KEY"],
  claude_draft_alt:       ["ANTHROPIC_API_KEY"],
  parallel_ensemble:      [["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]],
  adversarial_critique:   [["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]],

  // 미디어 생성 — 어느 하나라도 키 있으면 도구 활성 (sub-model 은 핸들러에서 키 검사)
  generate_image:         [["OPENAI_API_KEY", "GEMINI_API_KEY", "MIDJOURNEY_API_KEY"]],
  generate_video:         [["RUNWAY_API_KEY", "GEMINI_API_KEY"]],
  generate_slides:        ["ANTHROPIC_API_KEY"],

  // 도메인 특화 — 사전조사 + LLM 종합. 어댑터 키 1개 이상이면 활성.
  food_market_analyze:        [["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]],
  food_equipment_search:      [["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]],
  food_regulation_check:      [["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]],
  food_recipe_design:         [["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]],
  food_brand_retail:          [["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]],
  ecig_market_analyze:        [["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]],
  ecig_competitor_scan:       [["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]],
  ecig_regulation_check:      [["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]],
  ecig_brand_retail:          [["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]],
  cosmetic_market_analyze:    [["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]],
  cosmetic_competitor_scan:   [["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]],
  cosmetic_recipe_design:     [["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]],
  cosmetic_manufacturing_check:[["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]],
  general_market_analyze:     [["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]],
  general_business_analyze:   [["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]],
  general_finance_analyze:    [["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]],
}

function envHas(key: string): boolean {
  const v = process.env[key]
  return typeof v === "string" && v.trim().length > 0
}

/** 단일 요구사항 항목 검증. 문자열 = AND, 배열 = OR. */
function envRequirementMet(item: EnvAny): boolean {
  if (Array.isArray(item)) return item.some(envHas)
  return envHas(item)
}

/** 도구의 모든 요구사항 (AND 조합) 검증. 매핑 없으면 항상 활성. */
export function isToolAvailable(name: string): boolean {
  const reqs = TOOL_ENV_REQUIREMENTS[name]
  if (!reqs) return true  // 매핑 미등록 = 키 무관 도구로 간주
  if (reqs.length === 0) return true
  return reqs.every(envRequirementMet)
}

/** 등록된 도구 중 환경변수 조건이 충족된 것만 반환. agentLoop 가 호출. */
export function listAvailableTools(): ToolDefinition[] {
  return listTools().filter(t => isToolAvailable(t.name))
}

/** 디버그/대시보드용 — 모든 도구의 가용 여부 표시. */
export function buildAvailableToolsList(): Array<{
  name: string
  description: string
  available: boolean
  missingKeys: string[]
}> {
  return listTools().map(t => {
    const reqs = TOOL_ENV_REQUIREMENTS[t.name] ?? []
    const missing: string[] = []
    for (const item of reqs) {
      if (!envRequirementMet(item)) {
        if (Array.isArray(item)) missing.push(`(${item.join("|")})`)
        else missing.push(item)
      }
    }
    return {
      name: t.name,
      description: t.description.slice(0, 160),
      available: missing.length === 0,
      missingKeys: missing,
    }
  })
}
