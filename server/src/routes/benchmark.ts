// NOTE (2026-04-11): orchestra/scoreboard + orchestra/runtime 폐기.
// executeOrchestra → runAgentLoop 교체. recordProviderExecution 호출 제거.
import { logBenchmark, normalizeBenchmarkCase } from "../orchestra/benchmark.js"
import { runAgentLoop } from "../agent/agentLoop.js"
import { evaluateBenchmarkResult } from "../benchmark/evaluator.js"
import { buildBenchmarkComparison, buildDefaultBenchmarkCases, toBenchmarkRunResult } from "../benchmark/scoreboard.js"
import fs from "fs"
import path from "path"
import { logger } from "../observability/logger.js"
import { broadcast } from "../http/websocket.js"
import type { ParsedRequest } from "../http/router.js"
import type { ExpressLikeResponse } from "../http/response.js"

// ─── 벤치마크 히스토리 ────────────────────────────────────────────────────────
const HISTORY_FILE = path.resolve(process.cwd(), "server", "data", "benchmark-history.json")

interface BenchmarkHistoryEntry {
  run_at: string
  case_count: number
  single_providers: string[]
  orchestra_wins: number
  total_cases: number
  win_rate: number
  avg_quality_orchestra: number
  avg_quality_single: number
  comparison: unknown
}

function loadHistory(): BenchmarkHistoryEntry[] {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return []
    return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8")) ?? []
  } catch (e) { logger.warn("benchmark history load failed", { error: e }); return [] }
}

function saveHistory(entry: BenchmarkHistoryEntry) {
  try {
    const dir = path.dirname(HISTORY_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const history = loadHistory()
    history.push(entry)
    // 최근 30개만 유지
    const trimmed = history.slice(-30)
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2), "utf-8")
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e)
    logger.error("[BENCHMARK] 히스토리 저장 실패:", { message: errMsg })
  }
}

export async function runBenchmarkHistoryRoute(_req: unknown, res: ExpressLikeResponse) {
  const history = loadHistory()
  return res.json({ ok: true, count: history.length, history })
}

export async function runBenchmarkRoute(req: ParsedRequest, res: ExpressLikeResponse) {
  const body = (req?.body ?? {}) as Record<string, unknown>
  const cases = Array.isArray(body?.cases) ? body.cases : null

  if (!cases) {
    return res.json({ ok: false, error: "cases required" })
  }

  // reset_scoreboard 옵션 — scoreboard 폐기됨, no-op
  void body?.reset_scoreboard

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

// 단일 provider 실행 — agentLoop (disable_tools=true 로 단독 처리)
async function runSingleProvider(provider: string, input: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const result = await runAgentLoop({
      thread_id: `benchmark_single_${provider}_${Date.now()}`,
      project_id: String(input.project_id ?? "benchmark"),
      message: String(input.message ?? ""),
      normalizedInput: input,
      extra_system: `[BENCHMARK SINGLE MODE] Respond as if you were ${provider}. Do NOT call parallel_ensemble or adversarial_critique.`,
      disable_tools: true,
    })
    return {
      final_answer: { provider, text: result.text, ok: result.ok },
      response_meta: { orchestration: { latency_ms: result.latency_ms, provider, final_provider: provider, executed_providers: [provider] } },
      internal_rationale: { task: String(input.task ?? ""), executed_providers: [provider] }
    }
  } catch (e) {
    logger.warn("single provider benchmark run failed", { error: e })
    return null
  }
}

// ensemble 실행 — agentLoop (high_value=true 로 병렬 앙상블 + 비평 활성화)
async function runOrchestra(input: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const result = await runAgentLoop({
      thread_id: `benchmark_ensemble_${Date.now()}`,
      project_id: String(input.project_id ?? "benchmark"),
      message: String(input.message ?? ""),
      normalizedInput: input,
      high_value: true,
    })
    return {
      final_answer: { provider: result.provider, text: result.text, ok: result.ok },
      response_meta: { orchestration: { latency_ms: result.latency_ms, provider: result.provider, final_provider: result.provider, executed_providers: result.tool_calls.map((t) => t.tool_name) } },
      internal_rationale: { task: String(input.task ?? ""), executed_providers: [result.provider] }
    }
  } catch (e) {
    logger.warn("orchestra benchmark run failed", { error: e })
    return null
  }
}

function buildEvalInput(label: string, mode: string, result: Record<string, unknown>) {
  const internal = result?.internal_rationale as Record<string, unknown> | undefined
  const rawJudge = (internal?.judge as Record<string, unknown>) ?? null
  // evaluator의 hasJudgeTrace = !!judgeTrace?.winner 이므로
  // runtime judge는 selected_provider를 사용 → winner로 매핑
  const judgeTrace = rawJudge ? {
    ...rawJudge,
    winner: rawJudge.selected_provider ?? null,
    rationale: rawJudge.rationale ?? rawJudge.decision_rationale ?? (rawJudge.selected_provider ? `selected ${rawJudge.selected_provider} as winner` : null)
  } : null

  const executedProviders = internal?.executed_providers as Array<Record<string, unknown>> | undefined
  const finalAnswer = result?.final_answer as Record<string, unknown> | undefined
  const verifier = result?.verifier as Record<string, unknown> | undefined

  return {
    label,
    mode,
    final_answer: {
      answer: finalAnswer ?? null,
      provider_chain: executedProviders?.map((p: Record<string, unknown>) => p.provider) ?? [],
      scoreboard_summary: internal?.scoreboard_after ?? null,
      judge_trace: judgeTrace,
      claims: internal?.claims ?? [],
      conflict_count: internal?.conflict_count ?? 0,
      decision_rationale: rawJudge?.rationale ?? rawJudge?.decision_rationale ?? (rawJudge?.selected_provider ? `selected ${rawJudge.selected_provider}` : null),
      winner_snapshot: finalAnswer ? {
        provider: (finalAnswer as Record<string, unknown>).provider,
        text: String((finalAnswer as Record<string, unknown>).text ?? "").slice(0, 200)
      } : null,
      runner_up_snapshot: verifier ? {
        provider: verifier.provider,
        text: String(verifier.text ?? "").slice(0, 200)
      } : null
    }
  }
}

export async function runBenchmarkRunRoute(req: ParsedRequest | { body: Record<string, unknown> }, res: ExpressLikeResponse) {
  const body = (req?.body ?? {}) as Record<string, unknown>

  // cases: 직접 지정 or 기본 테스트셋 사용
  const cases = Array.isArray(body?.cases) && (body.cases as unknown[]).length > 0
    ? body.cases as Array<Record<string, unknown>>
    : buildDefaultBenchmarkCases()

  // single_providers: 비교할 단일 모델 목록 (gemini 포함 — reasoning/long_doc 공정 비교)
  const singleProviders: string[] = Array.isArray(body?.single_providers) && (body.single_providers as unknown[]).length > 0
    ? body.single_providers as string[]
    : ["openai", "claude", "gemini", "perplexity"]

  // max_cases: 최대 실행 케이스 수 (기본 18개 — task당 3케이스 균등 커버)
  const maxCases = Number(body?.max_cases ?? 18)

  // 태스크별 균등 선택 — dialogue만 나오는 문제 해결
  const taskGroups: Record<string, Array<Record<string, unknown>>> = {}
  for (const c of cases) {
    const caseObj = c as Record<string, unknown>
    const input = caseObj.input as Record<string, unknown> | undefined
    const t = String(input?.task ?? "dialogue")
    if (!taskGroups[t]) taskGroups[t] = []
    taskGroups[t].push(caseObj)
  }
  const taskKeys = Object.keys(taskGroups)
  const perTask = Math.max(1, Math.floor(maxCases / taskKeys.length))
  const selectedCases: Array<Record<string, unknown>> = []
  for (const t of taskKeys) {
    selectedCases.push(...taskGroups[t].slice(0, perTask))
    if (selectedCases.length >= maxCases) break
  }
  // 부족하면 나머지 채우기
  if (selectedCases.length < maxCases) {
    const remaining = (cases as Array<Record<string, unknown>>).filter((c) => !selectedCases.includes(c))
    selectedCases.push(...remaining.slice(0, maxCases - selectedCases.length))
  }

  const singleRuns: any[] = []
  const orchestraRuns: any[] = []

  for (const benchCase of selectedCases) {
    const caseInput = benchCase.input as Record<string, unknown>
    const input: Record<string, unknown> = {
      message: caseInput.message,
      task: caseInput.task,
      thread_id: `benchmark_${benchCase.id}`,
      project_id: "benchmark"
    }

    // 1. Orchestra 실행
    const orchestraResult = await runOrchestra(input)
    if (orchestraResult) {
      const evalInput = buildEvalInput(benchCase.label as string, "orchestra", orchestraResult)
      const evaluation = evaluateBenchmarkResult(evalInput)
      orchestraRuns.push(
        toBenchmarkRunResult(orchestraResult, benchCase, "orchestra", evaluation)
      )

      const responseMeta = orchestraResult?.response_meta as Record<string, unknown> | undefined
      // benchmark.jsonl 로깅
      await logBenchmark({
        ...normalizeBenchmarkCase({
          meta: { orchestration: responseMeta?.orchestration }
        }),
        task: caseInput.task,
        case_id: benchCase.id,
        mode: "orchestra"
      })
    }

    // 2. 단일 모델 실행
    for (const provider of singleProviders) {
      const singleResult = await runSingleProvider(provider, input)
      if (singleResult) {
        const evalInput = buildEvalInput(benchCase.label as string, `single_${provider}`, singleResult)
        const evaluation = evaluateBenchmarkResult(evalInput)
        singleRuns.push(
          toBenchmarkRunResult(singleResult, benchCase, `single_${provider}`, evaluation)
        )
      }
    }
  }

  // 3. 비교 결과 생성
  const comparison = buildBenchmarkComparison(singleRuns, orchestraRuns) as Record<string, unknown>

  // NOTE (2026-04-11): pairwise scoreboard 기록 제거 — scoreboard 폐기됨
  // 비교 결과는 tool_call_log 에 기록된 도구 호출 패턴으로 품질 관리

  const summary = (comparison.summary ?? {}) as Record<string, unknown>

  // 히스토리 저장
  const historyEntry: BenchmarkHistoryEntry = {
    run_at: new Date().toISOString(),
    case_count: selectedCases.length,
    single_providers: singleProviders,
    orchestra_wins: Number(summary?.orchestra_wins ?? 0),
    total_cases: Number(summary?.total_cases ?? 0),
    win_rate: Number(summary?.win_rate ?? 0),
    avg_quality_orchestra: Number(summary?.avg_quality_orchestra ?? 0),
    avg_quality_single: Number(summary?.avg_quality_single ?? 0),
    comparison
  }
  saveHistory(historyEntry)

  // ── WebSocket broadcast: 벤치마크 완료 알림 ──
  try {
    broadcast("benchmark:done", {
      case_count: selectedCases.length,
      single_providers: singleProviders,
      win_rate: Number(summary?.win_rate ?? 0),
      run_at: historyEntry.run_at,
    })
  } catch { /* broadcast 실패 무시 */ }

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
  try {
    const fakeReq = { body: { max_cases: 12 }, method: undefined, url: undefined, headers: {} } as unknown as ParsedRequest
    const results: any[] = []
    const fakeRes = {
      json: (data: unknown) => { results.push(data); return fakeRes },
      status: (_code: number) => fakeRes,
      setHeader: (_k: string, _v: string) => fakeRes
    } as ExpressLikeResponse
    await runBenchmarkRunRoute(fakeReq, fakeRes)
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e)
    logger.error("[BENCHMARK] 자동 벤치마크 실패:", { message: errMsg })
  }
}

export function startBenchmarkScheduler() {
  const firstDelay = 60 * 60 * 1000
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
