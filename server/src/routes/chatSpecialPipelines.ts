// chatSpecialPipelines.ts — 특수 파이프라인 (웹검색, 법률, 재무, 데이터분석, 상품기획, 슬라이드, 핸드오프)

import { runAdapter } from "../orchestra/adapterDispatcher.js"
import { appendProjectMemory, getLatestProjectContext, addProjectSourceAsset } from "../memory/projectMemory.js"
import { getThreadMemory } from "../memory/threadMemory.js"
import { logger } from "../observability/logger.js"
import { ROUTE_TIMEOUT_MS, OPENAI_BASE, PERPLEXITY_BASE, ANTHROPIC_BASE } from "../config/defaults.js"

// ===== Helper Functions =====
function safeArray(value: any): any[] {
  return Array.isArray(value) ? value : []
}

function safeObject(value: any): Record<string, any> {
  return value && typeof value === "object" ? value : {}
}

function safeString(value: any): string {
  return String(value ?? "").trim()
}

function safeNumber(value: any, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

// ===== SLIDE COMMAND =====
const SLIDE_PATTERNS = ["슬라이드로 만들어줘","슬라이드로 정리해줘","ppt로 만들어줘","ppt로 정리해줘","프레젠테이션으로 만들어줘","발표자료로 만들어줘","슬라이드 만들어줘","슬라이드로 변환해줘","pptx로 만들어줘"]

export function detectSlideCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return SLIDE_PATTERNS.some((p) => lower.includes(p))
}

export async function handleSlideCommand(input: any, rawMessage: string): Promise<{ ok: boolean; slide_data?: any; message: string }> {
  const SLIDE_SYSTEM_PROMPT = `You are a presentation designer. Based on the user's request, generate a slide deck as JSON.

Return ONLY valid JSON with this exact structure (no markdown, no explanation):
{
  "title": "presentation title",
  "theme": "midnight_executive",
  "slides": [
    { "type": "title", "title": "Main Title", "subtitle": "Subtitle text" },
    { "type": "content", "title": "Slide Title", "bullets": ["Point 1", "Point 2", "Point 3"], "note": "optional speaker note" },
    { "type": "two_column", "title": "Slide Title", "left": { "heading": "Left heading", "bullets": ["item 1", "item 2"] }, "right": { "heading": "Right heading", "bullets": ["item 1", "item 2"] } },
    { "type": "closing", "title": "Thank You", "subtitle": "closing message" }
  ]
}

Rules:
- 5-10 slides total
- Always start with type "title" and end with type "closing"
- Use Korean if the user writes in Korean
- Return ONLY the JSON object, nothing else`

  try {
    const result = await runAdapter({
      provider: "claude", task: "code",
      messages: [{ role: "system", content: SLIDE_SYSTEM_PROMPT }, { role: "user", content: rawMessage }],
      input: { model: "claude-sonnet-4-6", max_tokens: 16384, temperature: 0.3 }
    })
    const text = safeString(result?.text ?? result?.answer_text ?? result?.output?.text)
    if (!text) throw new Error("empty response")
    let clean = text.replace(/```json|```/g, "").trim()
    const firstBrace = clean.indexOf("{")
    const lastBrace = clean.lastIndexOf("}")
    if (firstBrace !== -1 && lastBrace !== -1) clean = clean.slice(firstBrace, lastBrace + 1)
    const slideData = JSON.parse(clean)
    if (!slideData?.slides || !Array.isArray(slideData.slides)) throw new Error("invalid slide structure")
    return { ok: true, slide_data: slideData, message: `✅ 슬라이드 ${slideData.slides.length}장을 생성했습니다.\n\n**제목:** ${slideData.title}\n\n아래 다운로드 버튼을 클릭하면 PPTX 파일로 저장됩니다.` }
  } catch (e: any) {
    return { ok: false, message: `슬라이드 생성 중 오류가 발생했습니다: ${e?.message ?? "unknown error"}` }
  }
}

// ===== HANDOFF COMMAND =====
export const HANDOFF_PATTERNS = ["세션 정리해줘","핸드오프 파일","대화 요약해줘","세션 요약","다음 세션에 넘겨줘","컨텍스트 정리","지금까지 정리해줘","handoff","session summary","summarize session"]

export function detectHandoffCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return HANDOFF_PATTERNS.some((p) => lower.includes(p))
}

export async function runHandoffSummary(threadMessages: any[], query: string): Promise<{ ok: boolean; summary: string; error?: string }> {
  const openaiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  if (!openaiKey) return { ok: false, summary: "", error: "OPENAI_API_KEY 없음" }
  const allMessages = Array.isArray(threadMessages) ? threadMessages : []
  const recentMessages = allMessages.filter((m: any) => m.content?.trim() && !m.isHidden).slice(-30)
    .map((m: any) => `[${String(m.role ?? "user") === "user" ? "USER" : "AI"}] ${String(m.content ?? "").slice(0, 500)}`).join("\n\n")
  const contentToSummarize = recentMessages || `사용자 요청: ${query}`
  try {
    const resp = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: `당신은 AI 세션 요약 전문가입니다. 대화 내용을 다음 구조로 요약하세요:\n\n## 세션 요약\n### 1. 핵심 작업 목록\n### 2. 완료된 항목\n### 3. 미완료/진행 중 항목\n### 4. 주요 결정사항\n### 5. 다음 세션 시작 시 참고사항\n\n간결하고 구조적으로 작성하세요.` },
          { role: "user", content: `다음 대화를 요약해줘:\n\n${contentToSummarize}` }
        ],
        max_tokens: 16384
      }),
      signal: AbortSignal.timeout(30000)
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(String(data?.error?.message ?? `HTTP ${resp.status}`))
    const summary = String(data?.choices?.[0]?.message?.content ?? "")
    if (!summary) throw new Error("empty summary")
    return { ok: true, summary }
  } catch (e: any) {
    return { ok: false, summary: "", error: e?.message ?? "요약 실패" }
  }
}

// ===== WEB SEARCH COMMAND =====
const WEB_SEARCH_PATTERNS = ["검색해줘","찾아줘","웹에서","최신 정보","지금 검색","인터넷에서","실시간으로","최근 뉴스","오늘 뉴스","search","find me","look up","latest news","current"]

export function detectWebSearchCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return WEB_SEARCH_PATTERNS.some((p) => lower.includes(p))
}

export async function runWebSearch(query: string): Promise<{ ok: boolean; answer: string; citations: { url: string; title: string }[]; error?: string }> {
  const perplexityKey = String((globalThis as any)?.process?.env?.PERPLEXITY_API_KEY ?? "").trim()
  const openaiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  let searchResult = ""
  let citations: { url: string; title: string }[] = []

  if (perplexityKey) {
    try {
      const resp = await fetch(`${PERPLEXITY_BASE}/chat/completions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${perplexityKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "sonar-pro", messages: [{ role: "system", content: "You are a search assistant. Provide accurate, up-to-date information with sources. Respond in the same language as the user's query." }, { role: "user", content: query }], max_tokens: 16384, return_citations: true, return_related_questions: false }),
        signal: AbortSignal.timeout(20000)
      })
      const data = await resp.json().catch(() => ({}))
      searchResult = String(data?.choices?.[0]?.message?.content ?? "")
      const rawCitations = data?.citations ?? []
      citations = Array.isArray(rawCitations) ? rawCitations.slice(0, 5).map((c: any) => ({ url: String(c?.url ?? c ?? ""), title: String(c?.title ?? c?.url ?? c ?? "") })).filter(c => c.url) : []
    } catch (e: any) { logger.error("[WEB_SEARCH] Perplexity error:", { message: e?.message }) }
  }

  if (!searchResult && openaiKey) {
    try {
      const resp = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-5.2", messages: [{ role: "system", content: "Provide current information about the topic. Be factual and concise." }, { role: "user", content: query }], max_tokens: 16384 }),
        signal: AbortSignal.timeout(20000)
      })
      const data = await resp.json().catch(() => ({}))
      searchResult = String(data?.choices?.[0]?.message?.content ?? "")
    } catch (e) { logger.warn("web search OpenAI fallback failed", { error: e }) }
  }

  if (!searchResult) return { ok: false, answer: "", citations: [], error: "검색 결과를 가져오지 못했습니다." }

  let finalAnswer = searchResult
  if (citations.length > 0) {
    finalAnswer += "\n\n---\n**출처**\n"
    citations.forEach((c, i) => {
      const title = c.title && c.title !== c.url ? c.title : c.url
      finalAnswer += `${i + 1}. [${title}](${c.url})\n`
    })
  }
  return { ok: true, answer: finalAnswer, citations }
}

// ===== DEEP RESEARCH COMMAND =====
const DEEP_RESEARCH_PATTERNS = ["심층 분석","심층 리서치","심층 조사","deep research","깊게 조사해줘","자세히 조사해줘","심층적으로 분석","심층 연구","종합 분석해줘","심층 보고서","리서치 리포트 만들어줘"]

export function detectDeepResearchCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return DEEP_RESEARCH_PATTERNS.some((p) => lower.includes(p))
}

export async function runDeepResearch(query: string, onProgress: (step: string, text: string) => void): Promise<{ ok: boolean; report: string; error?: string }> {
  const openaiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  const perplexityKey = String((globalThis as any)?.process?.env?.PERPLEXITY_API_KEY ?? "").trim()

  onProgress("search", "🔍 Perplexity로 최신 정보 검색 중...")
  let searchResult = ""
  if (perplexityKey) {
    try {
      const pResp = await fetch(`${PERPLEXITY_BASE}/chat/completions`, { method: "POST", headers: { "Authorization": `Bearer ${perplexityKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "sonar-pro", messages: [{ role: "system", content: "You are a research assistant. Provide comprehensive, factual information with sources." }, { role: "user", content: query }], max_tokens: 16384 }) })
      searchResult = String((await pResp.json().catch(() => ({})))?.choices?.[0]?.message?.content ?? "")
    } catch (e) { logger.warn("deep research Perplexity search failed", { error: e }) }
  }

  onProgress("analyze", "🧠 OpenAI로 정보 분석 및 종합 중...")
  let analysisResult = ""
  if (openaiKey) {
    try {
      const analyzePrompt = searchResult ? `다음 검색 결과를 바탕으로 "${query}"에 대해 핵심 인사이트를 분석해줘:\n\n${searchResult.slice(0, 3000)}` : `"${query}"에 대해 핵심 인사이트를 분석해줘`
      const oResp = await fetch(`${OPENAI_BASE}/v1/chat/completions`, { method: "POST", headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-5.2", messages: [{ role: "system", content: "You are an expert analyst. Analyze information critically and provide key insights." }, { role: "user", content: analyzePrompt }], max_tokens: 16384 }) })
      analysisResult = String((await oResp.json().catch(() => ({})))?.choices?.[0]?.message?.content ?? "")
    } catch (e) { logger.warn("deep research analysis step failed", { error: e }) }
  }

  onProgress("report", "📝 Claude로 최종 리포트 작성 중...")
  try {
    const reportResult = await runAdapter({ provider: "claude", task: "research", messages: [{ role: "system", content: "당신은 전문 리서치 작가입니다. 수집된 정보를 바탕으로 구조화된 심층 리포트를 작성하세요. 마크다운 형식으로 작성하고, 핵심 발견사항, 분석, 결론을 명확하게 구분하세요." }, { role: "user", content: `"${query}"에 대한 심층 리포트를 작성해줘.\n\n[검색 결과]\n${searchResult || "검색 결과 없음"}\n\n[분석 결과]\n${analysisResult || "분석 결과 없음"}\n\n위 정보를 종합하여 다음 구조로 리포트를 작성해줘:\n1. 핵심 요약 (Executive Summary)\n2. 주요 발견사항\n3. 심층 분석\n4. 결론 및 시사점` }], input: { model: "claude-sonnet-4-6", max_tokens: 16384, temperature: 0.3 } })
    const reportText = String(reportResult?.text ?? reportResult?.answer_text ?? "")
    if (!reportText) throw new Error("empty report")
    return { ok: true, report: reportText }
  } catch (e: any) {
    const fallback = analysisResult || searchResult
    if (fallback) return { ok: true, report: `## ${query} 분석 결과\n\n${fallback}` }
    return { ok: false, report: "", error: e?.message ?? "리포트 생성 실패" }
  }
}

// ===== LEGAL REVIEW COMMAND =====
const LEGAL_REVIEW_PATTERNS = ["법률 검토","계약서 검토","법적 검토","법적 위험","법률 분석","계약서 분석","약관 검토","약관 분석","법률 리뷰","법적 리스크","계약 위험","법적 문제","계약 검토해줘","법률적으로 검토","legal review","contract review","legal risk","legal analysis"]

export function detectLegalReviewCommand(message: string): boolean { return LEGAL_REVIEW_PATTERNS.some((p) => String(message ?? "").toLowerCase().includes(p)) }

export async function runLegalReview(
  query: string,
  attachedText: string,
  onProgress: (step: string, text: string) => void,
  attachedFile?: { base64: string; name: string; type: string }
): Promise<{ ok: boolean; report: string; error?: string }> {
  const openaiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  const anthropicKey = String((globalThis as any)?.process?.env?.ANTHROPIC_API_KEY ?? "").trim()
  const perplexityKey = String((globalThis as any)?.process?.env?.PERPLEXITY_API_KEY ?? "").trim()

  // PDF 원본이 있으면 그대로 사용, 없으면 추출 텍스트 — truncation 제거
  const hasPdfFile = attachedFile?.type === "application/pdf" && !!attachedFile?.base64
  const docContext = attachedText ? `\n\n[첨부 문서 내용]\n${attachedText}` : ""

  onProgress("search", "관련 법령 및 판례 검색 중...")
  let legalSearchResult = ""
  if (perplexityKey) {
    try {
      const searchQuery = `다음 법률 검토 요청과 관련된 법령, 판례를 검색해줘:\n\n${query}${attachedText ? `\n\n[문서 요약]\n${attachedText.slice(0, 2000)}` : ""}`
      const pResp = await fetch(`${PERPLEXITY_BASE}/chat/completions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${perplexityKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "sonar-pro",
          messages: [
            { role: "system", content: "한국 법률 전문가로서 관련 법령, 판례, 규정을 검색하여 제공하세요." },
            { role: "user", content: searchQuery }
          ],
          max_tokens: 16384
        }),
        signal: AbortSignal.timeout(30000)
      })
      legalSearchResult = String((await pResp.json().catch(() => ({})))?.choices?.[0]?.message?.content ?? "")
    } catch (e) { logger.warn("legal review search step failed", { error: e }) }
  }

  onProgress("analyze", "Claude가 법률 문서 전체 분석 중...")
  let clauseAnalysis = ""
  const claudeSystemPrompt = `당신은 한국 법정에서 25년 이상 활동한 소송 전문 변호사입니다.

제출된 법원 문서, 소송 서류, 법적 의견서, 계약서 등 문서 유형을 먼저 정확히 식별하고,
해당 문서가 소송 절차상 어떤 단계에 해당하는지 파악하세요.

[출력 형식 — 절대 준수]
- 표(table) 사용 금지
- 코드 블록(\`\`\`) 사용 금지
- 이모지(emoji) 사용 금지
- 문서 내용 단순 나열 금지
- 반드시 서술형 문장으로 작성

[분석 항목 — 빠짐없이 작성]
1. 문서의 법적 성격과 소송 절차상 의미 (법령 조문 번호 명시)
2. 가사소송법, 민사소송법, 민법, 가족관계등록법 관련 조문 인용
3. 실제 대법원 판례 또는 하급심 판례 인용 (사건번호·판결 취지 포함)
4. 의뢰인(피고)에게 유리한 논거와 불리한 논거 객관적 검토
5. 이 문서가 사건 전체에서 갖는 전략적 의미와 즉각 취해야 할 행동`

  try {
    if (hasPdfFile) {
      // PDF 원본을 Claude document API로 직접 전달 — 텍스트 추출·truncation 없음
      const resp = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 16384,
          system: claudeSystemPrompt,
          messages: [{
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: attachedFile!.base64 } },
              { type: "text", text: `다음 법률 문서 전체를 분석해줘:\n\n${query}\n\n[참고 법령 및 판례]\n${legalSearchResult || "없음"}` }
            ]
          }]
        }),
        signal: AbortSignal.timeout(120000)
      })
      const data = await resp.json().catch(() => ({}))
      clauseAnalysis = String(data?.content?.[0]?.text ?? "")
    } else {
      // 텍스트 기반 (파일 없음) — runAdapter 사용
      const cr = await runAdapter({
        provider: "claude", task: "research",
        messages: [
          { role: "system", content: claudeSystemPrompt },
          { role: "user", content: `다음 내용을 법률적으로 분석해줘:\n\n${query}${docContext}\n\n[참고 법령 및 판례]\n${legalSearchResult || "없음"}` }
        ],
        input: { model: "claude-sonnet-4-6", max_tokens: 16384, temperature: 0.1 }
      })
      clauseAnalysis = String(cr?.text ?? cr?.answer_text ?? "")
    }
  } catch (e) { logger.warn("legal pipeline clause analysis failed", { error: e }) }

  onProgress("report", "OpenAI가 최종 법률 의견서 작성 중...")
  try {
    const gptUserContent = hasPdfFile
      // PDF 원본은 Claude가 이미 완전 분석 — Claude 분석 결과만 전달
      ? `법률 검토 요청: ${query}\n\n[Claude 전문 분석 (PDF 전체 기반)]\n${clauseAnalysis || "없음"}\n\n[관련 법령 및 판례]\n${legalSearchResult || "없음"}\n\n위 분석을 바탕으로 최종 법률 의견서를 작성해줘.`
      : `법률 검토 대상: ${query}${docContext}\n\n[Claude 분석]\n${clauseAnalysis || "없음"}\n\n[관련 법령 및 판례]\n${legalSearchResult || "없음"}\n\n최종 법률 의견서를 작성해줘.`

    const oData = await (await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.2",
        messages: [
          {
            role: "system",
            content: `당신은 25년 경력의 한국 소송 전문 변호사로서 법률 의견서를 작성합니다.

[출력 형식 — 절대 준수]
- 표(table) 사용 금지
- 코드 블록(\`\`\`) 사용 금지
- 이모지(emoji) 사용 금지
- 문서 내용 단순 재나열 금지
- 번호 목록은 반드시 일반 텍스트(1. 2. 3.)로 작성, 코드 블록 사용 절대 금지

[작성 기준]
- 최소 3000자 이상의 서술형 산문으로 작성
- 가사소송법, 민사소송법, 민법 등 해당 법령 조문 번호를 본문에 직접 인용
- 실제 대법원 판례를 사건번호와 함께 인용하고 판결 취지 설명
- 의뢰인에게 유리한 논거와 불리한 논거를 모두 검토 후 실질적 대응 전략 제시
- 즉시 취해야 할 법적 행동을 기한과 함께 구체적으로 제시
- 마지막 문단: "이 의견서는 참고용이며 실제 법적 효력이 없습니다. 구체적인 사건에 대해서는 담당 변호사와 상담하시기 바랍니다."`
          },
          { role: "user", content: gptUserContent }
        ],
        max_tokens: 16384
      }),
      signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS)
    })).json().catch(() => ({}))
    const report = String(oData?.choices?.[0]?.message?.content ?? "").trim()
    if (!report) throw new Error("empty")
    return { ok: true, report }
  } catch (e: any) {
    const fallback = clauseAnalysis || legalSearchResult
    return fallback ? { ok: true, report: fallback } : { ok: false, report: "", error: e?.message }
  }
}

// ===== DATA ANALYSIS COMMAND =====
const DATA_ANALYSIS_PATTERNS = ["데이터 분석","통계 분석","수치 분석","트렌드 분석","패턴 분석","상관관계","데이터 시각화","csv 분석","엑셀 분석","지표 분석","kpi 분석","data analysis","analyze data","statistical analysis"]

export function detectDataAnalysisCommand(message: string): boolean { return DATA_ANALYSIS_PATTERNS.some((p) => String(message ?? "").toLowerCase().includes(p)) }

export async function runDataAnalysis(query: string, attachedText: string, onProgress: (step: string, text: string) => void): Promise<{ ok: boolean; report: string; error?: string }> {
  const openaiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  const perplexityKey = String((globalThis as any)?.process?.env?.PERPLEXITY_API_KEY ?? "").trim()
  const dataContext = attachedText ? `\n\n[데이터]\n${attachedText.slice(0, 8000)}` : ""
  onProgress("search", "📊 관련 업계 기준 및 벤치마크 검색 중...")
  let benchmarkResult = ""
  if (perplexityKey && !attachedText) {
    try {
      const pResp = await fetch(`${PERPLEXITY_BASE}/chat/completions`, { method: "POST", headers: { "Authorization": `Bearer ${perplexityKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "sonar-pro", messages: [{ role: "system", content: "데이터 분석 전문가로서 관련 업계 기준, 벤치마크, 평균 지표를 제공하세요." }, { role: "user", content: `다음 데이터 분석 요청과 관련된 업계 기준을 검색해줘:\n\n${query}` }], max_tokens: 16384 }), signal: AbortSignal.timeout(25000) })
      benchmarkResult = String((await pResp.json().catch(() => ({})))?.choices?.[0]?.message?.content ?? "")
    } catch (e) { logger.warn("data analysis benchmark search failed", { error: e }) }
  }
  onProgress("analyze", "🔢 OpenAI가 데이터 패턴 및 인사이트 분석 중...")
  let analysisResult = ""
  if (openaiKey) {
    try {
      const oData = await (await fetch(`${OPENAI_BASE}/v1/chat/completions`, { method: "POST", headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-5.2", messages: [{ role: "system", content: "데이터 사이언티스트로서 핵심지표요약, 트렌드/패턴식별, 상관관계분석, 이상치, 비즈니스해석을 제공하세요." }, { role: "user", content: `다음 데이터를 분석해줘:\n\n${query}${dataContext}\n\n${benchmarkResult ? `[벤치마크]\n${benchmarkResult.slice(0, 1000)}` : ""}` }], max_tokens: 16384 }), signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) })).json().catch(() => ({}))
      analysisResult = String(oData?.choices?.[0]?.message?.content ?? "").trim()
    } catch (e) { logger.warn("data analysis step failed", { error: e }) }
  }
  onProgress("report", "📝 Claude가 분석 보고서 작성 중...")
  try {
    const cr = await runAdapter({ provider: "claude", task: "research", messages: [{ role: "system", content: "데이터 분석 보고서 전문가입니다. 형식: ## 📊 데이터 분석 보고서 / ###1.분석개요 / ###2.핵심지표요약 / ###3.주요발견사항 / ###4.트렌드및패턴 / ###5.인사이트 / ###6.시각화제안 / ###7.권고사항" }, { role: "user", content: `보고서 작성:\n[요청] ${query}${dataContext}\n[OpenAI분석]\n${analysisResult || "없음"}\n[벤치마크]\n${benchmarkResult || "없음"}` }], input: { model: "claude-sonnet-4-6", max_tokens: 16384, temperature: 0.2 } })
    const report = String(cr?.text ?? cr?.answer_text ?? "").trim()
    if (!report) throw new Error("empty")
    return { ok: true, report }
  } catch (e: any) {
    const fallback = analysisResult || benchmarkResult
    return fallback ? { ok: true, report: `## 📊 데이터 분석\n\n${fallback}` } : { ok: false, report: "", error: e?.message }
  }
}

// ===== FINANCE COMMAND =====
const FINANCE_PATTERNS = ["재무정보","재무분석","재무제표","재무 분석","손익계산서","대차대조표","영업이익","순이익","부채비율","roe","roa","per","pbr","ebitda","기업가치","밸류에이션","투자분석","공시 분석","사업보고서","financial analysis","financial statement","valuation"]

export function detectFinanceCommand(message: string): boolean { return FINANCE_PATTERNS.some((p) => String(message ?? "").toLowerCase().includes(p)) }

export async function runFinanceAnalysis(query: string, attachedText: string, onProgress: (step: string, text: string) => void): Promise<{ ok: boolean; report: string; error?: string }> {
  const openaiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  const perplexityKey = String((globalThis as any)?.process?.env?.PERPLEXITY_API_KEY ?? "").trim()
  const docContext = attachedText ? `\n\n[첨부 재무 문서]\n${attachedText.slice(0, 8000)}` : ""
  onProgress("search", "📈 최신 재무 데이터 및 업계 비교 검색 중...")
  let financeSearch = ""
  if (perplexityKey) {
    try {
      const pResp = await fetch(`${PERPLEXITY_BASE}/chat/completions`, { method: "POST", headers: { "Authorization": `Bearer ${perplexityKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "sonar-pro", messages: [{ role: "system", content: "기업 재무 분석 전문가로서 최신 재무 데이터, 공시, 업계 평균 지표를 제공하세요." }, { role: "user", content: `다음 재무 분석 요청 관련 최신 데이터를 검색해줘:\n\n${query}` }], max_tokens: 16384 }), signal: AbortSignal.timeout(30000) })
      financeSearch = String((await pResp.json().catch(() => ({})))?.choices?.[0]?.message?.content ?? "")
    } catch (e) { logger.warn("finance pipeline search step failed", { error: e }) }
  }
  onProgress("analyze", "💹 OpenAI가 재무 지표 및 투자 관점 분석 중...")
  let financeAnalysis = ""
  if (openaiKey) {
    try {
      const oData = await (await fetch(`${OPENAI_BASE}/v1/chat/completions`, { method: "POST", headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-5.2", messages: [{ role: "system", content: "CFA 수준의 재무 분석가로서 PER/PBR/ROE/EBITDA 계산, 수익성/안정성/성장성 분석, 업계 비교, 리스크 요인을 분석하세요. ※투자 권유 아님" }, { role: "user", content: `재무 정보 분석:\n\n${query}${docContext}\n\n[검색 데이터]\n${financeSearch || "없음"}` }], max_tokens: 16384 }), signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) })).json().catch(() => ({}))
      financeAnalysis = String(oData?.choices?.[0]?.message?.content ?? "").trim()
    } catch (e) { logger.warn("finance pipeline analysis step failed", { error: e }) }
  }
  onProgress("report", "📋 Claude가 재무 분석 보고서 작성 중...")
  try {
    const cr = await runAdapter({ provider: "claude", task: "research", messages: [{ role: "system", content: "기업 재무 보고서 전문가입니다. 형식: ## 💹 기업 재무 분석 보고서 / ###1.분석개요 / ###2.핵심재무지표요약(표) / ###3.수익성분석 / ###4.안정성분석 / ###5.성장성분석 / ###6.주요리스크 / ###7.종합평가 / ※참고용, 투자권유아님" }, { role: "user", content: `재무 보고서 작성:\n[대상] ${query}${docContext}\n[OpenAI분석]\n${financeAnalysis || "없음"}\n[시장데이터]\n${financeSearch || "없음"}` }], input: { model: "claude-sonnet-4-6", max_tokens: 16384, temperature: 0.15 } })
    const report = String(cr?.text ?? cr?.answer_text ?? "").trim()
    if (!report) throw new Error("empty")
    return { ok: true, report }
  } catch (e: any) {
    const fallback = financeAnalysis || financeSearch
    return fallback ? { ok: true, report: `## 💹 재무 분석\n\n${fallback}` } : { ok: false, report: "", error: e?.message }
  }
}

// ===== PRODUCT DEVELOPMENT COMMAND =====
const PRODUCT_DEV_PATTERNS = ["상품 개발","제품 개발","상품 기획","제품 기획","신제품","브랜딩 전략","브랜드 전략","포지셔닝","경쟁사 분석","swot 분석","시장조사","고객 분석","페르소나","mvp","gtm 전략","go-to-market","상품화 전략","런칭 전략","product development","brand strategy"]

export function detectProductDevCommand(message: string): boolean { return PRODUCT_DEV_PATTERNS.some((p) => String(message ?? "").toLowerCase().includes(p)) }

export async function runProductDevelopment(query: string, attachedText: string, onProgress: (step: string, text: string) => void): Promise<{ ok: boolean; report: string; error?: string }> {
  const openaiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  const perplexityKey = String((globalThis as any)?.process?.env?.PERPLEXITY_API_KEY ?? "").trim()
  const docContext = attachedText ? `\n\n[첨부 문서]\n${attachedText.slice(0, 8000)}` : ""
  onProgress("search", "🔍 시장 트렌드 및 경쟁사 현황 검색 중...")
  let marketSearch = ""
  if (perplexityKey) {
    try {
      const pResp = await fetch(`${PERPLEXITY_BASE}/chat/completions`, { method: "POST", headers: { "Authorization": `Bearer ${perplexityKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "sonar-pro", messages: [{ role: "system", content: "시장 조사 전문가로서 최신 시장 트렌드, 경쟁사 동향, 소비자 인사이트를 제공하세요." }, { role: "user", content: `다음 상품/브랜드 기획 관련 시장 동향을 검색해줘:\n\n${query}${docContext}` }], max_tokens: 16384 }), signal: AbortSignal.timeout(30000) })
      marketSearch = String((await pResp.json().catch(() => ({})))?.choices?.[0]?.message?.content ?? "")
    } catch (e) { logger.warn("product development market search failed", { error: e }) }
  }
  onProgress("strategy", "💡 OpenAI가 전략 및 포지셔닝 분석 중...")
  let strategyResult = ""
  if (openaiKey) {
    try {
      const oData = await (await fetch(`${OPENAI_BASE}/v1/chat/completions`, { method: "POST", headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-5.2", messages: [{ role: "system", content: "브랜딩 및 상품 전략 전문가로서 SWOT분석, 타겟고객페르소나(2-3개), 포지셔닝전략, USP, GTM전략, 리스크를 분석하세요." }, { role: "user", content: `상품/브랜드 기획 분석:\n\n${query}${docContext}\n\n[시장조사]\n${marketSearch || "없음"}` }], max_tokens: 16384 }), signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) })).json().catch(() => ({}))
      strategyResult = String(oData?.choices?.[0]?.message?.content ?? "").trim()
    } catch (e) { logger.warn("product development strategy analysis failed", { error: e }) }
  }
  onProgress("report", "📦 Claude가 상품 기획서 작성 중...")
  try {
    const cr = await runAdapter({ provider: "claude", task: "research", messages: [{ role: "system", content: "상품 기획 전문가입니다. 형식: ## 📦 상품 개발 기획서 / ###1.상품개요 / ###2.시장분석(표) / ###3.타겟고객페르소나 / ###4.SWOT분석 / ###5.포지셔닝전략및USP / ###6.GTM전략 / ###7.마일스톤및실행계획 / ###8.예상리스크및대응" }, { role: "user", content: `기획서 작성:\n[기획] ${query}${docContext}\n[전략분석]\n${strategyResult || "없음"}\n[시장데이터]\n${marketSearch || "없음"}` }], input: { model: "claude-sonnet-4-6", max_tokens: 16384, temperature: 0.3 } })
    const report = String(cr?.text ?? cr?.answer_text ?? "").trim()
    if (!report) throw new Error("empty")
    return { ok: true, report }
  } catch (e: any) {
    const fallback = strategyResult || marketSearch
    return fallback ? { ok: true, report: `## 📦 상품 기획\n\n${fallback}` } : { ok: false, report: "", error: e?.message }
  }
}

// ===== SOURCE PROMOTE COMMAND =====
const SOURCE_PROMOTE_PATTERNS = ["내용 정리해서 소스로","소스로 저장","소스로 넘겨줘","프로젝트 소스에 추가","소스로 올려줘","소스로 승격","지식 소스로","프로젝트 지식으로","소스 등록"]

export function detectSourcePromoteCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return SOURCE_PROMOTE_PATTERNS.some((p) => lower.includes(p))
}

export function buildSourceAssetFromThread(input: any): any | null {
  const threadId = safeString(input?.thread_id) || "chat_thread"
  const threadMemory = getThreadMemory(threadId)
  if (!threadMemory) return null
  const structured = threadMemory.structured
  const summary = safeString(structured?.summary)
  const INTERNAL_NOISE = ["single_candidate","single_candidate_after_escalation","primary_survival_bias","override"]
  const decisions = safeArray(structured?.decisions).filter((d: string) => !INTERNAL_NOISE.some((n) => String(d).toLowerCase().includes(n)))
  const facts = safeArray(structured?.facts)
  const entities = safeArray(structured?.entities)
  if (!summary && decisions.length === 0 && facts.length === 0) return null
  const lines: string[] = []
  if (summary) { lines.push("[요약]"); lines.push(summary); lines.push("") }
  if (decisions.length > 0) { lines.push("[결정사항]"); lines.push(...decisions); lines.push("") }
  if (facts.length > 0) { lines.push("[핵심 사실]"); lines.push(...facts); lines.push("") }
  if (entities.length > 0) { lines.push("[주요 키워드]"); lines.push(entities.join(", ")) }
  const content = lines.join("\n").trim()
  if (!content) return null
  const title = threadMemory.title ?? `스레드 요약 — ${new Date().toLocaleDateString("ko-KR")}`
  return { id: `source_${threadId}_${Date.now()}`, thread_id: threadId, type: "thread_summary", title, content, status: "confirmed", created_at: Date.now(), updated_at: Date.now() }
}

export async function runSourcePromote(
  threadMessages: any[],
  projectId: string,
  _query: string
): Promise<{ ok: boolean; title: string; content: string; error?: string }> {
  const openaiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  if (!openaiKey) return { ok: false, title: "", content: "", error: "OPENAI_API_KEY 없음" }

  const relevant = threadMessages
    .filter((m: any) => m.role === "user" || m.role === "assistant")
    .slice(-20)
    .map((m: any) => `[${m.role.toUpperCase()}] ${String(m.content ?? "").slice(0, 800)}`)
    .join("\n\n")

  if (!relevant.trim()) return { ok: false, title: "", content: "", error: "저장할 내용 없음" }

  try {
    const res = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: "gpt-5.2",
        max_tokens: 16384,
        messages: [
          {
            role: "system",
            content: "당신은 대화 내용을 구조화된 지식 자산으로 변환하는 AI입니다. 다음 대화를 분석해서 JSON으로만 응답하세요 (마크다운 코드블록 없이): { \"title\": \"한 줄 제목 (20자 이내)\", \"content\": \"핵심 내용, 결론, 결정사항, 중요 사실을 구조화한 마크다운 (500자 이내)\" } 내용은 미래에 다른 대화에서 참고할 수 있도록 자기완결적으로 작성하세요. 불필요한 인사, 메타 발언은 제거하고 핵심 정보만 남기세요."
          },
          { role: "user", content: `다음 대화를 지식 자산으로 변환해주세요:\n\n${relevant}` }
        ]
      })
    })
    const data = await res.json() as any
    const raw = String(data?.choices?.[0]?.message?.content ?? "").trim()
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim()
    const parsed = JSON.parse(cleaned)
    return {
      ok: true,
      title: String(parsed?.title ?? "스레드 지식 자산").slice(0, 60),
      content: String(parsed?.content ?? relevant.slice(0, 500))
    }
  } catch (e: any) {
    return { ok: false, title: "", content: "", error: e?.message ?? "파싱 실패" }
  }
}

// SSE 라우트에서 사용하는 동기 래퍼 — structured memory 기반 즉시 반환 (비동기 불필요)
export function handleSourcePromoteCommand(input: any): { ok: boolean; message: string } {
  const projectId = safeString(input?.project_id) || "chat_project"
  const asset = buildSourceAssetFromThread(input)
  if (!asset) return { ok: false, message: "현재 스레드에 저장된 내용이 없습니다. 먼저 대화를 진행해주세요." }
  try {
    addProjectSourceAsset(projectId, asset)
    return { ok: true, message: `✅ 프로젝트 소스로 저장했습니다.\n\n**제목:** ${asset.title}\n\n${asset.content.slice(0, 400)}${asset.content.length > 400 ? "\n\n..." : ""}` }
  } catch (e) {
    logger.warn("project memory save failed", { error: e })
    return { ok: false, message: "소스 저장 중 오류가 발생했습니다." }
  }
}
