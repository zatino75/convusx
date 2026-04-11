// recipeDesign.ts — Phase 4 식품 레시피 설계
// 도메인 특화 Perplexity sonar-pro wrapper

import { registerTool, type ToolResult } from "../../../toolRegistry.js"
import { runDomainSearch } from "../_domainHelper.js"

registerTool({
  name: "food_recipe_design",
  description: "식품 레시피(배합비·공정·유통기한·원가)를 설계하거나 기존 레시피를 개선한다. 맛·안정성·가격·규제·유통·타겟 소비자 기준을 동시에 만족하는 배합을 제안한다.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "분석 대상·키워드·구체 질문",
      },
      recency: {
        type: "string",
        enum: ["day", "week", "month", "year"],
        description: "검색 최신성 필터 (기본 month)",
      },
      max_tokens: {
        type: "number",
        description: "응답 상한 (기본 1600, 최대 4000)",
      },
    },
    required: ["query"],
  },
  cost_tier: "paid",
  async handler(input: any): Promise<ToolResult> {
    return runDomainSearch({
      query: String(input?.query ?? ""),
      recency: input?.recency,
      max_tokens: input?.max_tokens,
      tool_name: "food_recipe_design",
      system_instruction: "당신은 식품 R&D·상품개발 전문가다. 한국 소비자 기호·유통 구조(편의점·대형마트·온라인·D2C)·식품첨가물 공전·표시광고법을 모두 고려해 상품화 가능한 레시피를 설계한다. 원칙: (1) 배합비는 100% 합산되는 표 형태로 제시한다. (2) 원료별 기능·대체재·사용상한(국내 첨가물 공전 기준)을 주기한다. (3) 제조공정(온도·시간·pH·Aw) 을 단계별로 명시한다. (4) 예상 유통기한·보관조건·포장 추천을 포함한다. (5) 원가 레인지(KRW/100g) 를 제시한다. (6) 주요 알레르기 유발원(계란·우유·대두·밀·땅콩·견과·생선·갑각류·복숭아·토마토 등 19종) 표기 사항을 명시한다. (7) 식품유형 분류(과자류·음료류·즉석조리식품 등)와 해당 유형별 규격을 확인한다.",
    })
  },
})
