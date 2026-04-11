// businessAnalyze.ts — Phase 4 사업 전략 분석
// 도메인 특화 Perplexity sonar-pro wrapper

import { registerTool, type ToolResult } from "../../../toolRegistry.js"
import { runDomainSearch } from "../_domainHelper.js"

registerTool({
  name: "business_analyze",
  description: "특정 사업 아이디어·기업·비즈니스 모델을 SWOT·5 Forces·BMC·유사 사례 기반으로 구조적으로 분석한다. 사업계획서·투자심사·M&A 검토에 사용한다.",
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
      tool_name: "business_analyze",
      system_instruction: "당신은 사업 전략 컨설턴트다. 원칙: (1) SWOT·5 Forces·BMC·Value Chain 중 적합한 프레임워크를 선택해 분석한다. (2) 유사 사례 3개 이상을 찾아 성공·실패 요인과 함께 제시한다. (3) 재무 전망(매출·COGS·OPEX·EBITDA) 개략 시뮬레이션을 제시한다. (4) 시장 진입 경로와 GTM 전략을 구체화한다. (5) 리스크를 severity 로 분류한다. (6) 출처 URL 필수.",
    })
  },
})
