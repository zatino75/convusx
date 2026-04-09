// ── Gzip 압축 미들웨어 ──
// Accept-Encoding: gzip 지원 시 응답을 자동 압축
// SSE 스트림, 1KB 미만 응답은 제외

import { createGzip } from "node:zlib"
import type { ServerResponse } from "node:http"

const MIN_COMPRESS_BYTES = 1024

/**
 * 응답을 gzip으로 래핑.
 * - acceptEncoding에 gzip이 없으면 원본 res 반환
 * - Content-Type이 text/event-stream(SSE)이면 원본 반환
 * - 호출 시점에 이미 headersSent면 원본 반환
 *
 * 주의: 이 함수는 res.end()를 가로채서 압축 후 전송합니다.
 * Router dispatch 전에 한 번만 호출해야 합니다.
 */
export function wrapWithCompression(
  acceptEncoding: string,
  res: ServerResponse
): ServerResponse {
  if (!acceptEncoding.includes("gzip")) return res

  const originalWrite = res.write.bind(res)
  const originalEnd = res.end.bind(res)
  const originalWriteHead = res.writeHead.bind(res)

  let bufferedChunks: Buffer[] = []
  let totalSize = 0
  let headersSent = false
  let isSSE = false
  let compressionDecided = false
  let useCompression = false

  // writeHead를 가로채서 SSE 여부 확인
  res.writeHead = function (statusCode: number, ...args: any[]) {
    const headers = args[0]
    if (headers) {
      const ct = typeof headers === "object" && !Array.isArray(headers)
        ? String(headers["content-type"] ?? headers["Content-Type"] ?? "")
        : ""
      if (ct.includes("text/event-stream")) isSSE = true
    }
    return originalWriteHead(statusCode, ...args)
  } as any

  res.write = function (chunk: any, ...args: any[]) {
    if (isSSE || headersSent) return originalWrite(chunk, ...args)

    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    bufferedChunks.push(buf)
    totalSize += buf.length
    return true
  } as any

  res.end = function (chunk?: any, ...args: any[]) {
    if (isSSE || headersSent) {
      return originalEnd(chunk, ...args)
    }

    if (chunk) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      bufferedChunks.push(buf)
      totalSize += buf.length
    }

    const fullBody = Buffer.concat(bufferedChunks)
    headersSent = true

    // 크기가 작으면 압축 스킵
    if (fullBody.length < MIN_COMPRESS_BYTES) {
      return originalEnd(fullBody, ...args)
    }

    // 압축 적용
    res.setHeader("Content-Encoding", "gzip")
    res.removeHeader("Content-Length") // 압축 후 길이 변경

    const gzip = createGzip()
    const compressedChunks: Buffer[] = []

    gzip.on("data", (c: Buffer) => compressedChunks.push(c))
    gzip.on("end", () => {
      const compressed = Buffer.concat(compressedChunks)
      originalEnd(compressed)
    })
    gzip.on("error", () => {
      // 압축 실패 시 원본 전송
      originalEnd(fullBody)
    })

    gzip.end(fullBody)
    return res
  } as any

  return res
}
