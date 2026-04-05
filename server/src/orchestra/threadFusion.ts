export type ThreadMemoryLike = {
  thread_id: string
  title?: string
  structured?: {
    summary?: string
    decisions?: string[]
    facts?: string[]
    entities?: string[]
  }
}

export type SimilarQueryResult = {
  thread_id: string
  score?: number
  matched_answer?: string
  winner_provider?: string
}

const DEFAULT_THRESHOLD = Number(process.env.THREAD_FUSION_THRESHOLD ?? 0.65)
const ENABLED = String(process.env.ENABLE_THREAD_FUSION ?? "true").trim().toLowerCase() !== "false"

function tokenize(input: string): string[] {
  return String(input ?? "")
    .toLowerCase()
    .split(/[^a-z0-9가-힣]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
}

function overlapRatio(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0
  const setB = new Set(b)
  const hits = a.filter((item) => setB.has(item)).length
  return hits / Math.max(1, Math.min(a.length, b.length))
}

export function shouldFuseThread(query: string, thread: ThreadMemoryLike, result?: SimilarQueryResult) {
  if (!ENABLED) return false
  const score = Number(result?.score ?? 0)
  if (score < DEFAULT_THRESHOLD) return false

  const queryTokens = tokenize(query)
  const threadTokens = tokenize([
    thread?.title ?? "",
    thread?.structured?.summary ?? "",
    ...(thread?.structured?.entities ?? []),
    ...(thread?.structured?.facts ?? []),
  ].join(" "))

  if (overlapRatio(queryTokens, threadTokens) < 0.2) return false
  return true
}

export function buildThreadFusionBlock(
  query: string,
  allThreads: ThreadMemoryLike[],
  similarResults: SimilarQueryResult[],
  currentThreadId: string
) {
  if (!ENABLED) return { block: "", matchedCount: 0 }

  const candidates = (similarResults ?? [])
    .filter((item) => item?.thread_id && item.thread_id !== currentThreadId)
    .map((result) => ({
      result,
      thread: (allThreads ?? []).find((thread) => thread.thread_id === result.thread_id),
    }))
    .filter((item) => item.thread && shouldFuseThread(query, item.thread, item.result))
    .slice(0, 3)

  if (!candidates.length) return { block: "", matchedCount: 0 }

  const lines = ["[THREAD MEMORY]", ""]
  for (const item of candidates) {
    const title = item.thread?.title ? ` — ${item.thread.title}` : ""
    const provider = item.result?.winner_provider ? ` [${String(item.result.winner_provider).toUpperCase()}]` : ""
    lines.push(`[관련 스레드${title}${provider}]`)
    lines.push(String(item.result?.matched_answer ?? item.thread?.structured?.summary ?? "").trim())
    lines.push("")
  }

  return { block: lines.join("\n").trim(), matchedCount: candidates.length }
}
