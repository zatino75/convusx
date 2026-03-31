import { logBenchmark, normalizeBenchmarkCase } from "../orchestra/benchmark.js"
import { resetScoreboard, recordProviderExecution } from "../orchestra/scoreboard.js"
import { executeOrchestra } from "../orchestra/runtime.js"
import { evaluateBenchmarkResult } from "../benchmark/evaluator.js"
import { buildBenchmarkComparison, buildDefaultBenchmarkCases, toBenchmarkRunResult } from "../benchmark/scoreboard.js"
import fs from "fs"
import path from "path"

// ─── 벤치마크 히스토리 ────────────────────────────────────────────────────────
const HISTORY_FILE = path.resolve(process.cwd(), "server", "data", "benchmark-history.json")

function loadHistory(): any[] {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return []
    return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8")) ?? []
  } catch { return [] }
}

function saveHistory(entry: any) {
  try {
    const dir = path.dirname(HISTORY_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const history = loadHistory()
    history.push(entry)
    // 최근 30개만 유지
    const trimmed = history.slice(-30)
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2), "utf-8")
  } catch (e: any) {
    console.error("[BENCHMARK] 히스토리 저장 실패:", e?.message)
  }
}

export async function runBenchmarkHistoryRoute(_req: any, res: any) {
  const history = loadHistory()
  return res.json({ ok: true, count: history.length, history })
}

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
  const rawJudge = result?.internal_rationale?.judge ?? null
  // evaluator의 hasJudgeTrace = !!judgeTrace?.winner 이므로
  // runtime judge는 selected_provider를 사용 → winner로 매핑
  const judgeTrace = rawJudge ? {
    ...rawJudge,
    winner: rawJudge.selected_provider ?? null,
    rationale: rawJudge.rationale ?? rawJudge.decision_rationale ?? (rawJudge.selected_provider ? `selected ${rawJudge.selected_provider} as winner` : null)
  } : null

  return {
    label,
    mode,
    final_answer: {
      answer: result?.final_answer ?? null,
      provider_chain: result?.internal_rationale?.executed_providers?.map((p: any) => p.provider) ?? [],
      scoreboard_summary: result?.internal_rationale?.scoreboard_after ?? null,
      judge_trace: judgeTrace,
      claims: result?.internal_rationale?.claims ?? [],
      conflict_count: result?.internal_rationale?.conflict_count ?? 0,
      decision_rationale: rawJudge?.rationale ?? rawJudge?.decision_rationale ?? (rawJudge?.selected_provider ? `selected ${rawJudge.selected_provider}` : null),
      winner_snapshot: result?.final_answer ? {
        provider: result.final_answer.provider,
        text: result.final_answer.text?.slice(0, 200)
      } : null,
      runner_up_snapshot: result?.verifier ? {
        provider: result.verifier.provider,
        text: result.verifier.text?.slice(0, 200)
      } : null
    }
  }
}

export async function runBenchmarkRunRoute(req: any, res: any) {
  const body = req?.body ?? {}

  // cases: 직접 지정 or 기본 테스트셋 사용
  const cases = Array.isArray(body?.cases) && body.cases.length > 0
    ? body.cases
    : buildDefaultBenchmarkCases()

  // single_providers: 비교할 단일 모델 목록 (gemini 포함 — reasoning/long_doc 공정 비교)
  const singleProviders: string[] = Array.isArray(body?.single_providers) && body.single_providers.length > 0
    ? body.single_providers
    : ["openai", "claude", "gemini", "perplexity"]

  // max_cases: 최대 실행 케이스 수 (기본 6개 — task 6종류 균등 커버)
  const maxCases = Number(body?.max_cases ?? 6)

  // 태스크별 균등 선택 — dialogue만 나오는 문제 해결
  const taskGroups: Record<string, any[]> = {}
  for (const c of cases) {
    const t = c.input?.task ?? "dialogue"
    if (!taskGroups[t]) taskGroups[t] = []
    taskGroups[t].push(c)
  }
  const taskKeys = Object.keys(taskGroups)
  const perTask = Math.max(1, Math.floor(maxCases / taskKeys.length))
  const selectedCases: any[] = []
  for (const t of taskKeys) {
    selectedCases.push(...taskGroups[t].slice(0, perTask))
    if (selectedCases.length >= maxCases) break
  }
  // 부족하면 나머지 채우기
  if (selectedCases.length < maxCases) {
    const remaining = cases.filter((c: any) => !selectedCases.includes(c))
    selectedCases.push(...remaining.slice(0, maxCases - selectedCases.length))
  }

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

  // ─── Pairwise 승자 → Scoreboard 자동 반영 ────────────────────────────────────
  // 벤치마크 비교 결과를 routing 학습에 직접 피드백
  // - orchestra 승: winning provider에 weight 1.8 win 기록
  // - single 승: 해당 single provider에 weight 1.5 win 기록
  // - tie: 양쪽 모두 weight 0.5 중립 기록
  for (const pair of comparison.pairwise ?? []) {
    const task = String(pair?.task ?? "dialogue").trim().toLowerCase()
    const winner = String(pair?.benchmark_winner ?? "")
    const orchestraProvider = String(pair?.orchestra_provider_chain?.[0] ?? "").toLowerCase() ||
      String(pair?.winner_snapshot?.provider ?? "").toLowerCase()
    const bestSingleProvider = String(pair?.best_single_provider ?? "").toLowerCase()

    if (winner === "orchestra" && orchestraProvider) {
      recordProviderExecution(orchestraProvider, {
        success: true, selected_as_final: true, effective: true,
        weight: 1.8, task, latency_ms: 0, estimated_cost_usd: 0, error_code: null
      })
    } else if (winner === "best_single" && bestSingleProvider) {
      recordProviderExecution(bestSingleProvider, {
        success: true, selected_as_final: true, effective: true,
        weight: 1.5, task, latency_ms: 0, estimated_cost_usd: 0, error_code: null
      })
      // orchestra provider는 패배 기록 (약하게)
      if (orchestraProvider && orchestraProvider !== bestSingleProvider) {
        recordProviderExecution(orchestraProvider, {
          success: false, selected_as_final: false, effective: true,
          weight: 0.6, task, latency_ms: 0, estimated_cost_usd: 0, error_code: "benchmark_loss"
        })
      }
    } else if (winner === "tie") {
      // 동점: 양쪽 모두 약하게 긍정 기록
      if (orchestraProvider) {
        recordProviderExecution(orchestraProvider, {
          success: true, selected_as_final: false, effective: true,
          weight: 0.4, task, latency_ms: 0, estimated_cost_usd: 0, error_code: null
        })
      }
    }
  }
  console.log(`[BENCHMARK] Scoreboard 반영 완료 — ${comparison.pairwise?.length ?? 0}개 케이스`)

  // 히스토리 저장
  const historyEntry = {
    run_at: new Date().toISOString(),
    case_count: selectedCases.length,
    single_providers: singleProviders,
    orchestra_wins: comparison?.summary?.orchestra_wins ?? 0,
    total_cases: comparison?.summary?.total_cases ?? 0,
    win_rate: comparison?.summary?.win_rate ?? 0,
    avg_quality_orchestra: comparison?.summary?.avg_quality_orchestra ?? 0,
    avg_quality_single: comparison?.summary?.avg_quality_single ?? 0,
    comparison
  }
  saveHistory(historyEntry)
  console.log(`[BENCHMARK] 자동 저장 완료 — 승률: ${Math.round((historyEntry.win_rate ?? 0) * 100)}%`)

  return res.json({
    ok: true,
    case_count: selectedCases.length,
    single_providers: singleProviders,
    comparison
  })
}

// ─── 자동 벤치마크 스케줄러 ──────────────────────────────────────────────────
let autoScheduler: ReturnType<typeof setTimeout> | null = null
const AUTO_BENCHMARK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24시간

async function runAutoBenchmark() {
  console.log("[BENCHMARK] 자동 벤치마크 시작...")
  try {
    const fakeReq = { body: { max_cases: 6 } }
    const results: any[] = []
    const fakeRes = {
      json: (data: any) => { results.push(data) }
    }
    await runBenchmarkRunRoute(fakeReq, fakeRes)
    console.log("[BENCHMARK] 자동 벤치마크 완료")
  } catch (e: any) {
    console.error("[BENCHMARK] 자동 벤치마크 실패:", e?.message)
  }
}

export function startBenchmarkScheduler() {
  // 서버 시작 1시간 후 첫 실행, 이후 24시간마다 반복
  const firstDelay = 60 * 60 * 1000 // 1시간
  console.log(`[BENCHMARK] 스케줄러 등록 — 첫 실행: 1시간 후, 이후 24시간 주기`)
  setTimeout(() => {
    runAutoBenchmark()
    autoScheduler = setInterval(runAutoBenchmark, AUTO_BENCHMARK_INTERVAL_MS)
  }, firstDelay)
}

export const benchmarkHistoryRoute = {
  path: "/api/benchmark/history",
  handler: runBenchmarkHistoryRoute
}

export const benchmarkRoute = {
  path: "/api/benchmark",
  handler: runBenchmarkRoute
}

export const benchmarkRunRoute = {
  path: "/api/benchmark/run",
  handler: runBenchmarkRunRoute
}
