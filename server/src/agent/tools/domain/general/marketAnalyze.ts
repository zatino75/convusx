// marketAnalyze.ts — Phase 4 범용 시장 분석
// 도메인 특화 Perplexity sonar-pro wrapper

import { registerTool, type ToolResult } from "../../../toolRegistry.js"
import { runDomainSearch } from "../_domainHelper.js"

registerTool({
  name: "market_analyze",
  description: "일반 산업·카테고리의 시장 규모·성장률·경쟁 구도·트렌드를 실시간 웹 데이터로 분석한다. 식품·전자담배·화장품 이외의 모든 산업(IT·SaaS·커머스·제조·유통·서비스) 에 사용한다.",
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
      tool_name: "market_analyze",
      system_instruction: "당신은 전방위 시장 분석가다. 원칙: (1) 시장 규모·CAGR·예측치는 반드시 수치·연도·출처를 명시한다. (2) 주요 플레이어 TOP 5 와 점유율을 표로 제시한다. (3) 최근 12개월 M&A·펀딩·신제품·규제 변화를 연대기로 정리한다. (4) 트렌드는 뒷받침 데이터와 함께 제시한다. (5) 리스크·규제·진입장벽을 언급한다. (6) 출처 URL 필수.",
    })
  },
})
