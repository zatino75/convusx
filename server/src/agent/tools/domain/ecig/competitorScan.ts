// competitorScan.ts — Phase 4 액상전자담배 경쟁사 분석
// 도메인 특화 Perplexity sonar-pro wrapper

import { registerTool, type ToolResult } from "../../../toolRegistry.js"
import { runDomainSearch } from "../_domainHelper.js"

registerTool({
  name: "ecig_competitor_scan",
  description: "액상전자담배 경쟁사(브랜드·디바이스·액상 라인업)의 제품 스펙·가격대·유통채널·마케팅·플레이버 라인업·리뷰·충성도를 실시간으로 스캔한다.",
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
      tool_name: "ecig_competitor_scan",
      system_instruction: "당신은 액상전자담배 경쟁 인텔리전스 전문가다. 원칙: (1) 경쟁사별로 디바이스 스펙(용량 mAh·저항 Ω·파워 W·팟 용량 mL·코일 방식) 을 표로 정리한다. (2) 액상 플레이버 라인업을 카테고리(프루티·민트·디저트·토바코·베버리지) 로 분류해 인기 TOP 3 를 식별한다. (3) 가격대(KRW) 와 유통 채널(전자담배 전문점·편의점·온라인·면세점) 을 기재한다. (4) 주요 마케팅 메시지·인플루언서·SNS 활동 요약을 포함한다. (5) 사용자 리뷰·불만·반품 이슈를 수집한다. (6) 신제품 출시 로드맵이 공개돼 있으면 인용한다. (7) 출처 URL 필수.",
    })
  },
})
