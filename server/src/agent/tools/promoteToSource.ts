// promoteToSource.ts — Phase 4-C promote_to_source tool
//
// "\uc18c\uc2a4\ub85c \ub118\uaca8\uc918" / "promote to source" \ud328\ud134 \uac10\uc9c0 \uc2dc
// \ud604\uc7ac \uc2a4\ub808\ub4dc \ub0b4\uc6a9\uc744 \ud504\ub85c\uc81d\ud2b8 \uc18c\uc2a4\ub85c \uc2b9\uaca9\ud55c\ub2e4.

import { registerTool, type ToolResult } from "../toolRegistry.js"
import { promoteThreadToSource } from "../../fusion/sourcePromoter.js"

function safeString(v: any): string { return String(v ?? "").trim() }

registerTool({
  name: "promote_to_source",
  description:
    "\uc0ac\uc6a9\uc790\uac00 '\uc18c\uc2a4\ub85c \ub118\uaca8\uc918', '\uc18c\uc2a4\ub85c \uc2b9\uac9d', '\ud504\ub85c\uc81d\ud2b8 \uc18c\uc2a4\ub85c \uc800\uc7a5\ud574', 'promote to source' \ub4f1\uc758 \ud45c\ud604\uc744 " +
    "\uc4f8 \ub54c \uc790\ub3d9 \ud638\ucd9c\ub41c\ub2e4. \ud604\uc7ac \uc2a4\ub808\ub4dc\uc758 \ub300\ud654 \ub0b4\uc6a9\uc744 \uad6c\uc870\ud654\ud558\uc5ec \ud504\ub85c\uc81d\ud2b8 \uc218\uc900 \uc18c\uc2a4 \uc790\uc0b0\uc73c\ub85c \uc2b9\uaca9 \uc800\uc7a5\ud558\uba70, " +
    "\uc774\ud6c4 \ubaa8\ub4e0 \uc2a4\ub808\ub4dc\uc5d0\uc11c \uc790\ub3d9 retrieval \ub300\uc0c1\uc774 \ub41c\ub2e4.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "\uc2b9\uaca9\ud560 \ub0b4\uc6a9\uc758 \ud575\uc2ec \uc694\uc57d (1\ue400e3\ubb38\uc7a5)" },
      content: { type: "string", description: "\uc2b9\uaca9\ud560 \uc804\uccb4 \ub0b4\uc6a9 (\ub9c8\ud06c\ub2e4\uc6b4 \ub4f1 \uc790\uc720 \ud615\uc2dd, \ucd5c\ub300 8000\uc790)" },
      source_hint: { type: "string", description: "\uc18c\uc2a4 \uc720\ud615 \ud78c\ud2b8 (\uc120\ud0dd, \uc608: '\uc2dc\uc7a5\uc870\uc0ac', '\ubc95\uaddc\uac80\ud1a0', '\uc81c\ud488\uac1c\ubc1c')" },
    },
    required: ["summary", "content"],
  },
  cost_tier: "free",
  async handler(input: any, ctx: any): Promise<ToolResult> {
    const summary = safeString(input?.summary)
    const content = safeString(input?.content)
    if (!summary || !content) {
      return { ok: false, output_text: JSON.stringify({ ok: false, error: "summary and content are required" }), error: "missing_fields" }
    }

    const projectId = safeString(ctx?.project_id) || "chat_project"
    const threadId = safeString(ctx?.thread_id) || "unknown"
    const threadTitle = safeString(ctx?.thread_title) || null

    const result = promoteThreadToSource({
      project_id: projectId,
      thread_id: threadId,
      thread_title: threadTitle,
      summary,
      content: content.slice(0, 8000),
      source_hint: safeString(input?.source_hint) || undefined,
    })

    return {
      ok: result.ok,
      output_text: JSON.stringify({
        ok: result.ok,
        asset_id: result.asset_id,
        project_id: projectId,
        thread_id: threadId,
        error: result.error,
        message: result.ok
          ? `\uc2a4\ub808\ub4dc \ub0b4\uc6a9\uc774 \ud504\ub85c\uc81d\ud2b8 \uc18c\uc2a4\ub85c \uc2b9\uaca9\ub418\uc5c8\uc2b5\ub2c8\ub2e4. (asset_id: ${result.asset_id})`
          : `\uc18c\uc2a4 \uc2b9\uaca9 \uc2e4\ud328: ${result.error}`,
      }),
      summary: `promote_to_source project=${projectId} ok=${result.ok}`,
    }
  },
})
