// threadFusion.ts â€” CORVUS X Thread Fusion Engine (Phase 4-C)
//
// \ud504\ub85c\uc81d\ud2b8 \ub0b4 \ubaa8\ub4e0 \uc2a4\ub808\ub4dc\uc758 \ub300\ud654·\uacb0\uacfc\ubb3c·\uacb0\ub860·\ud45c·\ucf54\ub4dc·\ub9ac\uc11c\uce58\ub97c \uc790\ub3d9\uc73c\ub85c \uad50\ucc28 \uac80\uc0c9/\uc8fc\uc785\ud55c\ub2e4.
// \uc720\uc800\uac00 "OOO \uc2a4\ub808\ub4dc \ucc38\uace0"\ub77c\uace0 \ub9d0\ud574\ub3c4 \uc2dc\uc2a4\ud15c\uc774 \uc790\ub3d9 \ucc98\ub9ac \u2014 \uc218\ub3d9 \uc9c0\uc815 UI \uc804\uba74 \uc0ad\uc81c.
// \uc2a4\ub808\ub4dc \uac04 \uc815\ubcf4 \uacf5\uc720\ub294 \uae30\ubcf8\uac12, \ub044 \uc218 \uc5c6\uc74c.

import { getProjectThreadMemories } from "../memory/threadMemory.js"
import { logger } from "../observability/logger.js"

export type FusedThreadContext = {
  project_id: string
  query: string
  matched_threads: MatchedThread[]
  fused_summary: string
  total_threads_scanned: number
}

type MatchedThread = {
  thread_id: string
  title: string | null
  relevance_score: number
  excerpt: string
  matched_on: "message" | "structured" | "title"
}

function normalizeText(v: any): string {
  return String(v ?? "").toLowerCase().trim()
}

function simpleScore(haystack: string, needles: string[]): number {
  const h = normalizeText(haystack)
  let score = 0
  for (const n of needles) {
    if (n.length < 2) continue
    if (h.includes(n)) score += 1
  }
  return score
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+|[,;.!?()\"'\[\]{}]/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
}

export function fuseThreadContext(opts: {
  project_id: string
  query: string
  max_threads?: number
  max_excerpt_len?: number
}): FusedThreadContext {
  const { project_id, query } = opts
  const maxThreads = Math.max(1, opts.max_threads ?? 5)
  const maxExcerpt = Math.max(100, opts.max_excerpt_len ?? 600)
  const needles = tokenize(query)
  const allThreads = getProjectThreadMemories(project_id)
  const scored: (MatchedThread & { _score: number })[] = []

  for (const mem of allThreads) {
    let score = 0
    let excerpt = ""
    let matchedOn: MatchedThread["matched_on"] = "message"

    if (mem.title) {
      const ts = simpleScore(mem.title, needles)
      if (ts > 0) { score += ts * 2; matchedOn = "title"; excerpt = String(mem.title).slice(0, maxExcerpt) }
    }

    const st = (mem as any).structured
    if (st) {
      const stText = [st.summary, ...(st.decisions ?? []), ...(st.facts ?? [])].join(" ")
      const ss = simpleScore(stText, needles)
      if (ss > score) { score = ss; matchedOn = "structured"; excerpt = stText.slice(0, maxExcerpt) }
    }

    for (const msg of ((mem as any).messages ?? []).slice(-30)) {
      const content = typeof msg.content === "string"
        ? msg.content
        : (Array.isArray(msg.content) ? msg.content.map((c: any) => c?.text ?? "").join(" ") : "")
      const ms = simpleScore(content, needles)
      if (ms > score) { score = ms; matchedOn = "message"; excerpt = content.slice(0, maxExcerpt) }
    }

    if (score > 0) {
      scored.push({ thread_id: mem.thread_id, title: (mem as any).title ?? null, relevance_score: score, excerpt, matched_on: matchedOn, _score: score })
    }
  }

  scored.sort((a, b) => b._score - a._score)
  const top = scored.slice(0, maxThreads).map(({ _score, ...rest }) => rest)

  let fused = ""
  if (top.length === 0) {
    fused = `\ud504\ub85c\uc81d\ud2b8 \ub0b4 \uad00\ub828 \uc2a4\ub808\ub4dc\uac00 \ubc1c\uacac\ub418\uc9c0 \uc54a\uc558\ub2e4. (query: "${query.slice(0, 80)}")`
  } else {
    const lines = top.map((t, i) => {
      const titleStr = t.title ? `"${t.title}"` : `thread:${t.thread_id.slice(0, 8)}`
      return `[${i + 1}] ${titleStr} (score=${t.relevance_score}, on=${t.matched_on})\n  ${t.excerpt.replace(/\n/g, " ").slice(0, 300)}`
    })
    fused = `\uad00\ub828 \uc2a4\ub808\ub4dc ${top.length}\uac74 (query: "${query.slice(0, 80)}"):` + "\n" + lines.join("\n")
  }

  logger.debug("[threadFusion] fused", { project_id, query: query.slice(0, 60), matched: top.length, total: allThreads.length })
  return { project_id, query, matched_threads: top, fused_summary: fused, total_threads_scanned: allThreads.length }
}

export function buildFusionSystemBlock(opts: { project_id: string; query: string; max_threads?: number }): string {
  const result = fuseThreadContext(opts)
  if (result.matched_threads.length === 0) return ""
  return [
    `[\ud504\ub85c\uc81d\ud2b8 \uc2a4\ub808\ub4dc \uc790\ub3d9 \uc735\ud569 \ucee8\ud14d\uc2a4\ud2b8]`,
    `\ud604\uc7ac \ud504\ub85c\uc81d\ud2b8\uc758 \uad00\ub828 \uc2a4\ub808\ub4dc\uc5d0\uc11c \uc790\ub3d9 \ucd94\ucd9c\ud55c \ub0b4\uc6a9\uc774\ub2e4. \ud604\uc7ac \uc9c8\ubb38\uc5d0 \uc9c1\uc811 \uad00\ub828\ub41c \ub0b4\uc6a9\ub9cc \uc120\ubcc4\ud574 \ub2f5\ubcc0\uc5d0 \ud65c\uc6a9\ud558\ub77c.`,
    result.fused_summary,
  ].join("\n")
}
