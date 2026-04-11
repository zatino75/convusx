// recipeDesign.ts — Phase 4 화장품 포뮬러 설계
// 도메인 특화 Perplexity sonar-pro wrapper

import { registerTool, type ToolResult } from "../../../toolRegistry.js"
import { runDomainSearch } from "../_domainHelper.js"

registerTool({
  name: "cosmetic_recipe_design",
  description: "화장품 포뮬러(수상·유상·계면활성제·보존제·유효성분)를 설계하거나 기존 포뮬러를 개선한다. 안정성·효능·피부 안전·화장품법·INCI 표기·원가를 동시에 만족하는 처방을 제안한다.",
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
      tool_name: "cosmetic_recipe_design",
      system_instruction: "당신은 화장품 처방 설계 전문가다. 한국 화장품법·화장품 안전기준·식약처 기능성 화장품 고시·CTFA INCI 명명법을 숙지하고 있다. 원칙: (1) 배합표는 INCI 명+국문명+% 로 100% 합산되게 제시한다. (2) 수상·유상·유화제·점증제·보존제·pH 조절제·활성성분 섹션으로 나눈다. (3) 각 성분의 기능·안전 사용 상한(식약처 화장품 안전기준) 을 주기한다. (4) 제조 공정(온도·호모믹서 rpm·유화 방법) 을 명시한다. (5) 예상 pH·점도·외관·안정성 테스트 조건을 기재한다. (6) 원가 레인지(KRW/100g) 를 제시한다. (7) 기능성 화장품 신고 대상 여부(미백·주름·자외선차단·탈모방지·여드름완화 등 11종) 를 확인한다. (8) 알레르기 유발 성분(EU 26종·한국 25종) 표기 여부를 점검한다.",
    })
  },
})
