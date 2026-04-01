export type PlannerSignals = {
  benchmark_mode: boolean
  deep_analysis: boolean
  deep_research: boolean
  force_pro: boolean
  structured_output: boolean  // 메시지에 명시적 섹션/항목 요구가 있을 때
}

export type PlannedTask =
  | "dialogue"
  | "reasoning"
  | "research"
  | "code"
  | "writing"
  | "long_doc"

function normalizeText(input: string) {
  return String(input ?? "").trim().toLowerCase()
}

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword))
}

export function extractPlanningSignals(input: string): PlannerSignals {
  const text = normalizeText(input)

  const benchmark_mode = includesAny(text, [
    "benchmark",
    "eval",
    "evaluation",
    "테스트셋",
    "비교평가",
    "정량비교",
    "벤치마크"
  ])

  const deep_analysis = includesAny(text, [
    "deep analysis",
    "analyze deeply",
    "심층분석",
    "깊게 분석",
    "정밀 분석",
    "자세히 분석",
    "종합 분석",
    "전체적으로 분석",
    "다각도로",
    "다방면으로",
    "종합적으로",
    "철저하게",
    "상세히 분석",
    "자세하게 분석",
    "완전히 분석",
    "치밀하게",
    "면밀히"
  ])

  const deep_research = includesAny(text, [
    "deep research",
    "research deeply",
    "심층 리서치",
    "깊은 리서치",
    "정밀 리서치",
    "깊게 조사",
    "철저히 조사",
    "상세 조사",
    "자세히 조사",
    "종합적으로 조사",
    "전반적으로 조사",
    "리서치해줘",
    "리서치 해줘",
    "조사해줘",
    "조사 부탁",
    "최신 정보 조사",
    "최신 동향",
    "시장 조사",
    "트렌드 조사"
  ])

  const force_pro = includesAny(text, [
    "force_pro",
    "force pro",
    "use pro",
    "pro로",
    "pro 사용",
    "gpt-5.4-pro"
  ])

  // 명시적 섹션/항목 요구 감지 — 멀티섹션 구조 출력이 필요한 요청
  const structured_output =
    includesAny(text, [
      "반드시 포함", "포함 항목", "포함해야", "포함하세요",
      "다음 섹션", "다음 항목", "다음 구조", "다음 내용",
      "섹션으로", "섹션을 포함", "구성해주세요", "구조로 작성",
      "1)", "2)", "3)", "첫째", "둘째", "셋째",
      "must include", "include the following", "following sections", "structured format"
    ]) ||
    // "1. xxx 2. xxx 3. xxx" 패턴 감지
    /(?:^|\s)\d+[\.\)]\s+\S/.test(text)

  return {
    benchmark_mode,
    deep_analysis,
    deep_research,
    force_pro,
    structured_output
  }
}

export function detectTaskType(input: string): PlannedTask {
  const text = normalizeText(input)

  // ─── 1. CODE — 코딩/개발 요청 ───────────────────────────────────────────────
  if (
    includesAny(text, [
      "code", "coding", "debug", "debugging", "refactor", "bug",
      "typescript", "javascript", "tsx", "react", "node",
      "backend", "frontend", "compile", "build error",
      "빌드", "코드", "디버그", "리팩터", "버그", "에러 수정",
      "파이썬", "python", "함수", "짜줘", "구현해", "스크립트",
      "알고리즘", "클래스", "자바", "java", "golang", "go",
      "rust", "swift", "kotlin", "sql", "데이터베이스", "database",
      "html", "css",
      // PowerShell / shell scripting
      "powershell", "파워셸", "파워쉘", "bash script", "shell script",
      "ps1", "bat 파일", "cmd 스크립트",
      // API 키워드는 개발 컨텍스트에서만 (리서치 키워드와 구분)
      "api endpoint", "rest api", "graphql", "api server"
    ])
  ) {
    return "code"
  }

  // ─── 2. LONG_DOC — 문서 분석/추출/요약 (writing보다 먼저 체크) ──────────────
  // 핵심 기준: 기존 문서를 읽고 분석/요약/검토하는 작업
  if (
    includesAny(text, [
      // 문서 분석 명시
      "long document", "summarize document", "document analysis",
      "전체 문서", "긴 문서", "장문", "전문 요약", "전체 내용 분석",
      "문서 전체", "전체 리포트", "보고서 전체", "긴 보고서",
      "pdf 요약", "pdf 분석", "pdf 검토",
      // 계약서/법률 문서 분석
      "계약서 전체", "계약서 분석", "계약서 검토", "계약서 리뷰",
      "약관 분석", "약관 검토", "법적 검토", "법률 검토", "법적 위험",
      "법률 분석", "법률 리뷰", "법적 리스크", "독소조항", "legal review",
      // 보고서/문서 작성 (분석 기반 생성)
      "보고서 작성", "리포트 작성", "분석 보고서", "분석 리포트",
      "인사이트 문서", "실행 계획서", "전략 보고서", "경영진 보고",
      "보고서 보완", "계획서 보완",
      // 재무/데이터 문서 분석
      "재무제표 분석", "재무 분석", "재무정보", "재무분석",
      "손익계산서", "밸류에이션", "투자분석", "공시 분석", "financial analysis",
      "재무 데이터", "분기별 데이터", "수치 분석", "수치 요약",
      // 경쟁사/시장 심층 분석 문서
      "경쟁사 분석", "포지셔닝 보고서", "swot 분석"
    ])
  ) {
    return "long_doc"
  }

  // ─── 3. WRITING — 순수 콘텐츠 창작/생성 ────────────────────────────────────
  // 핵심 기준: 새로운 텍스트/콘텐츠를 처음부터 창작하는 작업
  if (
    includesAny(text, [
      // 명시적 콘텐츠 유형
      "blog post", "blog article", "newsletter", "press release",
      "copywriting", "essay writing", "article writing",
      "블로그 포스트", "블로그 글", "블로그 작성",
      "이메일 초안", "이메일 작성", "메일 작성",
      "기사 작성", "보도자료", "에세이",
      "소개문", "카피라이팅", "마케팅 문구",
      "sns 글", "sns 포스팅", "광고 문구",
      "자기소개서", "cover letter",
      // 브랜드/마케팅 문서 창작
      "브랜드 아이덴티티", "브랜드 스토리", "브랜드 문서",
      "피칭 나레이티브", "피치덱 스크립트", "ir 문서",
      "제안서 작성", "기획서 작성", "전략 문서 작성",
      "b2b 제안서", "입점 제안서",
      // 영문 creative writing
      "write a", "draft a", "create a document", "write me"
    ])
  ) {
    // 추가 검증: 분석/요약 키워드가 함께 있으면 long_doc으로 fallback
    const hasAnalysisIntent = includesAny(text, [
      "분석해", "분석하고", "요약해", "검토해", "리뷰해",
      "analyze", "summarize", "review", "extract"
    ])
    if (hasAnalysisIntent) return "long_doc"
    return "writing"
  }

  // ─── 4. RESEARCH — 조사/검색/팩트체크 ─────────────────────────────────────
  if (
    includesAny(text, [
      "research", "fact-check", "fact check",
      "latest", "recent", "current",
      "verify with sources",
      "시장조사", "리서치", "조사해줘", "조사해",
      "최신 정보", "팩트체크", "출처 확인",
      "트렌드 분석", "시장 동향", "업계 동향",
      "최근 동향", "최신 트렌드",
      "news search", "검색해줘", "검색해",
      "실시간", "오늘 기준", "현재 기준",
      // 데이터/통계 조사
      "데이터 분석", "통계 분석", "데이터 시각화",
      "csv 분석", "엑셀 분석", "kpi 분석", "data analysis",
      // 상품/시장 조사
      "상품 개발", "제품 개발", "상품 기획", "브랜딩 전략", "시장 분석",
      "gtm 전략", "product development",
      // 식품/원료 조사
      "성분 분석", "원료 조사", "원료 분석", "성분 조사", "배합 조사",
      "원료 트렌드", "식품 트렌드", "식품 성분", "영양 성분",
      "식품 규제", "식품 법규", "food trend", "ingredient research",
      // 액상전자담배 조사
      "액상 성분", "니코틴 함량", "전자담배 규제", "액상 트렌드",
      "vape trend", "e-liquid research", "vaping regulation",
      "pg/vg", "pg vg", "향료 조사", "플레이버 트렌드",
      // 브랜딩/유통 리서치
      "경쟁사 조사", "경쟁 브랜드", "브랜드 포지셔닝 조사",
      "유통 채널 조사", "입점 조건", "플랫폼 조사",
      "소비자 조사", "target audience", "고객 조사"
    ])
  ) {
    return "research"
  }

  // ─── 5. REASONING — 논리적 판단/비교/추론 ──────────────────────────────────
  if (
    includesAny(text, [
      "reason", "reasoning", "why", "compare",
      "tradeoff", "trade-off", "decision",
      "설계", "전략", "판단", "비교", "추론",
      "왜", "어떻게 결정",
      // 리스크/마진 계산
      "리스크", "마진", "roi", "수익성",
      // 의사결정 패턴
      "어떤 것이 더", "어느 쪽이", "무엇이 더 나은", "더 적합",
      "장단점", "pros and cons", "우선순위",
      // 복잡한 판단 요구
      "단계적으로", "논리적으로", "근거를 들어",
      "최종 추천", "최종 결정", "선택해야",
      // 브랜딩/유통 전략 판단
      "유통 전략", "입점 전략", "채널 전략", "포지셔닝 전략",
      "가격 전략", "pricing strategy", "브랜드 전략",
      "어떤 채널", "어느 플랫폼", "어떤 유통",
      // 식품/제품 배합 판단
      "배합 비율", "레시피 최적화", "원료 선정", "성분 선택",
      "어떤 원료", "어떤 성분", "포뮬레이션",
      // 전자담배 판단
      "액상 배합", "니코틴 농도 선택", "플레이버 방향",
      "어떤 액상", "pg vg 비율"
    ])
  ) {
    return "reasoning"
  }

  // ─── 6. DIALOGUE — 일반 대화 (기본값) ─────────────────────────────────────
  return "dialogue"
}

export function planRequest(input: string) {
  const task = detectTaskType(input)
  const signals = extractPlanningSignals(input)

  return {
    task,
    signals
  }
}
