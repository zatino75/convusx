import { logBenchmark, normalizeBenchmarkCase } from "../orchestra/benchmark.js"
import { resetScoreboard } from "../orchestra/scoreboard.js"

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

export const benchmarkRoute = {
  path: "/api/benchmark",
  handler: runBenchmarkRoute
}
