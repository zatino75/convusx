import fs from "node:fs"
import path from "node:path"

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

const DATA_DIR = path.resolve(process.cwd(), "server", "data")
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

  state.source_assets.push({
    ...asset,
    status: asset?.status ?? "draft",
    created_at: Number(asset?.created_at ?? Date.now()),
    updated_at: Number(asset?.updated_at ?? Date.now())
  })

  if (state.source_assets.length > 300) {
    state.source_assets.shift()
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

export function getLatestProjectContext(projectId: string) {
  const state = ensureProjectState(projectId)
  const entries = [...state.entries].sort((a, b) => Number(b?.timestamp ?? 0) - Number(a?.timestamp ?? 0))
  const latest = entries.length > 0 ? entries[0] : null

  const summaries = uniqueStrings(
    entries
      .map((entry) => normalizeText(entry?.summary))
      .filter(Boolean)
  ).slice(0, 5)

  const decisions = uniqueStrings(
    entries.flatMap((entry) => Array.isArray(entry?.decisions) ? entry.decisions : [])
  ).slice(0, 8)

  const facts = uniqueStrings(
    entries.flatMap((entry) => Array.isArray(entry?.facts) ? entry.facts : [])
  ).slice(0, 12)

  const sources = uniqueStrings(
    getConfirmedProjectSourceAssets(projectId)
      .map((asset) => normalizeText(asset?.content))
      .filter(Boolean)
  ).slice(0, 8)

  return {
    project_id: projectId,
    entry_count: entries.length,
    source_asset_count: state.source_assets.length,
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