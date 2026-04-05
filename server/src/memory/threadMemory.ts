import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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
  winner_provider?: string | null  // judge가 선택한 최종 provider
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

const DATA_DIR = path.resolve(__dirname, "../../../data")
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

// 한국어 문자 바이그램 — 형태소 없이 변형어 매칭 (분석해줘 ≈ 분석)
function koreanCharBigrams(text: string): string[] {
  const korean = text.replace(/[^가-힣]/g, "")
  const bigrams: string[] = []
  for (let i = 0; i < korean.length - 1; i++) {
    bigrams.push(korean.slice(i, i + 2))
  }
  return bigrams
}

// 단어 토큰 + 한국어 문자 바이그램 혼합
function tokenize(text: string): Set<string> {
  const normalized = normalizeText(text).toLowerCase()

  const wordTokens = normalized
    .split(/[\s\.,!?;:()\[\]{}"'\/]+/)
    .map((t) => t.replace(/[^a-z0-9가-힣]/g, ""))
    .filter((t) => t.length >= 2)

  const bigrams = koreanCharBigrams(normalized)

  return new Set([...wordTokens, ...bigrams])
}

// Overlap Coefficient: intersection / min(|A|, |B|)
// Jaccard보다 쿼리-문서 비대칭에 강건 (짧은 쿼리 → 높은 재현율)
function overlapScore(query: Set<string>, doc: Set<string>): number {
  if (query.size === 0 || doc.size === 0) return 0
  let intersection = 0
  for (const token of query) {
    if (doc.has(token)) intersection++
  }
  const minSize = Math.min(query.size, doc.size)
  return minSize === 0 ? 0 : intersection / minSize
}

// TF 보정: 쿼리 토큰이 문서에 여러 번 등장할수록 가중치
function tfBonus(queryTokens: Set<string>, text: string): number {
  const words = text.toLowerCase().split(/\s+/)
  const k1 = 1.2
  let score = 0
  for (const token of queryTokens) {
    const tf = words.filter((w) => w.includes(token)).length
    if (tf > 0) score += (tf * (k1 + 1)) / (tf + k1)
  }
  return (score / (queryTokens.size || 1)) * 0.15
}

export function findSimilarQuery(
  query: string,
  projectId: string,
  options?: { threshold?: number; limit?: number }
): SimilarQueryResult[] {
  const threshold = options?.threshold ?? 0.15  // 0.18 → 0.15: 한국어 변형어 재현율 개선
  const limit = options?.limit ?? 5

  const queryTokens = tokenize(query)
  if (queryTokens.size === 0) return []

  const projectEntries = Object.values(ThreadStore).filter(
    (entry) => entry.project_id === projectId
  )

  // 스레드별 최고점 결과만 유지 (중복 제거)
  const bestPerThread = new Map<string, SimilarQueryResult>()

  for (const entry of projectEntries) {
    const userMessages = entry.messages.filter((m) => m.role === "user")
    const assistantMessages = entry.messages.filter((m) => m.role === "assistant")

    // assistant 메시지를 id/created_at 기준으로 user 메시지와 매핑
    // (인덱스 기반 매핑은 system 메시지 삽입 시 오매칭 발생)
    const assistantByIndex = new Map<number, ThreadMessage>()
    let aIdx = 0
    for (let i = 0; i < entry.messages.length; i++) {
      const msg = entry.messages[i]
      if (msg.role === "assistant") {
        // 직전 user 메시지의 userMessages 내 인덱스 찾기
        let precedingUserIdx = -1
        for (let j = i - 1; j >= 0; j--) {
          if (entry.messages[j].role === "user") {
            precedingUserIdx = userMessages.findIndex((u) => u.id === entry.messages[j].id)
            break
          }
        }
        if (precedingUserIdx >= 0) {
          assistantByIndex.set(precedingUserIdx, msg)
        } else {
          assistantByIndex.set(aIdx, msg)
        }
        aIdx++
      }
    }

    // 스레드 제목 (가중치 1.5)
    const titleScore = entry.title
      ? overlapScore(queryTokens, tokenize(entry.title)) * 1.5
      : 0

    // structured summary (가중치 0.7)
    const summaryScore = entry.structured?.summary
      ? overlapScore(queryTokens, tokenize(entry.structured.summary)) * 0.7
      : 0

    // entities + decisions + facts 복합 매칭 (가중치 0.9)
    const structuredText = [
      ...(entry.structured?.entities ?? []),
      ...(entry.structured?.decisions ?? []),
      ...(entry.structured?.facts ?? [])
    ].join(" ")
    const structuredScore = structuredText
      ? overlapScore(queryTokens, tokenize(structuredText)) * 0.9
      : 0

    for (let i = 0; i < userMessages.length; i++) {
      const userMsg = userMessages[i]
      const msgScore = overlapScore(queryTokens, tokenize(userMsg.content))
      const tf = tfBonus(queryTokens, userMsg.content)

      const score = Math.max(msgScore + tf, titleScore, summaryScore, structuredScore)

      if (score < threshold) continue

      // 매핑된 assistant 메시지 우선, 없으면 structured summary fallback
      const pairedAssistant = assistantByIndex.get(i)
      const matchedAnswer =
        pairedAssistant?.content ||
        assistantMessages[i]?.content ||       // legacy fallback
        normalizeText(entry.structured?.summary) ||
        ""

      if (!matchedAnswer) continue

      const current = bestPerThread.get(entry.thread_id)
      if (!current || score > current.score) {
        bestPerThread.set(entry.thread_id, {
          thread_id: entry.thread_id,
          score,
          matched_query: userMsg.content,
          matched_answer: matchedAnswer,
          winner_provider: entry.winner_provider ?? null,  // judge 선택 provider 반영
          updated_at: Number(entry.structured?.updated_at ?? 0)
        })
      }
    }
  }

  return Array.from(bestPerThread.values())
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
    retrieval_preview: entry?.retrieval_preview ?? existing?.retrieval_preview ?? null,
    // winner_provider: 새 값이 있으면 갱신, 없으면 기존 값 유지
    winner_provider: entry?.winner_provider ?? existing?.winner_provider ?? null
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

export function clearAllThreadMemory() {
  for (const key of Object.keys(ThreadStore)) {
    delete ThreadStore[key]
  }
  saveStore()
}
