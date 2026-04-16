import { describe, it, expect } from "vitest"
import { estimateCostUsd } from "../src/cost/costCalc"

describe("estimateCostUsd", () => {
  it("returns 0 when modelName is missing", () => {
    expect(estimateCostUsd(null, { input_tokens: 1000, output_tokens: 1000 })).toBe(0)
    expect(estimateCostUsd(undefined, { input_tokens: 1000, output_tokens: 1000 })).toBe(0)
    expect(estimateCostUsd("", { input_tokens: 1000, output_tokens: 1000 })).toBe(0)
  })

  it("returns 0 when usage is missing or empty", () => {
    expect(estimateCostUsd("gpt-5.4-pro", null)).toBe(0)
    expect(estimateCostUsd("gpt-5.4-pro", undefined)).toBe(0)
    expect(estimateCostUsd("gpt-5.4-pro", {})).toBe(0)
  })

  it("returns 0 for unknown model even with valid usage", () => {
    expect(
      estimateCostUsd("unknown-future-model-2030", { input_tokens: 10000, output_tokens: 10000 })
    ).toBe(0)
  })

  it("computes Claude Opus cost from input+output tokens", () => {
    // claude-opus-4-6: input 0.015/1k, output 0.075/1k
    // 1000 input + 1000 output => 0.015 + 0.075 = 0.09 USD
    const cost = estimateCostUsd("claude-opus-4-6", {
      input_tokens: 1000,
      output_tokens: 1000,
    })
    expect(cost).toBeCloseTo(0.09, 5)
  })

  it("computes GPT-5.4-pro cost correctly", () => {
    // gpt-5.4-pro: input 0.015/1k, output 0.06/1k
    const cost = estimateCostUsd("gpt-5.4-pro", {
      input_tokens: 2000,
      output_tokens: 500,
    })
    expect(cost).toBeCloseTo(2 * 0.015 + 0.5 * 0.06, 5)
  })

  it("accepts prompt_tokens / completion_tokens aliases", () => {
    const a = estimateCostUsd("claude-sonnet-4-6", {
      input_tokens: 1000,
      output_tokens: 1000,
    })
    const b = estimateCostUsd("claude-sonnet-4-6", {
      prompt_tokens: 1000,
      completion_tokens: 1000,
    })
    expect(a).toBeCloseTo(b, 5)
    expect(a).toBeGreaterThan(0)
  })

  it("ignores non-finite token counts", () => {
    expect(
      estimateCostUsd("gpt-5.4-pro", {
        input_tokens: Number.NaN,
        output_tokens: 1000,
      })
    ).toBeGreaterThan(0) // 입력 NaN 이어도 output 만으로 계산 가능
    expect(
      estimateCostUsd("gpt-5.4-pro", {
        input_tokens: Number.NaN,
        output_tokens: Number.NaN,
      })
    ).toBe(0)
  })

  it("handles zero tokens gracefully", () => {
    expect(estimateCostUsd("claude-opus-4-6", { input_tokens: 0, output_tokens: 0 })).toBe(0)
  })
})
