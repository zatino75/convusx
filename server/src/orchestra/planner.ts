import type { CanonicalTask, CodeSubtask } from "../types/tasks.js"

// PlannedTask — CanonicalTask의 별칭 (하위호환)
export type { CanonicalTask as PlannedTask, CodeSubtask }

export type PlannerSignals = {
  benchmark_mode: boolean
  deep_analysis: boolean
  deep_research: boolean
  force_pro: boolean
  structured_output: boolean
}

function normalizeText(input: string) {
  return String(input ?? "").trim().toLowerCase()
}

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword))
}

// ── 점수 기반 의도 분류 핵심 함수 ──
// Claude/ChatGPT/Gemini 모두 LLM 자체로 라우팅을 결정하지만,
// 레이턴시 제약상 CORVUS X는 복합 시그널 스코어링으로 근사 구현.
// 규칙: 복합 표현("법률 검토") > 단일 키워드, 동사+목적어 > 동사 단독, 최고 점수 태스크 선택
function scoreTask(
  scores: Map<string, number>,
  task: string,
  keywords: string[],
  text: string,
  weight: number
) {
  for (const kw of keywords) {
    if (text.includes(kw)) {
      scores.set(task, (scores.get(task) ?? 0) + weight)
    }
  }
}

export function extractPlanningSignals(input: string): PlannerSignals {
  const text = normalizeText(input)

  const benchmark_mode = includesAny(text, [
    "benchmark", "eval", "evaluation", "테스트셋", "비교평가", "정량비교", "벤치마크"
  ])

  const deep_analysis = includesAny(text, [
    "deep analysis", "analyze deeply", "심층분석", "깊게 분석", "정밀 분석", "자세히 분석",
    "종합 분석", "전체적으로 분석", "다각도로", "다방면으로", "종합적으로", "철저하게",
    "상세히 분석", "자세하게 분석", "완전히 분석", "치밀하게", "면밀히",
    // 법률·계약 문서 분석은 본질적으로 심층 분석
    "법률 검토", "법적 검토", "소장", "소송장", "판결문", "계약서 분석", "계약서 검토"
  ])

  const deep_research = includesAny(text, [
    "deep research", "research deeply", "심층 리서치", "깊은 리서치", "정밀 리서치",
    "깊게 조사", "철저히 조사", "상세 조사", "자세히 조사", "종합적으로 조사",
    "전반적으로 조사", "리서치해줘", "리서치 해줘", "조사해줘", "조사 부탁",
    "최신 정보 조사", "최신 동향", "시장 조사", "트렌드 조사"
  ])

  const force_pro = includesAny(text, [
    "force_pro", "force pro", "use pro", "pro로", "pro 사용", "gpt-5.4-pro"
  ])

  const structured_output =
    includesAny(text, [
      "반드시 포함", "포함 항목", "포함해야", "포함하세요", "다음 섹션", "다음 항목",
      "다음 구조", "다음 내용", "섹션으로", "섹션을 포함", "구성해주세요", "구조로 작성",
      "1)", "2)", "3)", "첫째", "둘째", "셋째", "must include", "include the following",
      "following sections", "structured format"
    ]) || /(?:^|\s)\d+[\.)]\s+\S/.test(text)

  return {
    benchmark_mode,
    deep_analysis,
    deep_research,
    force_pro,
    structured_output
  }
}

export function detectCodeSubtask(input: string): CodeSubtask | null {
  const text = normalizeText(input)
  if (!includesAny(text, [
    "code", "coding", "debug", "debugging", "refactor", "bug", "typescript", "javascript",
    "tsx", "react", "node", "backend", "frontend", "빌드", "코드", "디버그", "리팩터",
    "버그", "에러 수정", "파이썬", "python", "함수", "짜줘", "구현해", "스크립트",
    "알고리즘", "클래스", "java", "golang", "rust", "swift", "kotlin", "sql", "html",
    "css", "api endpoint", "rest api"
  ])) return null

  if (includesAny(text, [
    "review", "code review", "pr review", "리뷰", "검토", "문제점 찾아", "보안 검토",
    "refactor", "refactoring", "리팩터", "리팩토링", "구조 개선", "중복 제거", "cleanup"
  ])) {
    return "code_refactor_review"
  }

  if (includesAny(text, [
    "debug", "bug", "error", "fix", "에러", "오류", "고쳐", "수정", "안 돼", "실패", "stack trace"
  ])) {
    return "code_debug"
  }

  return "code_implement"
}

// ── 메인 의도 분류 ──
// 설계 원칙 (ChatGPT/Claude/Gemini가 LLM 라우팅으로 하는 것을 휴리스틱으로 근사):
// 1. 복합 표현 (법률 검토, 코드 짜줘) = 단일 키워드 × 2배 이상 가중치
// 2. 도메인 객체 (소장, 판결문) = 고확신 시그널, 동사 맥락 없어도 충분
// 3. 동사 단독 (검토해줘, 분석해줘) = 약한 시그널 — 목적어 맥락이 있어야 확정
// 4. 모든 시그널 스캔 후 최고 점수 선택 (선착순 X)
// 5. 특수 태스크 (legal, code, finance) > 일반 태스크 (writing, reasoning)
export function detectTaskType(input: string): CanonicalTask {
  const text = normalizeText(input)
  const scores = new Map<string, number>()
  const s = (task: string, keywords: string[], weight: number) =>
    scoreTask(scores, task, keywords, text, weight)

  // ══════════════════════════════════════════
  // LEGAL REVIEW
  // ══════════════════════════════════════════
  // 법률 문서 객체 — 이게 있으면 무조건 legal_review (가장 강한 시그널)
  s("legal_review", [
    "소장", "소송장", "이혼소송장", "판결문", "고소장", "고발장", "소송위임장",
    "답변서", "준비서면", "기소장", "공소장", "항소장", "상고장", "조정조서"
  ], 12)
  // 법률 복합 표현 — "법률 검토", "법적 분석" 등 동사+도메인 조합
  s("legal_review", [
    "법률 검토", "법적 검토", "법률적인 검토", "법률적 검토", "법적 분석", "법률 분석",
    "법률적으로", "법률 리뷰", "법적 리뷰", "소송 대응", "법적 대응", "법적 위험",
    "법률 리스크", "법적 리스크", "법적 쟁점", "법률 자문", "법적 자문",
    "계약서 검토", "계약서 분석", "약관 검토", "약관 분석", "독소조항 확인"
  ], 10)
  // 법률 도메인 키워드 (단독으로도 strong)
  s("legal_review", [
    "소송", "계약서", "약관", "피고", "원고", "청구취지", "청구원인", "독소조항",
    "위자료", "양육권", "재산분할", "이혼", "고소", "고발", "가사소송", "민사소송",
    "형사소송", "행정소송", "법원", "판결", "조정", "이혼사유", "부정행위",
    "compliance", "규제 검토", "규정 검토"
  ], 5)
  // 약한 법률 시그널 (단독으로는 부족, 다른 시그널과 함께일 때 의미)
  s("legal_review", [
    "법률", "법적", "법학", "리걸", "legal", "변호사", "기한", "소제기", "위임장"
  ], 3)

  // ══════════════════════════════════════════
  // CODE
  // ══════════════════════════════════════════
  // 코드 복합 표현
  s("code_implement", [
    "코드 짜줘", "코드 작성해줘", "코드 만들어줘", "코드 구현", "스크립트 작성",
    "함수 만들어", "함수 작성", "컴포넌트 만들어", "api 만들어", "모듈 작성"
  ], 12)
  s("code_debug", [
    "코드 고쳐줘", "버그 고쳐", "에러 고쳐", "오류 수정", "디버그해줘",
    "왜 안 돼", "왜 에러", "stack trace", "수정해줘"
  ], 12)
  s("code_refactor_review", [
    "코드 검토해줘", "코드 리뷰해줘", "pr 리뷰", "리팩터링해줘", "코드 개선해줘",
    "구조 개선", "코드 품질"
  ], 12)
  // 코드 언어/기술 키워드
  s("code_implement", [
    "typescript", "javascript", "python", "react", "node", "nodejs", "sql",
    "html", "css", "java", "golang", "rust", "swift", "kotlin", "api endpoint",
    "rest api", "코드", "스크립트", "함수", "클래스", "알고리즘", "구현"
  ], 5)
  s("code_debug", [
    "버그", "에러", "오류", "디버그", "fix", "빌드 오류", "실패", "안 돌아가"
  ], 6)

  // ══════════════════════════════════════════
  // FINANCE ANALYSIS
  // ══════════════════════════════════════════
  s("finance_analysis", [
    "재무 분석", "투자 분석", "재무제표 분석", "수익성 분석", "밸류에이션 분석",
    "손익 분석", "현금흐름 분석"
  ], 12)
  s("finance_analysis", [
    "재무", "재무제표", "손익", "현금흐름", "밸류에이션", "valuation",
    "투자 분석", "financial analysis", "finance", "pbr", "roe", "per"
  ], 6)

  // ══════════════════════════════════════════
  // SPREADSHEET / SLIDES / WORD / PDF
  // ══════════════════════════════════════════
  s("excel", [
    "excel", "spreadsheet", "xlsx", "csv", "구글 시트", "google sheet",
    "엑셀", "스프레드시트", "피벗", "수식", "xlookup", "vlookup", "sumif"
  ], 10)
  s("ppt", [
    "ppt", "powerpoint", "presentation", "deck", "슬라이드", "발표자료",
    "피치덱", "프레젠테이션", "파워포인트"
  ], 10)
  s("word", [
    "word", "docx", "워드 문서", "워드파일", "formal document"
  ], 10)
  s("pdf", [
    "pdf 만들어", "pdf 생성", "pdf 변환", "pdf로"
  ], 8)

  // ══════════════════════════════════════════
  // DATA ANALYSIS
  // ══════════════════════════════════════════
  s("data_analysis", [
    "데이터 분석", "통계 분석", "kpi 분석", "차트 분석", "상관관계 분석",
    "지표 분석", "수치 분석"
  ], 10)

  // ══════════════════════════════════════════
  // PRODUCT DEVELOPMENT
  // ══════════════════════════════════════════
  s("product_development", [
    "상품 개발", "제품 개발", "상품 기획", "브랜딩 전략", "시장 진입", "유통 전략",
    "gtm", "go-to-market", "pricing strategy"
  ], 10)

  // ══════════════════════════════════════════
  // LONG DOC (대형 문서 처리)
  // ══════════════════════════════════════════
  s("long_doc", [
    "전체 문서 분석", "문서 전체 분석", "pdf 분석", "pdf 검토", "pdf 요약",
    "계약서 전체", "swot 분석", "경쟁사 분석", "전략 보고서 작성",
    "분석 보고서 작성", "전체 리포트"
  ], 10)
  s("long_doc", [
    "전체 내용", "문서 전체", "긴 문서", "장문", "전문 요약", "경영진 보고"
  ], 5)

  // ══════════════════════════════════════════
  // RESEARCH
  // ══════════════════════════════════════════
  s("research", [
    "최신 정보 조사", "시장 조사", "경쟁사 조사", "트렌드 조사", "업계 동향 조사"
  ], 10)
  s("research", [
    "리서치해줘", "리서치 해줘", "조사해줘", "검색해줘", "최신 정보", "팩트체크",
    "출처 확인", "트렌드 분석", "시장 동향", "업계 동향", "최근 동향",
    "최신 트렌드", "실시간", "오늘 기준", "현재 기준", "경쟁 브랜드",
    "ingredient research", "vaping regulation"
  ], 5)

  // ══════════════════════════════════════════
  // CREATIVE WRITING
  // ══════════════════════════════════════════
  s("writing_creative", [
    "소설 써줘", "시 써줘", "대본 써줘", "스토리 만들어줘", "광고 카피 써줘",
    "랩 가사 써줘", "가사 써줘", "동화 써줘"
  ], 12)
  s("writing_creative", [
    "소설", "단편소설", "장편소설", "시나리오", "대본", "극본", "드라마 대본",
    "광고 카피", "카피라이팅", "창작", "가사", "동화", "판타지", "sf 소설",
    "웹툰", "웹소설", "creative writing", "fiction", "poem", "lyrics", "screenplay"
  ], 6)

  // ══════════════════════════════════════════
  // BUSINESS WRITING
  // ══════════════════════════════════════════
  s("writing_business", [
    "이메일 초안", "이메일 작성해줘", "메일 초안", "제안서 작성", "기획서 작성",
    "사업계획서 작성", "투자 제안서", "ir 자료 작성", "공지문 작성", "보도자료 작성"
  ], 12)
  s("writing_business", [
    "이메일 써줘", "메일 작성", "답장 초안", "회신 초안", "공문 작성",
    "마케팅 문구", "홍보 문구", "피치덱 스크립트", "사업계획서", "비즈니스 플랜",
    "press release", "newsletter", "draft a", "write a proposal", "write an email",
    "랜딩페이지 카피", "상세페이지 작성", "회의록", "주간 보고", "인수인계 문서"
  ], 6)

  // ══════════════════════════════════════════
  // REASONING (판단·비교·설명)
  // ══════════════════════════════════════════
  s("reasoning", [
    "장단점 분석해줘", "pros and cons", "어떻게 생각해", "어느 쪽이 나아",
    "어떻게 판단해", "뭐가 더 좋아", "비교해줘"
  ], 10)
  s("reasoning", [
    "왜", "비교", "판단", "추론", "설계", "전략", "어떻게 결정", "어떻게 봐",
    "어떤 게 맞아", "뭐가 나아", "분석해줘", "평가해줘", "검토해줘",
    "리스크", "roi", "수익성", "장단점", "우선순위", "논리적으로",
    "근거를 들어", "최종 추천", "선택해야",
    "설명해줘", "알려줘", "뜻이 뭐야", "무슨 뜻", "차이가 뭐야", "차이점",
    "explain", "what is", "how does", "definition", "쉽게 설명"
  ], 3)

  // ══════════════════════════════════════════
  // GENERAL WRITING (요약·번역·정리 등 범용)
  // ── 가장 낮은 가중치 — 특수 태스크 신호가 있으면 항상 밀림 ──
  // ══════════════════════════════════════════
  s("writing", [
    "요약해줘", "요약해", "정리해줘", "정리해", "핵심만", "핵심 정리",
    "요점 정리", "한줄로", "summarize", "summary", "key points",
    "번역해줘", "번역해", "영어로", "한국어로", "translate",
    "표로 정리", "표 만들어", "테이블로", "비교표",
    "다시 써줘", "고쳐 써", "rewrite", "rephrase",
    "추천해줘", "제안해줘", "골라줘"
  ], 2)

  // ══════════════════════════════════════════
  // 최고 점수 태스크 선택
  // ══════════════════════════════════════════
  let bestTask: CanonicalTask = "dialogue"
  let bestScore = 0

  for (const [task, score] of scores.entries()) {
    if (score > bestScore) {
      bestScore = score
      bestTask = task as CanonicalTask
    }
  }

  // 신호 없으면 dialogue
  if (bestScore < 3) return "dialogue"

  // code_implement/debug/refactor → detectCodeSubtask로 세분화
  if (["code_implement", "code_debug", "code_refactor_review"].includes(bestTask)) {
    return bestTask
  }

  return bestTask
}

export function planRequest(input: string) {
  const task = detectTaskType(input)
  const code_subtask = task === "code" || task === "code_implement" || task === "code_debug" || task === "code_refactor_review"
    ? detectCodeSubtask(input)
    : null

  return {
    task,
    code_subtask,
    signals: extractPlanningSignals(input)
  }
}
