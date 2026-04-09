import type { ServerResponse } from "node:http"

/** Express-like response wrapper returned by createExpressLikeResponse */
export interface ExpressLikeResponse {
  setHeader(k: string, v: string): ExpressLikeResponse
  status(code: number): ExpressLikeResponse
  json(body: unknown): ExpressLikeResponse
}

export function setJson(res: ServerResponse, statusCode: number) {
  res.statusCode = statusCode
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
}

export function endJson(res: ServerResponse, statusCode: number, body: unknown) {
  setJson(res, statusCode)
  res.end(JSON.stringify(body))
}

export function createExpressLikeResponse(res: ServerResponse): ExpressLikeResponse {
  return {
    setHeader(k: string, v: string) {
      if (!res.headersSent) res.setHeader(k, v)
      return this
    },
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
