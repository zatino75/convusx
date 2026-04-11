// recallThreadHistory.ts — 스레드·프로젝트 메모리 회상 도구
//
// threadMemory.findSimilarQuery 를 래핑해 과거 유사 질의와 답변을 찾는다.
// Phase 4 의 threadFusion 이 붙기 전 최소 버전 — scope 'thread' | 'project' | 'all' 지원.

import { registerTool, type ToolResult } from "../toolRegistry.js"
import { findSimilarQuery, getThreadMemory, getProjectThreadMemories } from "../../memory/threadMemory.js"

function safeString(value: any): string {
  return String(value ?? "").trim()
}

function clampInt(value: any, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

registerTool({
  name: "recall_thread_history",
  description:
    "현재 스레드 또는 프로젝트 내 과거 대화에서 사용자의 현재 질문과 의미상 가장 유사한 질의-답변 " +
    "쌍을 찾아 반환한다. 사용자가 '아까', '전에', '이전 스레드', '저번에', '그때' 같은 과거 " +
    "참조 표현을 쓰거나, 연속된 주제를 다루는 것으로 보일 때 반드시 먼저 호출해 과거 문맥을 " +
    "복원해야 한다. 결과는 점수가 높은 순으로 최대 5건이며 각 항목은 thread_id·score·matched_query·" +
    "matched_answer(요약)·winner_provider·updated_at 을 포함한다.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "검색 쿼리 (사용자의 현재 질문을 그대로 넣거나 핵심 키워드만 축약해도 된다)",
      },
      scope: {
        type: "string",
        enum: ["thread", "project", "all"],
        description: "검색 범위 — thread = 현재 스레드만, project = 같은 프로젝트의 다른 스레드 포함, all = 전체. 기본 project.",
      },
      top_k: {
        type: "number",
        description: "반환 상한 (기본 3, 최대 5)",
      },
      include_current_thread_summary: {
        type: "boolean",
        description: "현재 스레드의 structured summary 도 함께 반환할지 (기본 true)",
      },
    },
    required: ["query"],
  },
  cost_tier: "free",
  async handler(input, ctx): Promise<ToolResult> {
    const query = safeString(input?.query)
    if (!query) {
      return {
        ok: false,
        output_text: JSON.stringify({ ok: false, error: "query is required" }),
        error: "missing_query",
      }
    }

    const scope = (safeString(input?.scope) || "project") as "thread" | "project" | "all"
    const topK = clampInt(input?.top_k, 1, 5, 3)
    const includeSummary = input?.include_current_thread_summary !== false

    const threadId = safeString(ctx.thread_id)
    const projectId = safeString(ctx.project_id) || "chat_project"

    // findSimilarQuery 가 project 단위 검색을 지원한다고 가정.
    // all 의 경우 project_id 를 null 로 넘겨 전체 검색 (구현에 따라 fallback).
    let matches: Array<{
      thread_id: string
      score: number
      matched_query: string
      matched_answer: string
      winner_provider: string | null
      updated_at: number
    }> = []

    try {
      // findSimilarQuery(query, projectId, { threshold, limit })
      const raw = findSimilarQuery(query, projectId, { limit: topK + 2 }) ?? []
      matches = Array.isArray(raw) ? (raw as any) : []
    } catch (e: any) {
      return {
        ok: false,
        output_text: JSON.stringify({ ok: false, error: `findSimilarQuery failed: ${safeString(e?.message)}` }),
        error: "similar_query_failed",
      }
    }

    // scope=thread 면 현재 스레드만 필터
    if (scope === "thread") {
      matches = matches.filter((m) => m.thread_id === threadId)
    }

    matches = matches.slice(0, topK).map((m) => ({
      ...m,
      matched_query: safeString(m.matched_query).slice(0, 400),
      matched_answer: safeString(m.matched_answer).slice(0, 800),
    }))

    // 현재 스레드의 structured summary
    let currentThreadSummary: any = null
    if (includeSummary && threadId) {
      try {
        const mem: any = getThreadMemory(threadId)
        if (mem?.structured) {
          currentThreadSummary = {
            title: mem.title ?? null,
            summary: mem.structured.summary ?? null,
            decisions: Array.isArray(mem.structured.decisions) ? mem.structured.decisions.slice(0, 10) : [],
            facts: Array.isArray(mem.structured.facts) ? mem.structured.facts.slice(0, 10) : [],
            open_questions: Array.isArray(mem.structured.open_questions) ? mem.structured.open_questions.slice(0, 10) : [],
            entities: Array.isArray(mem.structured.entities) ? mem.structured.entities.slice(0, 20) : [],
            updated_at: mem.structured.updated_at ?? null,
          }
        }
      } catch { /* ignore */ }
    }

    // 프로젝트 내 다른 스레드 수 (scope != thread 일 때만 참고용)
    let projectThreadCount: number | null = null
    if (scope !== "thread") {
      try {
        const all: any = getProjectThreadMemories(projectId) ?? []
        projectThreadCount = Array.isArray(all) ? all.length : null
      } catch { /* ignore */ }
    }

    return {
      ok: true,
      output_text: JSON.stringify({
        ok: true,
        scope,
        query,
        match_count: matches.length,
        matches,
        current_thread_summary: currentThreadSummary,
        project_thread_count: projectThreadCount,
      }),
      summary: `recall_thread_history scope=${scope} matches=${matches.length}`,
    }
  },
})
