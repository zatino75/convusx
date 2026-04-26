import type { IncomingMessage, ServerResponse } from "node:http"
import { readJsonBody, normalizePath } from "./middleware.js"
import { createExpressLikeResponse, endJson } from "./response.js"
import type { ExpressLikeResponse } from "./response.js"

/** Parsed request object created by Router dispatch for non-raw handlers */
export interface ParsedRequest {
  method: string | undefined
  url: string | undefined
  headers: IncomingMessage["headers"]
  body: Record<string, unknown>
}

// RouteHandler uses flexible params — Router dispatches both raw (IncomingMessage/ServerResponse)
// and parsed (ParsedRequest/ExpressLikeResponse) depending on the raw flag.
// Individual route files should use ParsedRequest/ExpressLikeResponse for their own signatures.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RouteHandler = (req: any, res: any) => any

export interface Route {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS"
  path: string
  handler: RouteHandler
  /** true = handler receives raw (req, res), false = wrapped with body parsing */
  raw?: boolean
}

export class Router {
  private routes: Route[] = []

  add(method: Route["method"], path: string, handler: RouteHandler, raw = false) {
    this.routes.push({ method, path, handler, raw })
    return this
  }

  get(path: string, handler: RouteHandler, raw = false) { return this.add("GET", path, handler, raw) }
  post(path: string, handler: RouteHandler, raw = false) { return this.add("POST", path, handler, raw) }
  put(path: string, handler: RouteHandler, raw = false) { return this.add("PUT", path, handler, raw) }
  patch(path: string, handler: RouteHandler, raw = false) { return this.add("PATCH", path, handler, raw) }
  delete(path: string, handler: RouteHandler, raw = false) { return this.add("DELETE", path, handler, raw) }
  options(path: string, handler: RouteHandler, raw = false) { return this.add("OPTIONS", path, handler, raw) }

  async dispatch(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const method = String(req.method ?? "GET").toUpperCase() as Route["method"]
    const path = normalizePath(req.url)

    // Exact match first
    let matched = this.routes.find(r => r.method === method && r.path === path)

    // Prefix match for parameterized routes (e.g., /api/project-sources/:id)
    if (!matched) {
      matched = this.routes.find(r =>
        r.method === method && r.path.endsWith("/*") && path.startsWith(r.path.slice(0, -2))
      )
    }

    if (!matched) return false

    if (matched.raw) {
      await matched.handler(req, res)
    } else {
      const body = await readJsonBody(req)
      const reqLike = { method: req.method, url: req.url, headers: req.headers, body }
      const resLike = createExpressLikeResponse(res)
      await matched.handler(reqLike, resLike)
    }

    return true
  }
}
