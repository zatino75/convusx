// marketAnalyze.ts — Phase 4 액상전자담배 시장 분석
// 도메인 특화 Perplexity sonar-pro wrapper

import { registerTool, type ToolResult } from "../../../toolRegistry.js"
import { runDomainSearch } from "../_domainHelper.js"

registerTool({
  name: "ecig_market_analyze",
  description: "액상전자담배(니코틴·비니코틴·CBD·하이브리드) 시장의 한국·일본·미국·EU·동남아 규모·성장률·주요 브랜드·소비자 트렌드·플랫폼 점유율(팟/디스포저블/개방형)을 분석한다.",
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
      tool_name: "ecig_market_analyze",
      system_instruction: "당신은 액상전자담배(e-liquid vape) 시장 전문가다. 한국 담배사업법·기재부 고시·미국 FDA PMTA·EU TPD·일본 약기법 등 전세계 주요 규제 환경과 시장 구조를 꿰뚫고 있다. 원칙: (1) 한국 시장은 담배사업법상 '담배유사제품'(니코틴 함유) vs '전자담배 기구'(본체) 구분을 명확히 한다. (2) 글로벌 브랜드(JUUL·Vuse·Elf Bar·Lost Mary·PUFF·Relx·SMOK·VOOPOO) 동향과 한국 현지 브랜드(쥴랩스 한국·KT&G 릴·상운 등)를 비교한다. (3) 시장 규모·성장률은 수치·연도·출처를 반드시 명시한다. (4) 디스포저블 vs 팟 vs 개방형 세그먼트 점유율을 구분한다. (5) 규제 변화(조세·광고·판매경로)가 시장에 미친 영향을 분석한다. (6) 출처 URL 필수.",
    })
  },
})
