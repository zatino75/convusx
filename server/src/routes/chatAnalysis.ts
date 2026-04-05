import { runAdapter } from "../orchestra/adapterDispatcher.js";

export async function analyzeImageWithVision(attached: any, userText: string): Promise<string> {
  const openaiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  const claudeKey = String((globalThis as any)?.process?.env?.ANTHROPIC_API_KEY ?? "").trim()
  const prompt = userText || "이 이미지를 상세하게 분석해줘"

  async function callOpenAIVision(): Promise<string> {
    if (!openaiKey) return ""
    const body = {
      model: "gpt-5.2",
      messages: [{ role: "user", content: [
        { type: "image_url", image_url: { url: `data:${attached.type};base64,${attached.base64}`, detail: "high" } },
        { type: "text", text: prompt }
      ]}],
      max_tokens: 16384
    }
    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000)
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) return ""
      const text = data?.choices?.[0]?.message?.content ?? ""
      return typeof text === "string" ? text.trim() : ""
    } catch { return "" }
  }

  async function callClaudeVision(): Promise<string> {
    if (!claudeKey) return ""
    const mediaType = (attached.type || "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp"
    const body = {
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: attached.base64 } },
        { type: "text", text: prompt }
      ]}]
    }
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": claudeKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000)
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) return ""
      const text = data?.content?.[0]?.text ?? ""
      return typeof text === "string" ? text.trim() : ""
    } catch { return "" }
  }

  const [openaiResult, claudeResult] = await Promise.allSettled([
    callOpenAIVision(),
    callClaudeVision()
  ])
  const openaiText = openaiResult.status === "fulfilled" ? openaiResult.value : ""
  const claudeText = claudeResult.status === "fulfilled" ? claudeResult.value : ""

  if (!openaiText && !claudeText) return "이미지를 분석할 수 없습니다. API 키를 확인해주세요."
  if (claudeText.length > openaiText.length * 1.1) return claudeText
  return openaiText || claudeText
}

export async function analyzePdfWithGemini(attached: any, userText: string): Promise<string> {
  const apiKey = String((globalThis as any)?.process?.env?.GEMINI_API_KEY ?? "").trim()
  if (!apiKey) return analyzePdfWithOpenAI(attached, userText)
  try {
    const body = { contents: [{ parts: [{ inline_data: { mime_type: "application/pdf", data: attached.base64 } }, { text: userText || "이 PDF 문서의 내용을 분석하고 핵심 내용을 요약해줘" }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 4096 } }
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data?.error?.message ?? `HTTP ${resp.status}`)
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
    if (!text) throw new Error("empty response")
    return text
  } catch (e: any) {
    console.error("[PDF] Gemini failed:", e?.message, "→ falling back to OpenAI")
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
  } catch {}

  const prompt = extractedText
    ? userText + "\n\n[파일명: " + attached.name + "]\n[추출된 내용]\n" + extractedText
    : userText + "\n\n[파일명: " + attached.name + "]\n\n파일이 첨부되었습니다. 파일명을 참고하여 분석해주세요."

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
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
    const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 4096 } }
    const resp = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=" + apiKey, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    })
    const d = await resp.json()
    return d?.candidates?.[0]?.content?.parts?.[0]?.text || analyzeOfficeFileWithClaude(attached, userText)
  } catch { return analyzeOfficeFileWithClaude(attached, userText) }
}

export async function analyzeDocumentWithGemini(docText: string, userText: string): Promise<string> {
  const apiKey = String((globalThis as any)?.process?.env?.GEMINI_API_KEY ?? "").trim()
  if (!apiKey) return analyzeDocumentWithClaude(docText, userText)
  try {
    const body = { contents: [{ parts: [{ text: userText + "\n\n" + docText }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 4096 } }
    const resp = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=" + apiKey, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    })
    const d = await resp.json()
    return d?.candidates?.[0]?.content?.parts?.[0]?.text || analyzeDocumentWithClaude(docText, userText)
  } catch { return analyzeDocumentWithClaude(docText, userText) }
}

export async function analyzeDocumentWithClaude(docText: string, userText: string): Promise<string> {
  const apiKey = String((globalThis as any)?.process?.env?.ANTHROPIC_API_KEY ?? "").trim()
  if (!apiKey) return "분석할 수 없습니다."
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 16384, messages: [{ role: "user", content: userText + "\n\n" + docText }] })
    })
    const d = await resp.json()
    return d?.content?.[0]?.text ?? "분석 실패"
  } catch (e: any) { return "분석 오류: " + String(e?.message ?? "") }
}


export async function analyzePdfWithOpenAI(attached: any, userText: string): Promise<string> {
  const apiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  if (!apiKey) return "API 키가 없어 PDF를 분석할 수 없습니다."
  try {
    const pdfText = Buffer.from(attached.base64, "base64").toString("latin1")
    const extracted = pdfText.replace(/[^ -~가-힣ㄱ-ㅎㅏ-ㅣ]/g, " ").replace(/\s+/g, " ").slice(0, 6000).trim()
    if (extracted.length < 100) return `PDF 파일(${attached.name})을 받았습니다. 이 파일은 스캔된 이미지 PDF로 텍스트 추출이 어렵습니다. Gemini API 키를 설정하면 이미지 PDF도 분석할 수 있습니다.`
    const body = { model: "gpt-5.2", messages: [{ role: "system", content: "당신은 문서 분석 전문가입니다. 주어진 텍스트를 분석하고 핵심 내용을 정리해주세요." }, { role: "user", content: `[PDF 파일: ${attached.name}]\n\n[추출된 텍스트]\n${extracted}\n\n${userText || "이 문서의 핵심 내용을 분석해줘"}` }], max_tokens: 16384 }
    const resp = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) })
    const data = await resp.json().catch(() => ({}))
    return String(data?.choices?.[0]?.message?.content ?? "PDF 분석에 실패했습니다.")
  } catch (e: any) {
    return `PDF 분석 오류: ${e?.message ?? "unknown"}`
  }
}

