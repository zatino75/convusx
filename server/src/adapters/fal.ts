/**
 * fal.ts — fal.ai Queue API 어댑터
 * Design 부서의 비주얼 에셋 생성 (이미지 / 영상 / 3D) 에 사용.
 * 키 미설정 시 throw — 호출부(design 부서)가 nano_banana 등 다음 체인으로 폴백.
 */

import { logger } from "../observability/logger.js"

const FAL_BASE = "https://queue.fal.run"
const DEFAULT_POLL_INTERVAL_MS = 3000

function requireKey(): string {
  const apiKey = String((globalThis as any)?.process?.env?.FAL_API_KEY ?? "").trim()
  if (!apiKey) throw new Error("FAL_API_KEY not set")
  return apiKey
}

export async function falGenerate(
  endpoint: string,
  input: Record<string, unknown>,
  timeoutMs = 300000,
): Promise<any> {
  const apiKey = requireKey()
  const submitRes = await fetch(`${FAL_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  })
  if (!submitRes.ok) {
    const body = await submitRes.text().catch(() => "")
    throw new Error(`fal.ai submit ${submitRes.status}: ${body.slice(0, 200)}`)
  }
  const { request_id } = (await submitRes.json()) as { request_id: string }
  if (!request_id) throw new Error("fal.ai submit: missing request_id")

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, DEFAULT_POLL_INTERVAL_MS))
    const statusRes = await fetch(`${FAL_BASE}/${endpoint}/requests/${request_id}/status`, {
      headers: { Authorization: `Key ${apiKey}` },
    })
    if (!statusRes.ok) continue
    const status = (await statusRes.json()) as { status: string }
    if (status.status === "COMPLETED") {
      const resultRes = await fetch(`${FAL_BASE}/${endpoint}/requests/${request_id}`, {
        headers: { Authorization: `Key ${apiKey}` },
      })
      return await resultRes.json()
    }
    if (status.status === "FAILED") {
      throw new Error(`fal.ai generation failed (request_id=${request_id})`)
    }
  }
  logger.warn({ endpoint, request_id }, "[fal.ai] 타임아웃")
  throw new Error("fal.ai timeout")
}

export async function falImage(prompt: string, opts: { width?: number; height?: number } = {}) {
  return falGenerate(
    "fal-ai/flux/dev",
    {
      prompt,
      image_size: { width: opts.width ?? 1024, height: opts.height ?? 1024 },
      num_images: 1,
    },
    60000,
  )
}

export async function falVideo(prompt: string, opts: { duration?: number; aspectRatio?: string } = {}) {
  return falGenerate(
    "fal-ai/kling-video/v2",
    {
      prompt,
      duration: opts.duration ?? 5,
      aspect_ratio: opts.aspectRatio ?? "16:9",
    },
    300000,
  )
}

export async function fal3D(imageUrl: string) {
  return falGenerate(
    "fal-ai/triposr",
    {
      image_url: imageUrl,
      output_format: "glb",
    },
    120000,
  )
}
