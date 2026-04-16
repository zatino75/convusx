import { describe, it, expect, beforeEach } from "vitest"
import {
  registerTool,
  getTool,
  listTools,
  listToolNames,
  invokeTool,
  toAnthropicTools,
  type ToolContext,
  type ToolDefinition,
} from "../src/agent/toolRegistry"

function makeCtx(): ToolContext {
  return {
    thread_id: "t_test",
    project_id: "p_test",
    normalizedInput: {},
    startedAt: Date.now(),
    toolCallLog: [],
  }
}

const baseTool = (overrides: Partial<ToolDefinition> = {}): ToolDefinition => ({
  name: "test_echo",
  description: "echoes input back as output_text",
  input_schema: { type: "object", properties: {} },
  async handler(input: any) {
    return {
      ok: true,
      output_text: JSON.stringify({ echoed: input }),
      summary: "echo_ok",
    }
  },
  ...overrides,
})

describe("toolRegistry", () => {
  beforeEach(() => {
    // registry 는 module-level singleton 이라 테스트마다 동일 이름을 overwrite 한다.
  })

  describe("registerTool + getTool", () => {
    it("registers a tool and retrieves it by name", () => {
      registerTool(baseTool({ name: "reg_get_test" }))
      const def = getTool("reg_get_test")
      expect(def).not.toBeNull()
      expect(def?.name).toBe("reg_get_test")
      expect(def?.description).toContain("echoes")
    })

    it("getTool returns null for unknown name", () => {
      expect(getTool("nonexistent_xyz_tool")).toBeNull()
    })

    it("throws on invalid definition (missing name)", () => {
      expect(() => registerTool({ ...baseTool(), name: "" })).toThrow()
    })

    it("throws when handler is not a function", () => {
      expect(() =>
        registerTool({ ...baseTool(), handler: null as any })
      ).toThrow()
    })

    it("overwriting by same name replaces the earlier registration", () => {
      registerTool(baseTool({ name: "overwrite_test", description: "first" }))
      registerTool(baseTool({ name: "overwrite_test", description: "second" }))
      expect(getTool("overwrite_test")?.description).toBe("second")
    })
  })

  describe("listTools / listToolNames", () => {
    it("includes a freshly registered tool", () => {
      registerTool(baseTool({ name: "list_probe" }))
      expect(listToolNames()).toContain("list_probe")
      expect(listTools().some((d) => d.name === "list_probe")).toBe(true)
    })
  })

  describe("toAnthropicTools", () => {
    it("maps to {name, description, input_schema}", () => {
      const serialized = toAnthropicTools([
        baseTool({ name: "anthro_map_probe" }),
      ])
      expect(serialized).toEqual([
        {
          name: "anthro_map_probe",
          description: expect.any(String),
          input_schema: { type: "object", properties: {} },
        },
      ])
    })
  })

  describe("invokeTool", () => {
    it("calls the handler and records tool_call_log", async () => {
      registerTool(baseTool({ name: "invoke_happy" }))
      const ctx = makeCtx()
      const result = await invokeTool("invoke_happy", { foo: "bar" }, ctx)
      expect(result.ok).toBe(true)
      expect(result.output_text).toContain("bar")
      expect(ctx.toolCallLog.length).toBe(1)
      const record = ctx.toolCallLog[0]
      expect(record.tool_name).toBe("invoke_happy")
      expect(record.ok).toBe(true)
      expect(record.latency_ms).toBeGreaterThanOrEqual(0)
    })

    it("returns unknown_tool error and logs failure for missing tool", async () => {
      const ctx = makeCtx()
      const result = await invokeTool("totally_missing_tool", {}, ctx)
      expect(result.ok).toBe(false)
      expect(result.error).toContain("unknown_tool")
      expect(ctx.toolCallLog[0]?.ok).toBe(false)
      expect(ctx.toolCallLog[0]?.error).toContain("unknown_tool")
    })

    it("catches handler exceptions and reports as ok:false", async () => {
      registerTool(
        baseTool({
          name: "invoke_throws",
          async handler() {
            throw new Error("boom")
          },
        })
      )
      const ctx = makeCtx()
      const result = await invokeTool("invoke_throws", {}, ctx)
      expect(result.ok).toBe(false)
      expect(result.error).toContain("boom")
      expect(ctx.toolCallLog[0]?.error).toContain("boom")
    })

    it("serializes output_text longer than summary cap", async () => {
      registerTool(
        baseTool({
          name: "invoke_long_output",
          async handler() {
            return {
              ok: true,
              output_text: "x".repeat(800),
              summary: undefined, // 길이 절단 로직 검증용
            }
          },
        })
      )
      const ctx = makeCtx()
      await invokeTool("invoke_long_output", {}, ctx)
      // output_summary 는 240자 cap
      expect(ctx.toolCallLog[0]?.output_summary.length).toBeLessThanOrEqual(240)
      // output_text 는 원본 유지
      expect(ctx.toolCallLog[0]?.output_text?.length).toBe(800)
    })
  })
})
