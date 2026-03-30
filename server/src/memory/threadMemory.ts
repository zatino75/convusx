import fs from "node:fs"
import path from "node:path"

type ThreadMessage = {
  id: string
  role: string
  content: string
  created_at: number
}

type ThreadStructured = {
  summary?: string
  decisions?: string[]
  facts?: string[]
  open_questions?: string[]
  entities?: string[]
  updated_at?: number
}

type ThreadMemoryEntry = {
  thread_id: string
  project_id: string
  title?: string | null
  messages: ThreadMessage[]
  structured?: ThreadStructured
  retrieval_preview?: any
}

type ThreadStoreType = Record<string, ThreadMemoryEntry>

export type SimilarQueryResult = {
  thread_id: string
  score: number
  matched_query: string
  matched_answer: string
  winner_provider: string | null
  updated_at: number
}

const DATA_DIR = path.resolve(process.cwd(), "server", "data")
const DATA_FILE = path.join(DATA_DIR, "thread-memory.json")

const ThreadStore: ThreadStoreType = loadStore()

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

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function saveStore() {
  ensureDataDir()
  fs.writeFileSync(DATA_FILE, JSON.stringify(ThreadStore, null, 2), "utf-8")
}

function loadStore(): ThreadStoreType {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return {}
    }

    const raw = fs.readFileSync(DATA_FILE, "utf-8")
    const parsed = JSON.parse(raw)

    if (!parsed || typeof parsed !== "object") {
      return {}
    }

    return parsed as ThreadStoreType
  } catch {
    return {}
  }
}

function tokenize(text: string): Set<string> {
  return new Set(
    normalizeText(text)
      .toLowerCase()
      .split(/[\s\.,!?;:()\[\]{}"']+/)
      .map((t) => t.replace(/[^a-z0-9가-힣]/g, ""))
      .filter((t) => t.length >= 2)
  )
}

function jaccardScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) {
    if (b.has(token)) intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

export function findSimilarQuery(
  query: string,
  projectId: string,
  options?: { threshold?: number; limit?: number }
): SimilarQueryResult[] {
  const threshold = options?.threshold ?? 0.25
  const limit = options?.limit ?? 5

  const queryTokens = tokenize(query)
  if (queryTokens.size === 0) return []

  const projectEntries = Object.values(ThreadStore).filter(
    (entry) => entry.project_id === projectId
  )

  const results: SimilarQueryResult[] = []
  const seen = new Set<string>()

  for (const entry of projectEntries) {
    const userMessages = entry.messages.filter((m) => m.role === "user")
    const assistantMessages = entry.messages.filter((m) => m.role === "assistant")

    // 스레드 제목도 매칭 대상에 포함
    const titleTokens = entry.title ? tokenize(entry.title) : new Set<string>()
    const titleScore = titleTokens.size > 0 ? jaccardScore(queryTokens, titleTokens) * 0.7 : 0

    for (let i = 0; i < userMessages.length; i++) {
      const userMsg = userMessages[i]
      const msgScore = jaccardScore(queryTokens, tokenize(userMsg.content))
      
      // structured summary도 점수에 반영
      const summaryScore = entry.structured?.summary
        ? jaccardScore(queryTokens, tokenize(entry.structured.summary)) * 0.5
        : 0

      const score = Math.max(msgScore, titleScore, summaryScore)

      if (score < threshold) continue

      const matchedAnswer =
        assistantMessages[i]?.content ||
        normalizeText(entry.structured?.summary) ||
        ""

      if (!matchedAnswer) continue

      // 같은 스레드에서 중복 제거 (가장 높은 점수만)
      const key = `${entry.thread_id}:${i}`
      if (seen.has(key)) continue
      seen.add(key)

      results.push({
        thread_id: entry.thread_id,
        score,
        matched_query: userMsg.content,
        matched_answer: matchedAnswer,
        winner_provider: null,
        updated_at: Number(entry.structured?.updated_at ?? 0)
      })
    }
  }

  return results
    .sort((a, b) => b.score - a.score || b.updated_at - a.updated_at)
    .slice(0, limit)
}

export function upsertThreadMemory(entry: ThreadMemoryEntry) {
  const threadId = normalizeText(entry?.thread_id)
  const projectId = normalizeText(entry?.project_id)

  if (!threadId || !projectId) return

  const existing = ThreadStore[threadId]

  const structured: ThreadStructured = {
    summary: normalizeText(entry?.structured?.summary),
    decisions: uniqueStrings(entry?.structured?.decisions ?? []),
    facts: uniqueStrings(entry?.structured?.facts ?? []),
    open_questions: uniqueStrings(entry?.structured?.open_questions ?? []),
    entities: uniqueStrings(entry?.structured?.entities ?? []),
    updated_at: Date.now()
  }

  ThreadStore[threadId] = {
    thread_id: threadId,
    project_id: projectId,
    title: entry?.title ?? existing?.title ?? null,
    messages: Array.isArray(entry?.messages) ? entry.messages : existing?.messages ?? [],
    structured,
    retrieval_preview: entry?.retrieval_preview ?? existing?.retrieval_preview ?? null
  }

  saveStore()
}

export function getThreadMemory(threadId: string) {
  const safeId = normalizeText(threadId)
  if (!safeId) return null
  return ThreadStore[safeId] ?? null
}

export function getProjectThreadMemories(projectId: string) {
  const safeProjectId = normalizeText(projectId)

  return Object.values(ThreadStore)
    .filter((entry) => entry.project_id === safeProjectId)
    .sort((a, b) => {
      const aTime = Number(a?.structured?.updated_at ?? 0)
      const bTime = Number(b?.structured?.updated_at ?? 0)
      return bTime - aTime
    })
}

export function getThreadMessages(threadId: string): ThreadMessage[] {
  const entry = getThreadMemory(threadId)
  return Array.isArray(entry?.messages) ? entry.messages : []
}