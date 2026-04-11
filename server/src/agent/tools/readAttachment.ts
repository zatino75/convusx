// readAttachment.ts — 현재 스레드의 첨부파일 접근 도구
//
// attachmentCache.ts 의 복원 로직을 통해 이미 normalizedInput.attached_file /
// pending_analysis_files 에 파일이 주입돼 있다. 이 도구는 모델이 "어떤 파일이
// 첨부돼 있는지" 와 "내용 일부" 를 필요할 때만 가져갈 수 있도록 노출한다.

import { registerTool, type ToolResult } from "../toolRegistry.js"

const MAX_TEXT_PREVIEW = 12000 // 약 3k 토큰 상한

function safeString(value: any): string {
  return String(value ?? "").trim()
}

function decodeBase64Text(base64: string | undefined | null): string {
  if (!base64) return ""
  try {
    const buf = Buffer.from(String(base64), "base64")
    // UTF-8 우선, 실패 시 latin1 fallback
    return buf.toString("utf8")
  } catch {
    return ""
  }
}

function isTextType(type: string | undefined | null, name: string | undefined | null): boolean {
  const t = safeString(type).toLowerCase()
  const n = safeString(name).toLowerCase()
  if (t.startsWith("text/")) return true
  if (t.includes("json") || t.includes("xml") || t.includes("yaml")) return true
  if (t.includes("csv") || t.includes("markdown") || t.includes("javascript") || t.includes("typescript")) return true
  if (/\.(txt|md|json|csv|tsv|xml|yaml|yml|js|ts|tsx|jsx|py|rb|go|rs|java|c|cc|cpp|h|hpp|sh|sql|log|ini|toml|html|css|scss)$/.test(n)) return true
  return false
}

registerTool({
  name: "read_attachment",
  description:
    "현재 턴 또는 이전 턴에서 복원된 첨부파일의 메타데이터·내용 일부를 가져온다. " +
    "사용자가 '파일', '첨부', '그 문서', '엑셀', 'PDF' 등을 언급하거나, 이전 턴 내용에 " +
    "파일 분석 맥락이 남아 있다면 먼저 호출해 무엇이 캐시돼 있는지 확인해야 한다. " +
    "mode='list' 는 현재 복원된 파일 목록과 메타데이터만, mode='preview' 는 텍스트 파일의 앞부분을, " +
    "mode='binary_info' 는 바이너리 파일의 크기·MIME 만 반환한다.",
  input_schema: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["list", "preview", "binary_info"],
        description: "list = 파일 목록만, preview = 텍스트 내용 일부, binary_info = 바이너리 메타",
      },
      index: {
        type: "number",
        description: "preview / binary_info 일 때 파일 인덱스 (0 = primary, 1+ = pending_analysis_files). 기본 0.",
      },
      max_chars: {
        type: "number",
        description: "preview 시 최대 글자 수 (기본 4000, 상한 12000)",
      },
    },
    required: ["mode"],
  },
  cost_tier: "free",
  async handler(input, ctx): Promise<ToolResult> {
    const normalized = ctx.normalizedInput ?? {}
    const primary = normalized.attached_file ?? null
    const pending: any[] = Array.isArray(normalized.pending_analysis_files) ? normalized.pending_analysis_files : []
    const restored = Boolean(normalized.__attachment_restored_from_cache)

    const all: any[] = []
    if (primary) all.push(primary)
    for (const f of pending) if (f) all.push(f)

    const mode = safeString(input?.mode) || "list"
    const idxRaw = Number(input?.index ?? 0)
    const idx = Number.isFinite(idxRaw) ? Math.max(0, Math.floor(idxRaw)) : 0

    if (mode === "list") {
      const items = all.map((f, i) => ({
        index: i,
        name: safeString(f?.name),
        type: safeString(f?.type),
        size: Number(f?.size ?? 0),
        is_text: isTextType(f?.type, f?.name),
      }))
      const payload = {
        ok: true,
        count: items.length,
        restored_from_cache: restored,
        files: items,
      }
      return {
        ok: true,
        output_text: JSON.stringify(payload),
        summary: `read_attachment.list count=${items.length} restored=${restored}`,
      }
    }

    if (all.length === 0) {
      return {
        ok: true,
        output_text: JSON.stringify({ ok: true, files: [], message: "no attachment in this turn" }),
        summary: "read_attachment no files",
      }
    }

    if (idx >= all.length) {
      return {
        ok: false,
        output_text: JSON.stringify({ ok: false, error: `index out of range (have ${all.length})` }),
        error: "index_out_of_range",
      }
    }

    const file = all[idx]
    const name = safeString(file?.name)
    const type = safeString(file?.type)
    const size = Number(file?.size ?? 0)

    if (mode === "binary_info") {
      return {
        ok: true,
        output_text: JSON.stringify({ ok: true, index: idx, name, type, size, is_text: isTextType(type, name) }),
        summary: `read_attachment.binary_info ${name} ${size}B`,
      }
    }

    // preview
    if (!isTextType(type, name)) {
      return {
        ok: true,
        output_text: JSON.stringify({
          ok: true,
          index: idx,
          name,
          type,
          size,
          is_text: false,
          note: "binary file — use a specialized tool (e.g. pdf_analyze, xlsx_parse)",
        }),
        summary: `read_attachment.preview binary ${name}`,
      }
    }

    const maxCharsRaw = Number(input?.max_chars ?? 4000)
    const maxChars = Math.min(MAX_TEXT_PREVIEW, Math.max(200, Number.isFinite(maxCharsRaw) ? maxCharsRaw : 4000))
    const decoded = decodeBase64Text(file?.base64)
    const preview = decoded.slice(0, maxChars)
    const truncated = decoded.length > preview.length

    return {
      ok: true,
      output_text: JSON.stringify({
        ok: true,
        index: idx,
        name,
        type,
        size,
        total_chars: decoded.length,
        preview_chars: preview.length,
        truncated,
        content: preview,
      }),
      summary: `read_attachment.preview ${name} ${preview.length}/${decoded.length} chars`,
    }
  },
})
