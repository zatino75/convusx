import { apiFetch, apiUrl } from "./url"

// ─── 타입 정의 ────────────────────────────────────────────────────────────────

export type PmoTask = {
  deptId: string
  priority?: string
  objective?: string
  deliverable?: string
  etaMinutes?: number
}

export type PmoPlan = {
  successCriteria?: string[]
  taskChecklist?: PmoTask[]
  [key: string]: unknown
}

export type CriticReview = {
  verdict?: "pass" | "needs_followup" | string
  summary?: string
  keyIssues?: string[]
  contradictions?: string[]
  verificationNeeded?: string[]
  confidence?: number
  [key: string]: unknown
}

export type CeoBriefing = {
  summary?: string
  opportunities?: string[]
  risks?: string[]
  recommendations?: string[]
  overallConfidence?: number
  [key: string]: unknown
}

export type DirectorEvent =
  | { type: "mission_start"; missionId?: string; sessionId?: string; topic?: string; domain?: string; deptCount?: number }
  | { type: "pmo_plan"; sessionId?: string; roundNumber?: number; plan?: PmoPlan }
  | { type: "dept_start"; deptId: string; objective?: string; model?: string }
  | { type: "dept_progress"; deptId: string; message?: string; percent?: number }
  | { type: "dept_done"; deptId: string; report?: unknown; model?: string; connectors?: string[]; durationMs?: number }
  | { type: "dept_error"; deptId: string; error?: string }
  | { type: "critic_review"; review?: CriticReview }
  | { type: "ceo_briefing"; briefing?: CeoBriefing }
  | { type: "all_done"; sessionId?: string; roundNumber?: number; summary?: unknown; briefing?: CeoBriefing; critic?: CriticReview }
  | { type: "stream_end"; ok?: boolean; timestamp?: string }
  | { type: "error"; message?: string }
  | { type: string; [key: string]: unknown }

export type DirectorStreamHandlers = {
  onEvent?: (event: DirectorEvent) => void
  onDone?: (payload: DirectorEvent) => void
  onError?: (error: Error) => void
}

// ─── EventSource 기반 GET 스트림 ──────────────────────────────────────────────
//
// 백엔드 GET /api/director/stream 은 EventSource 호환 SSE 스트림을 반환한다.
// directive 가 길어 URL 한도를 넘으면 호출자가 startDirectorStreamPost 를 사용해야 한다.

const DIRECTOR_EVENT_NAMES = [
  "mission_start",
  "pmo_plan",
  "dept_start",
  "dept_progress",
  "dept_done",
  "dept_error",
  "critic_review",
  "ceo_briefing",
  "all_done",
  "error",
  "stream_end",
] as const

export function startDirectorStream(
  directive: string,
  handlers: DirectorStreamHandlers,
  options?: { sessionId?: string; projectName?: string; connectors?: string[] }
): { close: () => void } {
  const url = new URL(apiUrl("/api/director/stream"), window.location.origin)
  url.searchParams.set("directive", directive)
  if (options?.sessionId) url.searchParams.set("sessionId", options.sessionId)
  if (options?.projectName) url.searchParams.set("projectName", options.projectName)
  if (options?.connectors?.length) url.searchParams.set("connectors", options.connectors.join(","))

  const es = new EventSource(url.toString(), { withCredentials: true })
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    try { es.close() } catch { /* ignore */ }
  }

  for (const name of DIRECTOR_EVENT_NAMES) {
    es.addEventListener(name, (ev: MessageEvent) => {
      let payload: any = {}
      try {
        payload = ev.data ? JSON.parse(ev.data) : {}
      } catch {
        payload = { raw: ev.data }
      }
      payload.type = payload.type ?? name
      handlers.onEvent?.(payload as DirectorEvent)

      if (name === "all_done") {
        handlers.onDone?.(payload as DirectorEvent)
        close()
      } else if (name === "error") {
        handlers.onError?.(new Error(String(payload?.message ?? "Director error")))
        close()
      } else if (name === "stream_end") {
        // 정상 종료 — onDone 이미 호출됐을 수 있으니 닫기만
        close()
      }
    })
  }

  es.onerror = () => {
    // EventSource 는 재연결을 자동 시도한다. 영구 실패는 readyState=CLOSED 로 판단.
    if (es.readyState === EventSource.CLOSED && !closed) {
      handlers.onError?.(new Error("Director SSE connection failed"))
      close()
    }
  }

  return { close }
}

// ─── POST /api/director/start (동기 호출, 결과 일괄 반환) ────────────────────

export async function runDirectorSync(
  directive: string,
  options?: { sessionId?: string; projectName?: string; connectors?: string[] }
): Promise<{
  ok: boolean
  sessionId: string
  roundNumber: number
  round?: unknown
  critic?: CriticReview
  briefing?: CeoBriefing
}> {
  const res = await apiFetch("/api/director/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      directive,
      sessionId: options?.sessionId,
      projectName: options?.projectName ?? directive.slice(0, 40),
      connectors: options?.connectors ?? [],
    }),
  })
  return res.json()
}
