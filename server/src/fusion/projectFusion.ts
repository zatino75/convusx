// projectFusion.ts — CORVUS X Project Fusion (Phase 4-C)
//
// \ud504\ub85c\uc81d\ud2b8 \uba54\ubaa8\ub9ac(\uad6c\uc870\ud654 \uc9c0\uc2dd) + \uc18c\uc2a4 \uc790\uc0b0\uc744 \ud569\uc300\ud574 agent loop system prompt \uc8fc\uc785\uc6a9 context \ub97c \ub9cc\ub4e0\ub2e4.
// threadFusion \uacfc \ud568\uaed8 \uc0ac\uc6a9\ub418\eba76, \uc2a4\ub808\ub4dc \uc735\ud569 \uc704\uc5d0 \ud504\ub85c\uc81d\ud2b8 \uc218\uc900 \uc9c0\uc2dd\uc744 \ucd94\uac00 \uc8fc\uc785.

import { getLatestProjectContext, getProjectMemory } from "../memory/projectMemory.js"
import { logger } from "../observability/logger.js"

export type ProjectFusionContext = {
  project_id: string
  structured_memory_block: string
  source_assets_block: string
  combined_block: string
}

export function fuseProjectContext(opts: {
  project_id: string
  query?: string
  max_sources?: number
}): ProjectFusionContext {
  const { project_id, query } = opts
  const maxSources = Math.max(1, opts.max_sources ?? 6)

  const context = getLatestProjectContext(project_id, query)
  const retrieval = (context as any).retrieval_context ?? {}

  // \uad6c\uc870\ud654 \uba54\ubaa8\ub9ac \ube14\ub85d \u2014 summary/decisions/facts
  let structuredBlock = ""
  const summaries: string[] = Array.isArray(retrieval.summary) ? retrieval.summary : []
  const decisions: string[] = Array.isArray(retrieval.decisions) ? retrieval.decisions : []
  const facts: string[] = Array.isArray(retrieval.facts) ? retrieval.facts : []

  const memLines: string[] = []
  if (summaries.length) memLines.push(`\uc694\uc57d: ${summaries.slice(0, 3).join(" / ")}`)
  if (decisions.length) memLines.push(`\uacb0\uc815 \uc0ac\ud56d: ${decisions.slice(0, 4).join("; ")}`)
  if (facts.length) memLines.push(`\uc8fc\uc694 \uc0ac\uc2e4: ${facts.slice(0, 4).join("; ")}`)

  if (memLines.length) {
    structuredBlock = `[\ud504\ub85c\uc81d\ud2b8 \uad6c\uc870\ud654 \uba54\ubaa8\ub9ac]\n` + memLines.join("\n")
  }

  // \uc18c\uc2a4 \uc790\uc0b0 \ube14\ub85d
  let sourcesBlock = ""
  const sources: string[] = Array.isArray(retrieval.sources) ? retrieval.sources : []
  if (sources.length > 0) {
    const topSources = sources.slice(0, maxSources)
    const lines = topSources.map((s: string, i: number) => {
      const preview = s.replace(/\n/g, " ").slice(0, 400)
      return `  [${i + 1}] ${preview}`
    })
    sourcesBlock = `[\ud504\ub85c\uc81d\ud2b8 \uc18c\uc2a4 \uc790\uc0b0 (${topSources.length}\uac74)]\n` + lines.join("\n")
  }

  const combined = [structuredBlock, sourcesBlock].filter(Boolean).join("\n\n")

  logger.debug("[projectFusion] fused", {
    project_id,
    summaries: summaries.length,
    sources: sources.length,
  })

  return { project_id, structured_memory_block: structuredBlock, source_assets_block: sourcesBlock, combined_block: combined }
}

export function buildProjectFusionBlock(opts: { project_id: string; query?: string }): string {
  const result = fuseProjectContext(opts)
  if (!result.combined_block) return ""
  return `[\ud504\ub85c\uc81d\ud2b8 \uc9c0\uc2dd \uae30\ubc18 \ucee8\ud14d\uc2a4\ud2b8]\n\ud604\uc7ac \ud504\ub85c\uc81d\ud2b8\uc758 \uad6c\uc870\ud654 \uba54\ubaa8\ub9ac\uc640 \uc18c\uc2a4 \uc790\uc0b0\uc5d0\uc11c \uc790\ub3d9 \ucd94\ucd9c\ud55c \ub0b4\uc6a9\uc774\ub2e4. \uc9c8\ubb38\uc5d0 \uc9c1\uc811 \uad00\ub828\ub41c \ub0b4\uc6a9\ub9cc \ud65c\uc6a9\ud558\ub77c.\n` + result.combined_block
}
