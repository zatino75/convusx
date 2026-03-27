import { getProjectThreadMemories } from "../memory/threadMemory.js"

type FusionBlock = {
  thread_id: string
  title: string | null
  summary: string
  decisions: string[]
  facts: string[]
  score: number
}

function normalizeText(value: any): string {
  return String(value ?? "").trim()
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

/**
 * Selects relevant threads from the same project based on query relevance.
 * Returns top-N threads sorted by relevance score, excluding current thread.
 */
export function selectRelevantThreads(params: {
  projectId: string
  currentThreadId: string
  query: string
  limit?: number
  threshold?: number
}): FusionBlock[] {
  const limit = params.limit ?? 3
  const threshold = params.threshold ?? 0.12

  const projectThreads = getProjectThreadMemories(params.projectId)
  const queryTokens = tokenize(params.query)

  const scored: FusionBlock[] = []

  for (const thread of projectThreads) {
    if (thread.thread_id === params.currentThreadId) continue

    const summary = normalizeText(thread.structured?.summary)
    const decisions = Array.isArray(thread.structured?.decisions) ? thread.structured.decisions : []
    const facts = Array.isArray(thread.structured?.facts) ? thread.structured.facts : []

    if (!summary && decisions.length === 0 && facts.length === 0) continue

    const combinedText = [summary, ...decisions, ...facts].join(" ")
    const threadTokens = tokenize(combinedText)
    const score = jaccardScore(queryTokens, threadTokens)

    if (score < threshold) continue

    scored.push({
      thread_id: thread.thread_id,
      title: thread.title ?? null,
      summary,
      decisions: decisions.slice(0, 4),
      facts: facts.slice(0, 6),
      score
    })
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/**
 * Builds a thread fusion context block string to inject into the prompt.
 */
export function buildThreadFusionBlock(threads: FusionBlock[]): string {
  if (threads.length === 0) return ""

  const lines: string[] = ["[RELATED THREAD CONTEXT]", ""]

  for (const thread of threads) {
    const label = thread.title ? `Thread: ${thread.title}` : `Thread: ${thread.thread_id.slice(0, 8)}`
    lines.push(`[${label}]`)

    if (thread.summary) {
      lines.push(thread.summary)
    }

    const topDecisions = uniqueStrings(thread.decisions).slice(0, 3)
    if (topDecisions.length > 0) {
      lines.push("Decisions: " + topDecisions.join(" | "))
    }

    const topFacts = uniqueStrings(thread.facts).slice(0, 4)
    if (topFacts.length > 0) {
      lines.push("Facts: " + topFacts.join(" | "))
    }

    lines.push("")
  }

  return lines.join("\n").trim()
}