// Nano Banana 2 — 경량 이미지 생성 어댑터
// Google Gemini 2.0 Flash 기반 네이티브 이미지 생성
// 텍스트→이미지, 텍스트+이미지→이미지 (편집) 지원

function env(key: string): string {
  return String((globalThis as any)?.process?.env?.[key] ?? "").trim()
}

export type NanoBananaParams = {
  prompt: string
  /** 참조 이미지 (base64 data URI 또는 URL). 있으면 이미지 편집 모드 */
  referenceImage?: string
  /** 생성 매수 (1-4, 기본 1) */
  numberOfImages?: number
  /** 출력 이미지 크기 */
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4"
  /** 원본 이미지 보존 정도 (편집 시). 0.0=자유변형, 1.0=원본유지 */
  guidanceScale?: number
}

export type NanoBananaResult = {
  ok: boolean
  images?: Array<{
    base64: string
    mimeType: string
  }>
  error?: string
}

import { GEMINI_BASE } from "../config/defaults.js"

/**
 * Gemini 2.0 Flash (Nano Banana 2) 네이티브 이미지 생성
 * - responseModalities에 "image"를 포함하면 이미지 생성 모드로 동작
 * - 텍스트+이미지 동시 생성 가능
 */
export async function generateImageNanoBanana(
  params: NanoBananaParams
): Promise<NanoBananaResult> {
  const apiKey = env("GEMINI_API_KEY")
  if (!apiKey) return { ok: false, error: "missing GEMINI_API_KEY" }

  const model = env("NANO_BANANA_MODEL") || "gemini-2.0-flash-exp"

  // parts 배열 구성
  const parts: Array<Record<string, any>> = []

  // 참조 이미지가 있으면 먼저 추가 (이미지 편집 모드)
  if (params.referenceImage) {
    const imageData = extractBase64(params.referenceImage)
    if (imageData) {
      parts.push({
        inlineData: {
          mimeType: imageData.mimeType,
          data: imageData.base64,
        },
      })
    }
  }

  // 프롬프트 구성
  let textPrompt = params.prompt
  if (params.aspectRatio && params.aspectRatio !== "1:1") {
    textPrompt += `\n[aspect ratio: ${params.aspectRatio}]`
  }
  parts.push({ text: textPrompt })

  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ["text", "image"],
      maxOutputTokens: 4096,
      temperature: 1.0,
      candidateCount: Math.min(params.numberOfImages ?? 1, 4),
    },
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60000) // 이미지 생성은 시간 넉넉히

    const res = await fetch(
      `${GEMINI_BASE}/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    )
    clearTimeout(timer)

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      return {
        ok: false,
        error: data?.error?.message ?? `HTTP ${res.status}`,
      }
    }

    // 응답에서 이미지 추출
    const images = extractImagesFromResponse(data)
    if (images.length === 0) {
      return { ok: false, error: "no images in response" }
    }

    return { ok: true, images }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "nano_banana_error" }
  }
}

/**
 * Imagen 3 전용 엔드포인트 (고품질 이미지 생성)
 * Gemini API를 통한 Imagen 3 접근
 */
export async function generateImageImagen(
  params: NanoBananaParams
): Promise<NanoBananaResult> {
  const apiKey = env("GEMINI_API_KEY")
  if (!apiKey) return { ok: false, error: "missing GEMINI_API_KEY" }

  const model = env("IMAGEN_MODEL") || "imagen-3.0-generate-002"

  const body = {
    instances: [{ prompt: params.prompt }],
    parameters: {
      sampleCount: Math.min(params.numberOfImages ?? 1, 4),
      aspectRatio: params.aspectRatio ?? "1:1",
    },
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60000)

    const res = await fetch(
      `${GEMINI_BASE}/models/${model}:predict?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    )
    clearTimeout(timer)

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      return {
        ok: false,
        error: data?.error?.message ?? `HTTP ${res.status}`,
      }
    }

    // Imagen 응답에서 이미지 추출
    const predictions = Array.isArray(data?.predictions) ? data.predictions : []
    const images = predictions
      .filter((p: any) => p?.bytesBase64Encoded)
      .map((p: any) => ({
        base64: String(p.bytesBase64Encoded),
        mimeType: String(p?.mimeType ?? "image/png"),
      }))

    if (images.length === 0) {
      return { ok: false, error: "no images in imagen response" }
    }

    return { ok: true, images }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "imagen_error" }
  }
}

/**
 * 통합 이미지 생성 — Nano Banana(Flash) 우선, 실패 시 Imagen 폴백
 */
export async function generateImage(
  params: NanoBananaParams
): Promise<NanoBananaResult> {
  // 참조 이미지가 있으면 편집 모드 → Nano Banana만 지원
  if (params.referenceImage) {
    return generateImageNanoBanana(params)
  }

  // 먼저 Nano Banana (빠르고 저비용)
  const nanoResult = await generateImageNanoBanana(params)
  if (nanoResult.ok) return nanoResult

  // 폴백: Imagen 3 (고품질)
  const imagenResult = await generateImageImagen(params)
  return imagenResult
}

// ── 유틸리티 ──

function extractBase64(input: string): { base64: string; mimeType: string } | null {
  // data:image/png;base64,xxxx 형태
  const match = input.match(/^data:(image\/\w+);base64,(.+)$/)
  if (match) {
    return { mimeType: match[1], base64: match[2] }
  }
  // 이미 순수 base64인 경우
  if (/^[A-Za-z0-9+/=]{100,}$/.test(input)) {
    return { mimeType: "image/png", base64: input }
  }
  return null
}

function extractImagesFromResponse(
  data: any
): Array<{ base64: string; mimeType: string }> {
  const images: Array<{ base64: string; mimeType: string }> = []

  const candidates = Array.isArray(data?.candidates) ? data.candidates : []
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts)
      ? candidate.content.parts
      : []
    for (const part of parts) {
      if (part?.inlineData?.data) {
        images.push({
          base64: String(part.inlineData.data),
          mimeType: String(part.inlineData.mimeType ?? "image/png"),
        })
      }
    }
  }

  return images
}
