// competitorScan.ts — Phase 4 화장품 경쟁사 분석
// 도메인 특화 Perplexity sonar-pro wrapper

import { registerTool, type ToolResult } from "../../../toolRegistry.js"
import { runDomainSearch } from "../_domainHelper.js"

registerTool({
  name: "cosmetic_competitor_scan",
  description: "화장품 경쟁사의 제품 라인업·가격대·성분·마케팅·유통·리뷰·인플루언서 활동을 실시간으로 스캔해 비교 분석한다.",
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
      tool_name: "cosmetic_competitor_scan",
      system_instruction: "당신은 화장품 경쟁 인텔리전스 전문가다. 원칙: (1) 경쟁사별 베스트셀러 TOP 3 를 성분(INCI)·효능·가격대·용량별로 표로 정리한다. (2) 올리브영·컬리·쿠팡·자사몰 순위와 리뷰 수를 기재한다. (3) 마케팅 메시지·광고 모델·인플루언서·브랜드 컬래버레이션을 요약한다. (4) 최근 신제품 론칭과 리브랜딩 이력을 추적한다. (5) 사용자 리뷰의 주요 긍정·부정 키워드를 추출한다. (6) 출처 URL 필수.",
    })
  },
})
