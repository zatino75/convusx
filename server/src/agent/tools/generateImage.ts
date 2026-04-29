// generateImage.ts — 이미지 생성 에이전트 도구
// 여러 이미지 생성 어댑터를 통합 (provider 별 키 보유 여부에 따라 활성).
// CLAUDE.md #26: 시스템 프롬프트에 브랜드명 박제 금지 — capability 만 기술.

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

// 2026-04-29 (CLAUDE.md #26): description / enum 을 등록 시점 process.env 로 동적 생성.
//   키 미설정 백엔드는 description 줄과 enum 값에서 모두 제외 → 모델이 "이 옵션 가능"
//   이라고 거짓 자기소개하지 않음. .env 핫리로드 시 (configReloader) 재시작 권장.
function _buildImageDesc(): { description: string; enum: string[] } {
  const has = (k: string) => typeof process.env[k] === "string" && process.env[k]!.trim().length > 0
  const lines = ["이미지를 생성합니다. model 파라미터로 다음 중 하나를 선택합니다."]
  const enumValues: string[] = []
  if (has("OPENAI_API_KEY"))     { enumValues.push("dall-e");      lines.push(`- "dall-e": 사실적·예술적 이미지, 빠른 응답.`) }
  if (has("MIDJOURNEY_API_KEY")) { enumValues.push("midjourney");  lines.push(`- "midjourney": 고품질 아트, 사진 품질, 최고 미적 완성도.`) }
  if (has("GEMINI_API_KEY"))     { enumValues.push("imagen", "flash");
    lines.push(`- "imagen": 사진 리얼리즘 최상급, 텍스트 렌더링 우수.`)
    lines.push(`- "flash": 빠른 속도, 대화형 편집에 적합.`)
  }
  if (enumValues.length === 0) {
    lines.push("(현재 활성화된 백엔드 없음 — 관리자 설정에서 API 키 등록 필요)")
  } else {
    lines.push(`사용자가 특정 백엔드를 명시하지 않으면 "${enumValues[0]}" 기본 사용.`)
  }
  lines.push("프롬프트는 영문으로 입력하면 품질이 향상됩니다.")
  return { description: lines.join("\n"), enum: enumValues }
}
const _IMAGE_META = _buildImageDesc()

registerTool({
  name: "generate_image",
  description: _IMAGE_META.description,
  input_schema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "이미지 생성 프롬프트. 영문 권장. 예: 'a serene mountain lake at sunset, photorealistic'"
      },
      model: {
        type: "string",
        enum: _IMAGE_META.enum.length > 0 ? _IMAGE_META.enum : ["dall-e"],
        description: "이미지 생성 백엔드 선택. 활성화된 백엔드만 enum 에 포함됨."
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
        return { ok: true, output_text: JSON.stringify({ ok: true, model, image_url: result.image_url ?? null, image_urls: result.image_urls ?? null, message: "🎨 이미지가 생성됐습니다.", latency_ms }) }
      }

      if (model === "imagen") {
        const result = await generateImageImagen({ prompt, aspectRatio: aspect })
        const latency_ms = Date.now() - t0
        if (!result.ok || !result.url) {
          logger.warn("generate_image[imagen] failed", { error: result.error })
          return { ok: false, output_text: JSON.stringify({ ok: false, model, error: result.error ?? "Imagen 생성 실패", latency_ms }) }
        }
        return { ok: true, output_text: JSON.stringify({ ok: true, model, image_url: result.url, message: "🎨 이미지가 생성됐습니다.", latency_ms }) }
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
        return { ok: true, output_text: JSON.stringify({ ok: true, model, image_url, message: "🎨 이미지가 생성됐습니다.", latency_ms }) }
      }

      // dall-e (default)
      const result = await generateImageDallE({ prompt, size: "1024x1024", quality, style: "vivid" })
      const latency_ms = Date.now() - t0
      if (!result.ok || !result.url) {
        logger.warn("generate_image[dall-e] failed", { error: result.error })
        return { ok: false, output_text: JSON.stringify({ ok: false, model, error: result.error ?? "DALL-E 생성 실패", latency_ms }) }
      }
      return { ok: true, output_text: JSON.stringify({ ok: true, model, image_url: result.url, revised_prompt: result.revised_prompt ?? null, message: "🎨 이미지가 생성됐습니다.", latency_ms }) }

    } catch (e) {
      const latency_ms = Date.now() - t0
      logger.error("generate_image tool exception", { error: e, model })
      return { ok: false, output_text: JSON.stringify({ ok: false, model, error: e instanceof Error ? e.message : "알 수 없는 오류", latency_ms }) }
    }
  }
})
