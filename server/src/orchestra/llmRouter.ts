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
키워드가 없어도 문맥, 상황, 뉘앙스를 종합해 판단하세요.

반환 형식 (JSON만, 다른 텍스트 없이):
{"task":"<task>","deep_analysis":<bool>,"deep_research":<bool>,"structured_output":<bool>,"reason":"<한 줄 이유>"}

task 선택 기준:
- legal_review: 법률 문서(소장/판결문/계약서/약관 등) 분석, 법적 검토/대응, 소송 관련
- code_implement: 코드 작성/구현 요청
- code_debug: 버그 수정, 에러 해결
- code_refactor_review: 코드 검토/리팩터링
- research: 최신 정보 조사, 시장조사, 팩트체크 (웹 검색 필요)
- reasoning: 판단/비교/전략 분석, 설명 요청
- data_analysis: 데이터/통계/KPI 분석
- finance_analysis: 재무제표, 투자 분석
- legal_review: 법률 문서, 계약서, 소송 관련
- long_doc: 장문 문서 처리, 보고서 작성
- writing_creative: 소설/시/대본/카피 창작
- writing_business: 이메일/제안서/기획서/보고서 작성
- writing: 요약/번역/정리/표 작성 등 범용
- excel: 엑셀/스프레드시트
- ppt: 프레젠테이션/슬라이드
- word: 워드 문서
- pdf: PDF 처리
- product_development: 상품/브랜드/유통 전략
- dialogue: 단순 대화, 위 어디에도 해당 없음

deep_analysis: 문서/데이터를 깊이 분석해야 하면 true (법률 검토, 계약서 분석 등은 항상 true)
deep_research: 웹 검색/최신 정보가 필요하면 true
structured_output: 특정 섹션 구조로 출력해야 하면 true`

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
      // 라우팅은 400ms 안에 안 되면 폴백
      signal: AbortSignal.timeout(400)
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
