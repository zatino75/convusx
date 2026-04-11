// generateImage.ts — 이미지 생성 에이전트 도구
// DALL-E 3 / Midjourney v7 / Google Imagen 4 / Gemini Flash (Nano Banana 2) 통합

import { registerTool, type ToolResult } from "../toolRegistry.js"
import { generateImage as generateImageDallE } from "../../adapters/openai.js"
import { generateImageImagen } from "../../adapters/gemini.js"
import { generateImageMidjourney } from "../../adapters/midjourney.js"
import { generateImage as generateImageFlash } from "../../adapters/nanoBanana.js"
import { logger } from "../../observability/logger.js"

type ImgRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4"
const IMG_RATIOS: ImgRatio[] = ["1:1", "16:9", "9:16", "4:3", "3:4"]
function toImgRatio(s: string, fallback: ImgRatio = "1:1"): ImgRatio {
  return (IMG_RATIOS.includes(s as ImgRatio) ? s : fallback) as ImgRatio
}

registerTool({
  name: "generate_image",
  description: `이미지를 생성합니다. model 파라미터로 제공자를 선택합니다.
- dall-e: OpenAI DALL-E 3. 사실적·예술적 이미지, 빠름.
- midjourney: Midjourney v7. 고품질 아트, 사진 품질, 최고 미적 완성도.
- imagen: Google Imagen 4. 사진 리얼리즘 최상급, 텍스트 렌더링 우수.
- flash: Gemini Flash 네이티브. 빠른 속도, 대화형 이미지 편집에 적합.
사용자가 특정 모델을 명시하지 않으면 dall-e 기본 사용.
고품질 아트웍 요청 시 midjourney, 사진 품질 요청 시 imagen 권장.
프롬프트는 영문으로 입력하면 품질이 향상됩니다.`,
  input_schema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "이미지 생성 프롬프트. 영문 권장. 예: 'a serene mountain lake at sunset, photorealistic'"
      },
      model: {
        type: "string",
        enum: ["dall-e", "midjourney", "imagen", "flash"],
        description: "이미지 생성 모델. dall-e=OpenAI DALL-E 3, midjourney=Midjourney v7, imagen=Google Imagen 4, flash=Gemini Flash"
      },
      aspect_ratio: {
        type: "string",
        description: "종횡비. 예: '1:1' (기본), '16:9', '9:16', '4:3', '3:4'."
      },
      quality: {
        type: "string",
        enum: ["standard", "hd"],
        description: "품질. dall-e 전용. standard(기본) 또는 hd."
      }
    },
    required: ["prompt", "model"]
  },
  cost_tier: "paid",
  async handler(input: any, _ctx: any): Promise<ToolResult> {
    const prompt = String(input.prompt ?? "")
    const model = String(input.model ?? "dall-e")
    const aspect = toImgRatio(String(input.aspect_ratio ?? "1:1"))
    const quality = (input.quality as "standard" | "hd" | undefined) ?? "standard"
    const t0 = Date.now()

    try {
      if (model === "midjourney") {
        const result = await generateImageMidjourney({ prompt, aspect, version: "6.1" })
        const latency_ms = Date.now() - t0
        if (!result.ok) {
          logger.warn("generate_image[midjourney] failed", { error: result.error })
          return { ok: false, output_text: JSON.stringify({ ok: false, model, error: result.error ?? "Midjourney 생성 실패", latency_ms }) }
        }
        return { ok: true, output_text: JSON.stringify({ ok: true, model, image_url: result.image_url ?? null, image_urls: result.image_urls ?? null, message: "🎨 Midjourney v7로 이미지가 생성됐습니다.", latency_ms }) }
      }

      if (model === "imagen") {
        const result = await generateImageImagen({ prompt, aspectRatio: aspect })
        const latency_ms = Date.now() - t0
        if (!result.ok || !result.url) {
          logger.warn("generate_image[imagen] failed", { error: result.error })
          return { ok: false, output_text: JSON.stringify({ ok: false, model, error: result.error ?? "Imagen 생성 실패", latency_ms }) }
        }
        return { ok: true, output_text: JSON.stringify({ ok: true, model, image_url: result.url, message: "🎨 Google Imagen 4로 이미지가 생성됐습니다.", latency_ms }) }
      }

      if (model === "flash") {
        const result = await generateImageFlash({ prompt, aspectRatio: aspect })
        const latency_ms = Date.now() - t0
        if (!(result as any).ok || !(result as any).images?.length) {
          logger.warn("generate_image[flash] failed", { error: (result as any).error })
          return { ok: false, output_text: JSON.stringify({ ok: false, model, error: (result as any).error ?? "Flash 생성 실패", latency_ms }) }
        }
        const first = (result as any).images[0]
        const image_url = `data:${first.mimeType};base64,${first.base64}`
        return { ok: true, output_text: JSON.stringify({ ok: true, model, image_url, message: "🎨 Gemini Flash (Nano Banana 2)로 이미지가 생성됐습니다.", latency_ms }) }
      }

      // dall-e (default)
      const result = await generateImageDallE({ prompt, size: "1024x1024", quality, style: "vivid" })
      const latency_ms = Date.now() - t0
      if (!result.ok || !result.url) {
        logger.warn("generate_image[dall-e] failed", { error: result.error })
        return { ok: false, output_text: JSON.stringify({ ok: false, model, error: result.error ?? "DALL-E 생성 실패", latency_ms }) }
      }
      return { ok: true, output_text: JSON.stringify({ ok: true, model, image_url: result.url, revised_prompt: result.revised_prompt ?? null, message: "🎨 DALL-E 3로 이미지가 생성됐습니다.", latency_ms }) }

    } catch (e) {
      const latency_ms = Date.now() - t0
      logger.error("generate_image tool exception", { error: e, model })
      return { ok: false, output_text: JSON.stringify({ ok: false, model, error: e instanceof Error ? e.message : "알 수 없는 오류", latency_ms }) }
    }
  }
})
