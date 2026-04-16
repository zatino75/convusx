export type PlannedTaskType =
  | "dialogue"
  | "reasoning"
  | "research"
  | "deep_research"
  | "code_implement"
  | "code_debug"
  | "code_refactor_review"
  | "writing"
  | "writing_creative"
  | "writing_business"
  | "legal_review"
  | "finance_analysis"
  | "data_analysis"
  | "excel"
  | "ppt"
  | "pdf";

export type CodeSubtask = "implement" | "debug" | "refactor_review" | "generic";

export type PlanningSignals = {
  benchmark_mode: boolean;
  deep_analysis: boolean;
  deep_research: boolean;
  force_pro: boolean;
};

function normalize(input: string): string {
  return String(input ?? "").toLowerCase().trim();
}

function hasAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

export function detectCodeSubtask(input: string): CodeSubtask {
  const text = normalize(input);
  if (hasAny(text, ["디버그", "debug", "에러", "버그", "고쳐", "fix"])) return "debug";
  if (hasAny(text, ["리뷰", "review", "리팩토링", "refactor"])) return "refactor_review";
  if (hasAny(text, ["구현", "컴포넌트", "코드 짜", "build", "implement"])) return "implement";
  return "generic";
}

export function detectTaskType(input: string): PlannedTaskType {
  const text = normalize(input);

  if (!text) return "dialogue";

  if (hasAny(text, ["엑셀", "excel", "xlsx", "spreadsheet"])) return "excel";
  if (hasAny(text, ["ppt", "슬라이드", "powerpoint"])) return "ppt";
  if (hasAny(text, ["pdf"])) return "pdf";

  if (hasAny(text, ["계약서", "법률", "법무", "독소조항", "compliance", "legal"])) return "legal_review";
  if (hasAny(text, ["재무", "밸류에이션", "valuation", "손익", "재무제표", "financial"])) return "finance_analysis";
  if (hasAny(text, ["데이터 분석", "통계 분석", "analysis", "dataset", "지표 분석"])) return "data_analysis";

  const codeSubtask = detectCodeSubtask(text);
  if (codeSubtask === "debug") return "code_debug";
  if (codeSubtask === "refactor_review") return "code_refactor_review";
  if (codeSubtask === "implement") return "code_implement";

  if (hasAny(text, ["리서치", "research", "조사", "시장 동향", "트렌드 조사"])) return "research";

  if (hasAny(text, ["소설", "스토리", "시나리오", "카피라이팅", "브랜딩 문구", "다시 써", "써줘"])) return "writing_creative";
  if (hasAny(text, ["이메일", "공문", "보고서 초안", "제안서", "업무 메일"])) return "writing_business";

  if (hasAny(text, ["설명", "차이점", "비교", "추천", "뭐가 좋", "어떤 게 좋"])) return "reasoning";

  if (hasAny(text, ["요약", "정리", "번역", "translate", "표", "리스트", "변환", "톤 바꿔"])) return "writing";

  return "dialogue";
}

export function extractPlanningSignals(input: string): PlanningSignals {
  const text = normalize(input);
  return {
    benchmark_mode: hasAny(text, ["벤치마크", "benchmark", "성능 비교", "테스트 실행"]),
    deep_analysis: hasAny(text, ["심층분석", "심층 분석", "deep analysis"]),
    deep_research: hasAny(text, ["심층 리서치", "deep research", "deep-research"]),
    force_pro: hasAny(text, ["pro 모드", "force pro", "고급 모드", "최고 정확도"])
  };
}
