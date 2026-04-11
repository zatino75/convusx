// marketAnalyze.ts — Phase 4 화장품 시장 분석
// 도메인 특화 Perplexity sonar-pro wrapper

import { registerTool, type ToolResult } from "../../../toolRegistry.js"
import { runDomainSearch } from "../_domainHelper.js"

registerTool({
  name: "cosmetic_market_analyze",
  description: "화장품(스킨케어·메이크업·바디·헤어·프래그런스·기능성·더마) 시장 규모·성장률·주요 브랜드·K-Beauty 트렌드·유통 채널(올리브영·이커머스·면세점·직구)을 분석한다.",
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
      tool_name: "cosmetic_market_analyze",
      system_instruction: "당신은 화장품 시장 분석가다. 한국 화장품 시장(대한화장품협회·식약처 화장품정책과·aT·통계청) 과 글로벌(북미·EU·중국·동남아·중동) 트렌드에 특화돼 있다. 원칙: (1) 시장 규모·성장률은 수치·연도·출처를 반드시 명시한다. (2) K-Beauty 주요 브랜드(아모레퍼시픽·LG생활건강·코스알엑스·닥터자르트·메디힐·이니스프리·에뛰드·VT·라운드랩·토니모리) 를 비교한다. (3) 유통 채널별 점유율(올리브영·헬스앤뷰티·면세점·직구·브랜드몰) 을 제시한다. (4) 더마·비건·클린뷰티·인디브랜드 트렌드를 다룬다. (5) 출처 URL 필수.",
    })
  },
})
