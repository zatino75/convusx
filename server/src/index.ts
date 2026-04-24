// NOTE (2026-04-11): toolBootstrap MUST be the very first import. It triggers
// side-effect registration of all agent tools into toolRegistry. Moved out of
// toolRegistry.ts itself to break an ESM circular import that caused TDZ on
// the `registry` binding. Do not reorder this line.
import "./agent/toolBootstrap.js"

import dotenv from "dotenv"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ENV_PATH = resolve(__dirname, "../../.env")
dotenv.config({ path: ENV_PATH, override: true })

import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { logger } from "./observability/logger.js"
import { Router } from "./http/router.js"
import type { ParsedRequest } from "./http/router.js"
import type { ExpressLikeResponse } from "./http/response.js"
import { setCorsHeaders, setSecurityHeaders, handleOptions, readJsonBody, normalizePath, initCorsOrigins } from "./http/middleware.js"
import { checkRateLimit, restoreBucketsFromDb, persistBucketsToDb } from "./http/rateLimiter.js"
import { requireAuth, isAuthWhitelisted } from "./http/auth.js"
import { authLoginRoute, authLogoutRoute, authMeRoute } from "./routes/auth.js"
import { endJson, createExpressLikeResponse } from "./http/response.js"
import { withCorrelationId } from "./http/correlationId.js"
import { wrapWithCompression } from "./http/compression.js"
import { getEnvConfig, getAppEnv } from "./config/environments.js"
import { handleUpgrade, startWsPing, closeAllClients, getConnectedClients, broadcast } from "./http/websocket.js"
import { createRequestTimer, captureError, getApmSnapshot } from "./observability/apm.js"
import { initPlugins, shutdownPlugins, getPluginList, registerPlugin, unregisterPlugin, activatePlugin, deactivatePlugin } from "./plugins/pluginManager.js"
import { loggingPluginManifest, loggingPluginHandlers } from "./plugins/builtins/loggingPlugin.js"
import { startRegulationWatcher, stopRegulationWatcher, getWatcherStatus, refreshRegulations } from "./regulation/regulationWatcher.js"
import { getAllSnapshots, getCacheSummary } from "./regulation/regulationCache.js"

const geminiKeyLoaded =
  typeof process.env.GEMINI_API_KEY === "string" &&
  process.env.GEMINI_API_KEY.trim().length > 0

import { runBenchmarkRoute, runBenchmarkRunRoute, runBenchmarkHistoryRoute } from "./routes/benchmark.js"
import { runFeedbackRoute } from "./routes/feedback.js"
import { runSlidesGenerateRoute as generateSlidesRoute } from "./routes/slides.js"
import { chatRoute, chatStreamRoute } from "./routes/chat.js"
import { usageRoute, scoreboardRoute, usageResetRoute, usageSummaryRoute } from "./routes/usage.js"
import { dashboardRoute } from "./routes/dashboard.js"
import { getSalesRoute, addSalesRoute, deleteSalesRoute } from "./routes/sales.js"
import { getPosRoute, checkoutPosRoute, refundPosRoute } from "./routes/pos.js"
import { deleteExecutiveReportRoute, getExecutiveReportsKpiRoute, getExecutiveReportsRoute, saveExecutiveReportRoute } from "./routes/executiveReports.js"
import { getRetailReportsLatestRoute, getRetailReportsRoute, refreshRetailReportsRoute } from "./routes/retailReports.js"
import { getSettingsKeys, saveSettingsKeys, resetSettings, validateKey } from "./routes/settings.js"
import { exportThreadRoute } from "./routes/export.js"
import { analyzePdfWithGemini, analyzeOfficeFileWithClaude, analyzeOfficeFileWithGemini } from "./routes/chatFileAnalysis.js"
import {
  getProjectMemory,
  getLatestProjectContext,
  getProjectSourceAssets,
  addProjectSourceAsset,
  updateProjectSourceAsset,
  removeProjectSourceAsset
} from "./memory/projectMemory.js"
import {
  getThreadMemory,
  getProjectThreadMemories
} from "./memory/threadMemory.js"
import {
  workspaceLoad,
  workspaceImport,
  workspaceSyncState,
  projectList,
  projectUpsert,
  projectDelete,
  threadList,
  threadGet,
  threadUpsert,
  threadDelete,
  messageSave,
  messageDelete,
  versionsSave
} from "./routes/workspace.js"
import { backupExport, backupDownload, backupRestore } from "./routes/backup.js"
import { docsRoute } from "./routes/openapi.js"
import { startScheduler, stopScheduler, getSchedulerStatus, triggerTask } from "./scheduler/backgroundScheduler.js"
import { externalToolRoute } from "./routes/externalTool.js"
import { directorStartRoute, directorSessionRoute, directorConnectorsRoute, directorBriefingRoute } from "./routes/director.js"
import { directorStreamGetRoute, directorStreamPostRoute, directorStreamOptionsRoute } from "./routes/directorStream.js"

// ── 환경 설정 초기화 ──
const envConfig = getEnvConfig()
initCorsOrigins(envConfig.corsOrigins)

// ── 헬퍼 ──

const SERVER_PORT = Number(process.env.PORT) || 8000

function parseUrl(urlValue: string | undefined): URL {
  return new URL(urlValue ?? "/", `http://localhost:${SERVER_PORT}`)
}

function extractPathParam(urlValue: string | undefined, prefix: string): string {
  return normalizePath(urlValue).replace(prefix, "").split("?")[0]
}

// ── 라우터 구성 ──

const router = new Router()

// ── Auth (화이트리스트 — 인증 없이 통과) ──
router.post("/api/auth/login", async (req: IncomingMessage, res: ServerResponse) => {
  await authLoginRoute(req, res)
}, true)
router.post("/api/auth/logout", async (req: IncomingMessage, res: ServerResponse) => {
  await authLogoutRoute(req, res)
}, true)
router.get("/api/auth/me", async (req: IncomingMessage, res: ServerResponse) => {
  await authMeRoute(req, res)
}, true)

// ── Chat ──
router.post("/api/chat", chatRoute.handler)
router.post("/api/chat/stream", async (req: IncomingMessage, res: ServerResponse) => {
  const body = await readJsonBody(req)
  const reqLike = {
    method: req.method, url: req.url, headers: req.headers, body,
    on: (event: string, cb: () => void) => { if (event === "close") req.on("close", cb) }
  }
  await chatStreamRoute.handler(reqLike, res)
}, true)

// ── Director (자율형 AI 조직) ──
router.post("/api/director/start", async (req: IncomingMessage, res: ServerResponse) => {
  await directorStartRoute(req, res)
})
router.get("/api/director/session", async (req: IncomingMessage, res: ServerResponse) => {
  await directorSessionRoute(req, res)
})
router.get("/api/director/session/*", async (req: IncomingMessage, res: ServerResponse) => {
  await directorSessionRoute(req, res)
})
router.get("/api/director/briefing/*", async (req: IncomingMessage, res: ServerResponse) => {
  await directorBriefingRoute(req, res)
})
router.get("/api/director/connectors", async (req: IncomingMessage, res: ServerResponse) => {
  await directorConnectorsRoute(req, res)
})
// SSE 실시간 스트리밍 (EventSource 호환)
router.get("/api/director/stream", async (req: IncomingMessage, res: ServerResponse) => {
  await directorStreamGetRoute(req, res)
}, true)  // 인증 화이트리스트 — SSE는 쿠키 없이도 EventSource 연결 가능
router.post("/api/director/stream", async (req: IncomingMessage, res: ServerResponse) => {
  await directorStreamPostRoute(req, res)
}, true)
router.options("/api/director/stream", (req: IncomingMessage, res: ServerResponse) => {
  directorStreamOptionsRoute(req, res)
}, true)

// ── Benchmark ──
router.post("/api/benchmark", runBenchmarkRoute)
router.post("/api/benchmark/run", runBenchmarkRunRoute)
router.get("/api/benchmark/history", async (_req: ParsedRequest, res: ExpressLikeResponse) => {
  await runBenchmarkHistoryRoute({}, res)
})

// ── Feedback ──
router.post("/api/feedback", runFeedbackRoute)

// ── Slides ──
router.post("/api/slides/generate", async (req: IncomingMessage, res: ServerResponse) => {
  const body = await readJsonBody(req)
  const reqLike = { method: req.method, url: req.url, headers: req.headers, body }
  const resLike = {
    writeHead: (code: number, headers: Record<string, string>) => {
      res.statusCode = code
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
    },
    end: (data?: string) => res.end(data),
    setHeader: (k: string, v: string) => res.setHeader(k, v),
    send: (data: string) => {
      if (!res.headersSent) res.setHeader("Access-Control-Allow-Origin", "*")
      res.end(data)
    },
    status: (code: number) => { res.statusCode = code; return resLike },
    json: (body: unknown) => {
      if (!res.headersSent) {
        res.statusCode = 200
        res.setHeader("Content-Type", "application/json")
        res.setHeader("Access-Control-Allow-Origin", "*")
      }
      res.end(JSON.stringify(body))
    }
  }
  await generateSlidesRoute(reqLike, resLike)
}, true)

// ── Usage / Scoreboard / Dashboard ──
router.post("/api/usage/reset", async (req: ParsedRequest, res: ExpressLikeResponse) => { await usageResetRoute.handler(req, res) })
router.get("/api/usage/summary", async (_req: ParsedRequest, res: ExpressLikeResponse) => { await usageSummaryRoute.handler({}, res) })
router.get("/api/usage", async (_req: ParsedRequest, res: ExpressLikeResponse) => { await usageRoute.handler({}, res) })
router.get("/api/scoreboard", async (_req: ParsedRequest, res: ExpressLikeResponse) => { await scoreboardRoute.handler({}, res) })
router.get("/api/dashboard", async (_req: ParsedRequest, res: ExpressLikeResponse) => { await dashboardRoute.handler({}, res) })

// ── Phase 5 — 부서 타이쿤 통계 ──
router.get("/api/departments/stats", async (_req: ParsedRequest, res: ExpressLikeResponse) => {
  const { getDepartmentsStatsRoute } = await import("./routes/departments.js")
  await getDepartmentsStatsRoute({}, res)
})

// ── Sales Dashboard ──
router.get("/api/sales", async (_req: ParsedRequest, res: ExpressLikeResponse) => { await getSalesRoute({}, res) })
router.post("/api/sales", addSalesRoute)
router.post("/api/sales/delete", deleteSalesRoute)

// ── POS ──
router.get("/api/pos", async (_req: ParsedRequest, res: ExpressLikeResponse) => { await getPosRoute({}, res) })
router.post("/api/pos/checkout", checkoutPosRoute)
router.post("/api/pos/refund", refundPosRoute)

// ── Executive Reports ──
router.get("/api/executive-reports", async (req: IncomingMessage, res: ServerResponse) => {
  const url = parseUrl(req.url)
  const limit = Number(url.searchParams.get("limit") ?? "24")
  const resLike = createExpressLikeResponse(res)
  await getExecutiveReportsRoute({ query: { limit } }, resLike)
}, true)
router.post("/api/executive-reports", saveExecutiveReportRoute)
router.post("/api/executive-reports/delete", deleteExecutiveReportRoute)
router.get("/api/executive-reports/kpi", async (_req: ParsedRequest, res: ExpressLikeResponse) => { await getExecutiveReportsKpiRoute({}, res) })

// ── Retail Reports (일/주/월 스냅샷) ──
router.get("/api/retail/reports", async (req: IncomingMessage, res: ServerResponse) => {
  const url = parseUrl(req.url)
  const limit = Number(url.searchParams.get("limit") ?? "30")
  const scope = String(url.searchParams.get("scope") ?? "retail_kpi")
  const resLike = createExpressLikeResponse(res)
  await getRetailReportsRoute({ query: { limit, scope } }, resLike)
}, true)
router.get("/api/retail/reports/latest", async (req: IncomingMessage, res: ServerResponse) => {
  const url = parseUrl(req.url)
  const scope = String(url.searchParams.get("scope") ?? "retail_kpi")
  const resLike = createExpressLikeResponse(res)
  await getRetailReportsLatestRoute({ query: { scope } }, resLike)
}, true)
router.post("/api/retail/reports/refresh", refreshRetailReportsRoute)

// ── Memory API ──
router.get("/api/project-memory", async (req: IncomingMessage, res: ServerResponse) => {
  const projectId = parseUrl(req.url).searchParams.get("projectId") ?? ""
  endJson(res, 200, { ok: true, data: getProjectMemory(projectId) })
}, true)

router.get("/api/thread-memory", async (req: IncomingMessage, res: ServerResponse) => {
  const threadId = parseUrl(req.url).searchParams.get("threadId") ?? ""
  endJson(res, 200, { ok: true, data: getThreadMemory(threadId) })
}, true)

router.get("/api/project-thread-memories", async (req: IncomingMessage, res: ServerResponse) => {
  const projectId = parseUrl(req.url).searchParams.get("projectId") ?? ""
  endJson(res, 200, { ok: true, data: getProjectThreadMemories(projectId) })
}, true)

// ── 파일 텍스트 추출 (PDF, Office) ──
router.post("/api/extract-text", async (req: ParsedRequest, res: ExpressLikeResponse) => {
  const body = req.body ?? {}
  const { name, base64, type } = body as { name?: string; base64?: string; type?: string }
  if (!base64) return res.json({ ok: false, error: "no_file_data" })
  const fileName = String(name ?? "file").toLowerCase()
  const mimeType = String(type ?? "")
  try {
    let text = ""
    if (mimeType === "application/pdf" || fileName.endsWith(".pdf")) {
      text = await analyzePdfWithGemini({ base64, name, type: "application/pdf" }, "이 PDF 문서의 전체 텍스트를 추출해줘. 분석이나 요약 없이 원문 텍스트만 최대한 그대로 추출해줘.")
    } else if (/\.(xlsx|xls|csv)$/i.test(fileName) || mimeType.includes("spreadsheet")) {
      text = await analyzeOfficeFileWithClaude({ base64, name, type: mimeType }, "이 파일의 전체 내용을 텍스트로 추출해줘.")
    } else if (/\.(docx|doc)$/i.test(fileName) || mimeType.includes("word")) {
      text = await analyzeOfficeFileWithClaude({ base64, name, type: mimeType }, "이 문서의 전체 텍스트를 추출해줘.")
    } else if (/\.(pptx|ppt)$/i.test(fileName) || mimeType.includes("presentation")) {
      text = await analyzeOfficeFileWithGemini({ base64, name, type: mimeType }, "이 프레젠테이션의 전체 텍스트를 추출해줘.")
    } else if (/\.(zip)$/i.test(fileName) || mimeType === "application/zip" || mimeType === "application/x-zip-compressed") {
      // ZIP → 내부 텍스트 파일 추출
      const { unzipSync } = await import("node:zlib")
      const buf = Buffer.from(base64, "base64")
      const TEXT_EXTS = /\.(txt|md|json|csv|js|ts|py|html|css|xml|yaml|yml|toml|ini|cfg|log|sh|bat|sql|r|rb|go|java|c|cpp|h|swift|kt|rs)$/i
      const parts: string[] = []
      let offset = 0
      while (offset < buf.length - 4) {
        if (buf.readUInt32LE(offset) !== 0x04034b50) break
        const fnLen = buf.readUInt16LE(offset + 26)
        const extraLen = buf.readUInt16LE(offset + 28)
        const entryName = buf.slice(offset + 30, offset + 30 + fnLen).toString("utf-8")
        const compMethod = buf.readUInt16LE(offset + 8)
        const compSize = buf.readUInt32LE(offset + 18)
        const dataStart = offset + 30 + fnLen + extraLen
        const compData = buf.slice(dataStart, dataStart + compSize)
        if (TEXT_EXTS.test(entryName) && compSize > 0 && compSize < 5_000_000) {
          try {
            let entryData: Buffer
            if (compMethod === 8) {
              try { entryData = unzipSync(Buffer.concat([Buffer.from([0x78, 0x9c]), compData])) }
              catch { entryData = unzipSync(compData) }
            } else { entryData = compData }
            parts.push(`\n=== ${entryName} ===\n${entryData.toString("utf-8")}`)
          } catch (zipErr) {
            /* ZIP 엔트리 파싱 실패 — 개별 엔트리 스킵, 전체 추출은 계속 */
          }
        }
        offset = dataStart + compSize
      }
      text = parts.length > 0 ? parts.join("\n") : `[ZIP 파일 내 텍스트 파일 없음: ${name}]`
    } else if (/\.(png|jpg|jpeg|gif|bmp|webp|svg|mp3|mp4|mov|avi|exe|dll|bin|dat|db|woff|ttf)$/i.test(fileName)) {
      text = `[바이너리 파일: ${name} (${Math.round(base64.length * 0.75 / 1024)}KB) — 텍스트 추출 불가]`
    } else {
      text = Buffer.from(base64, "base64").toString("utf-8")
    }
    res.json({ ok: true, text })
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e)
    logger.error("[extract-text] failed:", { name, error: errMsg })
    res.json({ ok: false, error: errMsg ?? "extraction_failed" })
  }
})

router.get("/api/project-sources", async (req: IncomingMessage, res: ServerResponse) => {
  const projectId = parseUrl(req.url).searchParams.get("projectId") ?? ""
  endJson(res, 200, { ok: true, data: getProjectSourceAssets(projectId) })
}, true)

router.post("/api/project-sources", async (req: ParsedRequest, res: ExpressLikeResponse) => {
  const projectId = String((req.body as Record<string, unknown>)?.projectId ?? "")
  const asset = (req.body as Record<string, any>)?.asset ?? null
  if (!projectId || !asset) return res.json({ ok: false, error: "invalid_input" })
  addProjectSourceAsset(projectId, asset as any)
  res.json({ ok: true })
})

router.patch("/api/project-sources/*", async (req: IncomingMessage, res: ServerResponse) => {
  const assetId = extractPathParam(req.url, "/api/project-sources/")
  const body = await readJsonBody(req) as Record<string, unknown>
  const projectId = String(body?.projectId ?? "")
  if (!assetId || !projectId) return endJson(res, 400, { ok: false, error: "invalid_input" })
  const patch: Record<string, string> = {}
  if (body?.status !== undefined) patch.status = String(body.status)
  if (body?.title !== undefined) patch.title = String(body.title)
  if (body?.content !== undefined) patch.content = String(body.content)
  updateProjectSourceAsset(projectId, assetId, patch)
  endJson(res, 200, { ok: true })
}, true)

router.delete("/api/project-sources/*", async (req: IncomingMessage, res: ServerResponse) => {
  const assetId = extractPathParam(req.url, "/api/project-sources/")
  const projectId = parseUrl(req.url).searchParams.get("projectId") ?? ""
  if (!assetId || !projectId) return endJson(res, 400, { ok: false, error: "invalid_input" })
  removeProjectSourceAsset(projectId, assetId)
  endJson(res, 200, { ok: true })
}, true)

// ── Workspace API (SQLite) ──
router.get("/api/workspace", async (_req: ParsedRequest, res: ExpressLikeResponse) => { workspaceLoad({}, res) })
router.post("/api/workspace/import", workspaceImport)
router.post("/api/workspace/sync-state", workspaceSyncState)

router.get("/api/workspace/projects", async (_req: ParsedRequest, res: ExpressLikeResponse) => { projectList({}, res) })
router.post("/api/workspace/projects", projectUpsert)
router.delete("/api/workspace/projects/*", async (req: IncomingMessage, res: ServerResponse) => {
  const id = extractPathParam(req.url, "/api/workspace/projects/")
  const resLike = createExpressLikeResponse(res)
  projectDelete({ params: { id } }, resLike)
}, true)

router.get("/api/workspace/threads", async (req: IncomingMessage, res: ServerResponse) => {
  const projectId = parseUrl(req.url).searchParams.get("projectId") ?? undefined
  const resLike = createExpressLikeResponse(res)
  threadList({ query: { projectId } }, resLike)
}, true)

router.get("/api/workspace/threads/*", async (req: IncomingMessage, res: ServerResponse) => {
  const id = extractPathParam(req.url, "/api/workspace/threads/")
  const resLike = createExpressLikeResponse(res)
  threadGet({ params: { id } }, resLike)
}, true)

router.post("/api/workspace/threads", threadUpsert)
router.delete("/api/workspace/threads/*", async (req: IncomingMessage, res: ServerResponse) => {
  const id = extractPathParam(req.url, "/api/workspace/threads/")
  const resLike = createExpressLikeResponse(res)
  threadDelete({ params: { id } }, resLike)
}, true)

router.post("/api/workspace/messages", messageSave)
router.delete("/api/workspace/messages", messageDelete)
router.post("/api/workspace/versions", versionsSave)

// ── Settings ──
router.get("/api/settings/keys", async (req: ParsedRequest, res: ExpressLikeResponse) => {
  await getSettingsKeys({ method: "GET", url: req.url, headers: req.headers, body: {} }, res)
})
router.post("/api/settings/keys", saveSettingsKeys)
router.post("/api/settings/reset", resetSettings)
router.post("/api/settings/validate-key", validateKey)

// ── Regulation Watcher (Phase 4-B) ──
router.get("/api/regulation/status", async (_req: ParsedRequest, res: ExpressLikeResponse) => {
  endJson(res as any, 200, { ok: true, data: { watcher: getWatcherStatus(), cache: getCacheSummary() } })
})
router.get("/api/regulation/snapshots", async (_req: ParsedRequest, res: ExpressLikeResponse) => {
  endJson(res as any, 200, { ok: true, data: getAllSnapshots() })
})
router.post("/api/regulation/refresh", async (req: ParsedRequest, res: ExpressLikeResponse) => {
  try {
    const body = (req as any).body ?? {}
    const category = body?.category
    const source_id = body?.source_id
    const r = await refreshRegulations({ category, source_id })
    endJson(res as any, 200, { ok: true, data: r })
  } catch (e: any) {
    endJson(res as any, 500, { ok: false, error: String(e?.message ?? e) })
  }
})

// ── Retrieval Context ──
router.get("/api/retrieval-context", async (req: IncomingMessage, res: ServerResponse) => {
  const projectId = parseUrl(req.url).searchParams.get("projectId") ?? ""
  const query = parseUrl(req.url).searchParams.get("query") ?? undefined
  endJson(res, 200, { ok: true, data: getLatestProjectContext(projectId, query) })
}, true)

// ── Export ──
router.post("/api/export", async (req: IncomingMessage, res: ServerResponse) => {
  const body = await readJsonBody(req)
  exportThreadRoute({ body }, res as any)
}, true)

// ── Backup / Restore ──
router.post("/api/backup/export", backupExport)
router.post("/api/backup/download", async (req: IncomingMessage, res: ServerResponse) => {
  backupDownload(req, res)
}, true)
router.post("/api/backup/restore", backupRestore)

// ── OpenAPI Docs ──
router.get("/api/docs", docsRoute)

// ── Scheduler ──
router.get("/api/scheduler/status", async (_req: ParsedRequest, res: ExpressLikeResponse) => {
  res.json({ ok: true, ...getSchedulerStatus() })
})
router.post("/api/scheduler/trigger", async (req: ParsedRequest, res: ExpressLikeResponse) => {
  const task = String((req.body as Record<string, unknown>)?.task ?? "")
  if (!task) return res.json({ ok: false, error: "task is required (log_rotation | health_check | retail_snapshot)" })
  const result = await triggerTask(task)
  res.json(result)
})

// ── APM (D5) ──
router.get("/api/apm", async (_req: ParsedRequest, res: ExpressLikeResponse) => {
  res.json({ ok: true, ...getApmSnapshot(), ws_clients: getConnectedClients() })
})

// ── WebSocket info (B4) ──
router.get("/api/ws/status", async (_req: ParsedRequest, res: ExpressLikeResponse) => {
  res.json({ ok: true, connected_clients: getConnectedClients() })
})
router.post("/api/ws/broadcast", async (req: ParsedRequest, res: ExpressLikeResponse) => {
  const body = req.body as Record<string, unknown>
  const event = String(body?.event ?? "system:info") as any
  const data = body?.data ?? {}
  broadcast(event, data)
  res.json({ ok: true, clients: getConnectedClients() })
})

// ── External Tool API (CC HOMEPAGE → CORVUS X) ──
// Bearer 토큰 자체 인증 (CORVUS_X_API_KEY). 세션 인증 화이트리스트 적용됨.
router.post("/api/external/tool/*", async (req: IncomingMessage, res: ServerResponse) => {
  await externalToolRoute(req, res)
}, true)

// ── Plugin System (B5) ──
router.get("/api/plugins", async (_req: ParsedRequest, res: ExpressLikeResponse) => {
  res.json({ ok: true, plugins: getPluginList() })
})
router.post("/api/plugins/register", async (req: ParsedRequest, res: ExpressLikeResponse) => {
  const body = req.body as Record<string, unknown>
  const manifest = body?.manifest as any
  if (!manifest?.id) return res.json({ ok: false, error: "manifest.id required" })
  // 핸들러는 런타임에서만 등록 가능 — API는 manifest만 등록
  const result = registerPlugin(manifest, {})
  res.json({ ok: result, plugin_id: manifest.id })
})
router.post("/api/plugins/activate", async (req: ParsedRequest, res: ExpressLikeResponse) => {
  const id = String((req.body as Record<string, unknown>)?.id ?? "")
  res.json({ ok: activatePlugin(id), plugin_id: id })
})
router.post("/api/plugins/deactivate", async (req: ParsedRequest, res: ExpressLikeResponse) => {
  const id = String((req.body as Record<string, unknown>)?.id ?? "")
  res.json({ ok: deactivatePlugin(id), plugin_id: id })
})
router.post("/api/plugins/unregister", async (req: ParsedRequest, res: ExpressLikeResponse) => {
  const id = String((req.body as Record<string, unknown>)?.id ?? "")
  res.json({ ok: unregisterPlugin(id), plugin_id: id })
})

// ── 서버 시작 ──

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // Correlation ID 컨텍스트 래핑 — 이하 모든 logger 호출에 자동 삽입
  await withCorrelationId(req, res, async () => {
    // ── www / apex → app 서브도메인으로 301 redirect ──────────────────────
    // cloudcookie.co.kr / www.cloudcookie.co.kr 접근 시 app.cloudcookie.co.kr 로 이동
    // 실제 CORVUS X 서비스는 app.cloudcookie.co.kr 한 곳에서만 동작
    // (nginx 레이어에서 1차 처리, 여기는 2차 방어선)
    const reqHost = String(req.headers?.host ?? "").toLowerCase().split(":")[0].trim()
    const WWW_REDIRECT_HOSTS = ["www.cloudcookie.co.kr", "cloudcookie.co.kr"]
    if (WWW_REDIRECT_HOSTS.includes(reqHost)) {
      const target = `https://app.cloudcookie.co.kr${req.url ?? "/"}`
      res.writeHead(301, {
        "Location": target,
        "Cache-Control": "no-store, no-cache",
        "X-Robots-Tag": "noindex, nofollow"
      })
      res.end()
      return
    }
    // ────────────────────────────────────────────────────────────────────

    setCorsHeaders(res, req)
    setSecurityHeaders(res)

    if (handleOptions(req, res)) return

    const path = normalizePath(req.url)

    // Health check (Router 밖 — 빠른 응답)
    if (req.method === "GET" && path === "/api/health") {
      endJson(res, 200, {
        ok: true,
        service: "CORVUS X",
        timestamp: new Date().toISOString(),
        env: { gemini_api_key: geminiKeyLoaded ? "LOADED" : "EMPTY" }
      })
      return
    }

    if (req.method === "GET" && path === "/") {
      endJson(res, 200, { ok: true, service: "CORVUS X" })
      return
    }

    // Rate limiting (/api/health, / 제외 — 위에서 이미 처리됨)
    if (path.startsWith("/api/") && checkRateLimit(req, res, path)) return

    // 모든 /api/ 경로에 인증 체크
    // 단, auth 화이트리스트(/api/health, /api/auth/login, /api/auth/logout, /api/auth/me)는 통과
    if (path.startsWith("/api/") && !isAuthWhitelisted(path)) {
      const auth = requireAuth(req)
      if (!auth.ok) {
        endJson(res, 401, { ok: false, error: auth.error ?? "unauthorized" })
        return
      }
    }

    // APM 요청 타이밍 (D5)
    const timer = createRequestTimer(req.method ?? "GET", path)

    // Gzip 압축 래핑 (SSE 스트림은 내부에서 자동 제외)
    const effectiveRes = envConfig.compressionEnabled
      ? wrapWithCompression(String(req.headers["accept-encoding"] ?? ""), res)
      : res

    try {
      const handled = await router.dispatch(req, effectiveRes)
      if (!handled) {
        endJson(res, 404, { ok: false, error: "not_found", path, method: req.method })
        timer.end(404)
      } else {
        timer.end(res.statusCode || 200)
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "server_error"
      captureError(err instanceof Error ? err : new Error(errMsg), { path, method: req.method ?? "GET", statusCode: 500 })
      timer.end(500)
      if (!res.headersSent) {
        endJson(res, 500, { ok: false, error: errMsg, path, method: req.method })
      }
    }
  })
})

// ── WebSocket upgrade 핸들러 (B4) ──
server.on("upgrade", (req, socket, head) => {
  handleUpgrade(req, socket, head)
})

server.listen(SERVER_PORT, async () => {
  // Rate limiter 버킷 복원 (SQLite에서)
  try {
    const { default: db } = await import("./db/database.js")
    restoreBucketsFromDb(db)
  } catch { /* 복원 실패 시 무시 — 빈 상태로 시작 */ }

  // 백그라운드 스케줄러 시작
  startScheduler()

  // WebSocket keep-alive 시작
  startWsPing()

  // 내장 플러그인 등록
  registerPlugin(loggingPluginManifest, loggingPluginHandlers)
  activatePlugin(loggingPluginManifest.id)

  // 플러그인 시스템 초기화
  await initPlugins()

  // Phase 4-B — 자동 법규 갱신 워처 (환경변수로만 활성화)
  try {
    startRegulationWatcher()
  } catch (e) {
    logger.warn("[regulationWatcher] start failed", { error: String(e) })
  }

  logger.info(`CORVUS X running on http://localhost:${SERVER_PORT}`, {
    env: getAppEnv(),
    compression: envConfig.compressionEnabled,
    cors: envConfig.corsOrigins.length > 0 ? envConfig.corsOrigins : ["*"],
    websocket: "ws://localhost:" + SERVER_PORT + "/ws"
  })
})

// ── Graceful shutdown ──
function shutdown(signal: string) {
  logger.info(`[SHUTDOWN] ${signal} received — closing server & DB`)
  server.close(async () => {
    stopScheduler()
    stopRegulationWatcher()
    closeAllClients()
    await shutdownPlugins()
    try {
      const dbMod = await import("./db/database.js")
      persistBucketsToDb(dbMod.default)
      dbMod.closeDb()
    } catch (e) { logger.warn("[SHUTDOWN] closeDb failed", { error: String(e) }) }
    logger.info("[SHUTDOWN] done")
    process.exit(0)
  })
  // 강제 종료 타이머 (5초)
  setTimeout(() => process.exit(1), 5000).unref()
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))

// ── 비정상 종료 방지 ─────────────────────────
process.on("unhandledRejection", (reason) => {
  logger.warn("[unhandledRejection]", { reason: String(reason) })
})
process.on("uncaughtException", (err) => {
  logger.warn("[uncaughtException]", { error: String(err?.message ?? err) })
})
