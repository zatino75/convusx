import { apiFetch } from "./url"
import type { StreamEvent } from "../types/workspace"

export type { StreamEvent }

export async function sendChatStream(
  payload: Record<string, any>,
  handlers: {
    onEvent?: (event: StreamEvent) => void
    onDone?: (payload: any) => void
    onError?: (error: Error) => void
  },
  options?: { signal?: AbortSignal }
) {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

  try {
    const response = await apiFetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: options?.signal,
    })

    if (!response.ok || !response.body) {
      throw new Error(`stream connect failed (${response.status})`)
    }

    reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let streamDone = false

    while (true) {
      if (options?.signal?.aborted) throw new DOMException("aborted", "AbortError")

      let readResult: ReadableStreamReadResult<Uint8Array>
      try {
        readResult = await reader.read()
      } catch (readErr) {
        // 네트워크 끊김 또는 서버 연결 해제 — reader 정리 후 rethrow
        reader.cancel().catch(() => {})
        reader = null
        if (options?.signal?.aborted) throw new DOMException("aborted", "AbortError")
        throw new Error(`stream read failed: ${(readErr as Error)?.message ?? "unknown"}`)
      }

      const { value, done } = readResult
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      while (buffer.includes("\n\n")) {
        const splitIndex = buffer.indexOf("\n\n")
        const rawEvent = buffer.slice(0, splitIndex)
        buffer = buffer.slice(splitIndex + 2)
        const dataLine = rawEvent
          .split("\n")
          .find((line) => line.startsWith("data:"))
        if (!dataLine) continue
        const payloadText = dataLine.replace(/^data:\s*/, "")
        if (!payloadText) continue

        let parsed: any
        try {
          parsed = JSON.parse(payloadText)
        } catch {
          continue // 파싱 실패한 청크 스킵
        }

        if (parsed?.type === "done") {
          const donePayload = parsed?.payload ?? parsed
          // 서버에서 보내는 reason 필드 (aborted | error | undefined=정상) 전달
          if (parsed?.payload?.reason) {
            donePayload._reason = parsed.payload.reason
            donePayload._errorMessage = parsed.payload.error_message ?? null
          }
          handlers?.onDone?.(donePayload)
          streamDone = true
          break
        }
        handlers?.onEvent?.(parsed)
      }

      if (streamDone) {
        reader.cancel().catch(() => {})
        reader = null
        break
      }
    }
  } catch (err) {
    // AbortError는 정상 취소이므로 onError 호출하지 않고 rethrow
    if ((err as DOMException)?.name === "AbortError") throw err
    handlers?.onError?.(err instanceof Error ? err : new Error(String(err)))
    throw err
  } finally {
    // reader가 아직 열려 있으면 정리
    if (reader) {
      reader.cancel().catch(() => {})
    }
  }
}
