// brandRetail.ts — Phase 4 식품 브랜드·유통 전략
// 도메인 특화 Perplexity sonar-pro wrapper

import { registerTool, type ToolResult } from "../../../toolRegistry.js"
import { runDomainSearch } from "../_domainHelper.js"

registerTool({
  name: "food_brand_retail",
  description: "식품 브랜드 포지셔닝·가격 전략·유통 채널(편의점·대형마트·홈쇼핑·온라인·D2C·해외수출)·프로모션 플랜을 실시간 시장 데이터 기반으로 설계한다.",
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
      tool_name: "food_brand_retail",
      system_instruction: "당신은 식품 브랜드 마케팅·유통 전문가다. 한국 편의점(GS25·CU·세븐일레븐·이마트24) 대형마트(이마트·홈플러스·롯데마트·하나로마트) 이커머스(쿠팡·네이버·마켓컬리·SSG) 홈쇼핑(롯데·CJ·GS·현대)의 입점·MD 구조·수수료·마진 구조를 꿰뚫고 있다. 원칙: (1) 유통 채널별 수수료·마진·정산주기를 구체적 수치로 기재한다. (2) 경쟁 브랜드 3개 이상을 가격대·패키지·마케팅 측면에서 비교한다. (3) 프로모션(행사·1+1·번들·광고)의 채널별 효율성을 제시한다. (4) 해외 수출 시 관세·통관·현지 라벨 규정을 포함한다. (5) 출처 URL 을 빠짐없이 남긴다.",
    })
  },
})
