// Midjourney 이미지 생성 어댑터
// UseAPI.net 경유 (공식 Midjourney API 미제공 상태, useapi.net 가장 안정적인 래퍼)
// 환경변수: MIDJOURNEY_API_KEY (useapi.net token)
//           MIDJOURNEY_DISCORD_TOKEN (Discord user token)
//           MIDJOURNEY_CHANNEL_ID (Discord channel id)

function env(key: string): string {
  return String((globalThis as any)?.process?.env?.[key] ?? "").trim()
}

export type MidjourneyGenerateParams = {
  prompt: string
  aspect?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4"
  version?: "6.1" | "6" | "5.2"
  quality?: "1" | ".5" | ".25"
  stylize?: number   // 0-1000, 기본 100
}

export type MidjourneyResult = {
  ok: boolean
  image_url?: string
  image_urls?: string[]   // 4장 그리드 분할
  job_id?: string
  status?: "pending" | "done" | "failed"
  error?: string
}

const USEAPI_BASE = "https://api.useapi.net/v2/jobs"
const POLL_INTERVAL_MS = 6000
const POLL_MAX = 60 // 최대 6분

function buildPrompt(params: MidjourneyGenerateParams): string {
  const parts: string[] = [params.prompt]
  if (params.aspect) parts.push(`--ar ${params.aspect.replace(":", "x")}`)
  if (params.version) parts.push(`--v ${params.version}`)
  if (params.quality) parts.push(`--q ${params.quality}`)
  if (params.stylize != null) parts.push(`--s ${params.stylize}`)
  return parts.join(" ")
}

async function pollJob(jobId: string, apiKey: string): Promise<MidjourneyResult> {
  for (let i = 0; i < POLL_MAX; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))

    const res = await fetch(`${USEAPI_BASE}/${jobId}`, {
      headers: { "Authorization": `Bearer ${apiKey}` }
    }).catch(() => null)

    if (!res?.ok) continue

    const data = await res.json().catch(() => ({}))
    const status: string = data?.status ?? ""

    if (status === "completed" || status === "finished") {
      // 4장 분할 이미지
      const urls: string[] = data?.attachments?.map((a: any) => a?.url).filter(Boolean) ?? []
      const single: string = data?.imageURL ?? data?.image_url ?? urls[0] ?? null

      if (single || urls.length > 0) {
        return {
          ok: true,
          image_url: single,
          image_urls: urls.length > 0 ? urls : (single ? [single] : []),
          job_id: jobId,
          status: "done"
        }
      }
      return { ok: false, status: "failed", error: "no image in response" }
    }

    if (status === "failed" || status === "error") {
      return { ok: false, status: "failed", error: data?.error ?? "job failed" }
    }
  }

  return { ok: false, status: "failed", error: "polling timeout (3min)" }
}

export async function generateImageMidjourney(
  params: MidjourneyGenerateParams
): Promise<MidjourneyResult> {
  const apiKey = env("MIDJOURNEY_API_KEY")
  const discordToken = env("MIDJOURNEY_DISCORD_TOKEN")
  const channelId = env("MIDJOURNEY_CHANNEL_ID")

  if (!apiKey) return { ok: false, error: "missing MIDJOURNEY_API_KEY" }
  if (!discordToken) return { ok: false, error: "missing MIDJOURNEY_DISCORD_TOKEN" }
  if (!channelId) return { ok: false, error: "missing MIDJOURNEY_CHANNEL_ID" }

  const prompt = buildPrompt(params)

  const body = {
    discord: discordToken,
    channel: channelId,
    prompt
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30000)

    const res = await fetch(`${USEAPI_BASE}/imagine`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    clearTimeout(timer)

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      return { ok: false, error: data?.error ?? `HTTP ${res.status}` }
    }

    const jobId: string = data?.jobid ?? data?.job_id ?? data?.id ?? ""
    if (!jobId) {
      return { ok: false, error: "no job id returned" }
    }

    return await pollJob(jobId, apiKey)

  } catch (e: any) {
    return { ok: false, error: e?.message ?? "midjourney_error" }
  }
}
