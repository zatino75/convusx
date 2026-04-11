// generateVideo.ts — 비디오 생성 에이전트 도구
// Runway Gen4 Turbo / Gemini Veo 3.1 통합

import { registerTool, type ToolResult } from "../toolRegistry.js"
import { generateVideoRunway } from "../../adapters/runway.js"
import { generateVideoVeo } from "../../adapters/veo.js"
import { logger } from "../../observability/logger.js"

type RunwayRatio = "16:9" | "9:16" | "1:1"
type VeoRatio    = "16:9" | "9:16" | "1:1"
const RUNWAY_RATIOS: RunwayRatio[] = ["16:9", "9:16", "1:1"]
const VEO_RATIOS:    VeoRatio[]    = ["16:9", "9:16", "1:1"]

function toRunwayRatio(s: string): RunwayRatio {
  return (RUNWAY_RATIOS.includes(s as RunwayRatio) ? s : "16:9") as RunwayRatio
}
function toVeoRatio(s: string): VeoRatio {
  return (VEO_RATIOS.includes(s as VeoRatio) ? s : "16:9") as VeoRatio
}
// Runway: 5 | 10, Veo: 5 | 8
function toRunwayDuration(n: number): 5 | 10 { return n <= 5 ? 5 : 10 }
function toVeoDuration(n: number): 5 | 8    { return n <= 5 ? 5 : 8 }

registerTool({
  name: "generate_video",
  description: `비디오(동영상)를 생성합니다. model 파라미터로 제공자를 선택합니다.
- runway: Runway Gen4 Turbo. 고품질 영상, 모션 일관성 우수.
- veo: Gemini Veo 3.1. Google 최신 영상 생성, 물리 법칙 이해 우수.
사용자가 특정 모델을 명시하지 않으면 runway 기본 사용.
생성에 최대 2~3분 소요됩니다. 사용자에게 미리 알려주세요.
프롬프트는 영문으로 입력하면 품질이 향상됩니다.`,
  input_schema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "비디오 생성 프롬프트. 영문 권장. 예: 'a serene forest waterfall, slow motion, cinematic'"
      },
      model: {
        type: "string",
        enum: ["runway", "veo"],
        description: "비디오 생성 모델. runway=Runway Gen4 Turbo, veo=Gemini Veo 3.1"
      },
      duration: {
        type: "number",
        description: "영상 길이(초). runway: 5 또는 10, veo: 5 또는 8. 기본값 5."
      },
      aspect_ratio: {
        type: "string",
        description: "종횡비. '16:9' (기본, 가로), '9:16' (세로, 쇼츠), '1:1' (정방형)."
      }
    },
    required: ["prompt", "model"]
  },
  cost_tier: "paid",
  async handler(input: any, _ctx: any): Promise<ToolResult> {
    const prompt = String(input.prompt ?? "")
    const model = String(input.model ?? "runway")
    const rawDuration = Number(input.duration ?? 5)
    const rawRatio = String(input.aspect_ratio ?? "16:9")
    const t0 = Date.now()

    try {
      if (model === "veo") {
        const duration = toVeoDuration(rawDuration)
        const aspectRatio = toVeoRatio(rawRatio)
        const result = await generateVideoVeo({ prompt, duration, aspectRatio })
        const latency_ms = Date.now() - t0
        if (!result.ok) {
          logger.warn("generate_video[veo] failed", { error: result.error })
          return { ok: false, output_text: JSON.stringify({ ok: false, model, error: result.error ?? "Veo 비디오 생성 실패", latency_ms }) }
        }
        return { ok: true, output_text: JSON.stringify({ ok: true, model, video_url: result.video_url ?? null, message: "🎬 Gemini Veo 3.1로 비디오가 생성됐습니다.", latency_ms }) }
      }

      // runway (default)
      const duration = toRunwayDuration(rawDuration)
      const ratio = toRunwayRatio(rawRatio)
      const result = await generateVideoRunway({ prompt, duration, ratio, model: "gen4_turbo" })
      const latency_ms = Date.now() - t0
      if (!result.ok) {
        logger.warn("generate_video[runway] failed", { error: result.error })
        return { ok: false, output_text: JSON.stringify({ ok: false, model, error: result.error ?? "Runway 비디오 생성 실패", latency_ms }) }
      }
      return { ok: true, output_text: JSON.stringify({ ok: true, model, video_url: result.video_url ?? null, message: "🎬 Runway Gen4 Turbo로 비디오가 생성됐습니다.", latency_ms }) }

    } catch (e) {
      const latency_ms = Date.now() - t0
      logger.error("generate_video tool exception", { error: e, model })
      return { ok: false, output_text: JSON.stringify({ ok: false, model, error: e instanceof Error ? e.message : "알 수 없는 오류", latency_ms }) }
    }
  }
})
