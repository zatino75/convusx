// generateVideo.ts — 비디오 생성 에이전트 도구
// 여러 비디오 생성 어댑터를 통합 (provider 별 키 보유 여부에 따라 활성).
// CLAUDE.md #26: 시스템 프롬프트에 브랜드명 박제 금지 — capability 만 기술.

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

// 2026-04-29 (CLAUDE.md #26): description / enum 을 등록 시점 process.env 로 동적 생성.
function _buildVideoDesc(): { description: string; enum: string[] } {
  const has = (k: string) => typeof process.env[k] === "string" && process.env[k]!.trim().length > 0
  const lines = ["비디오(동영상)를 생성합니다. model 파라미터로 다음 중 하나를 선택합니다."]
  const enumValues: string[] = []
  if (has("RUNWAY_API_KEY")) { enumValues.push("runway"); lines.push(`- "runway": 고품질 영상, 모션 일관성 우수.`) }
  if (has("GEMINI_API_KEY")) { enumValues.push("veo");    lines.push(`- "veo": 물리 법칙 이해 우수, 자연 풍경에 강점.`) }
  if (enumValues.length === 0) {
    lines.push("(현재 활성화된 백엔드 없음 — 관리자 설정에서 API 키 등록 필요)")
  } else {
    lines.push(`사용자가 특정 백엔드를 명시하지 않으면 "${enumValues[0]}" 기본 사용.`)
  }
  lines.push("생성에 최대 2~3분 소요됩니다. 사용자에게 미리 알려주세요.")
  lines.push("프롬프트는 영문으로 입력하면 품질이 향상됩니다.")
  return { description: lines.join("\n"), enum: enumValues }
}
const _VIDEO_META = _buildVideoDesc()

registerTool({
  name: "generate_video",
  description: _VIDEO_META.description,
  input_schema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "비디오 생성 프롬프트. 영문 권장. 예: 'a serene forest waterfall, slow motion, cinematic'"
      },
      model: {
        type: "string",
        enum: _VIDEO_META.enum.length > 0 ? _VIDEO_META.enum : ["runway"],
        description: "비디오 생성 백엔드 선택. 활성화된 백엔드만 enum 에 포함됨."
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
        return { ok: true, output_text: JSON.stringify({ ok: true, model, video_url: result.video_url ?? null, message: "🎬 비디오가 생성됐습니다.", latency_ms }) }
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
      return { ok: true, output_text: JSON.stringify({ ok: true, model, video_url: result.video_url ?? null, message: "🎬 비디오가 생성됐습니다.", latency_ms }) }

    } catch (e) {
      const latency_ms = Date.now() - t0
      logger.error("generate_video tool exception", { error: e, model })
      return { ok: false, output_text: JSON.stringify({ ok: false, model, error: e instanceof Error ? e.message : "알 수 없는 오류", latency_ms }) }
    }
  }
})
