// sourcePromoter.ts — CORVUS X Source Promoter (Phase 4-C)
//
// "\uc18c\uc2a4\ub85c \ub118\uaca8\uc918" / "promote to source" \ud328\ud134 \uac10\uc9c0 \uc2dc
// \ud604\uc7ac \uc2a4\ub808\ub4dc \ub0b4\uc6a9\uc744 \uad6c\uc870\ud654\ud558\uc5ec \ud504\ub85c\uc81d\ud2b8 \uc18c\uc2a4\ub85c \uc2b9\uaca9 \uc800\uc7a5\ud55c\ub2e4.

import { addProjectSourceAsset } from "../memory/projectMemory.js"
import { logger } from "../observability/logger.js"

const PROMOTE_PATTERNS = [
  /\uc18c\uc2a4\ub85c\s*\ub118\uaca8/i,
  /\uc18c\uc2a4\ub85c\s*\uc2b9\uaca9/i,
  /\ud504\ub85c\uc81d\ud2b8\s*\uc18c\uc2a4/i,
  /promote\s+to\s+source/i,
  /save\s+as\s+source/i,
  /\uc18c\uc2a4\ub85c\s*\uc800\uc7a5/i,
]

export function detectPromoteIntent(text: string): boolean {
  const t = String(text ?? "")
  return PROMOTE_PATTERNS.some((p) => p.test(t))
}

export type PromoteResult = {
  ok: boolean
  asset_id: string | null
  error?: string
}

export function promoteThreadToSource(opts: {
  project_id: string
  thread_id: string
  thread_title: string | null
  summary: string
  content: string
  source_hint?: string
}): PromoteResult {
  // 2026-04-23: 스레드 → 프로젝트 소스 자동 승격 경로 폐기 (bypass).
  // 원본 로직은 아래 if (false) 블록에 보존.
  logger.info("[sourcePromoter] promotion bypassed — cross-thread promotion disabled", {
    project_id: opts.project_id,
    thread_id: opts.thread_id,
  })
  return { ok: false, asset_id: null, error: "promotion_disabled_2026_04_23" }

  // eslint-disable-next-line no-unreachable
  if (false) {
    // ===== 원본 코드 (2026-04-23 bypass 이전) =====
    const { project_id, thread_id, thread_title, summary, content, source_hint } = opts
    try {
      const now = Date.now()
      const assetId = `promoted-${thread_id.slice(0, 8)}-${now}`
      addProjectSourceAsset(project_id, {
        id: assetId,
        name: thread_title ?? `\uc2a4\ub808\ub4dc \uc2b9\uaca9 ${new Date(now).toISOString().slice(0, 10)}`,
        type: "promoted_thread",
        content: content.slice(0, 8000),
        preview: summary.slice(0, 400),
        source_thread_id: thread_id,
        source_hint: source_hint ?? null,
        created_at: now,
        confirmed: true,
      } as any)
      logger.info("[sourcePromoter] promoted thread to source", { project_id, thread_id, asset_id: assetId })
      return { ok: true, asset_id: assetId }
    } catch (error: any) {
      logger.warn("[sourcePromoter] promote failed", { error: String(error?.message ?? error) })
      return { ok: false, asset_id: null, error: String(error?.message ?? error) }
    }
    // ===== /원본 코드 =====
  }
  return { ok: false, asset_id: null, error: "unreachable" }
}
