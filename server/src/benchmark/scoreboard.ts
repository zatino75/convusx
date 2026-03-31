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

function getScore(run: BenchmarkRunResult | undefined): number {
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
        message: "신규 프리미엄 건강음료 브랜드 런칭을 위한 보도자료 초안을 작성해 주세요."
      }
    },
    {
      id: "writing_basic_2",
      label: "writing",
      input: {
        task: "writing",
        message: "오프라인 편집샵 입점 제안서에 들어갈 브랜드 소개 문구를 간결하고 설득력 있게 작성해 주세요."
      }
    },
    {
      id: "writing_basic_3",
      label: "writing",
      input: {
        task: "writing",
        message: "인스타그램 신제품 런칭용 SNS 마케팅 문구 3가지를 작성해 주세요. 각각 톤이 달라야 합니다."
      }
    },
    {
      id: "writing_basic_4",
      label: "writing",
      input: {
        task: "writing",
        message: "B2B 유통사 미팅을 위한 이메일 초안을 작성해 주세요. 브랜드 소개 + 입점 제안 구조로 써주세요."
      }
    },
    {
      id: "writing_basic_5",
      label: "writing",
      input: {
        task: "writing",
        message: "초기 식음료 브랜드의 투자 유치용 한 페이지 브랜드 소개서 초안을 작성해 주세요."
      }
    },

    {
      id: "long_doc_basic_1",
      label: "long_doc",
      input: {
        task: "long_doc",
        message: "다음 유통 계약 조항에서 핵심 의사결정 포인트와 리스크 항목을 추출해 주세요: '을은 갑의 사전 서면 동의 없이 제3자에게 재판매할 수 없으며, 최소 발주 수량 미달 시 계약 해지 조건이 발동됩니다. 독점 판매 지역은 서울특별시로 한정하며, 계약 기간은 1년 자동 갱신입니다.'"
      }
    },
    {
      id: "long_doc_basic_2",
      label: "long_doc",
      input: {
        task: "long_doc",
        message: "다음 시장 조사 보고서 요약에서 실행 가능한 전략 인사이트 3가지를 추출해 주세요: '2025년 국내 RTD 음료 시장 규모는 2조 5천억 원으로 전년 대비 8% 성장하였으며, 건강 기능성 제품 비중이 35%를 차지합니다. MZ세대 소비 비중이 전체의 42%이며, 편의점 채널 성장률이 온라인 채널을 앞지르고 있습니다.'"
      }
    },
    {
      id: "long_doc_basic_3",
      label: "long_doc",
      input: {
        task: "long_doc",
        message: "다음 내부 전략 문서에서 우선순위 실행 항목과 리스크를 요약해 주세요: 'Q2 목표는 편의점 3개 체인 동시 입점이며, 이를 위해 MOQ 협상, 패키지 리뉴얼, 영업팀 확충이 선행되어야 합니다. 현재 가장 큰 리스크는 원가 상승과 경쟁사 신제품 출시입니다.'"
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
      best_single_score: bestSingleScore,
      orchestra_score: orchestraScore,
      score_gap: Number((orchestraScore - bestSingleScore).toFixed(4)),
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


