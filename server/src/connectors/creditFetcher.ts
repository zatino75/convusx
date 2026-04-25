/**
 * creditFetcher.ts — 프로바이더 잔액 실시간 조회 (billing endpoints).
 *
 * 2026-04-25 신규.
 *
 * ⚠️ 절대 LLM API 를 호출하지 않는다 (CLAUDE.md 규칙 #21).
 * 오직 billing/balance 엔드포인트만 사용 → 토큰 비용 발생 없음.
 *
 * 캐시: provider 별 5분 TTL. 강제 재조회는 refresh() 사용.
 *
 * 반환:
 *   number  — USD 잔액
 *   null    — 조회 불가 (API 미지원 / 키 없음 / 에러)
 *   에러는 throw 하지 않고 null 반환 → UI 가 fallback 표시.
 */

import { logger } from "../observability/logger.js"
import { PROVIDER_IDS, type ProviderId } from "../creditStore.js"

interface CacheEntry {
  balance: number | null
  fetchedAt: number
}

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<ProviderId, CacheEntry>()

/** 각 provider 의 결제/충전 페이지 URL. UI "충전하러가기" 버튼이 새 탭으로 오픈. */
export const TOPUP_URLS: Record<ProviderId, string> = {
  anthropic: "https://console.anthropic.com/settings/billing",
  openai: "https://platform.openai.com/settings/organization/billing/overview",
  google: "https://aistudio.google.com/app/apikey",
  deepseek: "https://platform.deepseek.com/top_up",
  perplexity: "https://www.perplexity.ai/settings/api",
  fal: "https://fal.ai/dashboard/billing",
}

/** 어떤 provider 가 잔액 API 를 지원하는가. UI 라벨/새로고침 버튼 표시 분기.
 * 2026-04-25 정밀 조정:
 *  - OpenAI: /credit_grants 는 deprecated, /usage 는 잔액 아님 → 수동
 *  - fal.ai: 공식 잔액 endpoint 미공개 → 수동
 *  - DeepSeek 만 자동 조회 유지. */
export const API_SUPPORTED: Record<ProviderId, boolean> = {
  anthropic: false,    // Admin API 부재
  openai: false,       // 잔액 조회 공식 API 미제공 (credit_grants deprecated)
  google: false,       // Cloud Billing API 복잡 — 수동
  deepseek: true,      // /user/balance 정상 동작
  perplexity: false,   // 잔액 API 없음
  fal: false,          // 공식 잔액 endpoint 미공개
}

// ── 개별 fetcher ──────────────────────────────────────────────────

async function fetchAnthropicBalance(): Promise<number | null> {
  // Anthropic Admin API 는 organization-level 만 가능 + 별도 admin key 필요. 수동만 지원.
  return null
}

async function fetchOpenAIBalance(): Promise<number | null> {
  const key = process.env.OPENAI_API_KEY?.trim()
  if (!key) return null
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10000)
    const r = await fetch("https://api.openai.com/v1/dashboard/billing/credit_grants", {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer))
    if (!r.ok) {
      // 401/403 → 권한 부족, 404 → endpoint 폐지. 모두 null.
      return null
    }
    const j: any = await r.json()
    // OpenAI 응답 스펙: { total_granted, total_used, total_available, grants: [...] }
    const available = Number(j?.total_available)
    if (Number.isFinite(available)) return +available.toFixed(2)
    return null
  } catch {
    return null
  }
}

async function fetchGeminiBalance(): Promise<number | null> {
  // Cloud Billing API 는 service account + billing account ID 필요. 수동만 지원.
  return null
}

async function fetchDeepSeekBalance(): Promise<number | null> {
  const key = process.env.DEEPSEEK_API_KEY?.trim()
  if (!key) return null
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10000)
    const r = await fetch("https://api.deepseek.com/user/balance", {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer))
    if (!r.ok) return null
    const j: any = await r.json()
    // 응답: { is_available, balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }
    const infos = Array.isArray(j?.balance_infos) ? j.balance_infos : []
    if (infos.length === 0) return null
    // USD 우선, 없으면 첫 항목.
    const usd = infos.find((b: any) => String(b?.currency).toUpperCase() === "USD") || infos[0]
    const total = Number(usd?.total_balance)
    if (!Number.isFinite(total)) return null
    // CNY 인 경우 단순 환산 (USD 1 ≈ CNY 7.2). 정확도보다 표시 일관성 우선.
    if (String(usd?.currency).toUpperCase() === "CNY") return +(total / 7.2).toFixed(2)
    return +total.toFixed(2)
  } catch {
    return null
  }
}

async function fetchPerplexityBalance(): Promise<number | null> {
  // Perplexity 는 잔액 조회 API 미공개. 수동만.
  return null
}

async function fetchFalBalance(): Promise<number | null> {
  const key = process.env.FAL_API_KEY?.trim() || process.env.FAL_KEY?.trim()
  if (!key) return null
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10000)
    const r = await fetch("https://rest.alpha.fal.ai/billing/user/balance", {
      method: "GET",
      headers: { Authorization: `Key ${key}` },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer))
    if (!r.ok) return null
    const j: any = await r.json()
    // 응답 키 후보: balance, current_balance, user_balance
    const cand = [j?.balance, j?.current_balance, j?.user_balance]
      .map(v => Number(v))
      .find(v => Number.isFinite(v))
    if (cand === undefined) return null
    return +cand.toFixed(2)
  } catch {
    return null
  }
}

const FETCHERS: Record<ProviderId, () => Promise<number | null>> = {
  anthropic: fetchAnthropicBalance,
  openai: fetchOpenAIBalance,
  google: fetchGeminiBalance,
  deepseek: fetchDeepSeekBalance,
  perplexity: fetchPerplexityBalance,
  fal: fetchFalBalance,
}

// ── 캐시 + 공개 API ──────────────────────────────────────────────

export interface FetchResult {
  provider: ProviderId
  apiBalance: number | null
  apiSupported: boolean
  fetchedAt: string | null     // ISO. null 이면 한 번도 시도 안 함.
  cached: boolean              // true 면 캐시 hit (5분 내).
}

function isCacheFresh(c: CacheEntry | undefined): c is CacheEntry {
  return !!c && Date.now() - c.fetchedAt < CACHE_TTL_MS
}

async function fetchOne(provider: ProviderId, force = false): Promise<FetchResult> {
  const apiSupported = API_SUPPORTED[provider]
  if (!apiSupported) {
    return { provider, apiBalance: null, apiSupported: false, fetchedAt: null, cached: false }
  }
  const cached = cache.get(provider)
  if (!force && isCacheFresh(cached)) {
    return {
      provider,
      apiBalance: cached.balance,
      apiSupported: true,
      fetchedAt: new Date(cached.fetchedAt).toISOString(),
      cached: true,
    }
  }
  const balance = await FETCHERS[provider]().catch(() => null)
  const fetchedAt = Date.now()
  cache.set(provider, { balance, fetchedAt })
  return {
    provider,
    apiBalance: balance,
    apiSupported: true,
    fetchedAt: new Date(fetchedAt).toISOString(),
    cached: false,
  }
}

/** 모든 provider 잔액을 병렬 조회 (캐시 우선). */
export async function fetchAllBalances(force = false): Promise<Record<ProviderId, FetchResult>> {
  const results = await Promise.all(PROVIDER_IDS.map(p => fetchOne(p, force)))
  const out = {} as Record<ProviderId, FetchResult>
  for (const r of results) out[r.provider] = r
  return out
}

/** 특정 provider 만 강제 재조회. UI 새로고침 아이콘에서 사용. */
export async function refreshOne(provider: string): Promise<FetchResult> {
  const p = String(provider || "").toLowerCase() as ProviderId
  if (!(PROVIDER_IDS as readonly string[]).includes(p)) {
    throw new Error(`unknown provider: ${provider}`)
  }
  return fetchOne(p, true)
}

/** 5분 스케줄러용. API 가능한 것만 백그라운드 갱신. 결과는 무시 (캐시 채우기). */
export async function backgroundRefresh(): Promise<void> {
  const supported = PROVIDER_IDS.filter(p => API_SUPPORTED[p])
  await Promise.all(supported.map(p =>
    fetchOne(p, true).catch(e => {
      logger.warn("[creditFetcher] background refresh failed", {
        provider: p, error: String(e?.message ?? e),
      })
      return null
    }),
  ))
}

/** 캐시만 조회 (네트워크 호출 없음). 디버그용. */
export function getCachedBalance(provider: string): number | null {
  const c = cache.get(String(provider || "").toLowerCase() as ProviderId)
  return c?.balance ?? null
}
