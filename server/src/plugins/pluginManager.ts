/**
 * pluginManager.ts
 * 플러그인 훅 시스템 + 디렉터 커넥터 상태 관리를 함께 제공하는 통합 매니저
 */

// ── Chat Hook Plugin System ──────────────────────────────────────────────────

export type HookName = "beforeChat" | "afterChat" | "onError"

export type HookContext = {
  data: Record<string, any>
  abort?: boolean
  abortReason?: string
}

export type HookHandler = (context: HookContext) => HookContext | Promise<HookContext>

export type PluginManifest = {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  hooks: HookName[]
}

type PluginEntry = {
  manifest: PluginManifest
  handlers: Partial<Record<HookName, HookHandler>>
  active: boolean
  registered_at: number
}

const pluginStore = new Map<string, PluginEntry>()

export function registerPlugin(
  manifest: PluginManifest,
  handlers: Partial<Record<HookName, HookHandler>> = {},
): boolean {
  if (!manifest?.id) return false
  pluginStore.set(manifest.id, {
    manifest,
    handlers,
    active: false,
    registered_at: Date.now(),
  })
  return true
}

export function unregisterPlugin(id: string): boolean {
  return pluginStore.delete(id)
}

export function activatePlugin(id: string): boolean {
  const entry = pluginStore.get(id)
  if (!entry) return false
  entry.active = true
  return true
}

export function deactivatePlugin(id: string): boolean {
  const entry = pluginStore.get(id)
  if (!entry) return false
  entry.active = false
  return true
}

export function getPluginList() {
  return [...pluginStore.values()].map((entry) => ({
    ...entry.manifest,
    active: entry.active,
    registered_at: entry.registered_at,
  }))
}

export async function executeHook(
  hook: HookName,
  data: Record<string, any> = {},
): Promise<HookContext> {
  let context: HookContext = { data }
  for (const entry of pluginStore.values()) {
    if (!entry.active) continue
    if (!entry.manifest.hooks.includes(hook)) continue
    const handler = entry.handlers[hook]
    if (!handler) continue
    context = await handler(context)
    if (context?.abort) break
  }
  return context
}

export async function initPlugins(): Promise<void> {
  // 현재는 인메모리 플러그인만 사용. 외부 로더 추가 시 여기서 초기화.
}

export async function shutdownPlugins(): Promise<void> {
  // 서버 종료 시 플러그인 상태 초기화.
  pluginStore.clear()
}

// ── Director Connector Registry ──────────────────────────────────────────────

export type ConnectorId =
  | "tavily" | "perplexity" | "posthog" | "supabase"
  | "canva" | "cloudinary" | "figma"
  | "notion" | "slack" | "gmail" | "gcal" | "gdrive"
  | "asana" | "linear" | "fireflies"
  | "pubmed" | "drug_db" | "clinical_trials" | "huggingface"
  | "gamma" | "semantic_search"
  | "claude_in_chrome" | "computer_use"

export interface ConnectorMeta {
  id: ConnectorId
  name: string
  category: "search" | "analytics" | "storage" | "design" | "productivity" | "research" | "ai" | "automation"
  description: string
  isPaid: boolean
  isNativeToModel?: string
  envKey?: string
}

export interface ConnectorStatus {
  id: ConnectorId
  available: boolean
  authenticated: boolean
  error?: string
  lastChecked: Date
}

export const CONNECTOR_REGISTRY: Record<ConnectorId, ConnectorMeta> = {
  tavily:          { id: "tavily",          name: "Tavily Search",        category: "search",       description: "실시간 웹 검색 + 심층 리서치",                    isPaid: false, envKey: "TAVILY_API_KEY" },
  perplexity:      { id: "perplexity",      name: "Perplexity sonar-pro", category: "search",       description: "AI 기반 실시간 웹 검색 + 출처 인용",              isPaid: false, envKey: "PERPLEXITY_API_KEY" },
  posthog:         { id: "posthog",         name: "PostHog Analytics",    category: "analytics",    description: "제품 분석 / 사용자 행동 데이터",                   isPaid: false, envKey: "POSTHOG_API_KEY" },
  supabase:        { id: "supabase",        name: "Supabase DB",          category: "storage",      description: "프로젝트 데이터 영구 저장 + 실시간 쿼리",          isPaid: false, envKey: "SUPABASE_URL" },
  canva:           { id: "canva",           name: "Canva Design",         category: "design",       description: "마케팅 자료 / 브랜드 이미지 / SNS 콘텐츠 생성",    isPaid: false, isNativeToModel: "gpt" },
  cloudinary:      { id: "cloudinary",      name: "Cloudinary",           category: "storage",      description: "이미지/영상 업로드 + CDN + 자동 최적화",           isPaid: false, envKey: "CLOUDINARY_URL" },
  figma:           { id: "figma",           name: "Figma",                category: "design",       description: "UI/UX 디자인 조회 + 에셋 추출",                   isPaid: false, envKey: "FIGMA_API_KEY" },
  notion:          { id: "notion",          name: "Notion",               category: "productivity", description: "보고서 자동 저장 / 지식베이스 조회",               isPaid: false },
  slack:           { id: "slack",           name: "Slack",                category: "productivity", description: "팀 메시지 발송 / 채널 모니터링 (Claude 공식 파트너)", isPaid: false, isNativeToModel: "claude" },
  gmail:           { id: "gmail",           name: "Gmail",                category: "productivity", description: "이메일 조회 / 드래프트 작성",                     isPaid: false },
  gcal:            { id: "gcal",            name: "Google Calendar",      category: "productivity", description: "일정 관리 / 미팅 예약 (Gemini 네이티브)",          isPaid: false, isNativeToModel: "gemini" },
  gdrive:          { id: "gdrive",          name: "Google Drive",         category: "storage",      description: "문서 저장 / 공유 (Gemini 네이티브 연동)",          isPaid: false, isNativeToModel: "gemini" },
  asana:           { id: "asana",           name: "Asana",                category: "productivity", description: "프로젝트 태스크 관리 / 진행상황 트래킹",           isPaid: false },
  linear:          { id: "linear",          name: "Linear",               category: "productivity", description: "개발 이슈 트래킹 / 스프린트 관리",                 isPaid: false },
  fireflies:       { id: "fireflies",       name: "Fireflies.ai",         category: "ai",           description: "미팅 녹취 + AI 요약 + 액션 아이템 추출",          isPaid: false },
  pubmed:          { id: "pubmed",          name: "PubMed",               category: "research",     description: "의학/생명과학 논문 검색 + 성분 안전성 연구",       isPaid: false },
  drug_db:         { id: "drug_db",         name: "Drug/Compound DB",     category: "research",     description: "화합물 / 약물 / 성분 데이터베이스 검색",           isPaid: false },
  clinical_trials: { id: "clinical_trials", name: "ClinicalTrials.gov",   category: "research",     description: "임상시험 데이터 / 연구 현황 조회",                 isPaid: false },
  huggingface:     { id: "huggingface",     name: "Hugging Face",         category: "ai",           description: "AI 모델 / 데이터셋 검색 + 논문 조회",             isPaid: false },
  gamma:           { id: "gamma",           name: "Gamma",                category: "productivity", description: "AI 프레젠테이션 자동 생성",                       isPaid: false },
  semantic_search: { id: "semantic_search", name: "Semantic Search",      category: "search",       description: "의미 기반 벡터 검색 (프로젝트 내부 지식베이스)",   isPaid: false },
  claude_in_chrome:{ id: "claude_in_chrome",name: "Claude in Chrome",    category: "automation",   description: "브라우저 자동화 / 웹 스크래핑 / 폼 입력",          isPaid: false },
  computer_use:    { id: "computer_use",    name: "Computer Use",         category: "automation",   description: "데스크탑 앱 자동화 / 스크린샷 분석",               isPaid: false },
}

class ConnectorManager {
  private statusCache = new Map<ConnectorId, ConnectorStatus>()
  private checkInterval = 5 * 60 * 1000

  async checkAll(): Promise<Map<ConnectorId, ConnectorStatus>> {
    const ids = Object.keys(CONNECTOR_REGISTRY) as ConnectorId[]
    await Promise.allSettled(ids.map((id) => this.checkConnector(id)))
    return this.statusCache
  }

  async checkConnector(id: ConnectorId): Promise<ConnectorStatus> {
    const cached = this.statusCache.get(id)
    if (cached && Date.now() - cached.lastChecked.getTime() < this.checkInterval) {
      return cached
    }

    const meta = CONNECTOR_REGISTRY[id]
    let available = false
    let authenticated = false
    let error: string | undefined

    try {
      if (meta.envKey) {
        const envVal = process.env[meta.envKey]
        authenticated = !!(envVal && envVal.length > 5)
        available = authenticated
      } else {
        available = true
        authenticated = true
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "확인 실패"
    }

    const status: ConnectorStatus = { id, available, authenticated, error, lastChecked: new Date() }
    this.statusCache.set(id, status)
    return status
  }

  async getSummary() {
    await this.checkAll()
    return Object.values(CONNECTOR_REGISTRY).map((meta) => ({
      ...meta,
      status: this.statusCache.get(meta.id) ?? { id: meta.id, available: false, authenticated: false, lastChecked: new Date() },
    }))
  }

  setConnected(id: ConnectorId, connected: boolean) {
    this.statusCache.set(id, {
      id,
      available: connected,
      authenticated: connected,
      lastChecked: new Date(),
    })
  }

  getRecommendedForDept(deptId: string): ConnectorId[] {
    const map: Record<string, ConnectorId[]> = {
      market: ["tavily", "perplexity", "posthog", "semantic_search"],
      compete: ["tavily", "perplexity", "semantic_search"],
      legal: ["tavily", "perplexity", "semantic_search"],
      finance: ["tavily", "perplexity", "supabase"],
      marketing: ["canva", "figma", "slack", "semantic_search"],
      rnd: ["pubmed", "drug_db", "clinical_trials", "huggingface", "tavily"],
      data: ["posthog", "supabase", "semantic_search"],
      content: ["canva", "cloudinary", "figma", "gamma"],
      sns: ["canva", "cloudinary", "slack"],
    }
    return map[deptId] ?? ["tavily", "perplexity"]
  }
}

export const pluginManager = new ConnectorManager()
