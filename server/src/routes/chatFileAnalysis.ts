// chatFileAnalysis.ts — 파일 분석 함수 모듈 (이미지, PDF, Office, 동영상)

import { logger } from "../observability/logger.js"
import { ROUTE_TIMEOUT_MS, OPENAI_BASE, ANTHROPIC_BASE, GEMINI_BASE, GEMINI_HOST, GEMINI_MODEL_ID } from "../config/defaults.js"

export async function analyzeImageWithVision(attached: any, userText: string): Promise<string> {
  const apiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  if (!apiKey) return "OPENAI_API_KEY가 설정되지 않아 이미지를 분석할 수 없습니다."
  const body = {
    model: "gpt-5.2",
    messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:${attached.type};base64,${attached.base64}`, detail: "high" } }, { type: "text", text: userText || "이 이미지를 분석해줘" }] }],
    max_tokens: 16384
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS)
  try {
    const response = await fetch(`${OPENAI_BASE}/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal })
    clearTimeout(timer)
    const data = await response.json().catch(() => ({}))
    if (!response.ok) return `이미지 분석 실패: ${data?.error?.message ?? `HTTP ${response.status}`}`
    const text = data?.choices?.[0]?.message?.content ?? ""
    return typeof text === "string" && text.trim() ? text.trim() : "이미지 분석 결과를 가져올 수 없습니다."
  } catch (e: any) {
    clearTimeout(timer)
    return `이미지 분석 중 오류: ${e?.message ?? "network_error"}`
  }
}

// PDF 처리: 1단계 pdf-parse → 2단계 Claude API document → 3단계 OpenAI 폴백
export async function analyzePdfWithGemini(attached: any, userText: string): Promise<string> {
  // 1단계: pdf-parse로 서버에서 직접 텍스트 추출 (API 호출 없음, 1~2초)
  try {
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js" as any)).default ?? (await import("pdf-parse/lib/pdf-parse.js" as any))
    const buf = Buffer.from(attached.base64, "base64")
    const result = await pdfParse(buf)
    const extracted = (result.text ?? "").trim()
    if (extracted.length >= 100) {
      logger.info("[PDF] pdf-parse 직접 추출 성공", { chars: extracted.length, name: attached.name })
      return extracted
    }
    logger.info("[PDF] pdf-parse 텍스트 부족 (스캔 PDF), Claude API로 전환", { chars: extracted.length })
  } catch (e: any) {
    logger.info("[PDF] pdf-parse 실패, Claude API로 전환", { error: e?.message })
  }

  // 2단계: Claude API document 타입으로 직접 전송 (3~10초)
  return analyzePdfWithClaude(attached, userText)
}

async function analyzePdfWithClaude(attached: any, userText: string): Promise<string> {
  const apiKey = String((globalThis as any)?.process?.env?.ANTHROPIC_API_KEY ?? "").trim()
  if (!apiKey) return analyzePdfWithOpenAI(attached, userText)
  try {
    const resp = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 16384,
        messages: [{
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: attached.base64
              }
            },
            {
              type: "text",
              text: userText || "이 PDF 문서의 전체 텍스트를 추출해줘. 분석이나 요약 없이 원문 텍스트만 최대한 그대로 추출해줘."
            }
          ]
        }]
      }),
      signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS)
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data?.error?.message ?? `HTTP ${resp.status}`)
    const text = data?.content?.[0]?.text ?? ""
    if (!text) throw new Error("empty response")
    logger.info("[PDF] Claude API 추출 성공", { chars: text.length, name: attached.name })
    return text
  } catch (e: any) {
    logger.error("[PDF] Claude API failed:", { message: e?.message, fallback: "OpenAI" })
    return analyzePdfWithOpenAI(attached, userText)
  }
}

// Excel/Word/PPT → Claude API에 직접 파일 내용 전달
// ZIP 파싱 대신 파일을 텍스트 프롬프트로 설명하고 Claude가 분석하도록 위임
export async function analyzeOfficeFileWithClaude(attached: any, userText: string): Promise<string> {
  const apiKey = String((globalThis as any)?.process?.env?.ANTHROPIC_API_KEY ?? "").trim()
  if (!apiKey) return "API 키가 없습니다."

  // ZIP XML 파싱으로 텍스트 추출 시도
  let extractedText = ""
  try {
    const content = Buffer.from(attached.base64, "base64").toString("latin1")
    const name = String(attached.name ?? "").toLowerCase()

    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      // xlsx = ZIP 파일. Node.js로 ZIP 엔트리 파싱
      try {
        const { unzipSync } = await import("zlib")
        const buf = Buffer.from(attached.base64, "base64")
        // ZIP local file header 파싱으로 각 파일 추출
        const texts: string[] = []
        let offset = 0
        const entries: { name: string; data: Buffer }[] = []
        while (offset < buf.length - 4) {
          if (buf.readUInt32LE(offset) !== 0x04034b50) break
          const fnLen = buf.readUInt16LE(offset + 26)
          const extraLen = buf.readUInt16LE(offset + 28)
          const entryName = buf.slice(offset + 30, offset + 30 + fnLen).toString("utf-8")
          const compMethod = buf.readUInt16LE(offset + 8)
          const compSize = buf.readUInt32LE(offset + 18)
          const dataStart = offset + 30 + fnLen + extraLen
          const compData = buf.slice(dataStart, dataStart + compSize)
          let entryData: Buffer
          try {
            entryData = compMethod === 8 ? unzipSync(Buffer.concat([Buffer.from([0x78, 0x9c]), compData])) : compData
          } catch {
            try { entryData = unzipSync(compData) } catch { entryData = compData }
          }
          entries.push({ name: entryName, data: entryData })
          offset = dataStart + compSize
        }
        // sharedStrings.xml에서 텍스트 추출
        const ss = entries.find(e => e.name.includes("sharedStrings"))
        if (ss) {
          const xml = ss.data.toString("utf-8")
          const tMatches = xml.match(/<t[^>]*>([^<]+)<\/t>/g) ?? []
          for (const m of tMatches) { const v = m.replace(/<[^>]+>/g,"").trim(); if (v) texts.push(v) }
        }
        // sheet1에서 수치 추출
        const sh = entries.find(e => e.name.includes("sheet1.xml"))
        const nums: string[] = []
        if (sh) {
          const xml = sh.data.toString("utf-8")
          const vMatches = xml.match(/<v>([^<]+)<\/v>/g) ?? []
          for (const m of vMatches) { nums.push(m.replace(/<[^>]+>/g,"")) }
        }
        extractedText = texts.length > 0
          ? "텍스트 데이터: " + [...new Set(texts)].join(", ").slice(0, 3000) + (nums.length ? "\n수치: " + nums.slice(0,100).join(", ") : "")
          : ""
      } catch (ze: any) {
        extractedText = ""
      }
    } else if (name.endsWith(".csv")) {
      extractedText = Buffer.from(attached.base64, "base64").toString("utf-8").slice(0, 4000)
    } else if (name.endsWith(".docx") || name.endsWith(".doc")) {
      try {
        const { unzipSync } = await import("zlib")
        const buf = Buffer.from(attached.base64, "base64")
        let offset = 0
        const entries: { name: string; data: Buffer }[] = []
        while (offset < buf.length - 4) {
          if (buf.readUInt32LE(offset) !== 0x04034b50) break
          const fnLen = buf.readUInt16LE(offset + 26)
          const extraLen = buf.readUInt16LE(offset + 28)
          const entryName = buf.slice(offset + 30, offset + 30 + fnLen).toString("utf-8")
          const compMethod = buf.readUInt16LE(offset + 8)
          const compSize = buf.readUInt32LE(offset + 18)
          const dataStart = offset + 30 + fnLen + extraLen
          const compData = buf.slice(dataStart, dataStart + compSize)
          let entryData: Buffer
          try { entryData = compMethod === 8 ? unzipSync(compData) : compData } catch { entryData = compData }
          entries.push({ name: entryName, data: entryData })
          offset = dataStart + compSize
        }
        const doc = entries.find(e => e.name.includes("document.xml"))
        if (doc) {
          const xml = doc.data.toString("utf-8")
          const tMatches = xml.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) ?? []
          extractedText = tMatches.map((m: string) => m.replace(/<[^>]+>/g,"").trim()).filter(Boolean).join(" ").slice(0, 6000)
        }
      } catch { extractedText = "" }
    } else if (name.endsWith(".pptx") || name.endsWith(".ppt")) {
      // PPT: 슬라이드별 텍스트 추출
      const slides: string[] = []
      let si = 1
      while (si <= 50) {
        const sm = content.match(new RegExp("ppt/slides/slide" + si + "\.xml[\s\S]{0,100000}?(?=PK\x03\x04)"))?.[0] ?? ""
        if (!sm) break
        const ts = (sm.match(/<a:t>([^<]{1,500})<\/a:t>/g) ?? []).map((m: string) => m.replace(/<[^>]+>/g,"").trim()).filter(Boolean)
        if (ts.length) slides.push("[슬라이드 " + si + "] " + ts.join(" | "))
        si++
      }
      extractedText = slides.join("\n").slice(0, 5000)
    }
  } catch (e) { logger.warn("Failed to extract text from document", { error: e }) }

  const prompt = extractedText
    ? userText + "\n\n[파일명: " + attached.name + "]\n[추출된 내용]\n" + extractedText
    : userText + "\n\n[파일명: " + attached.name + "]\n\n파일이 첨부되었습니다. 파일명을 참고하여 분석해주세요."

  try {
    const resp = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 16384, messages: [{ role: "user", content: prompt }] })
    })
    const d = await resp.json()
    return d?.content?.[0]?.text ?? "분석 실패"
  } catch (e: any) { return "분석 오류: " + String(e?.message ?? "") }
}

// PPT/장문 문서는 Gemini로
export async function analyzeOfficeFileWithGemini(attached: any, userText: string): Promise<string> {
  const apiKey = String((globalThis as any)?.process?.env?.GEMINI_API_KEY ?? "").trim()
  if (!apiKey) return analyzeOfficeFileWithClaude(attached, userText)
  try {
    const content = Buffer.from(attached.base64, "base64").toString("latin1")
    const name = String(attached.name ?? "").toLowerCase()
    const slides: string[] = []
    let si = 1
    while (si <= 50) {
      const sm = content.match(new RegExp("ppt/slides/slide" + si + "\.xml[\s\S]{0,100000}?(?=PK\x03\x04)"))?.[0] ?? ""
      if (!sm) break
      const ts = (sm.match(/<a:t>([^<]{1,500})<\/a:t>/g) ?? []).map((m: string) => m.replace(/<[^>]+>/g,"").trim()).filter(Boolean)
      if (ts.length) slides.push("[슬라이드 " + si + "] " + ts.join(" | "))
      si++
    }
    const extractedText = slides.join("\n").slice(0, 5000)
    const prompt = extractedText
      ? userText + "\n\n[파일명: " + name + "]\n" + extractedText
      : userText + "\n\n[파일명: " + name + "]"
    const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 65536 } }
    const resp = await fetch(`${GEMINI_BASE}/models/${GEMINI_MODEL_ID}:generateContent?key=${apiKey}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    })
    const d = await resp.json()
    return d?.candidates?.[0]?.content?.parts?.[0]?.text || analyzeOfficeFileWithClaude(attached, userText)
  } catch (e) { logger.warn("Gemini office file analysis failed, falling back to Claude", { error: e }); return analyzeOfficeFileWithClaude(attached, userText) }
}

export async function analyzeDocumentWithGemini(docText: string, userText: string): Promise<string> {
  const apiKey = String((globalThis as any)?.process?.env?.GEMINI_API_KEY ?? "").trim()
  if (!apiKey) return analyzeDocumentWithClaude(docText, userText)
  try {
    const body = { contents: [{ parts: [{ text: userText + "\n\n" + docText }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 65536 } }
    const resp = await fetch(`${GEMINI_BASE}/models/${GEMINI_MODEL_ID}:generateContent?key=${apiKey}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    })
    const d = await resp.json()
    return d?.candidates?.[0]?.content?.parts?.[0]?.text || analyzeDocumentWithClaude(docText, userText)
  } catch (e) { logger.warn("Gemini document analysis failed, falling back to Claude", { error: e }); return analyzeDocumentWithClaude(docText, userText) }
}

export async function analyzeDocumentWithClaude(docText: string, userText: string): Promise<string> {
  const apiKey = String((globalThis as any)?.process?.env?.ANTHROPIC_API_KEY ?? "").trim()
  if (!apiKey) return "분석할 수 없습니다."
  try {
    const resp = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 16384, messages: [{ role: "user", content: userText + "\n\n" + docText }] })
    })
    const d = await resp.json()
    return d?.content?.[0]?.text ?? "분석 실패"
  } catch (e: any) { return "분석 오류: " + String(e?.message ?? "") }
}


// ── 동영상 분석 (Gemini Video Understanding) ──
export async function analyzeVideoWithGemini(attached: any, userText: string): Promise<string> {
  const apiKey = String((globalThis as any)?.process?.env?.GEMINI_API_KEY ?? "").trim()
  if (!apiKey) return "GEMINI_API_KEY가 설정되지 않아 동영상을 분석할 수 없습니다."

  const mimeType = String(attached.type ?? "video/mp4")
  const prompt = userText || "이 동영상의 내용을 분석해줘. 주요 장면, 등장 인물/객체, 텍스트, 음성 내용을 설명해줘."

  try {
    // Gemini File API로 업로드 (base64 inline은 비디오에 비효율적)
    // 먼저 inline_data 시도 (짧은 영상)
    const fileSizeMB = (attached.base64?.length ?? 0) * 0.75 / 1024 / 1024

    if (fileSizeMB <= 20) {
      // 20MB 이하: inline_data로 직접 전달
      const body = {
        contents: [{
          parts: [
            { inline_data: { mime_type: mimeType, data: attached.base64 } },
            { text: prompt }
          ]
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 16384 }
      }
      const resp = await fetch(
        `${GEMINI_BASE}/models/${GEMINI_MODEL_ID}:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) }
      )
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error?.message ?? `HTTP ${resp.status}`)
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
      if (text) return text
      throw new Error("empty response")
    }

    // 20MB 초과: File API 사용
    // 1) 파일 업로드
    const uploadResp = await fetch(
      `${GEMINI_HOST}/upload/v1beta/files?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": mimeType,
          "X-Goog-Upload-Protocol": "raw",
        },
        body: Buffer.from(attached.base64, "base64"),
        signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
      }
    )
    const uploadData = await uploadResp.json().catch(() => ({}))
    const fileUri = uploadData?.file?.uri
    if (!fileUri) throw new Error("file upload failed: " + JSON.stringify(uploadData?.error ?? {}))

    // 2) 처리 대기 (최대 60초)
    let fileState = uploadData?.file?.state ?? "PROCESSING"
    for (let i = 0; i < 12 && fileState === "PROCESSING"; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const checkResp = await fetch(`${fileUri}?key=${apiKey}`).catch(() => null)
      const checkData = await checkResp?.json().catch(() => ({}))
      fileState = checkData?.state ?? "PROCESSING"
    }

    // 3) 분석 요청
    const body = {
      contents: [{
        parts: [
          { file_data: { mime_type: mimeType, file_uri: fileUri } },
          { text: prompt }
        ]
      }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 16384 }
    }
    const resp = await fetch(
      `${GEMINI_BASE}/models/${GEMINI_MODEL_ID}:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) }
    )
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data?.error?.message ?? `HTTP ${resp.status}`)
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "동영상 분석 결과를 가져올 수 없습니다."
  } catch (e: any) {
    return `동영상 분석 오류: ${e?.message ?? "unknown"}`
  }
}

export async function analyzePdfWithOpenAI(attached: any, userText: string): Promise<string> {
  const apiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  if (!apiKey) return "API 키가 없어 PDF를 분석할 수 없습니다."
  try {
    const pdfText = Buffer.from(attached.base64, "base64").toString("latin1")
    const extracted = pdfText.replace(/[^ -~가-힣ㄱ-ㅎㅏ-ㅣ]/g, " ").replace(/\s+/g, " ").slice(0, 6000).trim()
    if (extracted.length < 100) return `PDF 파일(${attached.name})을 받았습니다. 이 파일은 스캔된 이미지 PDF로 텍스트 추출이 어렵습니다. Gemini API 키를 설정하면 이미지 PDF도 분석할 수 있습니다.`
    const body = { model: "gpt-5.2", messages: [{ role: "system", content: "당신은 문서 분석 전문가입니다. 주어진 텍스트를 분석하고 핵심 내용을 정리해주세요." }, { role: "user", content: `[PDF 파일: ${attached.name}]\n\n[추출된 텍스트]\n${extracted}\n\n${userText || "이 문서의 핵심 내용을 분석해줘"}` }], max_tokens: 16384 }
    const resp = await fetch(`${OPENAI_BASE}/v1/chat/completions`, { method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) })
    const data = await resp.json().catch(() => ({}))
    return String(data?.choices?.[0]?.message?.content ?? "PDF 분석에 실패했습니다.")
  } catch (e: any) {
    return `PDF 분석 오류: ${e?.message ?? "unknown"}`
  }
}

// ─────────────────────────────────────────────────────────────────
// analyzePdfDirect — PDF + 질문을 Claude에 1번만 전달 (추출+분석 통합)
// 기존 2-step(추출→분석) 대비 API 호출 1회, 속도 3~5배 향상
// ─────────────────────────────────────────────────────────────────
export async function analyzePdfDirect(attached: any, userText: string): Promise<string> {
  const apiKey = String((globalThis as any)?.process?.env?.ANTHROPIC_API_KEY ?? "").trim()
  if (!apiKey) return analyzePdfWithOpenAI(attached, userText)
  try {
    const resp = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 16384,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: attached.base64 } },
            { type: "text", text: userText || "이 PDF 문서를 분석해줘" }
          ]
        }]
      }),
      signal: AbortSignal.timeout(90000)
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data?.error?.message ?? `HTTP ${resp.status}`)
    const text = String(data?.content?.[0]?.text ?? "").trim()
    if (!text) throw new Error("empty response")
    logger.info("[PDF] Direct Claude 완료", { chars: text.length, name: attached.name })
    return text
  } catch (e: any) {
    logger.error("[PDF] Direct Claude 실패 → OpenAI 폴백", { message: e?.message })
    return analyzePdfWithOpenAI(attached, userText)
  }
}

// ─────────────────────────────────────────────────────────────────
// analyzePdfExtractOnly — 텍스트만 추출 (법률/재무 파이프라인용)
// Claude document API로 원문 그대로 추출, 분석 없음
// ─────────────────────────────────────────────────────────────────
export async function analyzePdfExtractOnly(attached: any): Promise<string> {
  const apiKey = String((globalThis as any)?.process?.env?.ANTHROPIC_API_KEY ?? "").trim()
  if (!apiKey) {
    // 폴백: pdf-parse 로컬 추출
    try {
      const pdfParse = (await import("pdf-parse/lib/pdf-parse.js" as any)).default ?? (await import("pdf-parse/lib/pdf-parse.js" as any))
      const buf = Buffer.from(attached.base64, "base64")
      const result = await pdfParse(buf)
      const extracted = (result.text ?? "").trim()
      if (extracted.length >= 50) return extracted
    } catch (e) { logger.warn("PDF parse local extraction failed", { error: e }) }
    return ""
  }
  try {
    const resp = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 16384,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: attached.base64 } },
            { type: "text", text: "이 PDF의 전체 텍스트를 원문 그대로 추출해줘. 분석이나 요약 없이 문서에 있는 내용만 빠짐없이 출력해줘." }
          ]
        }]
      }),
      signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS)
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data?.error?.message ?? `HTTP ${resp.status}`)
    return String(data?.content?.[0]?.text ?? "").trim()
  } catch (e: any) {
    logger.error("[PDF] ExtractOnly 실패", { message: e?.message })
    return ""
  }
}

// ─────────────────────────────────────────────────────────────────
// analyzeFileWithGeminiNative — Excel/Word/PPT/PDF를 Gemini에 직접 전달
// 로컬 XML 파싱 없이 Gemini 2.5 Pro가 파일 구조를 그대로 읽음
// 셀 위치, 표 구조, 슬라이드 레이아웃 보존 → 품질 대폭 향상
// ─────────────────────────────────────────────────────────────────
export async function analyzeFileWithGeminiNative(attached: any, userText: string): Promise<string> {
  const apiKey = String((globalThis as any)?.process?.env?.GEMINI_API_KEY ?? "").trim()
  if (!apiKey) return ""

  const name = String(attached.name ?? "").toLowerCase()
  const rawType = String(attached.type ?? "")

  // MIME 타입 정규화 — 브라우저가 잘못 전달하는 경우 확장자로 보정
  let mimeType = rawType
  if (!mimeType || mimeType === "application/octet-stream") {
    if (name.endsWith(".xlsx") || name.endsWith(".xls"))  mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else if (name.endsWith(".docx") || name.endsWith(".doc")) mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else if (name.endsWith(".pptx") || name.endsWith(".ppt")) mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    else if (name.endsWith(".pdf"))  mimeType = "application/pdf"
    else if (name.endsWith(".csv"))  mimeType = "text/csv"
  }

  // Gemini가 지원하는 파일 타입만 허용
  const supported = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
    "text/csv", "text/plain", "text/markdown"
  ]
  if (!supported.some(s => mimeType.startsWith(s))) return ""

  const prompt = userText || `이 파일(${name})을 분석해줘`
  const fileSizeMB = (attached.base64?.length ?? 0) * 0.75 / 1024 / 1024

  try {
    if (fileSizeMB <= 20) {
      // 20MB 이하: inline_data 직접 전달 (업로드 대기 없음)
      const body = {
        contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: attached.base64 } }, { text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 65536 }
      }
      const resp = await fetch(
        `${GEMINI_BASE}/models/${GEMINI_MODEL_ID}:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) }
      )
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error?.message ?? `HTTP ${resp.status}`)
      const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim()
      if (!text) throw new Error("empty response")
      logger.info("[Gemini Native] 파일 분석 완료", { name, chars: text.length, mb: fileSizeMB.toFixed(1) })
      return text
    }

    // 20MB 초과: File API 업로드 후 분석
    const uploadResp = await fetch(
      `${GEMINI_HOST}/upload/v1beta/files?key=${apiKey}`,
      { method: "POST", headers: { "Content-Type": mimeType, "X-Goog-Upload-Protocol": "raw" }, body: Buffer.from(attached.base64, "base64"), signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) }
    )
    const uploadData = await uploadResp.json().catch(() => ({}))
    const fileUri = uploadData?.file?.uri
    if (!fileUri) throw new Error("file upload failed: " + JSON.stringify(uploadData?.error ?? {}))

    let fileState = uploadData?.file?.state ?? "PROCESSING"
    for (let i = 0; i < 12 && fileState === "PROCESSING"; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const checkData = await (await fetch(`${fileUri}?key=${apiKey}`).catch(() => null))?.json().catch(() => ({}))
      fileState = checkData?.state ?? "PROCESSING"
    }

    const body = {
      contents: [{ parts: [{ file_data: { mime_type: mimeType, file_uri: fileUri } }, { text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 65536 }
    }
    const resp = await fetch(
      `${GEMINI_BASE}/models/${GEMINI_MODEL_ID}:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) }
    )
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data?.error?.message ?? `HTTP ${resp.status}`)
    const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim()
    if (!text) throw new Error("empty response")
    logger.info("[Gemini Native] 대용량 파일 분석 완료", { name, chars: text.length })
    return text
  } catch (e: any) {
    logger.error("[Gemini Native] 실패", { name, message: e?.message })
    return ""
  }
}
