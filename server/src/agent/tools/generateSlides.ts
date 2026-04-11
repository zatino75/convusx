// generateSlides.ts — 슬라이드 생성 에이전트 도구
// Claude Opus 4.6으로 슬라이드 JSON 구조 생성 → 프론트엔드가 /api/slides/generate로 PPTX 다운로드

import { registerTool, type ToolResult } from "../toolRegistry.js"
import { ANTHROPIC_BASE } from "../../config/defaults.js"
import { logger } from "../../observability/logger.js"

const THEMES = ["midnight_executive", "coral_energy", "charcoal_minimal", "teal_trust", "forest_moss", "corvus_dark", "white_clean"] as const
type Theme = typeof THEMES[number]

function toTheme(s: string): Theme {
  return (THEMES.includes(s as Theme) ? s : "midnight_executive") as Theme
}

registerTool({
  name: "generate_slides",
  description: `프레젠테이션(슬라이드)을 생성합니다. 주제와 요구사항을 받아 완성된 슬라이드 구조를 만들어 PPTX로 다운로드할 수 있게 합니다.
슬라이드 유형: title(표지), section_header(챕터 헤더), content(내용+불릿), two_column(2단), stats(통계카드), quote(인용), closing(마무리).
테마: midnight_executive(진한 파랑), coral_energy(코랄), charcoal_minimal(차콜), teal_trust(청록), forest_moss(숲초록), corvus_dark(다크퍼플), white_clean(화이트).
프레젠테이션 내용은 한국어 기본, 언어(language) 파라미터로 변경 가능.`,
  input_schema: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description: "프레젠테이션 주제 또는 상세 요구사항. 예: '2026년 2분기 마케팅 전략', '신제품 액상전자담배 런칭 계획'"
      },
      slide_count: {
        type: "number",
        description: "슬라이드 수 (5~20). 기본값 10."
      },
      theme: {
        type: "string",
        enum: ["midnight_executive", "coral_energy", "charcoal_minimal", "teal_trust", "forest_moss", "corvus_dark", "white_clean"],
        description: "색상 테마. 기본값 midnight_executive."
      },
      audience: {
        type: "string",
        description: "청중/목적. 예: '경영진 보고용', '투자자 PT', '신입직원 교육'. 기본값: 비즈니스 발표."
      },
      language: {
        type: "string",
        enum: ["ko", "en"],
        description: "슬라이드 언어. 기본값 ko(한국어)."
      }
    },
    required: ["topic"]
  },
  cost_tier: "paid",
  async handler(input: any, _ctx: any): Promise<ToolResult> {
    const topic = String(input.topic ?? "").trim()
    const slideCount = Math.min(20, Math.max(5, Number(input.slide_count ?? 10)))
    const theme = toTheme(String(input.theme ?? "midnight_executive"))
    const audience = String(input.audience ?? "비즈니스 발표")
    const language = String(input.language ?? "ko") === "en" ? "English" : "Korean"
    const t0 = Date.now()

    if (!topic) {
      return { ok: false, output_text: JSON.stringify({ ok: false, error: "topic is required" }) }
    }

    const anthropicKey = String((globalThis as any)?.process?.env?.ANTHROPIC_API_KEY ?? "").trim()
    if (!anthropicKey) {
      return { ok: false, output_text: JSON.stringify({ ok: false, error: "ANTHROPIC_API_KEY not configured" }) }
    }

    // ── Claude에게 슬라이드 JSON 생성 요청 ──
    const systemPrompt = `You are a professional presentation designer. Generate a ${language} presentation as a valid JSON object.

REQUIRED JSON structure:
{
  "title": "presentation title",
  "theme": "${theme}",
  "slides": [
    { "type": "title", "title": "Main Title", "subtitle": "Subtitle", "date": "YYYY년 MM월" },
    { "type": "section_header", "title": "Chapter Name", "subtitle": "Brief description" },
    { "type": "content", "title": "Slide Title", "bullets": ["Point 1", "Point 2", "Point 3"], "notes": "speaker notes" },
    { "type": "two_column", "title": "Comparison", "left": { "heading": "Left", "bullets": ["A", "B"] }, "right": { "heading": "Right", "bullets": ["C", "D"] } },
    { "type": "stats", "title": "Key Metrics", "stats": [{ "value": "85%", "label": "Label", "sub": "context" }] },
    { "type": "quote", "title": "Key Insight", "quote": "The quote text here.", "author": "Source / Author" },
    { "type": "closing", "title": "Thank You", "subtitle": "Contact or CTA", "contact": "email or info" }
  ]
}

Rules:
- Output ONLY valid JSON, no markdown, no explanation
- Total slides: exactly ${slideCount}
- First slide MUST be type "title"
- Last slide MUST be type "closing"
- Mix slide types for visual variety
- Language: ${language}
- Audience: ${audience}
- bullets arrays: 3-5 items max per slide
- stats: 2-4 items per stats slide
- Make content specific, detailed, and professional`

    try {
      const resp = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01"
        },
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({
          model: "claude-opus-4-6",
          max_tokens: 8000,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: `Create a ${slideCount}-slide presentation on: ${topic}\nAudience: ${audience}\nLanguage: ${language}\nTheme: ${theme}\n\nReturn ONLY the JSON object.`
            }
          ]
        })
      })

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "")
        logger.warn("generate_slides Claude API error", { status: resp.status, error: errText })
        return { ok: false, output_text: JSON.stringify({ ok: false, error: `Claude API error ${resp.status}: ${errText.slice(0, 200)}` }) }
      }

      const data = await resp.json() as any
      const rawText = String(data?.content?.[0]?.text ?? "").trim()

      if (!rawText) {
        return { ok: false, output_text: JSON.stringify({ ok: false, error: "Claude returned empty response" }) }
      }

      // JSON 파싱 — 마크다운 코드펜스 제거
      let jsonText = rawText
      const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (fenceMatch) jsonText = fenceMatch[1].trim()
      // 앞뒤 { } 추출 (텍스트가 앞에 붙는 경우 방어)
      const firstBrace = jsonText.indexOf("{")
      const lastBrace = jsonText.lastIndexOf("}")
      if (firstBrace !== -1 && lastBrace !== -1) {
        jsonText = jsonText.slice(firstBrace, lastBrace + 1)
      }

      let slideData: any
      try {
        slideData = JSON.parse(jsonText)
      } catch (parseErr) {
        logger.warn("generate_slides JSON parse failed", { rawText: rawText.slice(0, 300) })
        return { ok: false, output_text: JSON.stringify({ ok: false, error: "슬라이드 JSON 파싱 실패. 다시 시도해 주세요." }) }
      }

      if (!Array.isArray(slideData?.slides) || slideData.slides.length === 0) {
        return { ok: false, output_text: JSON.stringify({ ok: false, error: "생성된 슬라이드 구조가 유효하지 않습니다." }) }
      }

      // theme 강제 적용 (Claude가 다른 theme을 넣을 수 있음)
      slideData.theme = theme

      const latency_ms = Date.now() - t0
      const actualCount = slideData.slides.length

      logger.info("generate_slides completed", { topic: topic.slice(0, 80), slide_count: actualCount, theme, latency_ms })

      return {
        ok: true,
        output_text: JSON.stringify({
          ok: true,
          is_slide: true,
          slide_data: slideData,
          title: String(slideData.title ?? topic).slice(0, 80),
          slide_count: actualCount,
          theme,
          message: `📊 ${actualCount}장 슬라이드가 생성됐습니다. 제목: "${slideData.title ?? topic}"`,
          latency_ms
        })
      }

    } catch (e) {
      const latency_ms = Date.now() - t0
      logger.error("generate_slides tool exception", { error: e, topic })
      return {
        ok: false,
        output_text: JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "알 수 없는 오류", latency_ms })
      }
    }
  }
})
