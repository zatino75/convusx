// regulationSources.ts — 자동 법규 갱신 소스 카탈로그 (Phase 4-B)
//
// 식품/액상전자담배/화장품 카테고리별로 규제 공식 출처를 나열한다.
// regulationWatcher 는 이 카탈로그를 주기적으로 순회하며 변경 사항을 감지한다.

export type RegulationCategory = "food" | "ecig" | "cosmetic" | "general"

export type RegulationSource = {
  id: string
  category: RegulationCategory
  title: string
  /** 공식 페이지 URL (사용자·캐시·에이전트 답변의 citation 으로 사용) */
  url: string
  /** Perplexity 에 넘길 최신 변경 감지 질의문 */
  watch_query: string
  /** 변경 감지 주기 (일) — 규제 중요도에 따라 다름 */
  interval_days: number
  /** 최종 목적 — agent loop 가 답변에 인용할 때 사용하는 도메인 힌트 */
  domain_hint: string
}

export const REGULATION_SOURCES: RegulationSource[] = [
  // ── 식품 ──────────────────────────────────────────────────────────────
  {
    id: "food-mfds-notice",
    category: "food",
    title: "식품의약품안전처 법령·고시·훈령",
    url: "https://www.mfds.go.kr",
    watch_query:
      "식품의약품안전처 식품위생법 식품첨가물공전 식품등의 표시·광고에 관한 법률 최근 개정 고시 훈령 변경사항",
    interval_days: 1,
    domain_hint: "food_regulation",
  },
  {
    id: "food-haccp-notice",
    category: "food",
    title: "HACCP 인증 고시 (한국식품안전관리인증원)",
    url: "https://www.haccp.or.kr",
    watch_query: "HACCP 고시 개정 식품안전관리인증기준 변경 최근 공고",
    interval_days: 7,
    domain_hint: "food_haccp",
  },
  {
    id: "food-import-act",
    category: "food",
    title: "수입식품안전관리 특별법",
    url: "https://www.law.go.kr",
    watch_query: "수입식품안전관리 특별법 시행령 시행규칙 최근 개정",
    interval_days: 7,
    domain_hint: "food_import",
  },
  {
    id: "food-health-functional",
    category: "food",
    title: "건강기능식품에 관한 법률 & 기능성 인정 고시",
    url: "https://www.mfds.go.kr",
    watch_query: "건강기능식품에 관한 법률 기능성 원료 인정 고시 최근 개정",
    interval_days: 7,
    domain_hint: "food_functional",
  },

  // ── 액상전자담배 ───────────────────────────────────────────────────────
  {
    id: "ecig-tobacco-act",
    category: "ecig",
    title: "담배사업법 & 기재부 고시 (액상전자담배 정의·과세)",
    url: "https://www.law.go.kr",
    watch_query:
      "담배사업법 기획재정부 고시 개별소비세법 지방세법 액상전자담배 니코틴 유사담배제품 최근 개정",
    interval_days: 1,
    domain_hint: "ecig_tax_definition",
  },
  {
    id: "ecig-health-promotion",
    category: "ecig",
    title: "국민건강증진법 (광고·판매 제한)",
    url: "https://www.law.go.kr",
    watch_query: "국민건강증진법 제9조의4 전자담배 광고 미성년자 판매 제한 최근 개정",
    interval_days: 7,
    domain_hint: "ecig_advertising",
  },
  {
    id: "ecig-fda-pmta",
    category: "ecig",
    title: "FDA PMTA / Deeming Rule (미국 시장)",
    url: "https://www.fda.gov/tobacco-products",
    watch_query:
      "FDA PMTA Premarket Tobacco Application ENDS deeming rule e-liquid vape recent update",
    interval_days: 14,
    domain_hint: "ecig_fda",
  },
  {
    id: "ecig-eu-tpd",
    category: "ecig",
    title: "EU Tobacco Products Directive (TPD)",
    url: "https://health.ec.europa.eu/tobacco/products-directive_en",
    watch_query:
      "EU Tobacco Products Directive TPD e-cigarette nicotine limit packaging warning recent amendment",
    interval_days: 14,
    domain_hint: "ecig_eu",
  },

  // ── 화장품 ────────────────────────────────────────────────────────────
  {
    id: "cosmetic-act",
    category: "cosmetic",
    title: "화장품법 & 시행령·시행규칙",
    url: "https://www.law.go.kr",
    watch_query: "화장품법 시행령 시행규칙 최근 개정 식약처 화장품정책과",
    interval_days: 7,
    domain_hint: "cosmetic_act",
  },
  {
    id: "cosmetic-safety",
    category: "cosmetic",
    title: "화장품 안전기준 등에 관한 규정",
    url: "https://www.mfds.go.kr",
    watch_query: "화장품 안전기준 등에 관한 규정 고시 개정 사용금지 원료 최근 변경",
    interval_days: 7,
    domain_hint: "cosmetic_safety",
  },
  {
    id: "cosmetic-functional",
    category: "cosmetic",
    title: "기능성화장품 심사에 관한 규정",
    url: "https://www.mfds.go.kr",
    watch_query: "기능성화장품 심사에 관한 규정 고시 미백 주름 자외선차단 최근 개정",
    interval_days: 14,
    domain_hint: "cosmetic_functional",
  },
  {
    id: "cosmetic-cgmp",
    category: "cosmetic",
    title: "우수화장품 제조 및 품질관리기준 (CGMP)",
    url: "https://www.mfds.go.kr",
    watch_query: "우수화장품 제조 및 품질관리기준 CGMP 고시 최근 개정",
    interval_days: 14,
    domain_hint: "cosmetic_cgmp",
  },

  // ── 범용 ──────────────────────────────────────────────────────────────
  {
    id: "general-fair-trade",
    category: "general",
    title: "표시·광고의 공정화에 관한 법률",
    url: "https://www.law.go.kr",
    watch_query: "표시광고의 공정화에 관한 법률 공정거래위원회 심사지침 최근 개정",
    interval_days: 14,
    domain_hint: "general_advertising",
  },
  {
    id: "general-privacy",
    category: "general",
    title: "개인정보 보호법",
    url: "https://www.pipc.go.kr",
    watch_query: "개인정보 보호법 시행령 개인정보보호위원회 최근 개정 고시",
    interval_days: 14,
    domain_hint: "general_privacy",
  },
  {
    id: "general-ecommerce",
    category: "general",
    title: "전자상거래 등에서의 소비자보호에 관한 법률",
    url: "https://www.law.go.kr",
    watch_query: "전자상거래법 소비자보호 공정거래위원회 시행령 최근 개정",
    interval_days: 14,
    domain_hint: "general_ecommerce",
  },
]

export function getSourcesByCategory(cat: RegulationCategory): RegulationSource[] {
  return REGULATION_SOURCES.filter((s) => s.category === cat)
}

export function getSourceById(id: string): RegulationSource | null {
  return REGULATION_SOURCES.find((s) => s.id === id) ?? null
}
