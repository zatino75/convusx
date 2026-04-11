// toolRegistry.ts — CORVUS X Agent Tool Registry (Phase 2 최소 세트)
//
// 모든 에이전트 도구는 여기에 register() 로 등록된다.
// agentLoop 는 이 레지스트리에서 tools 를 가져와 Claude native tool use 로 전달한다.

import { logger } from "../observability/logger.js"

// ── 타입 정의 ──────────────────────────────────────────────────────────────
export type ToolInputSchema = {
  type: "object"
  properties: Record<string, any>
  required?: string[]
  additionalProperties?: boolean
}

export type ToolContext = {
  thread_id: string
  project_id: string
  user_id?: string | null
  /** chat.ts 에서 정규화된 normalizedInput 전체 */
  normalizedInput: any
  /** 요청 시작 시각 (ms) */
  startedAt: number
  /** 누적 tool_call 기록 — agentLoop 가 push */
  toolCallLog: ToolCallRecord[]
}

export type ToolCallRecord = {
  tool_name: string
  input: any
  output_summary: string
  /** 전체 output_text (tool 결과 JSON) — UI 에서 parallel_ensemble / adversarial_critique 렌더링용 */
  output_text?: string
  ok: boolean
  latency_ms: number
  called_at: number
  error?: string
}

export type ToolHandler = (input: any, ctx: ToolContext) => Promise<ToolResult>

export type ToolResult = {
  ok: boolean
  /** 모델에게 돌려줄 직렬화된 텍스트 (JSON 또는 요약문) */
  output_text: string
  /** 내부 관찰용 요약 (토큰 절약, 로그용) */
  summary?: string
  error?: string
}

export type ToolDefinition = {
  name: string
  description: string
  input_schema: ToolInputSchema
  handler: ToolHandler
  /** 비용·위험 등급 — 고가치 경로에서만 활성화하고 싶은 도구 태깅용 */
  cost_tier?: "free" | "cheap" | "paid" | "expensive"
}

// ── 레지스트리 ────────────────────────────────────────────────────────────
const registry = new Map<string, ToolDefinition>()

export function registerTool(def: ToolDefinition) {
  if (!def?.name || typeof def.handler !== "function") {
    throw new Error(`registerTool: invalid definition for ${def?.name}`)
  }
  if (registry.has(def.name)) {
    logger.warn("[toolRegistry] duplicate tool overwrite", { tool: def.name })
  }
  registry.set(def.name, def)
}

export function getTool(name: string): ToolDefinition | null {
  return registry.get(name) ?? null
}

export function listTools(): ToolDefinition[] {
  return [...registry.values()]
}

export function listToolNames(): string[] {
  return [...registry.keys()]
}

/** Claude native tool use 형식으로 직렬화 */
export function toAnthropicTools(defs: ToolDefinition[] = listTools()) {
  return defs.map((d) => ({
    name: d.name,
    description: d.description,
    input_schema: d.input_schema,
  }))
}

/** 도구 실행 — agentLoop 단일 진입점이 호출 */
export async function invokeTool(name: string, input: any, ctx: ToolContext): Promise<ToolResult> {
  const def = getTool(name)
  const startedAt = Date.now()
  if (!def) {
    const err = `unknown_tool:${name}`
    ctx.toolCallLog.push({
      tool_name: name,
      input,
      output_summary: err,
      ok: false,
      latency_ms: 0,
      called_at: startedAt,
      error: err,
    })
    return { ok: false, output_text: JSON.stringify({ error: err }), error: err }
  }

  try {
    const result = await def.handler(input ?? {}, ctx)
    const latency = Date.now() - startedAt
    ctx.toolCallLog.push({
      tool_name: name,
      input,
      output_summary: String(result.summary ?? result.output_text ?? "").slice(0, 240),
      output_text: typeof result.output_text === "string" ? result.output_text : undefined,
      ok: result.ok !== false,
      latency_ms: latency,
      called_at: startedAt,
      error: result.error,
    })
    return result
  } catch (error: any) {
    const latency = Date.now() - startedAt
    const msg = String(error?.message ?? error ?? "tool_exception")
    logger.warn("[toolRegistry] tool handler threw", { tool: name, error: msg })
    ctx.toolCallLog.push({
      tool_name: name,
      input,
      output_summary: `exception:${msg}`,
      ok: false,
      latency_ms: latency,
      called_at: startedAt,
      error: msg,
    })
    return { ok: false, output_text: JSON.stringify({ error: msg }), error: msg }
  }
}

// ── 자동 등록 ─────────────────────────────────────────────────────────────
// NOTE (2026-04-11): 개별 tool import 는 ESM 순환 import 로 인한 TDZ 를 유발하므로
// 이 파일에서 직접 import 하지 않고 ./toolBootstrap.ts 로 분리한다.
// entry (src/index.ts) 가 toolBootstrap 을 한 번 import 하면 모든 tool 이 등록된다.
