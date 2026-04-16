// recallProjectMemory.ts — Phase 7 통합 retrieval 도구
//
// 프로젝트의 스레드 융합 + 구조화 메모리 + 소스 자산 + 부서 보고서를
// 단일 호출로 가져와 점수 기반 재순위·예산 배분된 컨텍스트 블록을 반환한다.
// 에이전트가 "프로젝트 내용", "이전 논의", "알아서 찾아봐" 등을 만날 때 호출.

import { registerTool, type ToolResult } from "../toolRegistry.js"
import { retrieveUnifiedContext } from "../../fusion/unifiedRetrieval.js"

function safeString(v: any): string { return String(v ?? "").trim() }

registerTool({
  name: "recall_project_memory",
  description:
    "현재 프로젝트의 가장 관련된 과거 스레드·구조화 메모리·소스 자산·부서 보고서를 " +
    "통합 retrieval 로 모아 단일 컨텍스트로 제공한다. 사용자가 '프로젝트 내용', '이전 논의', " +
    "'가장 최근', '알아서 찾아봐' 등 프로젝트 수준 참조를 요청할 때 호출한다. " +
    "스레드·프로젝트 메모리·소스 자산·보고서 각각을 개별 호출하지 말고 이 도구 하나로 끝낼 것.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "검색 키워드 또는 질문" },
      max_items: {
        type: "number",
        description: "통합 결과 최대 아이템 수 (1~12, 기본 8)",
      },
    },
    required: ["query"],
  },
  cost_tier: "free",
  async handler(input: any, ctx: any): Promise<ToolResult> {
    const query = safeString(input?.query)
    if (!query) {
      return {
        ok: false,
        output_text: JSON.stringify({ ok: false, error: "query is required" }),
        error: "missing_query",
      }
    }

    const projectId = safeString(ctx?.project_id) || "chat_project"
    const maxItems = Math.max(1, Math.min(12, Number(input?.max_items ?? 8) || 8))

    const unified = retrieveUnifiedContext({ project_id: projectId, query, max_items: maxItems })

    return {
      ok: true,
      output_text: JSON.stringify({
        ok: true,
        project_id: projectId,
        query,
        context: unified.block || "이 프로젝트에 저장된 관련 메모리가 없다.",
        items: unified.items.map((it) => ({
          kind: it.kind,
          id: it.id,
          title: it.title,
          score: it.score,
        })),
        stats: unified.stats,
      }),
      summary:
        `recall_project_memory project=${projectId} items=${unified.items.length} ` +
        `(threads_scanned=${unified.stats.threads_scanned}, sources=${unified.stats.sources_scanned})`,
    }
  },
})
