import dotenv from "dotenv"
dotenv.config({ override: true })

import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

const geminiKeyLoaded =
  typeof process.env.GEMINI_API_KEY === "string" &&
  process.env.GEMINI_API_KEY.trim().length > 0

console.log("[ENV] GEMINI_API_KEY:", geminiKeyLoaded ? "LOADED" : "EMPTY")

import { runBenchmarkRoute, runBenchmarkRunRoute, runBenchmarkHistoryRoute, startBenchmarkScheduler } from "./routes/benchmark.js"
import { runFeedbackRoute } from "./routes/feedback.js"
import { runSlidesGenerateRoute as generateSlidesRoute } from "./routes/slides.js"
import { chatRoute, chatStreamRoute } from "./routes/chat.js"
import { usageRoute, scoreboardRoute } from "./routes/usage.js"
import { dashboardRoute } from "./routes/dashboard.js"
import {
  getProjectMemory,
  getLatestProjectContext,
  getProjectSourceAssets,
  addProjectSourceAsset
} from "./memory/projectMemory.js"
import {
  getThreadMemory,
  getProjectThreadMemories
} from "./memory/threadMemory.js"

type RouteHandler = (req: any, res: any) => any | Promise<any>

function setJson(res: ServerResponse, statusCode: number) {
  res.statusCode = statusCode
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
}

function endJson(res: ServerResponse, statusCode: number, body: unknown) {
  setJson(res, statusCode)
  res.end(JSON.stringify(body))
}

function createExpressLikeResponse(res: ServerResponse) {
  return {
    status(code: number) {
      setJson(res, code)
      return this
    },
    json(body: unknown) {
      if (!res.headersSent) {
        setJson(res, res.statusCode && res.statusCode > 0 ? res.statusCode : 200)
      }
      res.end(JSON.stringify(body))
      return this
    }
  }
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim()

  if (!raw) return {}

  try {
    return JSON.parse(raw)
  } catch {
    return { __raw: raw }
  }
}

function normalizePath(urlValue: string | undefined): string {
  return String(urlValue ?? "").split("?")[0] || "/"
}

async function handlePostRoute(req: IncomingMessage, res: ServerResponse, handler: RouteHandler) {
  const body = await readJsonBody(req)

  const reqLike = {
    method: req.method,
    url: req.url,
    headers: req.headers,
    body
  }

  const resLike = createExpressLikeResponse(res)

  await handler(reqLike, resLike)
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

  const method = String(req.method ?? "GET").toUpperCase()
  const path = normalizePath(req.url)

  if (method === "OPTIONS") {
    res.statusCode = 204
    res.end()
    return
  }

  if (method === "GET" && path === "/api/health") {
    endJson(res, 200, {
      ok: true,
      service: "AI ORCHESTRA",
      timestamp: new Date().toISOString(),
      env: {
        gemini_api_key: geminiKeyLoaded ? "LOADED" : "EMPTY"
      }
    })
    return
  }

  if (method === "GET" && path === "/") {
    endJson(res, 200, { ok: true, service: "AI ORCHESTRA" })
    return
  }

  try {
    if (method === "POST" && path === "/api/chat") {
      await handlePostRoute(req, res, chatRoute.handler)
      return
    }

    if (method === "POST" && path === "/api/chat/stream") {
      const body = await readJsonBody(req)

      const reqLike = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
        on: (event: string, cb: () => void) => {
          if (event === "close") {
            req.on("close", cb)
          }
        }
      }

      await chatStreamRoute.handler(reqLike, res)
      return
    }

    if (method === "POST" && path === "/api/benchmark") {
      await handlePostRoute(req, res, runBenchmarkRoute)
      return
    }

    if (method === "POST" && path === "/api/benchmark/run") {
      await handlePostRoute(req, res, runBenchmarkRunRoute)
      return
    }

    if (method === "GET" && path === "/api/benchmark/history") {
      const resLike = createExpressLikeResponse(res)
      await runBenchmarkHistoryRoute({}, resLike)
      return
    }

    if (method === "POST" && path === "/api/feedback") {
      await handlePostRoute(req, res, runFeedbackRoute)
      return
    }

    if (method === "POST" && path === "/api/slides/generate") {
      const body = await readJsonBody(req)
      const reqLike = { method: req.method, url: req.url, headers: req.headers, body }
      const resLike = {
        writeHead: (code: number, headers: Record<string, any>) => {
          res.statusCode = code
          for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
        },
        end: (data?: any) => res.end(data),
        setHeader: (k: string, v: string) => res.setHeader(k, v),
        send: (data: any) => {
          if (!res.headersSent) {
            res.setHeader("Access-Control-Allow-Origin", "*")
          }
          res.end(data)
        },
        status: (code: number) => { res.statusCode = code; return resLike },
        json: (body: any) => {
          if (!res.headersSent) {
            res.statusCode = 200
            res.setHeader("Content-Type", "application/json")
            res.setHeader("Access-Control-Allow-Origin", "*")
          }
          res.end(JSON.stringify(body))
        }
      }
      await generateSlidesRoute(reqLike, resLike)
      return
    }

    if (method === "GET" && path === "/api/usage") {
      const resLike = createExpressLikeResponse(res)
      await usageRoute.handler({}, resLike)
      return
    }

    if (method === "GET" && path === "/api/scoreboard") {
      const resLike = createExpressLikeResponse(res)
      await scoreboardRoute.handler({}, resLike)
      return
    }

    if (method === "GET" && path === "/api/dashboard") {
      const resLike = createExpressLikeResponse(res)
      await dashboardRoute.handler({}, resLike)
      return
    }

    // ===== MEMORY API =====

    if (method === "GET" && path === "/api/project-memory") {
      const url = new URL(req.url ?? "/", "http://localhost:8000")
      const projectId = url.searchParams.get("projectId") ?? ""
      endJson(res, 200, { ok: true, data: getProjectMemory(projectId) })
      return
    }

    if (method === "GET" && path === "/api/thread-memory") {
      const url = new URL(req.url ?? "/", "http://localhost:8000")
      const threadId = url.searchParams.get("threadId") ?? ""
      endJson(res, 200, { ok: true, data: getThreadMemory(threadId) })
      return
    }

    if (method === "GET" && path === "/api/project-thread-memories") {
      const url = new URL(req.url ?? "/", "http://localhost:8000")
      const projectId = url.searchParams.get("projectId") ?? ""
      endJson(res, 200, { ok: true, data: getProjectThreadMemories(projectId) })
      return
    }

    if (method === "GET" && path === "/api/project-sources") {
      const url = new URL(req.url ?? "/", "http://localhost:8000")
      const projectId = url.searchParams.get("projectId") ?? ""
      endJson(res, 200, { ok: true, data: getProjectSourceAssets(projectId) })
      return
    }

    if (method === "POST" && path === "/api/project-sources") {
      const body = await readJsonBody(req)
      const projectId = String(body?.projectId ?? "")
      const asset = body?.asset ?? null
      if (!projectId || !asset) {
        endJson(res, 400, { ok: false, error: "invalid_input" })
        return
      }
      addProjectSourceAsset(projectId, asset)
      endJson(res, 200, { ok: true })
      return
    }

    if (method === "GET" && path === "/api/retrieval-context") {
      const url = new URL(req.url ?? "/", "http://localhost:8000")
      const projectId = url.searchParams.get("projectId") ?? ""
      endJson(res, 200, { ok: true, data: getLatestProjectContext(projectId) })
      return
    }

    endJson(res, 404, {
      ok: false,
      error: "not_found",
      path,
      method
    })
  } catch (err: any) {
    endJson(res, 500, {
      ok: false,
      error: err?.message ?? "server_error",
      path,
      method
    })
  }
})

const PORT = 8000

server.listen(PORT, () => {
  console.log("AI ORCHESTRA running on http://localhost:" + PORT)
  startBenchmarkScheduler()
})
