/**
 * prefetchSources.ts — 부서별 Pre-fetch 소스 선언적 설정.
 *
 * 2026-04-29 신규 (Session 8 — Pre-fetch 도입).
 *
 * 설계:
 *   - Planner 가 부서를 결정한 직후, LLM 호출 전에 prefetchEngine 이 이 설정을 읽고
 *     모든 소스를 Promise.allSettled 로 병렬 수집.
 *   - 결과는 DepartmentAgent 시스템 프롬프트 끝에 "실시간 데이터" 블록으로 주입.
 *   - LLM Tool Calling 으로 외부 호출하지 않음 (토큰 비용 + latency 절감).
 *
 * 정책:
 *   - condition(query, userMessage) 가 true 인 소스만 실행.
 *   - FDA / EU TPD 등 해외 규제 소스는 userMessage 에 수출/해외 키워드가 있을 때만.
 *   - 식약처 RSS 는 식품·화장품 전용. 전자담배 규제는 기재부/환경부/지자체 조례.
 *   - 캐시 TTL 은 데이터 휘발성에 따라 분리: 시세 5분 / 뉴스 30분 / 규제 1~2시간.
 */

export type PrefetchSourceType = "rss" | "fetch" | "perplexity" | "naver"

export interface PrefetchSourceConfig {
  type: PrefetchSourceType
  /** 정적 URL (rss / fetch). naver / perplexity 는 query 함수로 동적 구성. */
  url?: string
  /** 사용자 query 를 외부 검색 쿼리로 변환 (perplexity / naver 전용). */
  query?: (q: string) => string
  /** 단일 소스 타임아웃 (ms). */
  timeout: number
  /** 캐시 TTL (초). */
  ttl: number
  /**
   * 실행 조건. query = Planner 가 만든 부서 task 텍스트, userMessage = 사용자 원문.
   *   FDA/EU 같은 해외 소스는 userMessage 의 수출 키워드로만 트리거.
   */
  condition: (query: string, userMessage: string) => boolean
}

export const DEPT_PREFETCH_SOURCES: Record<string, Record<string, PrefetchSourceConfig>> = {

  legal: {
    // 식품: 식약처 RSS
    mfds_food: {
      type: "rss",
      url: "https://www.mfds.go.kr/bbs/rss.do?bbsNo=166",
      timeout: 5000,
      ttl: 3600,
      condition: (q) => /식품|HACCP|표시|위생|건강기능/.test(q),
    },
    // 화장품: 식약처 RSS
    mfds_cosmetic: {
      type: "rss",
      url: "https://www.mfds.go.kr/bbs/rss.do?bbsNo=229",
      timeout: 5000,
      ttl: 3600,
      condition: (q) => /화장품|CGMP|기능성|코스메틱/.test(q),
    },
    // 전자담배: 담배사업법 본문 (법제처, lsiSeq=1912)
    // 2026-04-29 정정: 기존 lsiSeq=259299 는 "디지털의료제품법" 이었음 (#29 정오표).
    tobacco_law_main: {
      type: "fetch",
      url: "https://www.law.go.kr/lsInfoP.do?lsiSeq=1912",
      timeout: 10000,
      ttl: 7200,
      condition: (q) => /전자담배|액상|담배사업법|담배/.test(q),
    },
    // 전자담배: 기재부 보도자료 / 합성니코틴 관련 — 정적 URL 변동성으로 Perplexity 대체
    tobacco_mofe_news: {
      type: "perplexity",
      query: () => "담배사업법 개정 합성니코틴 액상전자담배 기재부 2025 2026",
      timeout: 8000,
      ttl: 3600,
      condition: (q) => /전자담배|액상|담배사업법|합성니코틴|기재부/.test(q),
    },
    // 환경부 보도자료 게시판 (정적 목록 페이지) — read.do (404) → index.do 로 정정
    moe_ecig_fetch: {
      type: "fetch",
      url: "https://www.me.go.kr/home/web/index.do?menuId=286",
      timeout: 10000,
      ttl: 3600,
      condition: (q) => /전자담배|액상|니코틴|폐기|환경/.test(q),
    },
    // 환경부 Perplexity 보완 — 화학물질 규제 / 폐액상 회수 등 게시판 검색 누락 보완
    moe_ecig_perplexity: {
      type: "perplexity",
      query: () => "환경부 전자담배 액상 니코틴 화학물질 규제 2025 2026",
      timeout: 8000,
      ttl: 3600,
      condition: (q) => /전자담배|액상|니코틴|폐기|환경/.test(q),
    },
    // 지자체 조례 — 자치법규정보시스템 elis 검색 URL 단종 → law.go.kr 자치법규 검색으로 대체
    local_law_national: {
      type: "fetch",
      url: "https://www.law.go.kr/ordinSc.do?menuId=3&subMenuId=13&tabMenuId=81&query=전자담배",
      timeout: 10000,
      ttl: 7200,
      condition: (q) => /전자담배|액상|담배|흡연|판매/.test(q),
    },
    // 지자체 조례 Perplexity 보완 — 시군구별 흡연/판매 제한 조례 동향
    local_ordinance_search: {
      type: "perplexity",
      query: () => "전자담배 액상 흡연 판매 조례 시군구 지자체 2025 2026",
      timeout: 8000,
      ttl: 7200,
      condition: (q) => /전자담배|액상|담배|흡연|판매|조례/.test(q),
    },
    // FDA: 수출 키워드 있을 때만
    fda_ecig: {
      type: "fetch",
      url: "https://www.fda.gov/tobacco-products/products-ingredients-components/vaporizers-e-cigarettes-and-other-electronic-nicotine-delivery-systems-ends",
      timeout: 12000,
      ttl: 3600,
      condition: (_q, msg) => /FDA|수출|미국|PMTA|해외/.test(msg),
    },
    // EU TPD: 수출 키워드 있을 때만
    eu_tpd: {
      type: "fetch",
      url: "https://health.ec.europa.eu/tobacco/product-regulation/e-cigarettes_en",
      timeout: 12000,
      ttl: 3600,
      condition: (_q, msg) => /EU|TPD|유럽|수출|해외/.test(msg),
    },
    // Perplexity 규제 뉴스 보완
    perplexity_regulation: {
      type: "perplexity",
      query: (q) => `${q} 규제 법규 최신 개정 2026`,
      timeout: 8000,
      ttl: 1800,
      condition: () => true,
    },
  },

  market: {
    perplexity_food_market: {
      type: "perplexity",
      query: (q) => `${q} 식품 시장 규모 트렌드 성장률 2026`,
      timeout: 8000,
      ttl: 1800,
      condition: (q) => /식품|음료|HMR|간편식|건강기능/.test(q),
    },
    perplexity_ecig_market: {
      type: "perplexity",
      query: (q) => `액상전자담배 ${q} 시장 규모 브랜드 트렌드 2026`,
      timeout: 8000,
      ttl: 1800,
      condition: (q) => /전자담배|액상|포드|일회용|기기/.test(q),
    },
    perplexity_cosmetic_market: {
      type: "perplexity",
      query: (q) => `K-Beauty 화장품 ${q} 시장 수출 트렌드 2026`,
      timeout: 8000,
      ttl: 1800,
      condition: (q) => /화장품|뷰티|스킨케어|색조/.test(q),
    },
    perplexity_general_market: {
      type: "perplexity",
      query: (q) => `${q} 시장 분석 규모 성장률 주요기업 2026`,
      timeout: 8000,
      ttl: 1800,
      condition: () => true,
    },
    naver_news: {
      type: "naver",
      query: (q) => q,
      timeout: 5000,
      ttl: 1800,
      condition: () => Boolean(process.env.NAVER_CLIENT_ID),
    },
  },

  compete: {
    perplexity_competitor: {
      type: "perplexity",
      query: (q) => `${q} 경쟁사 분석 제품 가격 유통 마케팅 전략 2026`,
      timeout: 8000,
      ttl: 1800,
      condition: () => true,
    },
    perplexity_ecig_competitor: {
      type: "perplexity",
      query: (q) => `액상전자담배 ${q} 브랜드 경쟁사 제품 라인업 2026`,
      timeout: 8000,
      ttl: 1800,
      condition: (q) => /전자담배|액상|담배|포드/.test(q),
    },
    naver_news: {
      type: "naver",
      query: (q) => `${q} 경쟁사`,
      timeout: 5000,
      ttl: 1800,
      condition: () => Boolean(process.env.NAVER_CLIENT_ID),
    },
  },

  rnd: {
    mfds_food: {
      type: "rss",
      url: "https://www.mfds.go.kr/bbs/rss.do?bbsNo=166",
      timeout: 5000,
      ttl: 3600,
      condition: (q) => /식품|원료|배합|레시피|공정|HACCP/.test(q),
    },
    mfds_cosmetic: {
      type: "rss",
      url: "https://www.mfds.go.kr/bbs/rss.do?bbsNo=229",
      timeout: 5000,
      ttl: 3600,
      condition: (q) => /화장품|성분|처방|포뮬러|INCI/.test(q),
    },
    perplexity_ingredient: {
      type: "perplexity",
      query: (q) => `${q} 원료 성분 규제 안전성 식약처 2026`,
      timeout: 8000,
      ttl: 3600,
      condition: () => true,
    },
    perplexity_equipment: {
      type: "perplexity",
      query: (q) => `${q} 제조설비 공급사 인증 HACCP ISO 2026`,
      timeout: 8000,
      ttl: 3600,
      condition: (q) => /설비|장비|공급사|제조|원료/.test(q),
    },
  },

  finance: {
    perplexity_finance: {
      type: "perplexity",
      query: (q) => `${q} 재무 시세 환율 주가 기업가치 2026 최신`,
      timeout: 8000,
      ttl: 300,   // 5분 (시세는 자주 변함)
      condition: () => true,
    },
  },

  marketing: {
    perplexity_marketing: {
      type: "perplexity",
      query: (q) => `${q} 마케팅 전략 브랜드 유통 채널 캠페인 2026`,
      timeout: 8000,
      ttl: 1800,
      condition: () => true,
    },
    naver_news: {
      type: "naver",
      query: (q) => `${q} 마케팅 트렌드`,
      timeout: 5000,
      ttl: 1800,
      condition: () => Boolean(process.env.NAVER_CLIENT_ID),
    },
  },

  data: {
    perplexity_data: {
      type: "perplexity",
      query: (q) => `${q} 데이터 통계 분석 보고서 2026`,
      timeout: 8000,
      ttl: 1800,
      condition: () => true,
    },
  },

  // 데이터 수집 불필요 (전부 LLM 자체 생성)
  content:   {},
  sns:       {},
  design:    {},
  simple_qa: {},
}
