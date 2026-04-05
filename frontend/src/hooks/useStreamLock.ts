import { useCallback, useRef, useState } from "react"

export function useStreamLock() {
  const activeStreamRef = useRef<AbortController | null>(null)
  const [isSending, setIsSending] = useState(false)

  const beginStream = useCallback(() => {
    if (activeStreamRef.current) {
      activeStreamRef.current.abort()
      activeStreamRef.current = null
    }
    const controller = new AbortController()
    activeStreamRef.current = controller
    setIsSending(true)
    return controller
  }, [])

  const finishStream = useCallback(() => {
    activeStreamRef.current = null
    setIsSending(false)
  }, [])

  const abortStream = useCallback(() => {
    activeStreamRef.current?.abort()
    activeStreamRef.current = null
    setIsSending(false)
  }, [])

  return {
    activeStreamRef,
    isSending,
    beginStream,
    finishStream,
    abortStream,
  }
}
