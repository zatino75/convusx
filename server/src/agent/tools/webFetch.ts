// webFetch.ts — 에이전트 루프 웹 페이지 콘텐츠 조회 도구
//
// perplexity_search 가 "검색 + 요약"이라면 web_fetch 는 "특정 URL 전체 내용 가져오기".
// 블로그 게시물 / 법령 원문 / 경쟁사 제품 페이지 / 뉴스 원본 등 정확한 URL 을 알고 있을 때 사용.

import { registerTool, type ToolResult } from "../toolRegistry.js"
import { logger } from "../../observability/logger.js"

const DEFAULT_TIMEOUT_MS = 15_000
const MAX_RESPONSE_CHARS = 20_000   // 토큰 폭발 방지

function safeString(value: any): string {
  return String(value ?? "").trim()
}

/** HTML → 텍스트 간단 변환 (외부 라이브러리 없이) */
function stripHtml(html: string): string {
  // script / style 블록 제거
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
  // HTML 태그 제거
  text = text.replace(/<[^>]+>/g, " ")
  // HTML 엔티티 디코딩 (기본 세트)
  text = text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ")
  // 공백 정규화
  text = text.replace(/\s{2,}/g, " ").trim()
  return text
}

registerTool({
  name: "web_fetch",
  description: [
    "특정 URL 의 웹 페이지 전체 텍스트 콘텐츠를 가져옵니다.",
    "정확한 URL 을 알고 있고 원문 전체가 필요할 때 사용하세요.",
    "법령 원문, 뉴스 기사, 경쟁사 제품 페이지, 공식 문서 등에 적합합니다.",
    "단순 검색(키워드→요약) 이 필요할 때는 perplexity_search 를 사용하세요.",
  ].join(" "),
  input_schema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "가져올 웹 페이지의 전체 URL (https:// 포함)",
      },
      max_chars: {
        type: "number",
        description: `반환할 최대 문자 수. 기본 ${MAX_RESPONSE_CHARS}. 최대 ${MAX_RESPONSE_CHARS}.`,
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
  cost_tier: "cheap",
  handler: async (input: any, _ctx): Promise<ToolResult> => {
    const url = safeString(input?.url)
    if (!url || !url.startsWith("http")) {
      return {
        ok: false,
        output_text: JSON.stringify({ ok: false, error: "invalid_url", url }),
        summary: `web_fetch 실패: invalid_url (${url})`,
        error: "invalid_url",
      }
    }

    const maxChars = Math.min(
      Number(input?.max_chars) > 0 ? Number(input.max_chars) : MAX_RESPONSE_CHARS,
      MAX_RESPONSE_CHARS,
    )

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

    try {
      logger.info("[webFetch] fetching", { url })
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; CorvusX/1.0; +https://app.cloudcookie.co.kr)",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
          "Accept-Language": "ko,en;q=0.9",
        },
        signal: controller.signal,
      })

      if (!response.ok) {
        return {
          ok: false,
          output_text: JSON.stringify({ ok: false, error: `http_${response.status}`, url }),
          summary: `web_fetch 실패: http_${response.status} (${url})`,
          error: `http_${response.status}`,
        }
      }

      const contentType = response.headers.get("content-type") ?? ""
      const rawText = await response.text()

      let text: string
      if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
        text = stripHtml(rawText)
      } else {
        // JSON, plain text, XML 등 — 그대로
        text = rawText.trim()
      }

      const truncated = text.length > maxChars
      const finalText = truncated ? text.slice(0, maxChars) + "\n\n[... 콘텐츠가 길어 잘렸습니다]" : text

      logger.info("[webFetch] done", { url, chars: finalText.length, truncated })

      return {
        ok: true,
        output_text: JSON.stringify({
          ok: true,
          url,
          content_type: contentType,
          chars: finalText.length,
          truncated,
          text: finalText,
        }),
        summary: `web_fetch 완료: ${url} (${finalText.length}자${truncated ? ", 잘림" : ""})`,
      }
    } catch (err: any) {
      const timedOut = err?.name === "AbortError"
      const errMsg = timedOut ? "timeout" : safeString(err?.message) || "fetch_error"
      logger.warn("[webFetch] error", { url, error: errMsg })
      return {
        ok: false,
        output_text: JSON.stringify({ ok: false, error: errMsg, url }),
        summary: `web_fetch 실패: ${errMsg} (${url})`,
        error: errMsg,
      }
    } finally {
      clearTimeout(timer)
    }
  },
})
