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

function normalizeTask(value: any): string {
  const text = String(value ?? "").trim().toLowerCase()

  if (text.includes("code")) return "code"
  if (text.includes("research")) return "research"
  if (text.includes("reasoning")) return "reasoning"
  if (text.includes("dialogue")) return "dialogue"

  return text
}

function getTask(run: BenchmarkRunResult | undefined): string {
  const caseId = String(run?.case_id ?? "").toLowerCase()

  if (caseId.startsWith("code_")) return "code"
  if (caseId.startsWith("research_")) return "research"
  if (caseId.startsWith("reasoning_")) return "reasoning"
  if (caseId.startsWith("dialogue_")) return "dialogue"

  const plannerTask = normalizeTask(run?.raw_result?.planner_plan?.task)
  if (plannerTask === "dialogue" || plannerTask === "reasoning" || plannerTask === "research" || plannerTask === "code") {
    return plannerTask
  }

  const routerTask = normalizeTask(run?.raw_result?.router_decision?.task)
  if (routerTask === "dialogue" || routerTask === "reasoning" || routerTask === "research" || routerTask === "code") {
    return routerTask
  }

  const finalJudgeTask = normalizeTask(run?.raw_result?.final_answer?.judge_trace?.task)
  if (finalJudgeTask === "dialogue" || finalJudgeTask === "reasoning" || finalJudgeTask === "research" || finalJudgeTask === "code") {
    return finalJudgeTask
  }

  const judgeTask = normalizeTask(run?.raw_result?.judge_trace?.task)
  if (judgeTask === "dialogue" || judgeTask === "reasoning" || judgeTask === "research" || judgeTask === "code") {
    return judgeTask
  }

  const labelTask = normalizeTask(run?.label)
  if (labelTask === "dialogue" || labelTask === "reasoning" || labelTask === "research" || labelTask === "code") {
    return labelTask
  }

  const modeTask = normalizeTask(run?.mode)
  if (modeTask === "dialogue" || modeTask === "reasoning" || modeTask === "research" || modeTask === "code") {
    return modeTask
  }

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
      ties
    }
  }
}


