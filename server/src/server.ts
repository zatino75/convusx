import { createServer, IncomingMessage, ServerResponse } from "node:http"
import { URL } from "node:url"

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

type RouteHandler = (req: { body?: any; query?: any }, res: { json: (payload: unknown) => void }) => unknown

type RegisteredRoute = {
  method: "GET" | "POST"
  path: string
  handler: RouteHandler
}

const routes: RegisteredRoute[] = [
  { method: "POST", path: chatRoute.path, handler: chatRoute.handler as RouteHandler },
  { method: "GET", path: usageRoute.path, handler: usageRoute.handler as RouteHandler },
  { method: "GET", path: scoreboardRoute.path, handler: scoreboardRoute.handler as RouteHandler },
  { method: "GET", path: dashboardRoute.path, handler: dashboardRoute.handler as RouteHandler },

  // ===== MEMORY API =====

  {
    method: "GET",
    path: "/api/project-memory",
    handler: ({ query }, res) => {
      const projectId = String(query?.projectId ?? "")
      res.json({
        ok: true,
        data: getProjectMemory(projectId)
      })
    }
  },

  {
    method: "GET",
    path: "/api/thread-memory",
    handler: ({ query }, res) => {
      const threadId = String(query?.threadId ?? "")
      res.json({
        ok: true,
        data: getThreadMemory(threadId)
      })
    }
  },

  {
    method: "GET",
    path: "/api/project-thread-memories",
    handler: ({ query }, res) => {
      const projectId = String(query?.projectId ?? "")
      res.json({
        ok: true,
        data: getProjectThreadMemories(projectId)
      })
    }
  },

  {
    method: "GET",
    path: "/api/project-sources",
    handler: ({ query }, res) => {
      const projectId = String(query?.projectId ?? "")
      res.json({
        ok: true,
        data: getProjectSourceAssets(projectId)
      })
    }
  },

  {
    method: "POST",
    path: "/api/project-sources",
    handler: ({ body }, res) => {
      const projectId = String(body?.projectId ?? "")
      const asset = body?.asset ?? null

      if (!projectId || !asset) {
        res.json({ ok: false, error: "invalid_input" })
        return
      }

      addProjectSourceAsset(projectId, asset)

      res.json({
        ok: true
      })
    }
  },

  {
    method: "GET",
    path: "/api/retrieval-context",
    handler: ({ query }, res) => {
      const projectId = String(query?.projectId ?? "")

      res.json({
        ok: true,
        data: getLatestProjectContext(projectId)
      })
    }
  }
]

function setCorsHeaders(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  setCorsHeaders(res)
  res.statusCode = statusCode
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  res.end(JSON.stringify(payload))
}

function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []

    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })

    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }

      const raw = Buffer.concat(chunks).toString("utf-8").trim()

      if (!raw) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve({})
      }
    })

    req.on("error", () => {
      resolve({})
    })
  })
}

function findRoute(method: string, pathname: string): RegisteredRoute | null {
  return routes.find((route) => route.method === method && route.path === pathname) ?? null
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  setCorsHeaders(res)

  if (req.method === "OPTIONS") {
    res.statusCode = 204
    res.end()
    return
  }

  const url = new URL(req.url ?? "/", "http://localhost:8000")
  const pathname = url.pathname
  const method = String(req.method ?? "GET").toUpperCase()

  if (method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      service: "AI ORCHESTRA",
      timestamp: new Date().toISOString()
    })
    return
  }

  // SSE 스트리밍 전용 라우트
  if (method === "POST" && pathname === chatStreamRoute.path) {
    const body = await parseBody(req)
    await chatStreamRoute.handler(
      { body },
      {
        writeHead: (statusCode: number, headers: Record<string, string>) => {
          res.writeHead(statusCode, headers)
        },
        write: (chunk: string) => {
          res.write(chunk)
        },
        end: () => {
          res.end()
        }
      }
    )
    return
  }

  const route = findRoute(method, pathname)

  if (!route) {
    sendJson(res, 404, {
      ok: false,
      error: "not_found"
    })
    return
  }

  const body = method === "POST" ? await parseBody(req) : {}
  const query = Object.fromEntries(url.searchParams.entries())

  try {
    await route.handler(
      { body, query },
      {
        json: (payload: unknown) => {
          sendJson(res, 200, payload)
        }
      }
    )
  } catch (error: any) {
    sendJson(res, 500, {
      ok: false,
      error: String(error?.message ?? "server_error")
    })
  }
})

const PORT = 8000

server.listen(PORT, () => {
  console.log("[AI ORCHESTRA] server running on http://localhost:" + PORT)
})