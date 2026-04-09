import { describe, it, expect } from "vitest"
import { normalizeProvider, normalizeTask, hasText, clamp, round, safeNumber, uniqueStrings } from "../src/utils/common"

describe("normalizeProvider", () => {
  it("lowercases and trims", () => {
    expect(normalizeProvider("  OpenAI  ")).toBe("openai")
    expect(normalizeProvider("Claude")).toBe("claude")
    expect(normalizeProvider("GEMINI")).toBe("gemini")
  })

  it("handles null/undefined", () => {
    expect(normalizeProvider(null)).toBe("")
    expect(normalizeProvider(undefined)).toBe("")
  })
})

describe("normalizeTask", () => {
  it("normalizes known tasks", () => {
    expect(normalizeTask("dialogue")).toBe("dialogue")
    expect(normalizeTask("code_implement")).toBe("code_implement")
    expect(normalizeTask("REASONING")).toBe("reasoning")
  })

  it("maps aliases", () => {
    expect(normalizeTask("code_refactor")).toBe("code_refactor_review")
    expect(normalizeTask("code_review")).toBe("code_refactor_review")
    expect(normalizeTask("document")).toBe("word")
    expect(normalizeTask("spreadsheet")).toBe("excel")
    expect(normalizeTask("slides")).toBe("ppt")
  })

  it("defaults to dialogue", () => {
    expect(normalizeTask("")).toBe("dialogue")
    expect(normalizeTask(null)).toBe("dialogue")
    expect(normalizeTask("unknown_task")).toBe("dialogue")
  })
})

describe("hasText", () => {
  it("returns true for non-empty strings", () => {
    expect(hasText("hello")).toBe(true)
    expect(hasText("  text  ")).toBe(true)
  })

  it("returns false for empty/non-string", () => {
    expect(hasText("")).toBe(false)
    expect(hasText("   ")).toBe(false)
    expect(hasText(null)).toBe(false)
    expect(hasText(undefined)).toBe(false)
    expect(hasText(123)).toBe(false)
  })
})

describe("clamp", () => {
  it("clamps values within range", () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(15, 0, 10)).toBe(10)
  })
})

describe("round", () => {
  it("rounds to specified decimals", () => {
    expect(round(3.14159, 2)).toBe(3.14)
    expect(round(3.14159, 4)).toBe(3.1416)
  })
})

describe("safeNumber", () => {
  it("converts valid numbers", () => {
    expect(safeNumber(42)).toBe(42)
    expect(safeNumber("3.14")).toBe(3.14)
  })

  it("returns fallback for invalid", () => {
    expect(safeNumber(null)).toBe(0)
    expect(safeNumber("abc")).toBe(0)
    expect(safeNumber(NaN, -1)).toBe(-1)
    expect(safeNumber(Infinity, 0)).toBe(0)
  })
})

describe("uniqueStrings", () => {
  it("deduplicates case-insensitively", () => {
    expect(uniqueStrings(["OpenAI", "openai", "Claude", "CLAUDE"])).toEqual(["openai", "claude"])
  })

  it("filters empty values", () => {
    expect(uniqueStrings(["", "  ", "openai"])).toEqual(["openai"])
  })
})
