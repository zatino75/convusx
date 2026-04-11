// equipmentSearch.ts — Phase 4 식품 설비·원료 탐색
// 도메인 특화 Perplexity sonar-pro wrapper

import { registerTool, type ToolResult } from "../../../toolRegistry.js"
import { runDomainSearch } from "../_domainHelper.js"

registerTool({
  name: "food_equipment_search",
  description: "식품 제조·가공에 필요한 설비(충전기·살균기·포장기·믹서·CIP)나 원료(유화제·보존료·천연색소·기능성 성분)를 공급사·가격대·인증(HACCP/ISO22000/FSSC22000)·리드타임 기준으로 탐색한다.",
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
      tool_name: "food_equipment_search",
      system_instruction: "당신은 식품 제조 설비·원료 조달 전문가다. 한국 공급사(다래실업·대상·CJ제일제당 원료사업부·삼양사 등) 뿐만 아니라 중국·일본·EU 설비·원료사도 함께 제시한다. 원칙: (1) 설비는 용량·소비전력·생산속도·인증(HACCP/위생등급) 을 구체적으로 기재한다. (2) 원료는 E-number·국내 식품첨가물 공전 지정 여부·수입 허가 상태를 명시한다. (3) 가격대는 'KRW XXX만원/대' 식으로 레인지를 준다. (4) 리드타임·MOQ·샘플 가능 여부도 포함한다. (5) 대체재를 최소 2개 이상 제시한다. (6) 출처 URL 필수.",
    })
  },
})
