import dotenv from "dotenv"
dotenv.config()

import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

const geminiKeyLoaded =
  typeof process.env.GEMINI_API_KEY === "string" &&
  process.env.GEMINI_API_KEY.trim().length > 0

console.log("[ENV] GEMINI_API_KEY:", geminiKeyLoaded ? "LOADED" : "EMPTY")

import { runBenchmarkRoute } from "./routes/benchmark.js"
import { chatRoute, chatStreamRoute } from "./routes/chat.js"
import { usageRoute, scoreboardRoute } from "./routes/usage.js"
import { dashboardRoute } from "./routes/dashboard.js"

type RouteHandler = (req: any, res: any) => any | Promise<any>

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
}

function setJson(res: ServerResponse, statusCode: number) {
  res.statusCode = statusCode
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v)
}

function setSse(res: ServerResponse) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    ...CORS_HEADERS
  })
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

function createSseResponse(res: ServerResponse) {
  let headersWritten = false

  return {
    writeHead(_statusCode: number, _headers: Record<string, string>) {
      if (!headersWritten) {
        headersWritten = true
        setSse(res)
      }
    },
    write(chunk: string) {
      if (!headersWritten) {
        headersWritten = true
        setSse(res)
      }
      res.write(chunk)
    },
    end() {
      res.end()
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
  const method = String(req.method ?? "GET").toUpperCase()
  const path = normalizePath(req.url)

  if (method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS)
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
        body
      }

      const resLike = createSseResponse(res)
      await chatStreamRoute.handler(reqLike, resLike)
      return
    }

    if (method === "POST" && path === "/api/benchmark") {
      await handlePostRoute(req, res, runBenchmarkRoute)
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
})