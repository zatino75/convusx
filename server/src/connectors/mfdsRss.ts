/**
 * mfdsRss.ts — 식품의약품안전처 (MFDS) 공개 RSS 피드 커넥터
 *
 * API 키 불필요. 카테고리별 RSS URL 에서 최신 공지/안전 정보를 가져온다.
 * - fetchMfdsNews(category, limit?) → 구조화된 NewsItem[] 반환
 * - callMfdsRss(query) → DepartmentAgent 사전조사 파이프라인용 markdown 문자열
 *
 * 1시간 TTL 메모리 캐시. 에러 시 빈 배열/빈 문자열 반환 (서비스 중단 방지).
 */

export type MfdsCategory = "food" | "drug" | "cosmetic"

export interface MfdsNewsItem {
  title: string
  link: string
  pubDate: string
  description: string
}

const MFDS_RSS_URLS: Record<MfdsCategory, string> = {
  food:     "https://www.mfds.go.kr/bbs/rss.do?bbsNo=166",
  drug:     "https://www.mfds.go.kr/bbs/rss.do?bbsNo=227",
  cosmetic: "https://www.mfds.go.kr/bbs/rss.do?bbsNo=229",
}

const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour
const FETCH_TIMEOUT_MS = 10_000

interface CacheEntry {
  fetchedAt: number
  items: MfdsNewsItem[]
}

const cache = new Map<MfdsCategory, CacheEntry>()

function decodeEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim()
}

function extractTag(item: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i")
  const m = item.match(re)
  return m ? decodeEntities(m[1]) : ""
}

function parseRssItems(xml: string): MfdsNewsItem[] {
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi
  const items: MfdsNewsItem[] = []
  let match: RegExpExecArray | null
  while ((match = itemRe.exec(xml)) !== null) {
    const body = match[1]
    items.push({
      title: extractTag(body, "title"),
      link: extractTag(body, "link"),
      pubDate: extractTag(body, "pubDate"),
      description: extractTag(body, "description"),
    })
  }
  return items
}

export async function fetchMfdsNews(
  category: MfdsCategory,
  limit = 10,
): Promise<MfdsNewsItem[]> {
  const url = MFDS_RSS_URLS[category]
  if (!url) return []

  const cached = cache.get(category)
  const now = Date.now()
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.items.slice(0, limit)
  }

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "CorvusX/1.0 (+regulation-monitor)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return cached?.items.slice(0, limit) ?? []
    const xml = await res.text()
    const items = parseRssItems(xml)
    cache.set(category, { fetchedAt: now, items })
    return items.slice(0, limit)
  } catch {
    return cached?.items.slice(0, limit) ?? []
  }
}

/**
 * 사전 조사 파이프라인용 어댑터.
 * query 에 'food'/'drug'/'cosmetic' 키워드가 있으면 해당 카테고리, 없으면 food 기본.
 */
export async function callMfdsRss(query: string): Promise<string> {
  const q = String(query ?? "").toLowerCase()
  let category: MfdsCategory = "food"
  if (q.includes("의약") || q.includes("drug") || q.includes("약품")) category = "drug"
  else if (q.includes("화장품") || q.includes("cosmetic")) category = "cosmetic"

  const items = await fetchMfdsNews(category, 8)
  if (items.length === 0) return `[MFDS RSS (${category}): 결과 없음]`

  const lines = items.map((item, i) => {
    const date = item.pubDate ? ` (${item.pubDate})` : ""
    const desc = item.description ? `\n   ${item.description.slice(0, 200)}` : ""
    return `${i + 1}. **${item.title}**${date}\n   ${item.link}${desc}`
  })
  return `**식약처 ${category} 공지 (${items.length}건)**\n${lines.join("\n")}`
}
