import { useSyncExternalStore } from "react"
import type { CeoBriefing, CriticReview, PmoPlan } from "../api/director"

export type DeptState = "idle" | "thinking" | "working" | "done" | "error"

export type DeptStatus = {
  deptId: string
  state: DeptState
  objective?: string
  model?: string
  percent?: number
  durationMs?: number
  connectors?: string[]
  error?: string
  lastMessage?: string
}

export type ToolCallEntry = {
  time: number
  deptId: string
  tool: string
}

export type DirectorSession = {
  sessionId: string | null
  topic: string
  domain: string
  running: boolean
  startTime: number
  endTime: number
  deptStatuses: Record<string, DeptStatus>
  pmoPlan: PmoPlan | null
  criticReview: CriticReview | null
  ceoBriefing: CeoBriefing | null
  toolCallLog: ToolCallEntry[]
  roundNumber: number
  threadId: string | null
}

const INITIAL_SESSION: DirectorSession = {
  sessionId: null,
  topic: "",
  domain: "",
  running: false,
  startTime: 0,
  endTime: 0,
  deptStatuses: {},
  pmoPlan: null,
  criticReview: null,
  ceoBriefing: null,
  toolCallLog: [],
  roundNumber: 0,
  threadId: null,
}

let session: DirectorSession = { ...INITIAL_SESSION }
const listeners = new Set<() => void>()

function emit() {
  for (const fn of listeners) fn()
}

export function getDirectorSession(): DirectorSession {
  return session
}

export function resetDirectorSession(threadId?: string | null) {
  session = { ...INITIAL_SESSION, threadId: threadId ?? null }
  emit()
}

export function updateDirectorSession(patch: Partial<DirectorSession>) {
  session = { ...session, ...patch }
  emit()
}

export function updateDeptStatus(deptId: string, patch: Partial<DeptStatus>) {
  const prev = session.deptStatuses[deptId] ?? { deptId, state: "idle" as DeptState }
  session = {
    ...session,
    deptStatuses: {
      ...session.deptStatuses,
      [deptId]: { ...prev, deptId, ...patch },
    },
  }
  emit()
}

export function addToolCall(deptId: string, tool: string) {
  session = {
    ...session,
    toolCallLog: [...session.toolCallLog, { time: Date.now(), deptId, tool }],
  }
  emit()
}

export function useDirectorSession(): DirectorSession {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    () => session,
    () => session,
  )
}
