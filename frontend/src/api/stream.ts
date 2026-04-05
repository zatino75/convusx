import { apiUrl } from "./url"

export type StreamEvent = {
  type: string
  [key: string]: any
}

export async function sendChatStream(
  payload: Record<string, any>,
  handlers: {
    onEvent?: (event: StreamEvent) => void
    onDone?: (payload: any) => void
  },
  options?: { signal?: AbortSignal }
) {
  const response = await fetch(apiUrl("/api/chat/stream"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: options?.signal,
  })

  if (!response.ok || !response.body) {
    throw new Error(`stream connect failed (${response.status})`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    if (options?.signal?.aborted) throw new DOMException("aborted", "AbortError")
    const { value, done } = await reader.read()
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
      const parsed = JSON.parse(payloadText)
      if (parsed?.type === "done") handlers?.onDone?.(parsed?.payload ?? parsed)
      else handlers?.onEvent?.(parsed)
    }
  }
}
