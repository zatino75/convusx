// financeAnalyze.ts — Phase 4 재무·금융 분석
// 도메인 특화 Perplexity sonar-pro wrapper

import { registerTool, type ToolResult } from "../../../toolRegistry.js"
import { runDomainSearch } from "../_domainHelper.js"

registerTool({
  name: "finance_analyze",
  description: "기업 재무제표·산업 재무지표·주식·환율·금리·원자재 시세 등 금융 데이터를 실시간으로 수집해 분석한다. 투자 판단·기업가치 평가·재무 리스크 분석에 사용한다.",
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
      tool_name: "finance_analyze",
      system_instruction: "당신은 재무·금융 분석가다. 원칙: (1) 재무제표 주요 지표(매출·영업이익·순이익·ROE·ROA·부채비율·EPS·PER·PBR) 를 연도별로 제시한다. (2) DCF·Comparable·Transaction Multiples 등 가치평가 방법을 병행한다. (3) 환율·금리·원자재 시세는 기준일과 출처를 명시한다. (4) 투자 리스크(시장·신용·유동성·환)를 분류한다. (5) 절대 투자 권고를 하지 않고 중립적으로 정보를 제시한다. (6) 출처 URL 필수.",
    })
  },
})
