import { useCallback, useState } from "react"

export type ThreadMessage = {
  id: string
  role: string
  content: string
  status?: string
  [key: string]: any
}

export function useThreadMessages(initialMessages: ThreadMessage[] = []) {
  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages)

  const appendMessage = useCallback((message: ThreadMessage) => {
    setMessages((prev) => [...prev, message])
  }, [])

  const updateMessage = useCallback((id: string, patch: Partial<ThreadMessage>) => {
    setMessages((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }, [])

  const upsertAssistantDraft = useCallback((id: string, chunk: string) => {
    setMessages((prev) => {
      const existing = prev.find((item) => item.id === id)
      if (!existing) {
        return [...prev, { id, role: "assistant", content: chunk, status: "streaming" }]
      }
      return prev.map((item) => (item.id === id ? { ...item, content: `${item.content ?? ""}${chunk}` } : item))
    })
  }, [])

  return {
    messages,
    setMessages,
    appendMessage,
    updateMessage,
    upsertAssistantDraft,
  }
}
