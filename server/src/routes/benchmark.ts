import { logBenchmark, normalizeBenchmarkCase } from "../orchestra/benchmark.js"
import { resetScoreboard } from "../orchestra/scoreboard.js"
import { executeOrchestra } from "../orchestra/runtime.js"
import { evaluateBenchmarkResult } from "../benchmark/evaluator.js"
import { buildBenchmarkComparison, buildDefaultBenchmarkCases, toBenchmarkRunResult } from "../benchmark/scoreboard.js"

export async function runBenchmarkRoute(req: any, res: any) {
  const body = req?.body ?? {}
  const cases = Array.isArray(body?.cases) ? body.cases : null

  if (!cases) {
    return res.json({ ok: false, error: "cases required" })
  }

  if (body?.reset_scoreboard) {
    resetScoreboard()
  }

  const results = []

  for (const c of cases) {
    const normalized = normalizeBenchmarkCase(c)
    const record = await logBenchmark(normalized)

    results.push({
      task: record?.task,
      final_provider: record?.final_provider,
      latency_ms: record?.latency_ms
    })
  }

  return res.json({
    ok: true,
    count: results.length,
    results
  })
}

// 단일 provider 실행
async function runSingleProvider(provider: string, input: any): Promise<any> {
  try {
    const result = await executeOrchestra({
      ...input,
      mode: `single_${provider}`,
      benchmark_mode: false,
      force_primary_provider: provider,
      // 단일 모델 강제: verifier/optional 없이 primary만
      _single_provider_override: provider
    })
    return result
  } catch {
    return null
  }
}

// orchestra 실행
async function runOrchestra(input: any): Promise<any> {
  try {
    const result = await executeOrchestra({
      ...input,
      mode: "runtime_orchestra",
      benchmark_mode: true
    })
    return result
  } catch {
    return null
  }
}

function buildEvalInput(label: string, mode: string, result: any) {
  return {
    label,
    mode,
    final_answer: {
      answer: result?.final_answer ?? null,
      provider_chain: result?.internal_rationale?.executed_providers?.map((p: any) => p.provider) ?? [],
      scoreboard_summary: result?.internal_rationale?.scoreboard_after ?? null,
      judge_trace: result?.internal_rationale?.judge ?? null,
      claims: result?.internal_rationale?.claims ?? [],
      conflict_count: result?.internal_rationale?.conflict_count ?? 0,
      decision_rationale: result?.internal_rationale?.judge?.rationale ?? null,
      winner_snapshot: result?.final_answer ? {
        provider: result.final_answer.provider,
        text: result.final_answer.text?.slice(0, 200)
      } : null,
      runner_up_snapshot: null
    }
  }
}

export async function runBenchmarkRunRoute(req: any, res: any) {
  const body = req?.body ?? {}

  // cases: 직접 지정 or 기본 테스트셋 사용
  const cases = Array.isArray(body?.cases) && body.cases.length > 0
    ? body.cases
    : buildDefaultBenchmarkCases()

  // single_providers: 비교할 단일 모델 목록
  const singleProviders: string[] = Array.isArray(body?.single_providers)
    ? body.single_providers
    : ["openai", "claude", "perplexity"]

  // max_cases: 최대 실행 케이스 수 (기본 5개 — 비용/시간 제한)
  const maxCases = Number(body?.max_cases ?? 5)
  const selectedCases = cases.slice(0, maxCases)

  const singleRuns: any[] = []
  const orchestraRuns: any[] = []

  for (const benchCase of selectedCases) {
    const input = {
      message: benchCase.input.message,
      task: benchCase.input.task,
      thread_id: `benchmark_${benchCase.id}`,
      project_id: "benchmark"
    }

    // 1. Orchestra 실행
    const orchestraResult = await runOrchestra(input)
    if (orchestraResult) {
      const evalInput = buildEvalInput(benchCase.label, "orchestra", orchestraResult)
      const evaluation = evaluateBenchmarkResult(evalInput)
      orchestraRuns.push(
        toBenchmarkRunResult(orchestraResult, benchCase, "orchestra", evaluation)
      )

      // benchmark.jsonl 로깅
      await logBenchmark({
        ...normalizeBenchmarkCase({
          meta: { orchestration: orchestraResult?.response_meta?.orchestration }
        }),
        task: benchCase.input.task,
        case_id: benchCase.id,
        mode: "orchestra"
      })
    }

    // 2. 단일 모델 실행
    for (const provider of singleProviders) {
      const singleResult = await runSingleProvider(provider, input)
      if (singleResult) {
        const evalInput = buildEvalInput(benchCase.label, `single_${provider}`, singleResult)
        const evaluation = evaluateBenchmarkResult(evalInput)
        singleRuns.push(
          toBenchmarkRunResult(singleResult, benchCase, `single_${provider}`, evaluation)
        )
      }
    }
  }

  // 3. 비교 결과 생성
  const comparison = buildBenchmarkComparison(singleRuns, orchestraRuns)

  return res.json({
    ok: true,
    case_count: selectedCases.length,
    single_providers: singleProviders,
    comparison
  })
}

export const benchmarkRoute = {
  path: "/api/benchmark",
  handler: runBenchmarkRoute
}

export const benchmarkRunRoute = {
  path: "/api/benchmark/run",
  handler: runBenchmarkRunRoute
}
