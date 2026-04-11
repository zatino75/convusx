// generateVideo.ts — 비디오 생성 에이전트 도구
// Runway Gen4 Turbo / Gemini Veo 3.1 통합
//
// 에이전트 루프에서 tool call로 직접 호출 가능. chat.ts 키워드 감지 분기와 병존.
// 향후 chat.ts 키워드 분기 제거 시 이 도구만 사용.
// 생성에 최대 2-3분 소요될 수 있음 (타임아웃 180초).

import { registerTool } from "../toolRegistry.js"
import { generateVideoRunway } from "../../adapters/runway.js"
import { generateVideoVeo } from "../../adapters/veo.js"
import { logger } from "../../observability/logger.js"

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
        description: "영상 길이(초). 기본값 5. 최대 10초 권장."
      },
      aspect_ratio: {
        type: "string",
        description: "종횡비. 예: '16:9' (기본, 가로), '9:16' (세로, 쇼츠), '1:1' (정방형)."
      }
    },
    required: ["prompt", "model"]
  },
  cost_tier: "paid",
  async invoke(input) {
    const prompt = String(input.prompt ?? "")
    const model = String(input.model ?? "runway")
    const duration = Math.min(Number(input.duration ?? 5), 10)
    const aspectRatio = String(input.aspect_ratio ?? "16:9")
    const t0 = Date.now()

    try {
      if (model === "veo") {
        const result = await generateVideoVeo({ prompt, duration, aspectRatio })
        const latency_ms = Date.now() - t0
        if (!result.ok) {
          logger.warn("generate_video[veo] failed", { error: result.error })
          return JSON.stringify({ ok: false, model, error: result.error ?? "Veo 비디오 생성 실패", latency_ms })
        }
        return JSON.stringify({ ok: true, model, video_url: result.video_url ?? null, message: "🎬 Gemini Veo 3.1로 비디오가 생성됐습니다.", latency_ms })
      }

      // runway (default)
      const result = await generateVideoRunway({ prompt, duration, ratio: aspectRatio, model: "gen4_turbo" })
      const latency_ms = Date.now() - t0
      if (!result.ok) {
        logger.warn("generate_video[runway] failed", { error: result.error })
        return JSON.stringify({ ok: false, model, error: result.error ?? "Runway 비디오 생성 실패", latency_ms })
      }
      return JSON.stringify({ ok: true, model, video_url: result.video_url ?? null, message: "🎬 Runway Gen4 Turbo로 비디오가 생성됐습니다.", latency_ms })

    } catch (e) {
      const latency_ms = Date.now() - t0
      logger.error("generate_video tool exception", { error: e, model })
      return JSON.stringify({ ok: false, model, error: e instanceof Error ? e.message : "알 수 없는 오류", latency_ms })
    }
  }
})
