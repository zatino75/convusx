"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const planner_1 = require("../src/orchestra/planner");
(0, vitest_1.describe)("detectTaskType", () => {
    (0, vitest_1.it)("detects dialogue for simple messages", () => {
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("안녕하세요")).toBe("dialogue");
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("오늘 날씨 어때?")).toBe("dialogue");
    });
    (0, vitest_1.it)("detects code tasks", () => {
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("React 컴포넌트를 구현해줘 코드를 짜줘")).toBe("code_implement");
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("이 코드에서 에러가 나는데 디버그 해줘")).toBe("code_debug");
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("이 코드를 리뷰해줘 리팩토링 필요해")).toBe("code_refactor_review");
    });
    (0, vitest_1.it)("detects research", () => {
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("최신 AI 트렌드를 조사해줘")).toBe("research");
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("시장 동향을 리서치해줘")).toBe("research");
    });
    (0, vitest_1.it)("detects writing tasks", () => {
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("소설을 써줘 판타지 스토리")).toBe("writing_creative");
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("이메일 초안 작성해줘 공문")).toBe("writing_business");
    });
    (0, vitest_1.it)("detects legal review", () => {
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("계약서 검토해줘 독소조항 확인")).toBe("legal_review");
    });
    (0, vitest_1.it)("detects finance analysis", () => {
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("재무제표 분석해줘 밸류에이션")).toBe("finance_analysis");
    });
    (0, vitest_1.it)("detects data analysis", () => {
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("데이터 분석해줘 통계 분석")).toBe("data_analysis");
    });
    (0, vitest_1.it)("detects office tasks", () => {
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("엑셀 시트 만들어줘")).toBe("excel");
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("PPT 슬라이드 만들어줘")).toBe("ppt");
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("PDF 분석해줘")).toBe("pdf");
    });
    // ── dialogue catch-all 개선 검증 ──
    (0, vitest_1.it)("detects summary/organization as writing (not dialogue)", () => {
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("요약해줘")).toBe("writing");
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("정리해줘")).toBe("writing");
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("핵심만 정리해줘")).toBe("writing");
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("한 줄로 요약해줘")).toBe("writing");
    });
    (0, vitest_1.it)("detects translation as writing (not dialogue)", () => {
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("번역해줘")).toBe("writing");
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("영어로 번역해줘")).toBe("writing");
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("한국어로 번역해줘")).toBe("writing");
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("translate into english")).toBe("writing");
    });
    (0, vitest_1.it)("detects table/list creation as writing (not dialogue)", () => {
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("표 만들어줘")).toBe("writing");
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("비교표 만들어줘")).toBe("reasoning"); // "비교"가 reasoning에 먼저 매칭
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("표로 정리해줘")).toBe("writing");
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("리스트로 만들어줘")).toBe("writing");
    });
    (0, vitest_1.it)("detects explanation as reasoning (not dialogue)", () => {
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("설명해줘")).toBe("reasoning");
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("차이점이 뭐야")).toBe("reasoning");
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("쉽게 설명해줘")).toBe("reasoning");
    });
    (0, vitest_1.it)("detects conversion/rewrite as writing (not dialogue)", () => {
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("json으로 변환해줘")).toBe("writing");
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("다시 써줘")).toBe("writing_creative"); // "써"가 writing_creative에 먼저 매칭
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("톤 바꿔줘")).toBe("writing");
    });
    (0, vitest_1.it)("detects recommendation as reasoning (not dialogue)", () => {
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("추천해줘")).toBe("reasoning");
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("뭐가 좋을까")).toBe("reasoning");
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("어떤 게 좋아")).toBe("reasoning");
    });
    (0, vitest_1.it)("still returns dialogue for truly simple messages", () => {
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("안녕하세요")).toBe("dialogue");
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("오늘 날씨 어때?")).toBe("dialogue");
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("ㅎㅎ")).toBe("dialogue");
        (0, vitest_1.expect)((0, planner_1.detectTaskType)("고마워")).toBe("dialogue");
    });
});
(0, vitest_1.describe)("extractPlanningSignals", () => {
    (0, vitest_1.it)("detects benchmark mode", () => {
        const signals = (0, planner_1.extractPlanningSignals)("벤치마크 테스트 실행");
        (0, vitest_1.expect)(signals.benchmark_mode).toBe(true);
    });
    (0, vitest_1.it)("detects deep analysis", () => {
        const signals = (0, planner_1.extractPlanningSignals)("심층분석 해줘");
        (0, vitest_1.expect)(signals.deep_analysis).toBe(true);
    });
    (0, vitest_1.it)("detects deep research", () => {
        const signals = (0, planner_1.extractPlanningSignals)("심층 리서치 부탁해");
        (0, vitest_1.expect)(signals.deep_research).toBe(true);
    });
    (0, vitest_1.it)("returns false for normal messages", () => {
        const signals = (0, planner_1.extractPlanningSignals)("안녕하세요");
        (0, vitest_1.expect)(signals.benchmark_mode).toBe(false);
        (0, vitest_1.expect)(signals.deep_analysis).toBe(false);
        (0, vitest_1.expect)(signals.deep_research).toBe(false);
        (0, vitest_1.expect)(signals.force_pro).toBe(false);
    });
});
