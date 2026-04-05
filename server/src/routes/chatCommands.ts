
function safeString(v: any): string { return String(v ?? "").trim() }
import { runAdapter } from "../orchestra/adapterDispatcher.js";
import { generateImage } from "../adapters/openai.js";
import { generateImageImagen } from "../adapters/gemini.js";
import { generateImageMidjourney } from "../adapters/midjourney.js";
import { generateVideoRunway } from "../adapters/runway.js";
import { generateVideoVeo } from "../adapters/veo.js";

const SLIDE_PATTERNS = ["슬라이드 만들어", "ppt 만들어", "발표자료", "프레젠테이션 만들어", "피치덱", "slide", "presentation", "powerpoint"]

export function detectSlideCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return SLIDE_PATTERNS.some((p: any) => lower.includes(p))
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

const IMAGE_PATTERNS = ["이미지 만들어줘","이미지 그려줘","그림 그려줘","그림 만들어줘","이미지 생성해줘","사진 만들어줘","이미지로 만들어줘","그려줘","일러스트 만들어줘","generate image","create image","draw","make an image","make a picture"]
const GEMINI_IMAGE_PATTERNS = ["gemini로 그려줘","gemini로 이미지","imagen으로","gemini 이미지","구글로 그려줘","imagen 그려줘"]

export function detectGeminiImageCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return GEMINI_IMAGE_PATTERNS.some((p) => lower.includes(p))
}
export function detectImageCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return IMAGE_PATTERNS.some((p) => lower.includes(p))
}

export async function handleImageCommand(rawMessage: string): Promise<{ ok: boolean; url?: string; revised_prompt?: string; message: string }> {
  const cleaned = rawMessage
    .replace(/이미지\s*(만들어줘|그려줘|생성해줘|으로\s*만들어줘)/g, "")
    .replace(/그림\s*(그려줘|만들어줘)/g, "")
    .replace(/사진\s*만들어줘/g, "")
    .replace(/일러스트\s*만들어줘/g, "")
    .replace(/(generate|create|make|draw)\s*(an?\s*)?(image|picture|photo|illustration)/gi, "")
    .trim()
  const prompt = cleaned || rawMessage
  const result = await generateImage({ prompt, size: "1024x1024", quality: "standard", style: "vivid" })
  if (!result.ok || !result.url) return { ok: false, message: `이미지 생성 실패: ${result.error ?? "알 수 없는 오류"}` }
  return { ok: true, url: result.url, revised_prompt: result.revised_prompt, message: `🎨 이미지가 생성됐습니다.` }
}

export async function handleGeminiImageCommand(rawMessage: string): Promise<{ ok: boolean; url?: string; message: string; provider: string }> {
  const cleaned = rawMessage
    .replace(/gemini(로|로\s*이미지)?/gi, "").replace(/imagen(으로|으로\s*이미지)?/gi, "")
    .replace(/구글로\s*(그려줘)?/gi, "").replace(/이미지\s*(만들어줘|그려줘|생성해줘)/g, "").replace(/그려줘/g, "").trim()
  const prompt = cleaned || rawMessage
  const result = await generateImageImagen({ prompt, aspectRatio: "1:1" })
  if (!result.ok || !result.url) return { ok: false, message: `Gemini 이미지 생성 실패: ${result.error ?? "알 수 없는 오류"}`, provider: "gemini" }
  return { ok: true, url: result.url, message: "🎨 Gemini Imagen으로 이미지가 생성됐습니다.", provider: "gemini" }
}

// ── Midjourney ──
const MIDJOURNEY_PATTERNS = [
  "midjourney로", "midjourney 그려줘", "midjourney로 그려줘", "mj로", "mj 그려줘",
  "미드저니로", "미드저니 그려줘", "midjourney image", "midjourney로 이미지"
]
export function detectMidjourneyCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return MIDJOURNEY_PATTERNS.some((p) => lower.includes(p))
}
export async function handleMidjourneyCommand(rawMessage: string): Promise<{ ok: boolean; url?: string; image_urls?: string[]; message: string }> {
  const cleaned = rawMessage
    .replace(/midjourney(로|로\s*이미지|로\s*그려줘)?/gi, "")
    .replace(/미드저니(로|로\s*이미지|로\s*그려줘)?/gi, "")
    .replace(/mj(로|로\s*이미지|로\s*그려줘)?/gi, "")
    .replace(/이미지\s*(만들어줘|그려줘|생성해줘)/g, "").replace(/그려줘/g, "").trim()
  const prompt = cleaned || rawMessage
  const result = await generateImageMidjourney({ prompt, aspect: "1:1", version: "6.1" })
  if (!result.ok) return { ok: false, message: `Midjourney 생성 실패: ${result.error ?? "알 수 없는 오류"}` }
  return { ok: true, url: result.image_url, image_urls: result.image_urls, message: "🎨 Midjourney로 이미지가 생성됐습니다." }
}

// ── Runway Gen4 Turbo ──
const RUNWAY_PATTERNS = [
  "runway로", "runway 비디오", "runway로 만들어줘", "runway gen", "런웨이로",
  "런웨이 비디오", "runway video", "gen4로", "gen4 turbo"
]
export function detectRunwayCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return RUNWAY_PATTERNS.some((p) => lower.includes(p))
}
export async function handleRunwayCommand(rawMessage: string): Promise<{ ok: boolean; video_url?: string; message: string }> {
  const cleaned = rawMessage
    .replace(/runway(로|로\s*만들어줘|로\s*비디오)?/gi, "")
    .replace(/런웨이(로|로\s*만들어줘|로\s*비디오)?/gi, "")
    .replace(/gen4(\s*turbo)?(로|로\s*만들어줘)?/gi, "")
    .replace(/비디오\s*(만들어줘|생성해줘)/g, "").trim()
  const prompt = cleaned || rawMessage
  const result = await generateVideoRunway({ prompt, duration: 5, ratio: "16:9", model: "gen4_turbo" })
  if (!result.ok) return { ok: false, message: `Runway 비디오 생성 실패: ${result.error ?? "알 수 없는 오류"}` }
  return { ok: true, video_url: result.video_url, message: "🎬 Runway Gen4 Turbo로 비디오가 생성됐습니다." }
}

// ── Gemini Veo 3.1 ──
const VEO_PATTERNS = [
  "veo로", "veo 비디오", "veo로 만들어줘", "veo 만들어줘", "gemini 비디오",
  "gemini로 비디오", "veo3", "veo 3", "비오로"
]
export function detectVeoCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return VEO_PATTERNS.some((p) => lower.includes(p))
}
export async function handleVeoCommand(rawMessage: string): Promise<{ ok: boolean; video_url?: string; message: string }> {
  const cleaned = rawMessage
    .replace(/veo(\s*3(\.\s*\d)?)?(로|로\s*만들어줘|로\s*비디오)?/gi, "")
    .replace(/gemini(로)?\s*비디오(로|로\s*만들어줘)?/gi, "")
    .replace(/비디오\s*(만들어줘|생성해줘)/g, "").trim()
  const prompt = cleaned || rawMessage
  const result = await generateVideoVeo({ prompt, duration: 5, aspectRatio: "16:9" })
  if (!result.ok) return { ok: false, message: `Veo 비디오 생성 실패: ${result.error ?? "알 수 없는 오류"}` }
  return { ok: true, video_url: result.video_url, message: "🎬 Gemini Veo 3.1로 비디오가 생성됐습니다." }
}

const HANDOFF_PATTERNS = ["세션 정리해줘","핸드오프 파일","대화 요약해줘","세션 요약","다음 세션에 넘겨줘","컨텍스트 정리","지금까지 정리해줘","handoff","session summary","summarize session"]
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
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
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
      const resp = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${perplexityKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "sonar-pro", messages: [{ role: "system", content: "You are a search assistant. Provide accurate, up-to-date information with sources. Respond in the same language as the user's query." }, { role: "user", content: query }], max_tokens: 16384, return_citations: true, return_related_questions: false }),
        signal: AbortSignal.timeout(20000)
      })
      const data = await resp.json().catch(() => ({}))
      searchResult = String(data?.choices?.[0]?.message?.content ?? "")
      const rawCitations = data?.citations ?? []
      citations = Array.isArray(rawCitations) ? rawCitations.slice(0, 5).map((c: any) => ({ url: String(c?.url ?? c ?? ""), title: String(c?.title ?? c?.url ?? c ?? "") })).filter(c => c.url) : []
    } catch (e: any) { console.error("[WEB_SEARCH] Perplexity error:", e?.message) }
  }

  if (!searchResult && openaiKey) {
    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-5.2", messages: [{ role: "system", content: "Provide current information about the topic. Be factual and concise." }, { role: "user", content: query }], max_tokens: 16384 }),
        signal: AbortSignal.timeout(20000)
      })
      const data = await resp.json().catch(() => ({}))
      searchResult = String(data?.choices?.[0]?.message?.content ?? "")
    } catch {}
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
      const pResp = await fetch("https://api.perplexity.ai/chat/completions", { method: "POST", headers: { "Authorization": `Bearer ${perplexityKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "sonar-pro", messages: [{ role: "system", content: "You are a research assistant. Provide comprehensive, factual information with sources." }, { role: "user", content: query }], max_tokens: 16384 }) })
      searchResult = String((await pResp.json().catch(() => ({})))?.choices?.[0]?.message?.content ?? "")
    } catch {}
  }

  onProgress("analyze", "🧠 OpenAI로 정보 분석 및 종합 중...")
  let analysisResult = ""
  if (openaiKey) {
    try {
      const analyzePrompt = searchResult ? `다음 검색 결과를 바탕으로 "${query}"에 대해 핵심 인사이트를 분석해줘:\n\n${searchResult.slice(0, 6000)}` : `"${query}"에 대해 핵심 인사이트를 분석해줘`
      const oResp = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-5.2", messages: [{ role: "system", content: "You are an expert analyst. Analyze information critically and provide key insights." }, { role: "user", content: analyzePrompt }], max_tokens: 16384 }) })
      analysisResult = String((await oResp.json().catch(() => ({})))?.choices?.[0]?.message?.content ?? "")
    } catch {}
  }

  onProgress("report", "📝 Claude로 최종 리포트 작성 중...")
  try {
    const reportResult = await runAdapter({ provider: "claude", task: "research", messages: [{ role: "system", content: "당신은 전문 리서치 작가입니다. 수집된 정보를 바탕으로 구조화된 심층 리포트를 작성하세요. 마크다운 형식으로 작성하고, 핵심 발견사항, 분석, 결론을 명확하게 구분하세요." }, { role: "user", content: `"${query}"에 대한 심층 리포트를 작성해줘.\n\n[검색 결과]\n${searchResult.slice(0, 6000) || "검색 결과 없음"}\n\n[분석 결과]\n${analysisResult.slice(0, 4000) || "분석 결과 없음"}\n\n위 정보를 종합하여 다음 구조로 리포트를 작성해줘:\n1. 핵심 요약 (Executive Summary)\n2. 주요 발견사항\n3. 심층 분석\n4. 결론 및 시사점` }], input: { model: "claude-sonnet-4-6", max_tokens: 16384, temperature: 0.3 } })
    const reportText = String(reportResult?.text ?? reportResult?.answer_text ?? "")
    if (!reportText) throw new Error("empty report")
    return { ok: true, report: reportText }
  } catch (e: any) {
    const fallback = analysisResult || searchResult
    if (fallback) return { ok: true, report: `## ${query} 분석 결과\n\n${fallback}` }
    return { ok: false, report: "", error: e?.message ?? "리포트 생성 실패" }
  }
}

const LEGAL_REVIEW_PATTERNS = ["법률 검토","계약서 검토","법적 검토","법적 위험","법률 분석","계약서 분석","약관 검토","약관 분석","법률 리뷰","법적 리스크","계약 위험","법적 문제","계약 검토해줘","법률적으로 검토","legal review","contract review","legal risk","legal analysis"]
export function detectLegalReviewCommand(message: string): boolean { return LEGAL_REVIEW_PATTERNS.some((p) => String(message ?? "").toLowerCase().includes(p)) }

export async function runLegalReview(query: string, attachedText: string, onProgress: (step: string, text: string) => void): Promise<{ ok: boolean; report: string; error?: string }> {
  const openaiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  const perplexityKey = String((globalThis as any)?.process?.env?.PERPLEXITY_API_KEY ?? "").trim()
  const docContext = attachedText ? `\n\n[첨부 문서 내용]\n${attachedText.slice(0, 8000)}` : ""
  onProgress("search", "⚖️ 관련 법령 및 판례 검색 중...")
  let legalSearchResult = ""
  if (perplexityKey) {
    try {
      const pResp = await fetch("https://api.perplexity.ai/chat/completions", { method: "POST", headers: { "Authorization": `Bearer ${perplexityKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "sonar-pro", messages: [{ role: "system", content: "한국 법률 전문가로서 관련 법령, 판례, 규정을 검색하여 제공하세요." }, { role: "user", content: `다음 법률 검토 요청과 관련된 법령, 판례를 검색해줘:\n\n${query}${docContext}` }], max_tokens: 16384 }), signal: AbortSignal.timeout(30000) })
      legalSearchResult = String((await pResp.json().catch(() => ({})))?.choices?.[0]?.message?.content ?? "")
    } catch {}
  }
  onProgress("analyze", "📋 Claude가 핵심 조항 및 위험 요소 분석 중...")
  let clauseAnalysis = ""
  try {
    const cr = await runAdapter({ provider: "claude", task: "research", messages: [{ role: "system", content: "계약법 전문 법률 분석가입니다. 불리한 조항, 위험 요소를 HIGH/MEDIUM/LOW로 분류하고 수정 권고안을 제시하세요." }, { role: "user", content: `다음 내용을 법률적으로 분석해줘:\n\n${query}${docContext}\n\n[참고 법령]\n${legalSearchResult.slice(0, 5000) || "없음"}` }], input: { model: "claude-sonnet-4-6", max_tokens: 16384, temperature: 0.1 } })
    clauseAnalysis = String(cr?.text ?? cr?.answer_text ?? "")
  } catch {}
  onProgress("report", "🔍 OpenAI가 최종 법률 검토 보고서 작성 중...")
  try {
    const oData = await (await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-5.2", messages: [{ role: "system", content: "기업법무 전문가로서 구조화된 법률 검토 보고서를 작성하세요. 형식: ## ⚖️ 법률 검토 보고서 / ### 1.검토개요 / ### 2.핵심위험항목(HIGH/MEDIUM/LOW) / ### 3.조항별분석 / ### 4.관련법령 / ### 5.수정권고사항 / ### 6.종합의견 / ※참고용이며 법적구속력없음" }, { role: "user", content: `법률 검토 대상: ${query}${docContext}\n\n[Claude 분석]\n${clauseAnalysis.slice(0, 5000) || "없음"}\n\n[관련 법령]\n${legalSearchResult.slice(0, 4000) || "없음"}\n\n최종 보고서 작성해줘.` }], max_tokens: 16384 }), signal: AbortSignal.timeout(60000) })).json().catch(() => ({}))
    const report = String(oData?.choices?.[0]?.message?.content ?? "").trim()
    if (!report) throw new Error("empty")
    return { ok: true, report }
  } catch (e: any) {
    const fallback = clauseAnalysis || legalSearchResult
    return fallback ? { ok: true, report: `## ⚖️ 법률 검토\n\n${fallback}` } : { ok: false, report: "", error: e?.message }
  }
}

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
      const pResp = await fetch("https://api.perplexity.ai/chat/completions", { method: "POST", headers: { "Authorization": `Bearer ${perplexityKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "sonar-pro", messages: [{ role: "system", content: "데이터 분석 전문가로서 관련 업계 기준, 벤치마크, 평균 지표를 제공하세요." }, { role: "user", content: `다음 데이터 분석 요청과 관련된 업계 기준을 검색해줘:\n\n${query}` }], max_tokens: 16384 }), signal: AbortSignal.timeout(25000) })
      benchmarkResult = String((await pResp.json().catch(() => ({})))?.choices?.[0]?.message?.content ?? "")
    } catch {}
  }
  onProgress("analyze", "🔢 OpenAI가 데이터 패턴 및 인사이트 분석 중...")
  let analysisResult = ""
  if (openaiKey) {
    try {
      const oData = await (await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-5.2", messages: [{ role: "system", content: "데이터 사이언티스트로서 핵심지표요약, 트렌드/패턴식별, 상관관계분석, 이상치, 비즈니스해석을 제공하세요." }, { role: "user", content: `다음 데이터를 분석해줘:\n\n${query}${dataContext}\n\n${benchmarkResult ? `[벤치마크]\n${benchmarkResult.slice(0, 2000)}` : ""}` }], max_tokens: 16384 }), signal: AbortSignal.timeout(60000) })).json().catch(() => ({}))
      analysisResult = String(oData?.choices?.[0]?.message?.content ?? "").trim()
    } catch {}
  }
  onProgress("report", "📝 Claude가 분석 보고서 작성 중...")
  try {
    const cr = await runAdapter({ provider: "claude", task: "research", messages: [{ role: "system", content: "데이터 분석 보고서 전문가입니다. 형식: ## 📊 데이터 분석 보고서 / ###1.분석개요 / ###2.핵심지표요약 / ###3.주요발견사항 / ###4.트렌드및패턴 / ###5.인사이트 / ###6.시각화제안 / ###7.권고사항" }, { role: "user", content: `보고서 작성:\n[요청] ${query}${dataContext}\n[OpenAI분석]\n${analysisResult.slice(0, 5000) || "없음"}\n[벤치마크]\n${benchmarkResult.slice(0, 2000) || "없음"}` }], input: { model: "claude-sonnet-4-6", max_tokens: 16384, temperature: 0.2 } })
    const report = String(cr?.text ?? cr?.answer_text ?? "").trim()
    if (!report) throw new Error("empty")
    return { ok: true, report }
  } catch (e: any) {
    const fallback = analysisResult || benchmarkResult
    return fallback ? { ok: true, report: `## 📊 데이터 분석\n\n${fallback}` } : { ok: false, report: "", error: e?.message }
  }
}

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
      const pResp = await fetch("https://api.perplexity.ai/chat/completions", { method: "POST", headers: { "Authorization": `Bearer ${perplexityKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "sonar-pro", messages: [{ role: "system", content: "기업 재무 분석 전문가로서 최신 재무 데이터, 공시, 업계 평균 지표를 제공하세요." }, { role: "user", content: `다음 재무 분석 요청 관련 최신 데이터를 검색해줘:\n\n${query}` }], max_tokens: 16384 }), signal: AbortSignal.timeout(30000) })
      financeSearch = String((await pResp.json().catch(() => ({})))?.choices?.[0]?.message?.content ?? "")
    } catch {}
  }
  onProgress("analyze", "💹 OpenAI가 재무 지표 및 투자 관점 분석 중...")
  let financeAnalysis = ""
  if (openaiKey) {
    try {
      const oData = await (await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-5.2", messages: [{ role: "system", content: "CFA 수준의 재무 분석가로서 PER/PBR/ROE/EBITDA 계산, 수익성/안정성/성장성 분석, 업계 비교, 리스크 요인을 분석하세요. ※투자 권유 아님" }, { role: "user", content: `재무 정보 분석:\n\n${query}${docContext}\n\n[검색 데이터]\n${financeSearch.slice(0, 5000) || "없음"}` }], max_tokens: 16384 }), signal: AbortSignal.timeout(60000) })).json().catch(() => ({}))
      financeAnalysis = String(oData?.choices?.[0]?.message?.content ?? "").trim()
    } catch {}
  }
  onProgress("report", "📋 Claude가 재무 분석 보고서 작성 중...")
  try {
    const cr = await runAdapter({ provider: "claude", task: "research", messages: [{ role: "system", content: "기업 재무 보고서 전문가입니다. 형식: ## 💹 기업 재무 분석 보고서 / ###1.분석개요 / ###2.핵심재무지표요약(표) / ###3.수익성분석 / ###4.안정성분석 / ###5.성장성분석 / ###6.주요리스크 / ###7.종합평가 / ※참고용, 투자권유아님" }, { role: "user", content: `재무 보고서 작성:\n[대상] ${query}${docContext}\n[OpenAI분석]\n${financeAnalysis.slice(0, 5000) || "없음"}\n[시장데이터]\n${financeSearch.slice(0, 4000) || "없음"}` }], input: { model: "claude-sonnet-4-6", max_tokens: 16384, temperature: 0.15 } })
    const report = String(cr?.text ?? cr?.answer_text ?? "").trim()
    if (!report) throw new Error("empty")
    return { ok: true, report }
  } catch (e: any) {
    const fallback = financeAnalysis || financeSearch
    return fallback ? { ok: true, report: `## 💹 재무 분석\n\n${fallback}` } : { ok: false, report: "", error: e?.message }
  }
}

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
      const pResp = await fetch("https://api.perplexity.ai/chat/completions", { method: "POST", headers: { "Authorization": `Bearer ${perplexityKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "sonar-pro", messages: [{ role: "system", content: "시장 조사 전문가로서 최신 시장 트렌드, 경쟁사 동향, 소비자 인사이트를 제공하세요." }, { role: "user", content: `다음 상품/브랜드 기획 관련 시장 동향을 검색해줘:\n\n${query}${docContext}` }], max_tokens: 16384 }), signal: AbortSignal.timeout(30000) })
      marketSearch = String((await pResp.json().catch(() => ({})))?.choices?.[0]?.message?.content ?? "")
    } catch {}
  }
  onProgress("strategy", "💡 OpenAI가 전략 및 포지셔닝 분석 중...")
  let strategyResult = ""
  if (openaiKey) {
    try {
      const oData = await (await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-5.2", messages: [{ role: "system", content: "브랜딩 및 상품 전략 전문가로서 SWOT분석, 타겟고객페르소나(2-3개), 포지셔닝전략, USP, GTM전략, 리스크를 분석하세요." }, { role: "user", content: `상품/브랜드 기획 분석:\n\n${query}${docContext}\n\n[시장조사]\n${marketSearch.slice(0, 5000) || "없음"}` }], max_tokens: 16384 }), signal: AbortSignal.timeout(60000) })).json().catch(() => ({}))
      strategyResult = String(oData?.choices?.[0]?.message?.content ?? "").trim()
    } catch {}
  }
  onProgress("report", "📦 Claude가 상품 기획서 작성 중...")
  try {
    const cr = await runAdapter({ provider: "claude", task: "research", messages: [{ role: "system", content: "상품 기획 전문가입니다. 형식: ## 📦 상품 개발 기획서 / ###1.상품개요 / ###2.시장분석(표) / ###3.타겟고객페르소나 / ###4.SWOT분석 / ###5.포지셔닝전략및USP / ###6.GTM전략 / ###7.마일스톤및실행계획 / ###8.예상리스크및대응" }, { role: "user", content: `기획서 작성:\n[기획] ${query}${docContext}\n[전략분석]\n${strategyResult.slice(0, 5000) || "없음"}\n[시장데이터]\n${marketSearch.slice(0, 4000) || "없음"}` }], input: { model: "claude-sonnet-4-6", max_tokens: 16384, temperature: 0.3 } })
    const report = String(cr?.text ?? cr?.answer_text ?? "").trim()
    if (!report) throw new Error("empty")
    return { ok: true, report }
  } catch (e: any) {
    const fallback = strategyResult || marketSearch
    return fallback ? { ok: true, report: `## 📦 상품 기획\n\n${fallback}` } : { ok: false, report: "", error: e?.message }
  }
}

const SOURCE_PROMOTE_PATTERNS = ["내용 정리해서 소스로","소스로 저장","소스로 넘겨줘","프로젝트 소스에 추가","소스로 올려줘","소스로 승격","지식 소스로","프로젝트 지식으로","소스 등록"]

export function detectSourcePromoteCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return SOURCE_PROMOTE_PATTERNS.some((p: any) => lower.includes(p))
}
