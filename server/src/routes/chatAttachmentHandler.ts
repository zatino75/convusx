// chatAttachmentHandler.ts — 첨부파일 처리, URL 크롤링, 다중파일 정규화
import { logger } from "../observability/logger.js"

// ── 헬퍼 함수 ──
function safeArray(value: any): any[] {
  return Array.isArray(value) ? value : []
}

function safeString(value: any): string {
  return String(value ?? "").trim()
}

// ── 단일 파일 첨부 처리 ──
export function buildMessagesWithAttachment(input: any): any[] {
  const attached = input?.attached_file
  if (!attached?.base64 || !attached?.type) return []
  const isImage = String(attached.type).startsWith("image/")
  const isPdf = attached.type === "application/pdf"
  const userText = safeString(input?.message) || "이 파일을 분석해줘"
  if (isImage) return []
  if (isPdf) return [{ role: "user", content: [{ type: "text", text: `[첨부 파일: ${attached.name}]\n\n${userText}` }] }]
  try {
    const textContent = Buffer.from(attached.base64, "base64").toString("utf-8").slice(0, 8000)
    return [{ role: "user", content: `[첨부 파일: ${attached.name}]\n\n\`\`\`\n${textContent}\n\`\`\`\n\n${userText}` }]
  } catch (e) {
    logger.warn("attachment file decode failed", { error: e, file: attached.name })
    return [{ role: "user", content: `[첨부 파일: ${attached.name} — 읽기 실패]\n\n${userText}` }]
  }
}

export function injectAttachmentIntoInput(input: any): any {
  const attached = input?.attached_file
  if (!attached?.base64) return input
  const messages = buildMessagesWithAttachment(input)
  if (messages.length === 0) return input
  const existingMessages = safeArray(input?.messages).filter((m: any) => safeString(m?.role) !== "user" || !input?.message)
  return { ...input, messages: [...existingMessages, ...messages], message: undefined }
}

// ── URL 링크 감지 및 자동 크롤링 ──
export const URL_REGEX = /https?:\/\/[^\s<>"'(){}[\]]+/gi
export const BLOCKED_DOMAINS = ["localhost", "127.0.0.1", "0.0.0.0", "192.168.", "10.0.", "172.16."]

export function extractUrlsFromMessage(message: string): string[] {
  const urls = message.match(URL_REGEX) ?? []
  return urls
    .map(u => u.replace(/[.,;:!?)]+$/, "")) // 후행 구두점 제거
    .filter(u => !BLOCKED_DOMAINS.some(d => u.includes(d)))
    .slice(0, 3) // 최대 3개
}

export async function fetchUrlContent(url: string): Promise<{ ok: boolean; title?: string; text?: string; error?: string }> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CORVUSX/1.0)",
        "Accept": "text/html,application/xhtml+xml,text/plain,application/json",
      },
      signal: controller.signal,
      redirect: "follow",
    })
    clearTimeout(timer)

    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` }

    const contentType = String(resp.headers.get("content-type") ?? "")
    const rawText = await resp.text()

    if (contentType.includes("application/json")) {
      return { ok: true, title: url, text: rawText.slice(0, 6000) }
    }

    // HTML → 텍스트 추출 (간이 파서)
    const titleMatch = rawText.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = titleMatch?.[1]?.trim() ?? url

    // script/style 태그 제거 후 텍스트만 추출
    const stripped = rawText
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#\d+;/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 5000)

    if (stripped.length < 50) return { ok: false, error: "no meaningful text" }
    return { ok: true, title, text: stripped }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "fetch_error" }
  }
}

export async function enrichMessageWithUrls(message: string): Promise<string> {
  const urls = extractUrlsFromMessage(message)
  if (urls.length === 0) return message

  const results = await Promise.allSettled(urls.map(fetchUrlContent))
  const enrichments: string[] = []

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status === "fulfilled" && result.value.ok) {
      enrichments.push(`\n\n[링크 ${i + 1}: ${result.value.title ?? urls[i]}]\n${result.value.text}`)
    }
  }

  if (enrichments.length === 0) return message
  return message + "\n\n---\n[아래는 메시지에 포함된 URL에서 자동 추출한 내용입니다]" + enrichments.join("")
}

// ── 다중 파일 첨부 정규화 ──
// 프론트엔드에서 attached_files[] 배열로 보내면:
// 1) 첫 번째 파일 → attached_file (기존 단일 파일 파이프라인 활용)
// 2) 나머지 파일 → 타입별 처리 (PDF/이미지는 pending_analysis에 보존, 텍스트는 메시지 주입)
export function normalizeMultipleAttachments(input: any): any {
  const files = Array.isArray(input?.attached_files) ? input.attached_files.filter((f: any) => f?.base64) : []
  if (files.length === 0) return input

  // 첫 번째 파일은 메인 파이프라인(이미지/PDF/Office)으로
  const primary = files[0]
  const rest = files.slice(1)

  let enrichedMessage = String(input?.message ?? "")
  // PDF/이미지 등 바이너리 파일은 base64 데이터를 보존해서 순차 분석
  const pendingAnalysis: any[] = []

  for (const file of rest) {
    const name = String(file.name ?? "unknown")
    const type = String(file.type ?? "")
    try {
      if (type.startsWith("text/") || /\.(txt|md|csv|json|xml|yaml|yml|toml|log|ini|cfg|env|sh|bat)$/i.test(name)) {
        const text = Buffer.from(file.base64, "base64").toString("utf-8").slice(0, 4000)
        enrichedMessage += `\n\n[추가 첨부: ${name}]\n\`\`\`\n${text}\n\`\`\``
      } else if (/\.(ts|tsx|js|jsx|py|java|go|rs|cpp|c|h|hpp|swift|kt|rb|php|sql|html|css|scss|less)$/i.test(name)) {
        const text = Buffer.from(file.base64, "base64").toString("utf-8").slice(0, 4000)
        enrichedMessage += `\n\n[추가 코드 파일: ${name}]\n\`\`\`\n${text}\n\`\`\``
      } else if (type === "application/pdf" || type.startsWith("image/") || type.startsWith("video/") ||
                 /\.(xlsx|xls|docx|doc|pptx|ppt)$/i.test(name) ||
                 type.includes("spreadsheet") || type.includes("wordprocessing") || type.includes("presentation")) {
        // PDF, 이미지, 동영상, Office 파일은 base64 보존 → 순차 분석용
        pendingAnalysis.push(file)
      } else {
        enrichedMessage += `\n\n[추가 첨부: ${name} (${type}, ${Math.round((file.base64?.length ?? 0) * 0.75 / 1024)}KB)]`
      }
    } catch (e) {
      logger.warn("multi-file attachment decode failed", { error: e, file: name })
      enrichedMessage += `\n\n[추가 첨부: ${name} — 읽기 실패]`
    }
  }

  return {
    ...input,
    message: enrichedMessage,
    attached_file: primary,
    attached_files: undefined,
    pending_analysis_files: pendingAnalysis.length > 0 ? pendingAnalysis : undefined,
  }
}
