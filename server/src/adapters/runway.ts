// Runway Gen4 Turbo — 비디오 생성 어댑터
// API: https://api.runwayml.com/v1
// Docs: https://docs.runwayml.com

function env(key: string): string {
  return String((globalThis as any)?.process?.env?.[key] ?? "").trim()
}

export type RunwayGenerateParams = {
  prompt: string
  duration?: 5 | 10         // 초, 기본 5
  ratio?: "16:9" | "9:16" | "1:1"
  model?: "gen4_turbo" | "gen3a_turbo"
}

export type RunwayResult = {
  ok: boolean
  video_url?: string
  task_id?: string
  status?: "pending" | "done" | "failed"
  error?: string
}

const RUNWAY_BASE = "https://api.runwayml.com/v1"
const POLL_INTERVAL_MS = 5000
const POLL_MAX = 72 // 최대 6분

async function pollRunwayTask(taskId: string, apiKey: string): Promise<RunwayResult> {
  for (let i = 0; i < POLL_MAX; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))

    const res = await fetch(`${RUNWAY_BASE}/tasks/${taskId}`, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "X-Runway-Version": "2024-11-06"
      }
    }).catch(() => null)

    if (!res?.ok) continue

    const data = await res.json().catch(() => ({}))
    const status: string = data?.status ?? ""

    if (status === "SUCCEEDED") {
      const url = data?.output?.[0] ?? null
      if (url) return { ok: true, video_url: url, task_id: taskId, status: "done" }
      return { ok: false, status: "failed", error: "no output url" }
    }

    if (status === "FAILED") {
      return { ok: false, status: "failed", error: data?.failure ?? "task failed" }
    }

    // PENDING / RUNNING — 계속 폴링
  }

  return { ok: false, status: "failed", error: "polling timeout (3min)" }
}

export async function generateVideoRunway(params: RunwayGenerateParams): Promise<RunwayResult> {
  const apiKey = env("RUNWAY_API_KEY")
  if (!apiKey) return { ok: false, error: "missing RUNWAY_API_KEY" }

  const model = params.model ?? "gen4_turbo"

  const body = {
    model,
    promptText: params.prompt,
    duration: params.duration ?? 5,
    ratio: params.ratio ?? "16:9",
    watermark: false
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30000)

    const res = await fetch(`${RUNWAY_BASE}/image_to_video`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "X-Runway-Version": "2024-11-06"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    clearTimeout(timer)

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      return { ok: false, error: data?.error ?? `HTTP ${res.status}` }
    }

    const taskId: string = data?.id ?? data?.task_id ?? ""
    if (!taskId) {
      return { ok: false, error: "no task id returned" }
    }

    return await pollRunwayTask(taskId, apiKey)

  } catch (e: any) {
    return { ok: false, error: e?.message ?? "runway_error" }
  }
}
