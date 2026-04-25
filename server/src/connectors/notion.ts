/**
 * notion.ts — Notion API v1 커넥터
 *
 * 환경변수 NOTION_INTEGRATION_TOKEN 사용.
 * 미설정 시 모든 함수가 null 반환 (throw 안함 — 서비스 중단 방지).
 *
 * - searchNotion(query) → 검색 결과 페이지 목록
 * - fetchNotionPage(pageId) → 페이지 메타 + 블록 본문
 * - callNotion(query) → DepartmentAgent 사전조사 어댑터 (markdown)
 */

const NOTION_BASE = "https://api.notion.com/v1"
const NOTION_VERSION = "2022-06-28"
const FETCH_TIMEOUT_MS = 12_000

export interface NotionSearchHit {
  id: string
  title: string
  url: string
  last_edited_time: string
}

export interface NotionPageContent {
  id: string
  title: string
  url: string
  text: string
}

function getToken(): string | null {
  const t = String(process.env.NOTION_INTEGRATION_TOKEN ?? "").trim()
  return t || null
}

async function notionFetch(path: string, init: RequestInit): Promise<any | null> {
  const token = getToken()
  if (!token) return null
  try {
    const res = await fetch(`${NOTION_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

function extractTitle(obj: any): string {
  // page: properties.title.title[].plain_text 또는 properties.Name.title
  const props = obj?.properties ?? {}
  for (const key of Object.keys(props)) {
    const node = props[key]
    if (node?.type === "title" && Array.isArray(node?.title)) {
      const text = node.title.map((t: any) => t?.plain_text ?? "").join("")
      if (text) return text
    }
  }
  // database title
  if (Array.isArray(obj?.title)) {
    const text = obj.title.map((t: any) => t?.plain_text ?? "").join("")
    if (text) return text
  }
  return "(제목 없음)"
}

export async function searchNotion(query: string, pageSize = 10): Promise<NotionSearchHit[] | null> {
  const data = await notionFetch("/search", {
    method: "POST",
    body: JSON.stringify({
      query,
      page_size: pageSize,
      sort: { direction: "descending", timestamp: "last_edited_time" },
    }),
  })
  if (!data) return null
  const results = Array.isArray(data?.results) ? data.results : []
  return results.map((r: any) => ({
    id: String(r?.id ?? ""),
    title: extractTitle(r),
    url: String(r?.url ?? ""),
    last_edited_time: String(r?.last_edited_time ?? ""),
  }))
}

function extractBlockText(block: any): string {
  const type = block?.type
  if (!type) return ""
  const node = block[type]
  if (!node) return ""
  const rich = Array.isArray(node?.rich_text) ? node.rich_text : []
  const text = rich.map((t: any) => t?.plain_text ?? "").join("")
  if (!text) return ""
  switch (type) {
    case "heading_1": return `\n# ${text}`
    case "heading_2": return `\n## ${text}`
    case "heading_3": return `\n### ${text}`
    case "bulleted_list_item": return `- ${text}`
    case "numbered_list_item": return `1. ${text}`
    case "quote": return `> ${text}`
    case "code": return `\`\`\`\n${text}\n\`\`\``
    default: return text
  }
}

export async function fetchNotionPage(pageId: string): Promise<NotionPageContent | null> {
  const id = String(pageId ?? "").trim()
  if (!id) return null

  const meta = await notionFetch(`/pages/${encodeURIComponent(id)}`, { method: "GET" })
  if (!meta) return null

  // 블록 본문 (1페이지 100개)
  const blocksData = await notionFetch(
    `/blocks/${encodeURIComponent(id)}/children?page_size=100`,
    { method: "GET" },
  )
  const blocks = Array.isArray(blocksData?.results) ? blocksData.results : []
  const text = blocks.map(extractBlockText).filter(Boolean).join("\n").slice(0, 10_000)

  return {
    id: String(meta?.id ?? id),
    title: extractTitle(meta),
    url: String(meta?.url ?? ""),
    text,
  }
}

/** 사전 조사 파이프라인용 어댑터. */
export async function callNotion(query: string): Promise<string> {
  if (!getToken()) return "[Notion: NOTION_INTEGRATION_TOKEN 없음 — 비활성]"
  const hits = await searchNotion(query, 6)
  if (!hits) return "[Notion: 검색 실패]"
  if (hits.length === 0) return "[Notion: 결과 없음]"
  const lines = hits.map((h, i) => {
    const date = h.last_edited_time ? ` (${h.last_edited_time.slice(0, 10)})` : ""
    return `${i + 1}. **${h.title}**${date}\n   ${h.url}`
  })
  return `**Notion 검색 결과 (${hits.length}건)**\n${lines.join("\n")}`
}
