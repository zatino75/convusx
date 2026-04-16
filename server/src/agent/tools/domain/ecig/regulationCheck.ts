// regulationCheck.ts — Phase 4 액상전자담배 법규 검증
// 도메인 특화 Perplexity sonar-pro wrapper

import { registerTool, type ToolResult } from "../../../toolRegistry.js"
import { runDomainSearch } from "../_domainHelper.js"

registerTool({
  name: "ecig_regulation_check",
  description: "액상전자담배 관련 법규(담배사업법·기재부 고시·국민건강증진법·안전기준·FDA PMTA·EU TPD·각국 니코틴 한도·포장·경고문구)를 실시간 확인하고 특정 제품·판매·광고가 현행 법령에 부합하는지 검토한다. 고위험 task 이므로 반드시 자동 비평과 함께 사용된다.",
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
      tool_name: "ecig_regulation_check",
      inject_regulation_cache: "ecig",
      system_instruction: "당신은 한국·미국·EU·일본의 액상전자담배 법규 전문가다. 원칙: (1) 한국: 담배사업법(제2조 담배의 정의·유사담배제품 포함 여부), 개별소비세법, 지방세법, 국민건강증진법 제9조의4(광고제한), 식품의약품안전처 고시 등 관련 조문을 구체적으로 인용한다. (2) 미국: FDA PMTA 요건, Deeming Rule, 지역별 flavor ban. (3) EU: TPD 니코틴 농도 20mg/mL 상한·탱크 용량 2mL 상한·포장 10mL 상한. (4) 일본: 약기법상 니코틴 함유 액상의 의약품 규제. (5) 동남아(싱가포르·태국) 판매 금지 여부. (6) severity(critical/high/medium/low) 분류. (7) 불확실한 경우 반드시 '추가 법률 자문 필요' 명시. (8) 관련 공식 URL(식약처·기재부·법제처·FDA·EU DG SANTE) 출처로 남긴다.",
    })
  },
})
