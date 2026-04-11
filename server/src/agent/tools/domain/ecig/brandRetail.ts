// brandRetail.ts — Phase 4 액상전자담배 브랜드·유통 전략
// 도메인 특화 Perplexity sonar-pro wrapper

import { registerTool, type ToolResult } from "../../../toolRegistry.js"
import { runDomainSearch } from "../_domainHelper.js"

registerTool({
  name: "ecig_brand_retail",
  description: "액상전자담배 브랜드 포지셔닝·가격 전략·유통 채널(전자담배 전문점·편의점·온라인·면세점·해외 수출)·프로모션 플랜을 실시간 시장 데이터 기반으로 설계한다.",
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
      tool_name: "ecig_brand_retail",
      system_instruction: "당신은 액상전자담배 브랜드 마케팅·유통 전문가다. 한국의 액상전자담배 유통 구조(전문점 체인·편의점 제한 판매·온라인 금지 품목·면세점) 와 광고 규제(국민건강증진법상 옥외광고 금지·미성년자 노출 금지)를 숙지하고 있다. 원칙: (1) 한국 판매 가능 채널과 금지 채널을 명확히 구분한다. (2) 경쟁 브랜드의 가격대·유통·프로모션을 3개 이상 비교한다. (3) 마케팅 메시지는 국민건강증진법 제9조의4 위반 여부를 동시에 검토한다. (4) 해외 수출 시 각국 라벨·경고문구·니코틴 한도 규정을 포함한다. (5) 출처 URL 필수.",
    })
  },
})
