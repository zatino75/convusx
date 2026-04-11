// recallProjectMemory.ts â€” Phase 4-C recall_project_memory tool
//
// \ud504\ub85c\uc81d\ud2b8 \uc218\uc900 \uad6c\uc870\ud654 \uba54\ubaa8\ub9ac + \uc18c\uc2a4 \uc790\uc0b0 + \uc2a4\ub808\ub4dc \uc735\ud569\uc744 \ub2e8\uc77c \ub3c4\uad6c\ub85c \uc81c\uacf5.
// agent loop \uac00 \uc2a4\uc2a4\ub85c \ud504\ub85c\uc81d\ud2b8 \uacfc\uac70 \uc2a4\ub808\ub4dc\ub97c \ud638\ucd9c\ud560 \ub54c \uc0ac\uc6a9.

import { registerTool, type ToolResult } from "../toolRegistry.js"
import { buildFusionSystemBlock } from "../../fusion/threadFusion.js"
import { buildProjectFusionBlock } from "../../fusion/projectFusion.js"

function safeString(v: any): string { return String(v ?? "").trim() }

registerTool({
  name: "recall_project_memory",
  description:
    "\ud604\uc7ac \ud504\ub85c\uc81d\ud2b8\uc758 \uac00\uc7a5 \uad00\ub828\ub41c \uacfc\uac70 \uc2a4\ub808\ub4dc·\uad6c\uc870\ud654 \uba54\ubaa8\ub9ac·\uc18c\uc2a4 \uc790\uc0b0\uc744 \uc790\ub3d9 \uc5f0\uacb0\ud558\uc5ec \ud658\uacbd\uc3a8\ub85c \uc81c\uacf5\ud55c\ub2e4. " +
    "\uc0ac\uc6a9\uc790\uac00 '\ud504\ub85c\uc81d\ud2b8 \ub0b4\uc6a9', '\uc774\uc804 \ud22c\ub819', '\uac00\uc7a5 \ucd5c\uadfc', '\uc54c\uc544\uc11c \ucc3e\uc544\ubd10' \ub4f1 \ud504\ub85c\uc81d\ud2b8 \uc218\uc900 \ucc38\uc870\ub97c " +
    "\uc694\uccad\ud560 \ub54c \uc790\ub3d9 \ud638\ucd9c\ub41c\ub2e4. \uc2a4\ub808\ub4dc \uc735\ud569(\ud504\ub85c\uc81d\ud2b8 \ub0b4 \uc804\uccb4 \uc2a4\ub808\ub4dc \uad50\ucc28 \uac80\uc0c9) + \ud504\ub85c\uc81d\ud2b8 \uba54\ubaa8\ub9ac(\uad6c\uc870\ud654 \uc9c0\uc2dd) + \uc18c\uc2a4 \uc790\uc0b0 \uc218\uc900\uc744 \ud569\uc300\ud574 \ubc18\ud658\ud55c\ub2e4.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "\uac80\uc0c9 \ud0a4\uc6cc\ub4dc \ub610\ub294 \uc9c8\ubb38" },
      max_threads: { type: "number", description: "\uc2a4\ub808\ub4dc \uc735\ud569 \ucd5c\ub300 \ubc18\ud658 \uc218 (1\ue4002010, \uae30\ubcf8 5)" },
    },
    required: ["query"],
  },
  cost_tier: "free",
  async handler(input: any, ctx: any): Promise<ToolResult> {
    const query = safeString(input?.query)
    if (!query) return { ok: false, output_text: JSON.stringify({ ok: false, error: "query is required" }), error: "missing_query" }

    const projectId = safeString(ctx?.project_id) || "chat_project"
    const maxThreads = Math.max(1, Math.min(10, Number(input?.max_threads ?? 5) || 5))

    const threadBlock = buildFusionSystemBlock({ project_id: projectId, query, max_threads: maxThreads })
    const projectBlock = buildProjectFusionBlock({ project_id: projectId, query })

    const combined = [threadBlock, projectBlock].filter(Boolean).join("\n\n")

    return {
      ok: true,
      output_text: JSON.stringify({
        ok: true,
        project_id: projectId,
        query,
        context: combined || "\uc774 \ud504\ub85c\uc81d\ud2b8\uc5d0 \uc800\uc7a5\ub41c \uad00\ub828 \uba54\ubaa8\ub9ac\uac00 \uc5c6\ub2e4.",
        has_thread_fusion: threadBlock.length > 0,
        has_project_memory: projectBlock.length > 0,
      }),
      summary: `recall_project_memory project=${projectId} query="${query.slice(0, 40)}"`,
    }
  },
})
