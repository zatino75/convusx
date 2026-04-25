// chatMediaGen.ts — 이미지/비디오 생성 커맨드 감지 및 핸들러

import { generateImage } from "../adapters/openai.js"
import { generateImageImagen } from "../adapters/gemini.js"
import { generateImageMidjourney } from "../adapters/midjourney.js"
import { generateVideoRunway } from "../adapters/runway.js"
import { generateVideoVeo } from "../adapters/veo.js"
import { generateImage as generateImageNanoBanana } from "../adapters/nanoBanana.js"
import { logger } from "../observability/logger.js"
import { saveMedia } from "../media/mediaStore.js"

/**
 * 2026-04-25: 생성 결과를 mediaStore 에 fire-and-forget 저장 (갤러리용).
 * 실패해도 채팅 응답엔 영향 없음. URL/dataUri/base64 어떤 형태든 받음.
 */
function persistMedia(input: Parameters<typeof saveMedia>[0]): void {
  saveMedia(input).catch((err) => {
    logger.warn("[chatMediaGen] saveMedia 실패 (non-fatal)", { error: String(err?.message ?? err) })
  })
}

// ── OpenAI DALL-E ──
export const IMAGE_PATTERNS = ["이미지 만들어줘","이미지 그려줘","그림 그려줘","그림 만들어줘","이미지 생성해줘","사진 만들어줘","이미지로 만들어줘","그려줘","일러스트 만들어줘","generate image","create image","draw","make an image","make a picture"]

export const GEMINI_IMAGE_PATTERNS = ["gemini로 그려줘","gemini로 이미지","imagen으로","gemini 이미지","구글로 그려줘","imagen 그려줘"]

export function detectGeminiImageCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return GEMINI_IMAGE_PATTERNS.some((p) => lower.includes(p))
}

export function detectImageCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return IMAGE_PATTERNS.some((p) => lower.includes(p))
}

export async function handleImageCommand(rawMessage: string): Promise<{ ok: boolean; url?: string; revised_prompt?: string; message: string }> {
  const cleaned = rawMessage
    .replace(/이미지\s*(만들어줘|그려줘|생성해줘|으로\s*만들어줘)/g, "")
    .replace(/그림\s*(그려줘|만들어줘)/g, "")
    .replace(/사진\s*만들어줘/g, "")
    .replace(/일러스트\s*만들어줘/g, "")
    .replace(/(generate|create|make|draw)\s*(an?\s*)?(image|picture|photo|illustration)/gi, "")
    .trim()
  const prompt = cleaned || rawMessage
  try {
    const result = await generateImage({ prompt, size: "1024x1024", quality: "standard", style: "vivid" })
    if (!result.ok || !result.url) {
      logger.warn("DALL-E image generation failed", { error: result.error })
      return { ok: false, message: `이미지 생성 실패: ${result.error ?? "알 수 없는 오류"}` }
    }
    persistMedia({ url: result.url, prompt, model: "dall-e-3" })
    return { ok: true, url: result.url, revised_prompt: result.revised_prompt, message: `🎨 이미지가 생성됐습니다.` }
  } catch (e) {
    logger.error("DALL-E image generation exception", { error: e })
    return { ok: false, message: `이미지 생성 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}` }
  }
}

export async function handleGeminiImageCommand(rawMessage: string): Promise<{ ok: boolean; url?: string; message: string; provider: string }> {
  const cleaned = rawMessage
    .replace(/gemini(로|로\s*이미지)?/gi, "").replace(/imagen(으로|으로\s*이미지)?/gi, "")
    .replace(/구글로\s*(그려줘)?/gi, "").replace(/이미지\s*(만들어줘|그려줘|생성해줘)/g, "").replace(/그려줘/g, "").trim()
  const prompt = cleaned || rawMessage
  try {
    const result = await generateImageImagen({ prompt, aspectRatio: "1:1" })
    if (!result.ok || !result.url) {
      logger.warn("Gemini Imagen generation failed", { error: result.error })
      return { ok: false, message: `Gemini 이미지 생성 실패: ${result.error ?? "알 수 없는 오류"}`, provider: "gemini" }
    }
    // result.url 은 data:image/...;base64,... 형식 (gemini.ts::generateImageImagen)
    persistMedia({ dataUri: result.url, prompt, model: "imagen-4" })
    return { ok: true, url: result.url, message: "🎨 Gemini Imagen으로 이미지가 생성됐습니다.", provider: "gemini" }
  } catch (e) {
    logger.error("Gemini Imagen generation exception", { error: e })
    return { ok: false, message: `Gemini 이미지 생성 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`, provider: "gemini" }
  }
}

// ── Midjourney ──
export const MIDJOURNEY_PATTERNS = [
  "midjourney로", "midjourney 그려줘", "midjourney로 그려줘", "mj로", "mj 그려줘",
  "미드저니로", "미드저니 그려줘", "midjourney image", "midjourney로 이미지"
]

export function detectMidjourneyCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return MIDJOURNEY_PATTERNS.some((p) => lower.includes(p))
}

export async function handleMidjourneyCommand(rawMessage: string): Promise<{ ok: boolean; url?: string; image_urls?: string[]; message: string }> {
  const cleaned = rawMessage
    .replace(/midjourney(로|로\s*이미지|로\s*그려줘)?/gi, "")
    .replace(/미드저니(로|로\s*이미지|로\s*그려줘)?/gi, "")
    .replace(/mj(로|로\s*이미지|로\s*그려줘)?/gi, "")
    .replace(/이미지\s*(만들어줘|그려줘|생성해줘)/g, "").replace(/그려줘/g, "").trim()
  const prompt = cleaned || rawMessage
  try {
    const result = await generateImageMidjourney({ prompt, aspect: "1:1", version: "6.1" })
    if (!result.ok) {
      logger.warn("Midjourney generation failed", { error: result.error })
      return { ok: false, message: `Midjourney 생성 실패: ${result.error ?? "알 수 없는 오류"}` }
    }
    if (result.image_url) persistMedia({ url: result.image_url, prompt, model: "midjourney" })
    if (Array.isArray(result.image_urls)) {
      for (const u of result.image_urls) persistMedia({ url: u, prompt, model: "midjourney" })
    }
    return { ok: true, url: result.image_url, image_urls: result.image_urls, message: "🎨 Midjourney로 이미지가 생성됐습니다." }
  } catch (e) {
    logger.error("Midjourney generation exception", { error: e })
    return { ok: false, message: `Midjourney 생성 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}` }
  }
}

// ── Runway Gen4 Turbo ──
export const RUNWAY_PATTERNS = [
  "runway로", "runway 비디오", "runway로 만들어줘", "runway gen", "런웨이로",
  "런웨이 비디오", "runway video", "gen4로", "gen4 turbo"
]

export function detectRunwayCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return RUNWAY_PATTERNS.some((p) => lower.includes(p))
}

export async function handleRunwayCommand(rawMessage: string): Promise<{ ok: boolean; video_url?: string; message: string }> {
  const cleaned = rawMessage
    .replace(/runway(로|로\s*만들어줘|로\s*비디오)?/gi, "")
    .replace(/런웨이(로|로\s*만들어줘|로\s*비디오)?/gi, "")
    .replace(/gen4(\s*turbo)?(로|로\s*만들어줘)?/gi, "")
    .replace(/비디오\s*(만들어줘|생성해줘)/g, "").trim()
  const prompt = cleaned || rawMessage
  try {
    const result = await generateVideoRunway({ prompt, duration: 5, ratio: "16:9", model: "gen4_turbo" })
    if (!result.ok) {
      logger.warn("Runway video generation failed", { error: result.error })
      return { ok: false, message: `Runway 비디오 생성 실패: ${result.error ?? "알 수 없는 오류"}` }
    }
    if (result.video_url) persistMedia({ url: result.video_url, prompt, model: "runway-gen4-turbo" })
    return { ok: true, video_url: result.video_url, message: "🎬 Runway Gen4 Turbo로 비디오가 생성됐습니다." }
  } catch (e) {
    logger.error("Runway video generation exception", { error: e })
    return { ok: false, message: `Runway 비디오 생성 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}` }
  }
}

// ── Gemini Veo 3.1 ──
export const VEO_PATTERNS = [
  "veo로", "veo 비디오", "veo로 만들어줘", "veo 만들어줘", "gemini 비디오",
  "gemini로 비디오", "veo3", "veo 3", "비오로"
]

export function detectVeoCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return VEO_PATTERNS.some((p) => lower.includes(p))
}

export async function handleVeoCommand(rawMessage: string): Promise<{ ok: boolean; video_url?: string; message: string }> {
  const cleaned = rawMessage
    .replace(/veo(\s*3(\.\s*\d)?)?(로|로\s*만들어줘|로\s*비디오)?/gi, "")
    .replace(/gemini(로)?\s*비디오(로|로\s*만들어줘)?/gi, "")
    .replace(/비디오\s*(만들어줘|생성해줘)/g, "").trim()
  const prompt = cleaned || rawMessage
  try {
    const result = await generateVideoVeo({ prompt, duration: 5, aspectRatio: "16:9" })
    if (!result.ok) {
      logger.warn("Veo video generation failed", { error: result.error })
      return { ok: false, message: `Veo 비디오 생성 실패: ${result.error ?? "알 수 없는 오류"}` }
    }
    if (result.video_url) persistMedia({ url: result.video_url, prompt, model: "gemini-veo-3.1" })
    return { ok: true, video_url: result.video_url, message: "🎬 Gemini Veo 3.1로 비디오가 생성됐습니다." }
  } catch (e) {
    logger.error("Veo video generation exception", { error: e })
    return { ok: false, message: `Veo 비디오 생성 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}` }
  }
}

// ── Nano Banana 2 (Gemini Flash 네이티브 이미지 생성) ──
export const NANO_BANANA_PATTERNS = [
  "nano banana", "나노 바나나", "나노바나나", "flash로 그려줘", "flash 이미지",
  "gemini flash로 그려", "gemini flash 이미지", "flash로 이미지"
]

export function detectNanoBananaCommand(message: string): boolean {
  const lower = String(message ?? "").toLowerCase()
  return NANO_BANANA_PATTERNS.some((p) => lower.includes(p))
}

export async function handleNanoBananaCommand(rawMessage: string): Promise<{ ok: boolean; images?: Array<{ base64: string; mimeType: string }>; message: string }> {
  const cleaned = rawMessage
    .replace(/nano\s*banana\s*2?/gi, "")
    .replace(/나노\s*바나나\s*2?/gi, "")
    .replace(/gemini\s*flash(로)?\s*(이미지|그려줘)?/gi, "")
    .replace(/flash(로)?\s*(이미지|그려줘)?/gi, "")
    .replace(/이미지\s*(만들어줘|그려줘|생성해줘)/g, "").replace(/그려줘/g, "").trim()
  const prompt = cleaned || rawMessage
  try {
    const result = await generateImageNanoBanana({ prompt, aspectRatio: "1:1" })
    if (!result.ok || !result.images?.length) {
      logger.warn("Nano Banana generation failed", { error: result.error })
      return { ok: false, message: `Nano Banana 이미지 생성 실패: ${result.error ?? "알 수 없는 오류"}` }
    }
    for (const img of result.images) persistMedia({ base64: img.base64, mimeType: img.mimeType, prompt, model: "nano-banana" })
    return { ok: true, images: result.images, message: "🎨 Nano Banana 2 (Gemini Flash)로 이미지가 생성됐습니다." }
  } catch (e) {
    logger.error("Nano Banana generation exception", { error: e })
    return { ok: false, message: `Nano Banana 이미지 생성 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}` }
  }
}
