/**
 * naverNews.ts — 네이버 뉴스 검색 API 커넥터
 *
 * 환경변수: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
 * 미설정 시 빈 배열/안내 문자열 반환 (서비스 중단 방지).
 *
 * - searchNaverNews(query, display?) → 뉴스 항목 배열
 * - callNaverNews(query) → DepartmentAgent 사전조사 어댑터 (markdown)
 *
 * 30분 메모리 캐시.
 */

const ENDPOINT = "https://openapi.naver.com/v1/search/news.json"
const CACHE_TTL_MS = 30 * 60 * 1000
const FETCH_TIMEOUT_MS = 10_000

export interface NaverNewsItem {
  title: string
  link: string
  pubDate: string
  description: string
}

interface CacheEntry {
  fetchedAt: number
  items: NaverNewsItem[]
}

const cache = new Map<string, CacheEntry>()

function getCreds(): { id: string; secret: string } | null {
  const id = String(process.env.NAVER_CLIENT_ID ?? "").trim()
  const secret = String(process.env.NAVER_CLIENT_SECRET ?? "").trim()
  if (!id || !secret) return null
  return { id, secret }
}

function stripTags(s: string): string {
  return String(s ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim()
}

export async function searchNaverNews(query: string, display = 10): Promise<NaverNewsItem[]> {
  const creds = getCreds()
  if (!creds) return []
  const q = String(query ?? "").trim()
  if (!q) return []

  const cacheKey = `${q}::${display}`
  const cached = cache.get(cacheKey)
  const now = Date.now()
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.items
  }

  try {
    const url = `${ENDPOINT}?query=${encodeURIComponent(q)}&display=${display}&sort=date`
    const res = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": creds.id,
        "X-Naver-Client-Secret": creds.secret,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return cached?.items ?? []
    const data: any = await res.json()
    const items: NaverNewsItem[] = (Array.isArray(data?.items) ? data.items : []).map((it: any) => ({
      title: stripTags(it?.title),
      link: String(it?.originallink || it?.link || "").trim(),
      pubDate: String(it?.pubDate ?? "").trim(),
      description: stripTags(it?.description),
    }))
    cache.set(cacheKey, { fetchedAt: now, items })
    return items
  } catch {
    return cached?.items ?? []
  }
}

export async function callNaverNews(query: string): Promise<string> {
  if (!getCreds()) return "[NaverNews: NAVER_CLIENT_ID/SECRET 없음 — 비활성]"
  const items = await searchNaverNews(query, 8)
  if (items.length === 0) return "[NaverNews: 결과 없음]"
  const lines = items.map((it, i) => {
    const date = it.pubDate ? ` (${it.pubDate})` : ""
    const desc = it.description ? `\n   ${it.description.slice(0, 200)}` : ""
    return `${i + 1}. **${it.title}**${date}\n   ${it.link}${desc}`
  })
  return `**네이버 뉴스 (${items.length}건)**\n${lines.join("\n")}`
}
