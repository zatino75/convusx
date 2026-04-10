/**
 * LLM Router — Claude Haiku 기반 의도 분류
 *
 * ChatGPT/Claude/Gemini가 LLM 자체로 라우팅을 결정하는 방식과 동일한 원리.
 * Haiku는 200~300ms, 호출당 $0.0003 미만으로 충분한 의도 이해 제공.
 * 실패 시 기존 스코어 기반 planRequest()로 자동 폴백.
 */

import { planRequest } from "./planner.js"
import type { CanonicalTask } from "../types/tasks.js"
import type { PlannerSignals } from "./planner.js"

export type RouteResult = {
  task: CanonicalTask
  signals: PlannerSignals
  via: "llm" | "heuristic"
  reason?: string
}

const VALID_TASKS: CanonicalTask[] = [
  "dialogue", "reasoning", "research",
  "code_implement", "code_debug", "code_refactor_review",
  "writing", "writing_creative", "writing_business",
  "long_doc", "legal_review",
  "data_analysis", "finance_analysis", "product_development",
  "excel", "ppt", "word", "pdf"
]

const ROUTER_SYSTEM_PROMPT = `당신은 사용자 메시지의 진짜 의도를 파악해 태스크를 분류하는 라우터입니다.
키워드가 없어도 문맥, 상황, 감정, 뉘앙스를 종합해 판단하세요.

반환 형식 (JSON만, 다른 텍스트 없이):
{"task":"<task>","deep_analysis":<bool>,"deep_research":<bool>,"structured_output":<bool>,"reason":"<한 줄 이유>"}

task 선택 기준 (위에서 아래로 우선순위 순):

[최우선 — 도메인 특화]
- legal_review: 법률/소송/계약 관련 문서를 분석하거나 법적 검토·대응이 필요한 모든 경우.
  PDF나 첨부파일이 있어도 내용이 법률 문서(소장, 이혼소송, 판결문, 계약서, 약관, 합의서 등)이면 반드시 legal_review.
  "정리해줘", "파악해줘" 같은 표현이 있어도 대상이 법률 문서면 legal_review.
  예) "와이프가 이혼소송장 보내왔어" → legal_review / "계약서 봐줘" → legal_review
- finance_analysis: 재무제표, 투자, 밸류에이션 분석
- data_analysis: 데이터/통계/KPI 수치 분석
- product_development: 상품·브랜드·유통 전략

[코드]
- code_implement: 코드 작성/구현
- code_debug: 버그·에러 수정
- code_refactor_review: 코드 검토/리팩터링

[문서 생성]
- excel: 엑셀/스프레드시트 생성·편집
- ppt: 프레젠테이션 생성
- word: 워드 문서 생성
- pdf: PDF 변환·병합·추출 등 파일 조작 (법률/계약 내용 분석이 아닌 순수 파일 처리)
  ※ 주의: PDF 파일이 첨부됐다고 무조건 pdf 태스크가 아님. 내용이 법률이면 legal_review.

[리서치·분석]
- research: 최신 정보 조사, 시장조사, 웹 검색 필요
- reasoning: 판단/비교/설명 요청
- long_doc: 비법률 장문 문서 처리

[글쓰기]
- writing_creative: 소설/시/대본/카피 창작
- writing_business: 이메일/제안서/기획서 작성
- writing: 요약/번역/정리/표 작성

- dialogue: 단순 대화, 위 어디에도 해당 없음

deep_analysis: 법률 검토·계약 분석·심층 문서 분석이면 항상 true
deep_research: 웹 검색·최신 정보 필요하면 true
structured_output: "반드시 포함", 섹션 요구 등 구조화 출력 요청이면 true`

function buildRouterUserPrompt(message: string): string {
  // 너무 길면 앞 600자만 (라우팅에는 충분)
  const trimmed = message.slice(0, 600)
  return `사용자 메시지:\n"${trimmed}"\n\nJSON으로 분류하세요.`
}

function parseRouterResponse(raw: string): Partial<RouteResult> | null {
  try {
    // JSON 블록 추출 (마크다운 코드블록 안에 있을 수도 있음)
    const jsonMatch = raw.match(/\{[\s\S]*?\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])
    const task = String(parsed.task ?? "").trim() as CanonicalTask

    if (!VALID_TASKS.includes(task)) return null

    return {
      task,
      signals: {
        benchmark_mode: false,
        deep_analysis: Boolean(parsed.deep_analysis),
        deep_research: Boolean(parsed.deep_research),
        force_pro: false,
        structured_output: Boolean(parsed.structured_output)
      },
      reason: String(parsed.reason ?? "")
    }
  } catch {
    return null
  }
}

export async function routeWithLLM(
  message: string,
  anthropicApiKey: string
): Promise<RouteResult> {
  const heuristicResult = planRequest(message)
  const fallback: RouteResult = {
    task: heuristicResult.task,
    signals: heuristicResult.signals,
    via: "heuristic"
  }

  // API 키 없으면 즉시 폴백
  if (!anthropicApiKey) return fallback

  // 메시지가 너무 짧거나 단순하면 heuristic으로 충분
  const trimmed = message.trim()
  if (trimmed.length < 4) return fallback

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 120,
        system: ROUTER_SYSTEM_PROMPT,
        messages: [
          { role: "user", content: buildRouterUserPrompt(trimmed) }
        ]
      }),
      // 라우팅 타임아웃 — 한국 서버→Anthropic API 왕복 200-300ms 감안
      signal: AbortSignal.timeout(3000)
    })

    if (!response.ok) return fallback

    const data = await response.json() as any
    const rawText = String(data?.content?.[0]?.text ?? "").trim()
    if (!rawText) return fallback

    const parsed = parseRouterResponse(rawText)
    if (!parsed || !parsed.task || !parsed.signals) return fallback

    // heuristic이 고확신(score 기반)인 경우 — legal/code/finance는 heuristic도 정확함
    // LLM 결과와 다르면 LLM을 우선
    return {
      task: parsed.task,
      signals: {
        ...parsed.signals,
        // force_pro는 heuristic에서 유지
        force_pro: heuristicResult.signals.force_pro,
        // benchmark_mode도 heuristic 유지
        benchmark_mode: heuristicResult.signals.benchmark_mode
      },
      via: "llm",
      reason: parsed.reason
    }
  } catch {
    // timeout, 네트워크 오류 등 — 폴백
    return fallback
  }
}
