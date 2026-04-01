export type BenchmarkRunResult = {
  case_id: string
  mode: string
  label: string
  raw_result: any
  evaluation: any
}

type BenchmarkCase = {
  id: string
  label: string
  input: {
    task: string
    message: string
  }
}

// text_quality_score: orchestration 신호 제외 순수 텍스트 품질 (fair comparison 기준)
// quality_score: orchestration 보너스 포함 전체 점수 (orchestra 구조 가치 측정용)
function getScore(run: BenchmarkRunResult | undefined): number {
  return Number(
    run?.evaluation?.text_quality_score ??
    run?.evaluation?.quality_score ??
    run?.evaluation?.score ??
    0
  )
}

function getFullScore(run: BenchmarkRunResult | undefined): number {
  return Number(run?.evaluation?.quality_score ?? run?.evaluation?.score ?? 0)
}

const KNOWN_TASKS = ["dialogue", "reasoning", "research", "code", "writing", "long_doc"] as const
type KnownTask = typeof KNOWN_TASKS[number]

function isKnownTask(value: string): value is KnownTask {
  return (KNOWN_TASKS as readonly string[]).includes(value)
}

function normalizeTask(value: any): string {
  const text = String(value ?? "").trim().toLowerCase()

  if (text.includes("code")) return "code"
  if (text.includes("long_doc") || text.includes("long_document")) return "long_doc"
  if (text.includes("writing") || text.includes("write")) return "writing"
  if (text.includes("research")) return "research"
  if (text.includes("reasoning")) return "reasoning"
  if (text.includes("dialogue")) return "dialogue"

  return text
}

function getTask(run: BenchmarkRunResult | undefined): string {
  const caseId = String(run?.case_id ?? "").toLowerCase()

  if (caseId.startsWith("code_")) return "code"
  if (caseId.startsWith("long_doc_")) return "long_doc"
  if (caseId.startsWith("writing_")) return "writing"
  if (caseId.startsWith("research_")) return "research"
  if (caseId.startsWith("reasoning_")) return "reasoning"
  if (caseId.startsWith("dialogue_")) return "dialogue"

  const plannerTask = normalizeTask(run?.raw_result?.planner_plan?.task)
  if (isKnownTask(plannerTask)) return plannerTask

  const routerTask = normalizeTask(run?.raw_result?.router_decision?.task)
  if (isKnownTask(routerTask)) return routerTask

  const finalJudgeTask = normalizeTask(run?.raw_result?.final_answer?.judge_trace?.task)
  if (isKnownTask(finalJudgeTask)) return finalJudgeTask

  const judgeTask = normalizeTask(run?.raw_result?.judge_trace?.task)
  if (isKnownTask(judgeTask)) return judgeTask

  const labelTask = normalizeTask(run?.label)
  if (isKnownTask(labelTask)) return labelTask

  const modeTask = normalizeTask(run?.mode)
  if (isKnownTask(modeTask)) return modeTask

  return "unknown"
}

function getWinnerProvider(run: BenchmarkRunResult | undefined): string | null {
  return (
    run?.raw_result?.final_answer?.winner_snapshot?.provider ??
    run?.raw_result?.winner_provider ??
    null
  )
}

function groupByCaseId(runs: BenchmarkRunResult[]): Record<string, BenchmarkRunResult[]> {
  const grouped: Record<string, BenchmarkRunResult[]> = {}

  for (const run of runs) {
    if (!grouped[run.case_id]) {
      grouped[run.case_id] = []
    }
    grouped[run.case_id].push(run)
  }

  return grouped
}

export function toBenchmarkRunResult(
  result: any,
  benchmarkCase: any,
  mode: string,
  evaluation: any
): BenchmarkRunResult {
  return {
    case_id: benchmarkCase.id,
    mode,
    label: benchmarkCase.label,
    raw_result: result,
    evaluation
  }
}

export function buildDefaultBenchmarkCases(): BenchmarkCase[] {
  return [
    {
      id: "dialogue_basic_1",
      label: "dialogue",
      input: {
        task: "dialogue",
        message: "브랜드 차별화 전략을 간단히 설명해 주세요."
      }
    },
    {
      id: "dialogue_basic_2",
      label: "dialogue",
      input: {
        task: "dialogue",
        message: "신규 건강음료 브랜드의 핵심 고객과 핵심 가치 제안을 1문단으로 설명해 주세요."
      }
    },
    {
      id: "dialogue_basic_3",
      label: "dialogue",
      input: {
        task: "dialogue",
        message: "프리미엄 RTD 차음료 브랜드가 대중 브랜드와 어떻게 다른지 짧고 명확하게 설명해 주세요."
      }
    },
    {
      id: "dialogue_basic_4",
      label: "dialogue",
      input: {
        task: "dialogue",
        message: "오프라인 매장용 음료 브랜드 소개 문구를 실무적으로 작성해 주세요."
      }
    },
    {
      id: "dialogue_basic_5",
      label: "dialogue",
      input: {
        task: "dialogue",
        message: "기존 음료 시장에서 새로운 브랜드가 살아남기 위한 차별점 3가지를 짧게 설명해 주세요."
      }
    },

    {
      id: "reasoning_basic_1",
      label: "reasoning",
      input: {
        task: "reasoning",
        message: "보수적인 운영자에게 Strategy A vs Strategy B 중 무엇이 더 적합한지 이유와 함께 설명해 주세요."
      }
    },
    {
      id: "reasoning_basic_2",
      label: "reasoning",
      input: {
        task: "reasoning",
        message: "Strategy A는 마진이 높지만 재고 리스크가 크고, Strategy B는 마진이 낮지만 현금흐름이 안정적입니다. 보수적 운영자 기준으로 어떤 선택이 더 적합한지 단계적으로 설명해 주세요."
      }
    },
    {
      id: "reasoning_basic_3",
      label: "reasoning",
      input: {
        task: "reasoning",
        message: "단기 생존이 중요한 초기 브랜드라면 고마진 고위험 전략과 저마진 저위험 전략 중 무엇을 선택해야 하는지 근거를 들어 설명해 주세요."
      }
    },
    {
      id: "reasoning_basic_4",
      label: "reasoning",
      input: {
        task: "reasoning",
        message: "전략 A는 성장성이 높고 전략 B는 실패 확률이 낮습니다. 보수적인 창업자에게 어느 쪽이 더 적합한지 논리적으로 정리해 주세요."
      }
    },
    {
      id: "reasoning_basic_5",
      label: "reasoning",
      input: {
        task: "reasoning",
        message: "리스크, 마진, 실행 난이도를 함께 고려할 때 초기 식음료 브랜드 운영자는 어떤 전략을 선택해야 하는지 최종 추천까지 포함해 주세요."
      }
    },

    {
      id: "research_basic_1",
      label: "research",
      input: {
        task: "research",
        message: "온라인 판매 vs 오프라인 리테일 확장의 장단점을 비교하고 어떤 전략이 더 적합한지 추천해 주세요."
      }
    },
    {
      id: "research_basic_2",
      label: "research",
      input: {
        task: "research",
        message: "프리미엄 음료 브랜드 런칭 시 D2C 우선 전략과 리테일 우선 전략을 비교하고 최종 권고안을 제시해 주세요."
      }
    },
    {
      id: "research_basic_3",
      label: "research",
      input: {
        task: "research",
        message: "초기 건강식품 브랜드가 온라인 자사몰 중심으로 갈지, 편집샵 입점 중심으로 갈지 비교하고 추천해 주세요."
      }
    },
    {
      id: "research_basic_4",
      label: "research",
      input: {
        task: "research",
        message: "브랜드 인지도는 약하지만 제품력은 좋은 스타트업이 유통 전략을 짤 때 온라인 중심과 오프라인 중심 중 무엇이 더 나은지 비교해 주세요."
      }
    },
    {
      id: "research_basic_5",
      label: "research",
      input: {
        task: "research",
        message: "하이브리드 유통 전략이 D2C 단독 전략보다 나은 경우와 그렇지 않은 경우를 비교하고 최종 전략을 추천해 주세요."
      }
    },

    {
      id: "code_basic_1",
      label: "code",
      input: {
        task: "code",
        message: "Node.js에서 provider router 구조를 구현하는 간단한 TypeScript 예시 코드를 보여주세요."
      }
    },
    {
      id: "code_basic_2",
      label: "code",
      input: {
        task: "code",
        message: "여러 AI provider를 호출하고 실패 시 fallback 하는 TypeScript orchestration 함수 예시를 작성해 주세요."
      }
    },
    {
      id: "code_basic_3",
      label: "code",
      input: {
        task: "code",
        message: "OpenAI와 Claude 중 더 나은 응답을 선택하는 backend judge 함수를 TypeScript로 설계해 주세요."
      }
    },
    {
      id: "code_basic_4",
      label: "code",
      input: {
        task: "code",
        message: "scoreboard 기반으로 provider 응답을 평가하고 최종 winner를 반환하는 TypeScript 코드를 보여주세요."
      }
    },
    {
      id: "code_basic_5",
      label: "code",
      input: {
        task: "code",
        message: "planner → execution → judge 흐름을 갖는 간단한 Node.js orchestration 예시를 TypeScript로 작성해 주세요."
      }
    },

    {
      id: "writing_basic_1",
      label: "writing",
      input: {
        task: "writing",
        message: "신규 프리미엄 기능성 음료 브랜드 '핏워터(FitWater)'의 브랜드 아이덴티티 문서를 작성해 주세요. 반드시 다음 섹션을 포함해야 합니다: 1) 브랜드 철학 및 핵심 가치 2) 타깃 고객 페르소나 (구체적 특성 포함) 3) 경쟁 브랜드 대비 포지셔닝 4) 슬로건 3가지 (각각 다른 톤으로) 5) 채널별 커뮤니케이션 가이드라인"
      }
    },
    {
      id: "writing_basic_2",
      label: "writing",
      input: {
        task: "writing",
        message: "국내 편의점 3사(CU, GS25, 세븐일레븐)를 동시 공략하는 신제품 RTD 차음료 런칭 전략 문서를 작성해 주세요. 포함 항목: 1) 채널별 입점 전략 차별화 2) SKU 구성 및 가격 포지셔닝 3) 론칭 첫 3개월 판촉 캘린더 4) 채널별 예상 마진 구조 5) 성과 측정 KPI 설정"
      }
    },
    {
      id: "writing_basic_3",
      label: "writing",
      input: {
        task: "writing",
        message: "시리즈A 투자 유치를 위한 식음료 스타트업 피칭 나레이티브를 작성해 주세요. 구조: 1) 해결하는 문제 (시장 데이터 기반 서술) 2) 우리의 솔루션과 차별점 3) 시장 규모 및 성장성 4) 비즈니스 모델과 수익 구조 5) 지금까지의 트랙션 6) 투자금 사용 계획. 각 섹션은 투자자 설득력이 있어야 합니다."
      }
    },
    {
      id: "writing_basic_4",
      label: "writing",
      input: {
        task: "writing",
        message: "대형 유통사(롯데마트, 이마트) 입점을 위한 B2B 제안서를 작성해 주세요. 다음 요소를 모두 포함: 1) 브랜드 및 제품 라인업 소개 (차별점 중심) 2) 카테고리 내 경쟁 현황 및 공백 분석 3) 예상 판매 데이터 및 회전율 근거 4) 유통사 측 마진 구조 제안 5) 마케팅 지원 계획 6) 단계별 협력 로드맵"
      }
    },
    {
      id: "writing_basic_5",
      label: "writing",
      input: {
        task: "writing",
        message: "브랜드 리포지셔닝이 필요한 기존 식음료 브랜드를 위한 전략 리포트를 작성해 주세요. 구성: 1) 현재 브랜드 포지션 진단 (강점/약점) 2) 시장 환경 변화 분석 3) 리포지셔닝 방향 3가지 옵션 (각 장단점) 4) 권고 방향 및 근거 5) 실행 로드맵 (6개월 단위) 6) 예상 리스크 및 대응 방안. 각 섹션은 근거와 논리를 명확히 해야 합니다."
      }
    },

    {
      id: "long_doc_basic_1",
      label: "long_doc",
      input: {
        task: "long_doc",
        message: "다음 유통 계약서 전문에서 계약 당사자 입장에서 반드시 검토해야 할 항목을 분석해 주세요. 분석 구조: 1) 핵심 의무 조항 요약 2) 잠재 리스크 항목 (우선순위 순) 3) 협상 가능한 조항 식별 4) 즉시 거부해야 할 독소 조항 여부 5) 최종 계약 체결 권고 여부 및 근거. 계약 내용: '을(을)은 갑의 사전 서면 동의 없이 제3자에게 재판매, 재위탁, 재라이선스할 수 없다. 을이 월 최소 발주 수량(MOQ) 500박스를 3개월 연속 미달성 시 갑은 사전 통보 없이 계약을 해지할 수 있다. 독점 판매권은 서울 및 경기 지역으로 한정하며, 을이 동 지역 외에서 판매 활동을 할 경우 위약금으로 계약 총액의 20%를 갑에게 지급한다. 계약 기간은 1년이며, 만료 30일 전까지 서면 해지 통보가 없으면 동일 조건으로 자동 갱신된다. 가격 인상은 갑이 60일 전 통보로 일방적으로 결정할 수 있다.'"
      }
    },
    {
      id: "long_doc_basic_2",
      label: "long_doc",
      input: {
        task: "long_doc",
        message: "다음 시장 조사 보고서를 분석하여 경영진 보고용 실행 인사이트 문서를 작성해 주세요. 포함 항목: 1) 핵심 수치 요약 (경영진이 즉시 파악해야 할 데이터) 2) 시장 기회 영역 3가지 (근거 포함) 3) 대응이 필요한 위협 요소 2가지 4) 즉시 실행 가능한 전략 액션 아이템 5가지 5) 6개월 내 우선순위 제안. 보고서 내용: '2025년 국내 RTD 음료 시장 규모 2조 5천억 원 (전년比 +8%). 건강기능성 제품 비중 35%, 전년比 +7%p 급성장. MZ세대 소비 비중 42%, 주요 구매 동기는 건강관리(68%), 편의성(54%), 가성비(31%) 순. 편의점 채널 성장률 12% (온라인 채널 9% 상회). 경쟁사 A사 신제품 라인 출시 예정 (Q3), 경쟁사 B사 편의점 전용 SKU 확대 중. 소비자 브랜드 전환 의향 41% — 차별화 요소 부재 시 이탈 위험 높음. 프리미엄 가격대(3,000원 이상) 수용도 28%, 전년比 +6%p 증가.'"
      }
    },
    {
      id: "long_doc_basic_3",
      label: "long_doc",
      input: {
        task: "long_doc",
        message: "다음 내부 전략 문서를 검토하고 실행 계획서를 보완해 주세요. 보완 내용: 1) 각 실행 항목의 선행 조건 및 의존 관계 정리 2) 누락된 리스크 항목 추가 식별 3) 타임라인 현실성 검토 및 수정 제안 4) 예산 배분 우선순위 제안 5) 성과 측정 기준(KPI) 추가. 원본 문서: 'Q2 목표: 편의점 3개 체인(CU, GS25, 세븐일레븐) 동시 입점. 선행 과제: MOQ 협상 완료, 패키지 리뉴얼 확정, 영업팀 2명 추가 채용. 예산: 총 8천만 원 (마케팅 40%, 물류 30%, 인건비 20%, 기타 10%). 주요 리스크: 원가 상승(원자재 15% 인상 예상), 경쟁사 신제품 출시 예정. 담당자: 영업팀장(입점 협상), 마케팅팀(판촉 기획), 공급망팀(MOQ 및 물류). 목표 달성 시 Q3 지방 편의점 확장 검토 예정.'"
      }
    },
    {
      id: "long_doc_basic_4",
      label: "long_doc",
      input: {
        task: "long_doc",
        message: "다음 경쟁사 분석 데이터를 바탕으로 자사 전략 포지셔닝 보고서를 작성해 주세요. 구성: 1) 경쟁사별 강점/약점 비교표 2) 시장 내 포지셔닝 공백 식별 3) 자사가 선점해야 할 포지션 제안 (근거 포함) 4) 경쟁사 대응 시나리오 3가지 5) 차별화 전략 최종 권고. 데이터: '경쟁사 A(시장점유율 23%): 편의점 채널 1위, 가격 경쟁력 강점, 브랜드 인지도 높음, 건강 이미지 약함. 경쟁사 B(점유율 17%): 프리미엄 포지션, 온라인 D2C 강점, 오프라인 유통망 취약, 충성 고객 기반 탄탄. 경쟁사 C(점유율 12%): MZ 타깃, SNS 마케팅 강점, 제품 다양성 부족, 수익성 문제. 자사(점유율 4%): 기능성 성분 차별화, 유통망 제한적, 브랜드 인지도 낮음, 생산 원가 경쟁력 보통.'"
      }
    },
    {
      id: "long_doc_basic_5",
      label: "long_doc",
      input: {
        task: "long_doc",
        message: "다음 분기별 재무 데이터를 분석하여 경영진 의사결정 지원 보고서를 작성해 주세요. 분석 항목: 1) 핵심 재무 지표 트렌드 요약 2) 수익성 개선/악화 원인 분석 3) 현금흐름 리스크 평가 4) 비용 구조 최적화 기회 식별 5) Q3 전망 및 시나리오 분석 (낙관/중립/비관) 6) 즉각적인 경영 조치 권고. 데이터: 'Q1 매출 3.2억, 영업이익 -0.4억 (적자 전환). Q2 매출 4.1억, 영업이익 0.2억 (흑자 전환). 매출원가율 Q1 72%, Q2 68% (원자재 안정화). 판관비 Q1 1.8억, Q2 2.1억 (마케팅비 증가). 미수금 Q2 말 기준 0.9억 (편의점 체인 정산 지연). 재고 회전율 Q1 45일, Q2 38일 (개선). 현금 및 현금성 자산 0.6억 (운영 자금 3개월치 수준).'"
      }
    }
  ]
}

export function buildBenchmarkComparison(
  singleRuns: BenchmarkRunResult[],
  orchestraRuns: BenchmarkRunResult[]
) {
  const groupedSingles = groupByCaseId(singleRuns)
  const pairwise: any[] = []
  const providerWinShift: Record<string, number> = {}
  const taskImprovement: Record<string, { total: number; orchestra_win: number; best_single_win: number; tie: number }> = {}

  let orchestraWins = 0
  let bestSingleWins = 0
  let ties = 0
  let totalQualityOrchestra = 0
  let totalQualitySingle = 0
  let qualityCount = 0

  for (const orchestraRun of orchestraRuns) {
    const caseId = orchestraRun.case_id
    const singles = groupedSingles[caseId] ?? []

    if (singles.length === 0) {
      continue
    }

    const rankedSingles = singles
      .slice()
      .sort((a, b) => getScore(b) - getScore(a))

    const bestSingle = rankedSingles[0]
    const bestSingleScore = getScore(bestSingle)
    const orchestraScore = getScore(orchestraRun)

    let benchmarkWinner: "orchestra" | "best_single" | "tie" = "tie"

    if (orchestraScore > bestSingleScore) {
      benchmarkWinner = "orchestra"
      orchestraWins += 1
    } else if (bestSingleScore > orchestraScore) {
      benchmarkWinner = "best_single"
      bestSingleWins += 1
    } else {
      ties += 1
    }

    totalQualityOrchestra += orchestraScore
    totalQualitySingle += bestSingleScore
    qualityCount += 1

    const task = getTask(orchestraRun)

    if (!taskImprovement[task]) {
      taskImprovement[task] = {
        total: 0,
        orchestra_win: 0,
        best_single_win: 0,
        tie: 0
      }
    }

    taskImprovement[task].total += 1

    if (benchmarkWinner === "orchestra") {
      taskImprovement[task].orchestra_win += 1
    } else if (benchmarkWinner === "best_single") {
      taskImprovement[task].best_single_win += 1
    } else {
      taskImprovement[task].tie += 1
    }

    const bestSingleProvider = getWinnerProvider(bestSingle)

    if (bestSingleProvider) {
      providerWinShift[bestSingleProvider] = (providerWinShift[bestSingleProvider] ?? 0) + 1
    }

    if (benchmarkWinner === "orchestra") {
      providerWinShift["orchestra"] = (providerWinShift["orchestra"] ?? 0) + 1
    }

    pairwise.push({
      case_id: caseId,
      task,
      benchmark_winner: benchmarkWinner,
      best_single_mode: bestSingle.mode,
      best_single_provider: bestSingleProvider,
      // fair comparison: text_quality_score 기준 (orchestration 신호 제외)
      best_single_score: bestSingleScore,
      orchestra_score: orchestraScore,
      score_gap: Number((orchestraScore - bestSingleScore).toFixed(4)),
      // orchestration 포함 전체 점수 (orchestra 구조 가치 측정용)
      orchestra_full_score: getFullScore(orchestraRun),
      best_single_full_score: getFullScore(bestSingle),
      single_candidates: rankedSingles.map((run) => ({
        mode: run.mode,
        provider: getWinnerProvider(run),
        score: getScore(run),
        task: getTask(run)
      })),
      winner_reason:
        benchmarkWinner === "orchestra"
          ? "orchestra score exceeded the best single-model score"
          : benchmarkWinner === "best_single"
            ? "best single-model score exceeded the orchestra score"
            : "scores are tied",
      loser_reason:
        benchmarkWinner === "orchestra"
          ? "best single-model score was lower than orchestra"
          : benchmarkWinner === "best_single"
            ? "orchestra score was lower than best single-model"
            : "scores are tied",
      winner_snapshot:
        benchmarkWinner === "orchestra"
          ? orchestraRun?.raw_result?.final_answer?.winner_snapshot ?? null
          : bestSingle?.raw_result?.final_answer?.winner_snapshot ?? null,
      runner_up_snapshot:
        benchmarkWinner === "orchestra"
          ? orchestraRun?.raw_result?.final_answer?.runner_up_snapshot ?? null
          : bestSingle?.raw_result?.final_answer?.runner_up_snapshot ?? null,
      scoreboard_summary:
        benchmarkWinner === "orchestra"
          ? orchestraRun?.raw_result?.final_answer?.scoreboard_summary ?? null
          : bestSingle?.raw_result?.final_answer?.scoreboard_summary ?? null,
      provider_chain:
        benchmarkWinner === "orchestra"
          ? orchestraRun?.raw_result?.final_answer?.provider_chain ?? orchestraRun?.raw_result?.provider_chain ?? []
          : bestSingle?.raw_result?.final_answer?.provider_chain ?? bestSingle?.raw_result?.provider_chain ?? [],
      orchestra_provider_chain:
        orchestraRun?.raw_result?.final_answer?.provider_chain ?? orchestraRun?.raw_result?.provider_chain ?? [],
      best_single_provider_chain:
        bestSingle?.raw_result?.final_answer?.provider_chain ?? bestSingle?.raw_result?.provider_chain ?? [],
      judge_trace:
        benchmarkWinner === "orchestra"
          ? orchestraRun?.raw_result?.final_answer?.judge_trace ?? orchestraRun?.raw_result?.judge_trace ?? null
          : bestSingle?.raw_result?.final_answer?.judge_trace ?? bestSingle?.raw_result?.judge_trace ?? null,
      decision_rationale:
        benchmarkWinner === "orchestra"
          ? orchestraRun?.raw_result?.final_answer?.decision_rationale ?? null
          : bestSingle?.raw_result?.final_answer?.decision_rationale ?? null,
      single_evaluations: rankedSingles.map((run) => ({
        mode: run.mode,
        provider: getWinnerProvider(run),
        task: getTask(run),
        evaluation: run.evaluation
      })),
      orchestra_evaluation: orchestraRun.evaluation
    })
  }

  return {
    single_runs: singleRuns,
    orchestra_runs: orchestraRuns,
    pairwise,
    provider_win_shift: providerWinShift,
    task_improvement: taskImprovement,
    summary: {
      orchestra_wins: orchestraWins,
      best_single_wins: bestSingleWins,
      ties,
      total_cases: orchestraWins + bestSingleWins + ties,
      win_rate: (orchestraWins + bestSingleWins + ties) > 0
        ? Number((orchestraWins / (orchestraWins + bestSingleWins + ties)).toFixed(4))
        : 0,
      avg_quality_orchestra: qualityCount > 0
        ? Number((totalQualityOrchestra / qualityCount).toFixed(4))
        : 0,
      avg_quality_single: qualityCount > 0
        ? Number((totalQualitySingle / qualityCount).toFixed(4))
        : 0
    }
  }
}


