import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

type ProjectSourceAsset = {
  id: string
  thread_id?: string | null
  type: "file" | "image" | "link" | "note" | "thread_summary"
  title?: string
  content?: string
  url?: string
  status?: "draft" | "confirmed"
  created_at?: number
  updated_at?: number
}

type ProjectMemoryEntry = {
  project_id: string
  thread_id: string
  timestamp?: number
  goal?: any
  task?: string
  winner_provider?: string | null
  claims?: Record<string, string[]>
  provider_health?: any
  provider_latency?: any
  scoreboard?: any[]
  output?: any
  summary?: string
  decisions?: string[]
  facts?: string[]
  open_questions?: string[]
  entities?: string[]
}

type ProjectMemoryState = {
  entries: ProjectMemoryEntry[]
  source_assets: ProjectSourceAsset[]
}

export type PastWinnerResult = {
  task: string
  winner_provider: string
  answer_text: string
  confidence: number
  timestamp: number
}

const DATA_DIR = path.resolve(__dirname, "../../../data")
const DATA_FILE = path.join(DATA_DIR, "project-memory.json")

const ProjectStore: Record<string, ProjectMemoryState> = loadStore()

function normalizeText(value: any): string {
  return String(value ?? "").trim()
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  for (const value of values ?? []) {
    const normalized = normalizeText(value)
    if (!normalized) continue

    const key = normalized.toLowerCase()
    if (seen.has(key)) continue

    seen.add(key)
    out.push(normalized)
  }

  return out
}

function sortAssets(list: ProjectSourceAsset[]) {
  return [...list].sort((a, b) => {
    const aStatus = String(a?.status ?? "draft")
    const bStatus = String(b?.status ?? "draft")

    if (aStatus !== bStatus) {
      return aStatus === "confirmed" ? -1 : 1
    }

    const aUpdated = Number(a?.updated_at ?? a?.created_at ?? 0)
    const bUpdated = Number(b?.updated_at ?? b?.created_at ?? 0)

    return bUpdated - aUpdated
  })
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function saveStore() {
  ensureDataDir()
  fs.writeFileSync(DATA_FILE, JSON.stringify(ProjectStore, null, 2), "utf-8")
}

function loadStore(): Record<string, ProjectMemoryState> {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return {}
    }

    const raw = fs.readFileSync(DATA_FILE, "utf-8")
    const parsed = JSON.parse(raw)

    if (!parsed || typeof parsed !== "object") {
      return {}
    }

    return parsed as Record<string, ProjectMemoryState>
  } catch {
    return {}
  }
}

function ensureProjectState(projectId: string): ProjectMemoryState {
  const safeProjectId = normalizeText(projectId) || "default"

  const state =
    ProjectStore[safeProjectId] ??
    {
      entries: [],
      source_assets: []
    }

  ProjectStore[safeProjectId] = state
  return state
}

export function findPastWinner(
  projectId: string,
  task: string,
  options?: { minCount?: number; windowMs?: number }
): PastWinnerResult | null {
  const minCount = options?.minCount ?? 2
  const windowMs = options?.windowMs ?? 7 * 24 * 60 * 60 * 1000

  const state = ensureProjectState(projectId)
  const now = Date.now()
  const cutoff = now - windowMs
  const normalizedTask = normalizeText(task).toLowerCase()

  const relevant = state.entries.filter((entry) => {
    const entryTask = normalizeText(entry?.task).toLowerCase()
    const ts = Number(entry?.timestamp ?? 0)
    return (
      entryTask === normalizedTask &&
      ts >= cutoff &&
      normalizeText(entry?.winner_provider).length > 0 &&
      normalizeText(entry?.output?.text ?? entry?.summary).length > 0
    )
  })

  if (relevant.length < minCount) return null

  const providerCount: Record<string, number> = {}
  for (const entry of relevant) {
    const provider = normalizeText(entry.winner_provider)
    if (!provider) continue
    providerCount[provider] = (providerCount[provider] ?? 0) + 1
  }

  const topProvider = Object.entries(providerCount).sort((a, b) => b[1] - a[1])[0]
  if (!topProvider) return null

  const [winnerProvider, winCount] = topProvider
  const confidence = Math.min(winCount / relevant.length, 1)

  const bestEntry = relevant
    .filter((e) => normalizeText(e.winner_provider) === winnerProvider)
    .sort((a, b) => Number(b?.timestamp ?? 0) - Number(a?.timestamp ?? 0))[0]

  const answerText = normalizeText(bestEntry?.output?.text ?? bestEntry?.summary)
  if (!answerText) return null

  return {
    task: normalizedTask,
    winner_provider: winnerProvider,
    answer_text: answerText,
    confidence,
    timestamp: Number(bestEntry?.timestamp ?? 0)
  }
}

export function appendProjectMemory(entry: ProjectMemoryEntry) {
  const projectId =
    entry?.project_id ??
    "default"

  const state = ensureProjectState(projectId)

  state.entries.push({
    ...entry,
    summary: normalizeText(entry?.summary),
    decisions: uniqueStrings(Array.isArray(entry?.decisions) ? entry.decisions : []),
    facts: uniqueStrings(Array.isArray(entry?.facts) ? entry.facts : []),
    open_questions: uniqueStrings(Array.isArray(entry?.open_questions) ? entry.open_questions : []),
    entities: uniqueStrings(Array.isArray(entry?.entities) ? entry.entities : []),
    timestamp: entry?.timestamp ?? Date.now()
  })

  if (state.entries.length > 200) {
    state.entries.shift()
  }

  saveStore()
}

export function getProjectMemory(projectId: string) {
  const state = ensureProjectState(projectId)
  return [...state.entries].sort((a, b) => Number(b?.timestamp ?? 0) - Number(a?.timestamp ?? 0))
}

export function addProjectSourceAsset(projectId: string, asset: ProjectSourceAsset) {
  const state = ensureProjectState(projectId)

  const normalized = {
    ...asset,
    status: asset?.status ?? "draft",
    created_at: Number(asset?.created_at ?? Date.now()),
    updated_at: Number(asset?.updated_at ?? Date.now())
  }

  // upsert: 동일 id가 있으면 교체 (push → 중복 방지)
  const existingIdx = state.source_assets.findIndex((item) => item.id === normalized.id)
  if (existingIdx !== -1) {
    state.source_assets[existingIdx] = { ...state.source_assets[existingIdx], ...normalized, updated_at: Date.now() }
  } else {
    state.source_assets.push(normalized)
    if (state.source_assets.length > 300) {
      state.source_assets.shift()
    }
  }

  saveStore()
}

export function updateProjectSourceAsset(
  projectId: string,
  assetId: string,
  patch: Partial<ProjectSourceAsset>
) {
  const state = ensureProjectState(projectId)
  const idx = state.source_assets.findIndex((item) => item.id === assetId)
  if (idx === -1) return

  state.source_assets[idx] = {
    ...state.source_assets[idx],
    ...patch,
    updated_at: Date.now()
  }

  saveStore()
}

export function removeProjectSourceAsset(projectId: string, assetId: string) {
  const state = ensureProjectState(projectId)
  state.source_assets = state.source_assets.filter((item) => item.id !== assetId)
  saveStore()
}

export function getProjectSourceAssets(projectId: string) {
  const state = ensureProjectState(projectId)
  return sortAssets(state.source_assets)
}

export function getConfirmedProjectSourceAssets(projectId: string) {
  return getProjectSourceAssets(projectId).filter((item) => String(item?.status ?? "") === "confirmed")
}

// ------- query-aware source asset retrieval -------

// 한국어 문자 바이그램 — 형태소 없이 한국어 매칭
function koreanBigrams(text: string): string[] {
  const korean = text.replace(/[^가-힣]/g, "")
  const bigrams: string[] = []
  for (let i = 0; i < korean.length - 1; i++) {
    bigrams.push(korean.slice(i, i + 2))
  }
  return bigrams
}

// 수정: 가-힣을 구분자에서 제거, 한국어 바이그램 추가
function tokenizeSource(text: string): Set<string> {
  const normalized = String(text ?? "").toLowerCase()
  const wordTokens = normalized
    .split(/[\s\.,!?;:()\[\]{}"'\/\\]+/)
    .map((t) => t.replace(/[^a-z0-9가-힣\-]/g, ""))
    .filter((t) => t.length >= 2)
  const bigrams = koreanBigrams(normalized)
  return new Set([...wordTokens, ...bigrams])
}

// Overlap Coefficient: 짧은 쿼리-긴 문서 매칭에 강건
function overlapSourceScore(query: Set<string>, doc: Set<string>): number {
  if (query.size === 0 || doc.size === 0) return 0
  let intersection = 0
  for (const token of query) {
    if (doc.has(token)) intersection++
  }
  return intersection / Math.min(query.size, doc.size)
}

// 긴 소스: 앞 1000자 + 뒤 500자 혼합 스코어링 (중간 내용 손실 완화)
function scoreSourceContent(queryTokens: Set<string>, content: string): number {
  const head = content.slice(0, 1000)
  const tail = content.length > 1000 ? content.slice(-500) : ""
  const headScore = overlapSourceScore(queryTokens, tokenizeSource(head))
  const tailScore = tail ? overlapSourceScore(queryTokens, tokenizeSource(tail)) * 0.7 : 0
  return Math.max(headScore, tailScore)
}

export function findRelevantSourceAssets(
  projectId: string,
  query: string,
  options?: { threshold?: number; limit?: number; includeAll?: boolean }
) {
  const threshold = options?.threshold ?? 0.12
  const limit = options?.limit ?? 6
  const includeAll = options?.includeAll ?? false

  const queryTokens = tokenizeSource(query)

  // query가 너무 짧거나 빈값이면 confirmed 전체 반환
  if (queryTokens.size < 2) {
    return getConfirmedProjectSourceAssets(projectId).slice(0, limit)
  }

  const assets = includeAll
    ? getProjectSourceAssets(projectId)
    : getConfirmedProjectSourceAssets(projectId)

  const scored = assets.map((asset) => {
    // 제목: 가중치 1.8 (핵심 키워드 집약)
    const titleScore = overlapSourceScore(queryTokens, tokenizeSource(asset.title ?? "")) * 1.8
    // 내용: 앞+뒤 혼합 스코어링
    const contentScore = scoreSourceContent(queryTokens, asset.content ?? "")
    return { asset, score: Math.max(titleScore, contentScore) }
  })

  const filtered = scored.filter(({ score }) => score >= threshold)

  if (filtered.length === 0) {
    // 관련 소스가 없으면 confirmed 중 최신 3개만 fallback
    return getConfirmedProjectSourceAssets(projectId).slice(0, 3)
  }

  return filtered
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.asset)
}

// ------- getLatestProjectContext (query-aware 버전) -------

export function getLatestProjectContext(projectId: string, query?: string) {
  const state = ensureProjectState(projectId)
  const entries = [...state.entries].sort((a, b) => Number(b?.timestamp ?? 0) - Number(a?.timestamp ?? 0))
  const latest = entries.length > 0 ? entries[0] : null

  const hasQuery = query && query.trim().length >= 10
  const queryTokens = hasQuery ? tokenizeSource(query!) : null

  // query 있을 때: 관련도 높은 entry의 summary 우선, 없으면 최신 순
  const summaries = hasQuery && queryTokens
    ? uniqueStrings(
        entries
          .map((entry) => {
            const text = normalizeText(entry?.summary)
            if (!text) return null
            const score = overlapSourceScore(queryTokens!, tokenizeSource(text))
            return { text, score }
          })
          .filter(Boolean)
          .sort((a, b) => (b as any).score - (a as any).score)
          .map((item) => (item as any).text)
      ).slice(0, 4)
    : uniqueStrings(
        entries.map((entry) => normalizeText(entry?.summary)).filter(Boolean)
      ).slice(0, 4)

  // decisions/facts: 최신 20개 entry에서 집계 (너무 오래된 것 제외)
  const recentEntries = entries.slice(0, 20)

  const decisions = uniqueStrings(
    recentEntries.flatMap((entry) => Array.isArray(entry?.decisions) ? entry.decisions : [])
  ).slice(0, 4)

  // facts: query가 있을 때 관련성 높은 것만, 없으면 최신 5개
  const allFacts = uniqueStrings(
    recentEntries.flatMap((entry) => Array.isArray(entry?.facts) ? entry.facts : [])
  )

  const facts = hasQuery && queryTokens
    ? uniqueStrings(
        allFacts
          .map((f) => ({ text: f, score: overlapSourceScore(queryTokens!, tokenizeSource(f)) }))
          .filter((item) => item.score > 0.05)  // 최소 관련성 threshold
          .sort((a, b) => b.score - a.score)
          .map((item) => item.text)
      ).slice(0, 5)
    : allFacts.slice(0, 5)

  // query가 있으면 관련성 높은 소스만, 없으면 confirmed 전체
  const relevantAssets = hasQuery
    ? findRelevantSourceAssets(projectId, query!)
    : getConfirmedProjectSourceAssets(projectId)

  // 소스 내용: 각 asset에서 핵심 부분만 추출 (1200자 캡)
  const sources = uniqueStrings(
    relevantAssets
      .map((asset) => {
        const content = normalizeText(asset?.content)
        if (!content) return null
        // 긴 소스: 앞 800자 + 뒤 400자 합산 (중간 손실 완화)
        if (content.length > 1200) {
          return content.slice(0, 800).trim() + "\n…\n" + content.slice(-400).trim()
        }
        return content
      })
      .filter(Boolean) as string[]
  ).slice(0, 6)

  return {
    project_id: projectId,
    entry_count: entries.length,
    source_asset_count: state.source_assets.length,
    matched_source_count: relevantAssets.length,
    latest_goal: latest?.goal ?? null,
    latest_task: latest?.task ?? null,
    latest_winner_provider: latest?.winner_provider ?? null,
    latest_scoreboard: latest?.scoreboard ?? [],
    latest_provider_health: latest?.provider_health ?? {},
    latest_provider_latency: latest?.provider_latency ?? {},
    latest_claims: latest?.claims ?? {},
    latest_output: latest?.output ?? null,
    retrieval_context: {
      summary: summaries,
      decisions,
      facts,
      sources
    }
  }
}

export function clearAllProjectMemory() {
  for (const key of Object.keys(ProjectStore)) {
    delete ProjectStore[key]
  }
  saveStore()
}
