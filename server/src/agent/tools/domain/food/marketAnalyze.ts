// marketAnalyze.ts — Phase 4 식품 시장 분석
// 도메인 특화 Perplexity sonar-pro wrapper

import { registerTool, type ToolResult } from "../../../toolRegistry.js"
import { runDomainSearch } from "../_domainHelper.js"

registerTool({
  name: "food_market_analyze",
  description: "식품(가공식품·신선식품·HMR·건강기능식품·음료) 카테고리의 한국 또는 해외 시장 규모·성장률·주요 플레이어·소비자 트렌드를 실시간 데이터로 분석한다. 신제품 개발·사업 진입·카테고리 분석에 사용한다.",
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
      tool_name: "food_market_analyze",
      system_instruction: "당신은 식품 시장 분석 전문가다. 한국 식품 시장(식약처 분류·HACCP·건강기능식품 포함)과 글로벌 트렌드(북미·EU·일본·동남아)에 특화돼 있다. 다음 원칙을 따른다: (1) 한국 데이터는 식약처·식품의약품안전처·aT한국농수산식품유통공사·식품산업통계정보·통계청 KOSIS·닐슨 한국 자료를 우선한다. (2) 시장 규모·성장률·점유율은 반드시 수치와 연도를 명시한다. (3) 주요 기업·브랜드·SKU 예시를 3개 이상 나열한다. (4) 트렌드는 최근 6~12개월 기사·보고서 근거로만 제시한다. (5) 규제·라벨링 리스크가 보이면 반드시 명시한다. (6) 출처 URL 을 빠짐없이 남긴다.",
    })
  },
})
