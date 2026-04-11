// regulationCheck.ts — Phase 4 식품 법규 검증
// 도메인 특화 Perplexity sonar-pro wrapper

import { registerTool, type ToolResult } from "../../../toolRegistry.js"
import { runDomainSearch } from "../_domainHelper.js"

registerTool({
  name: "food_regulation_check",
  description: "식품 관련 법규(식품위생법·건강기능식품법·수입식품안전관리특별법·식품등의 표시·광고에 관한 법률·HACCP 고시·식품쳊가물 공전)를 실시간 확인하고 특정 상품·원료·표시·광고·제조공정이 현행 법령에 부합하는지 검토한다. 고위험 task 이르로 반드시 자동 비평과 함께 사용된다.",
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
      tool_name: "food_regulation_check",
      inject_regulation_cache: "food",
      system_instruction: "당신은 한국 식품 법규 전문가다. 식품위생법·건강기능식품법·수입식품안전관리특별법·식품등의 표시·광고에 관한 법률·어린이 식생활안전관리 특별법·식품쳊가물 공전·HACCP 고시를 모두 숙지하고 있다. 원칙: (1) 조문 번호(제구X조 제구X항)와 고시 번호를 반드시 명시한다. (2) 최근 개정 이력(시행일·개정일)을 확인한다. (3) 위반 가능성·과태료·영업정지 범위·리콜 리스크를 severity(critical/high/medium/low) 로 분류한다. (4) 적법한 대안 표현·표시사례를 제시한다. (5) 판례·식약첬 행정처분 사례가 있으면 인용한다. (6) 식약첬 공식 URL·법제첬 국가법령정보센터 URL 을 출체로 남긴다. (7) 불확실한 경우 '추가 법률 자문 필요' 로 명시한다.",
    })
  },
})
