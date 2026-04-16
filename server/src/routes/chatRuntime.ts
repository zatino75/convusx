export const CHAT_RUNTIME_MODE = "runtime_agent_loop"
export const CHAT_LEGACY_RUNTIME_MODE = "runtime_orchestra"
export const CHAT_DEFAULT_THREAD_ID = "chat_thread"
export const CHAT_DEFAULT_PROJECT_ID = "chat_project"

function safeString(value: unknown): string {
  return String(value ?? "").trim()
}

export function normalizeChatMode(mode: unknown): string {
  const raw = safeString(mode)
  if (!raw) return CHAT_RUNTIME_MODE
  if (raw === CHAT_LEGACY_RUNTIME_MODE) return CHAT_RUNTIME_MODE
  return raw
}

export function normalizeChatRuntimeInput<T extends Record<string, any>>(
  rawInput: T,
  extras: Record<string, unknown> = {},
): T & { mode: string; thread_id: string; project_id: string } {
  return {
    ...rawInput,
    mode: normalizeChatMode(rawInput?.mode),
    thread_id: safeString(rawInput?.thread_id) || CHAT_DEFAULT_THREAD_ID,
    project_id: safeString(rawInput?.project_id) || CHAT_DEFAULT_PROJECT_ID,
    ...extras,
  }
}
