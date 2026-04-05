export type PlannerSignals = {
  benchmark_mode: boolean
  deep_analysis: boolean
  deep_research: boolean
  force_pro: boolean
  structured_output: boolean
}

export type PlannedTask =
  | "dialogue"
  | "reasoning"
  | "research"
  | "code"
  | "code_implement"
  | "code_debug"
  | "code_refactor_review"
  | "writing"
  | "writing_creative"
  | "writing_business"
  | "long_doc"
  | "word"
  | "pdf"
  | "excel"
  | "ppt"
  | "legal_review"
  | "data_analysis"
  | "finance_analysis"
  | "product_development"
  | "generic"

export type CodeSubtask = "code_implement" | "code_debug" | "code_refactor_review"

function normalizeText(input: string) {
  return String(input ?? "").trim().toLowerCase()
}

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword))
}

function hasSpreadsheetIntent(text: string) {
  return includesAny(text, [
    "excel", "spreadsheet", "sheet", "google sheet", "google sheets", "xlsx", "csv",
    "엑셀", "스프레드시트", "시트", "표 계산", "함수", "피벗", "피벗테이블", "수식",
    "xlookup", "vlookup", "sumif", "sumifs", "index match"
  ])
}

function hasSlideIntent(text: string) {
  return includesAny(text, [
    "ppt", "powerpoint", "slides", "slide deck", "presentation", "deck",
    "슬라이드", "발표자료", "피치덱", "프레젠테이션", "파워포인트"
  ])
}

function hasWordIntent(text: string) {
  return includesAny(text, [
    "word", "docx", "문서 작성", "워드 문서", "워드파일", "보고서 문안",
    "formal document", "business document"
  ])
}

function hasPdfIntent(text: string) {
  return includesAny(text, [
    "pdf", "pdf 분석", "pdf 검토", "pdf 요약", "pdf 추출", "문서에서 추출"
  ])
}

export function extractPlanningSignals(input: string): PlannerSignals {
  const text = normalizeText(input)

  const benchmark_mode = includesAny(text, [
    "benchmark", "eval", "evaluation", "테스트셋", "비교평가", "정량비교", "벤치마크"
  ])

  const deep_analysis = includesAny(text, [
    "deep analysis", "analyze deeply", "심층분석", "깊게 분석", "정밀 분석", "자세히 분석",
    "종합 분석", "전체적으로 분석", "다각도로", "다방면으로", "종합적으로", "철저하게",
    "상세히 분석", "자세하게 분석", "완전히 분석", "치밀하게", "면밀히"
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

export function detectTaskType(input: string): PlannedTask {
  const text = normalizeText(input)

  if (includesAny(text, [
    "계약서", "약관", "법률", "법적", "독소조항", "리걸", "legal", "compliance", "규제 검토", "규정 검토"
  ])) {
    return "legal_review"
  }

  if (includesAny(text, [
    "재무", "재무제표", "손익", "현금흐름", "밸류에이션", "valuation", "per", "pbr", "roe",
    "투자 분석", "financial analysis", "finance"
  ])) {
    return "finance_analysis"
  }

  if (hasSpreadsheetIntent(text)) {
    return "excel"
  }

  if (hasSlideIntent(text)) {
    return "ppt"
  }

  if (hasPdfIntent(text)) {
    return "pdf"
  }

  if (hasWordIntent(text)) {
    return "word"
  }

  if (includesAny(text, [
    "data analysis", "데이터 분석", "통계 분석", "지표 분석", "kpi 분석", "수치 분석", "차트 분석", "상관관계"
  ])) {
    return "data_analysis"
  }

  if (includesAny(text, [
    "product development", "상품 개발", "제품 개발", "상품 기획", "gtm", "go-to-market", "브랜드 포지셔닝",
    "브랜딩 전략", "시장 진입", "유통 전략", "pricing strategy"
  ])) {
    return "product_development"
  }

  const codeSubtask = detectCodeSubtask(text)
  if (codeSubtask) {
    return codeSubtask
  }

  if (includesAny(text, [
    "long document", "summarize document", "document analysis", "전체 문서", "긴 문서", "장문", "전문 요약",
    "전체 내용 분석", "문서 전체", "전체 리포트", "보고서 전체", "긴 보고서", "pdf 요약", "pdf 분석",
    "pdf 검토", "계약서 전체", "계약서 분석", "계약서 검토", "계약서 리뷰", "약관 분석", "약관 검토",
    "법적 검토", "법률 검토", "법적 위험", "법률 분석", "법률 리뷰", "법적 리스크", "독소조항",
    "보고서 작성", "리포트 작성", "분석 보고서", "분석 리포트", "인사이트 문서", "실행 계획서", "전략 보고서",
    "경영진 보고", "보고서 보완", "계획서 보완", "경쟁사 분석", "포지셔닝 보고서", "swot 분석"
  ])) {
    return "long_doc"
  }

  if (includesAny(text, [
    "소설", "단편소설", "장편소설", "시 써", "시를 써", "시 작성", "스크립트", "대본", "극본", "시나리오",
    "드라마 대본", "웹드라마", "광고 카피", "카피라이팅", "카피 작성", "슬로건", "스토리", "이야기를 써",
    "이야기를 만들어", "창작", "가사", "랩 가사", "동화", "판타지", "sf 소설", "호러", "로맨스", "추리소설",
    "에피소드", "웹툰", "웹소설", "단막극", "creative writing", "fiction", "short story", "poem", "lyrics",
    "screenplay", "copywriting", "write a story", "write a poem", "sns 글", "sns 포스팅", "인스타그램 글",
    "유튜브 스크립트", "브랜드 스토리", "브랜드 나레이티브", "자기소개서", "자소서", "cover letter",
    "블로그 포스트", "블로그 글", "에세이", "칼럼", "기고문"
  ])) {
    const hasAnalysisIntent = includesAny(text, ["분석해", "분석하고", "요약해", "검토해", "리뷰해", "analyze", "summarize", "review", "extract"])
    return hasAnalysisIntent ? "long_doc" : "writing_creative"
  }

  if (includesAny(text, [
    "이메일 초안", "이메일 작성", "이메일 써줘", "메일 작성", "메일 초안", "답장 초안", "회신 초안", "공문 작성",
    "공지문 작성", "기사 작성", "소개문", "마케팅 문구", "광고 문구", "홍보 문구", "브랜드 문서", "피치덱 스크립트",
    "ir 문서", "ir 자료", "제안서 작성", "기획서 작성", "전략 문서 작성", "b2b 제안서", "입점 제안서",
    "파트너십 제안서", "투자 제안서", "사업계획서", "비즈니스 플랜", "newsletter", "press release", "article writing",
    "draft a", "create a document", "write me a", "write a proposal", "write a report", "write an email",
    "마케팅 콘텐츠", "콘텐츠 작성", "상품 소개문", "제품 소개", "서비스 소개", "제품 설명서", "랜딩페이지 카피",
    "상세페이지 작성", "회의록", "회의 요약", "업무 보고", "주간 보고", "월간 보고", "인수인계 문서", "매뉴얼 작성", "가이드 작성"
  ])) {
    const hasAnalysisIntent = includesAny(text, ["분석해", "분석하고", "요약해", "검토해", "리뷰해", "analyze", "summarize", "review", "extract"])
    return hasAnalysisIntent ? "long_doc" : "writing_business"
  }

  if (includesAny(text, [
    "research", "fact-check", "fact check", "latest", "recent", "current", "verify with sources",
    "시장조사", "리서치", "조사해줘", "조사해", "최신 정보", "팩트체크", "출처 확인", "트렌드 분석",
    "시장 동향", "업계 동향", "최근 동향", "최신 트렌드", "news search", "검색해줘", "검색해", "실시간", "오늘 기준",
    "현재 기준", "데이터 조사", "통계 조사", "market data", "경쟁사 조사", "경쟁 브랜드", "유통 채널 조사",
    "입점 조건", "플랫폼 조사", "소비자 조사", "target audience", "ingredient research", "vaping regulation"
  ])) {
    return "research"
  }

  if (includesAny(text, [
    "reason", "reasoning", "why", "compare", "tradeoff", "trade-off", "decision", "설계", "전략", "판단", "비교", "추론",
    "왜", "어떻게 결정", "어떻게 생각해", "어떻게 봐", "어떻게 판단", "어떤 게 맞아", "뭐가 나아", "분석해줘",
    "평가해줘", "검토해줘", "리스크", "마진", "roi", "수익성", "어떤 것이 더", "어느 쪽이", "무엇이 더 나은",
    "더 적합", "장단점", "pros and cons", "우선순위", "단계적으로", "논리적으로", "근거를 들어", "최종 추천",
    "최종 결정", "선택해야"
  ])) {
    return "reasoning"
  }

  if (includesAny(text, ["write", "작성", "문안", "초안", "draft", "copy"])) {
    return "writing"
  }

  return "dialogue"
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
