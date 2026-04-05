import { useCallback } from "react"
import { sendChatStream } from "../api/stream"
import { useStreamLock } from "./useStreamLock"

export function useChatStreaming() {
  const streamLock = useStreamLock()

  const runStream = useCallback(async (
    payload: Record<string, any>,
    handlers: {
      onEvent?: (event: any) => void
      onDone?: (payload: any) => void
      onError?: (error: unknown) => void
    }
  ) => {
    const controller = streamLock.beginStream()
    try {
      await sendChatStream(payload, {
        onEvent: handlers?.onEvent,
        onDone: handlers?.onDone,
      }, {
        signal: controller.signal,
      })
    } catch (error) {
      handlers?.onError?.(error)
      throw error
    } finally {
      streamLock.finishStream()
    }
  }, [streamLock])

  return {
    ...streamLock,
    runStream,
  }
}
