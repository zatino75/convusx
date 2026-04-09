import { describe, it, expect } from "vitest"
import { detectTaskType, detectCodeSubtask, extractPlanningSignals } from "../src/orchestra/planner"

describe("detectTaskType", () => {
  it("detects dialogue for simple messages", () => {
    expect(detectTaskType("안녕하세요")).toBe("dialogue")
    expect(detectTaskType("오늘 날씨 어때?")).toBe("dialogue")
  })

  it("detects code tasks", () => {
    expect(detectTaskType("React 컴포넌트를 구현해줘 코드를 짜줘")).toBe("code_implement")
    expect(detectTaskType("이 코드에서 에러가 나는데 디버그 해줘")).toBe("code_debug")
    expect(detectTaskType("이 코드를 리뷰해줘 리팩토링 필요해")).toBe("code_refactor_review")
  })

  it("detects research", () => {
    expect(detectTaskType("최신 AI 트렌드를 조사해줘")).toBe("research")
    expect(detectTaskType("시장 동향을 리서치해줘")).toBe("research")
  })

  it("detects writing tasks", () => {
    expect(detectTaskType("소설을 써줘 판타지 스토리")).toBe("writing_creative")
    expect(detectTaskType("이메일 초안 작성해줘 공문")).toBe("writing_business")
  })

  it("detects legal review", () => {
    expect(detectTaskType("계약서 검토해줘 독소조항 확인")).toBe("legal_review")
  })

  it("detects finance analysis", () => {
    expect(detectTaskType("재무제표 분석해줘 밸류에이션")).toBe("finance_analysis")
  })

  it("detects data analysis", () => {
    expect(detectTaskType("데이터 분석해줘 통계 분석")).toBe("data_analysis")
  })

  it("detects office tasks", () => {
    expect(detectTaskType("엑셀 시트 만들어줘")).toBe("excel")
    expect(detectTaskType("PPT 슬라이드 만들어줘")).toBe("ppt")
    expect(detectTaskType("PDF 분석해줘")).toBe("pdf")
  })

  // ── dialogue catch-all 개선 검증 ──

  it("detects summary/organization as writing (not dialogue)", () => {
    expect(detectTaskType("요약해줘")).toBe("writing")
    expect(detectTaskType("정리해줘")).toBe("writing")
    expect(detectTaskType("핵심만 정리해줘")).toBe("writing")
    expect(detectTaskType("한 줄로 요약해줘")).toBe("writing")
  })

  it("detects translation as writing (not dialogue)", () => {
    expect(detectTaskType("번역해줘")).toBe("writing")
    expect(detectTaskType("영어로 번역해줘")).toBe("writing")
    expect(detectTaskType("한국어로 번역해줘")).toBe("writing")
    expect(detectTaskType("translate into english")).toBe("writing")
  })

  it("detects table/list creation as writing (not dialogue)", () => {
    expect(detectTaskType("표 만들어줘")).toBe("writing")
    expect(detectTaskType("비교표 만들어줘")).toBe("reasoning") // "비교"가 reasoning에 먼저 매칭
    expect(detectTaskType("표로 정리해줘")).toBe("writing")
    expect(detectTaskType("리스트로 만들어줘")).toBe("writing")
  })

  it("detects explanation as reasoning (not dialogue)", () => {
    expect(detectTaskType("설명해줘")).toBe("reasoning")
    expect(detectTaskType("차이점이 뭐야")).toBe("reasoning")
    expect(detectTaskType("쉽게 설명해줘")).toBe("reasoning")
  })

  it("detects conversion/rewrite as writing (not dialogue)", () => {
    expect(detectTaskType("json으로 변환해줘")).toBe("writing")
    expect(detectTaskType("다시 써줘")).toBe("writing_creative") // "써"가 writing_creative에 먼저 매칭
    expect(detectTaskType("톤 바꿔줘")).toBe("writing")
  })

  it("detects recommendation as reasoning (not dialogue)", () => {
    expect(detectTaskType("추천해줘")).toBe("reasoning")
    expect(detectTaskType("뭐가 좋을까")).toBe("reasoning")
    expect(detectTaskType("어떤 게 좋아")).toBe("reasoning")
  })

  it("still returns dialogue for truly simple messages", () => {
    expect(detectTaskType("안녕하세요")).toBe("dialogue")
    expect(detectTaskType("오늘 날씨 어때?")).toBe("dialogue")
    expect(detectTaskType("ㅎㅎ")).toBe("dialogue")
    expect(detectTaskType("고마워")).toBe("dialogue")
  })
})

describe("extractPlanningSignals", () => {
  it("detects benchmark mode", () => {
    const signals = extractPlanningSignals("벤치마크 테스트 실행")
    expect(signals.benchmark_mode).toBe(true)
  })

  it("detects deep analysis", () => {
    const signals = extractPlanningSignals("심층분석 해줘")
    expect(signals.deep_analysis).toBe(true)
  })

  it("detects deep research", () => {
    const signals = extractPlanningSignals("심층 리서치 부탁해")
    expect(signals.deep_research).toBe(true)
  })

  it("returns false for normal messages", () => {
    const signals = extractPlanningSignals("안녕하세요")
    expect(signals.benchmark_mode).toBe(false)
    expect(signals.deep_analysis).toBe(false)
    expect(signals.deep_research).toBe(false)
    expect(signals.force_pro).toBe(false)
  })
})
