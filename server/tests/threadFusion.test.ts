import { describe, it, expect, beforeAll } from "vitest"
import { fuseThreadContext, buildFusionSystemBlock } from "../src/fusion/threadFusion"
import { upsertThreadMemory, clearAllThreadMemory } from "../src/memory/threadMemory"

const TEST_PROJECT = "vitest_threadfusion_project"

function seedThread(id: string, title: string, userMsg: string, assistantMsg: string, entities: string[] = []) {
  upsertThreadMemory({
    thread_id: id,
    project_id: TEST_PROJECT,
    title,
    messages: [
      { id: `${id}_u`, role: "user", content: userMsg, created_at: Date.now() },
      { id: `${id}_a`, role: "assistant", content: assistantMsg, created_at: Date.now() },
    ],
    structured: {
      summary: `${title} 요약 — ${userMsg.slice(0, 40)}`,
      entities,
    },
  })
}

describe("threadFusion.fuseThreadContext", () => {
  beforeAll(() => {
    // 같은 프로젝트에 이전 테스트 잔존이 있으면 제거 — 전 프로젝트 초기화는 과한 부작용이므로
    // ThreadStore 전체를 비우지는 않고 seed 만 진행.
    // (각 테스트 run 에서 clearAllThreadMemory 호출이 필요하면 필요한 테스트 앞에서 명시적으로 호출한다.)
    clearAllThreadMemory()
    seedThread(
      "vtf_t1",
      "케토 김밥 시장 분석",
      "케토 간편식 시장 규모는?",
      "최근 12개월 기준 YoY 126% 상승, MZ 타겟 검증 데이터 필요",
      ["케토", "MZ"]
    )
    seedThread(
      "vtf_t2",
      "CORVUS 경쟁사 스캔",
      "CORVUS X 와 경쟁하는 SaaS 가 뭐가 있는가",
      "Anthropic, OpenAI 기반의 AI workspace 제품이 주 경쟁군",
      ["CORVUS X", "Anthropic", "OpenAI"]
    )
    seedThread(
      "vtf_t3",
      "무관한 스레드 — 요리 레시피",
      "저녁 메뉴 추천",
      "파스타와 샐러드",
      []
    )
  })

  it("returns empty block when project has no matching thread", () => {
    const res = fuseThreadContext({
      project_id: TEST_PROJECT,
      query: "양자역학 관련 논문 3개",
    })
    // 매칭 0 이어도 함수는 fused_summary 문자열을 반환한다 (empty-state 메시지)
    expect(res.matched_threads.length).toBe(0)
    expect(res.fused_summary).toMatch(/관련 컨텍스트가 발견되지 않았다|컨텍스트/)
  })

  it("matches thread by query keyword", () => {
    const res = fuseThreadContext({
      project_id: TEST_PROJECT,
      query: "케토 간편식 시장 트렌드",
    })
    expect(res.matched_threads.length).toBeGreaterThan(0)
    expect(res.matched_threads[0].thread_id).toBe("vtf_t1")
  })

  it("gives entity bonus when query contains a registered entity phrase", () => {
    const withEntity = fuseThreadContext({
      project_id: TEST_PROJECT,
      query: "Anthropic 기반 AI 도구",
    })
    const entityThread = withEntity.matched_threads.find((t) => t.thread_id === "vtf_t2")
    expect(entityThread).toBeDefined()
    expect(entityThread!.relevance_score).toBeGreaterThan(0)
  })

  it("respects total_cap — fused_summary stays within cap", () => {
    const cap = 800
    const res = fuseThreadContext({
      project_id: TEST_PROJECT,
      query: "CORVUS 시장",
      total_cap: cap,
    })
    expect(res.fused_summary.length).toBeLessThanOrEqual(cap)
  })

  it("ranks title match higher than message-only match", () => {
    const res = fuseThreadContext({
      project_id: TEST_PROJECT,
      query: "케토 김밥",
    })
    // vtf_t1 타이틀이 '케토 김밥' 을 직접 담고 있으므로 최상위
    expect(res.matched_threads[0].thread_id).toBe("vtf_t1")
    expect(res.matched_threads[0].matched_on).toBe("title")
  })

  it("buildFusionSystemBlock returns non-empty string when matches exist", () => {
    const block = buildFusionSystemBlock({
      project_id: TEST_PROJECT,
      query: "CORVUS X 경쟁사",
    })
    expect(block.length).toBeGreaterThan(0)
    expect(block).toContain("프로젝트 지식")
  })

  it("buildFusionSystemBlock returns empty string for no-match query", () => {
    const block = buildFusionSystemBlock({
      project_id: TEST_PROJECT,
      query: "양자 컴퓨팅 논문 2024",
    })
    expect(block).toBe("")
  })
})
