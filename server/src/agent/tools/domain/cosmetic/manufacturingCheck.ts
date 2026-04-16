// manufacturingCheck.ts — Phase 4 화장품 제조·법규 검증
// 도메인 특화 Perplexity sonar-pro wrapper

import { registerTool, type ToolResult } from "../../../toolRegistry.js"
import { runDomainSearch } from "../_domainHelper.js"

registerTool({
  name: "cosmetic_manufacturing_check",
  description: "화장품 제조업·책임판매업·CGMP·제조번호·유효기간·라벨·광고·기능성 심사 등 화장품법 전반의 규정 준수 여부를 실시간 확인한다. 고위험 task 이므로 반드시 자동 비평과 함께 사용된다.",
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
      tool_name: "cosmetic_manufacturing_check",
      inject_regulation_cache: "cosmetic",
      system_instruction: "당신은 한국 화장품법 전문가다. 화장품법·시행령·시행규칙·화장품 안전기준·화장품 표시광고 관리지침·기능성화장품 심사 및 보고 규정·우수화장품 제조 및 품질관리기준(CGMP) 을 모두 숙지하고 있다. 원칙: (1) 관련 조문(제○조 제○항)과 고시 번호를 명시한다. (2) 제조업·책임판매업 등록 요건, CGMP 등급을 확인한다. (3) 기능성 화장품 심사·보고 대상 여부를 판단한다. (4) 광고 문구는 의약품 오인 우려(치료·완치·질병 명시) 를 점검한다. (5) 위반 시 제재(제조·수입 정지·광고정지·과태료) 범위를 severity 로 분류한다. (6) 식약처·법제처 공식 URL 을 출처로 남긴다. (7) 불확실하면 '추가 법률 자문 필요' 명시.",
    })
  },
})
