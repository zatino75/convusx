"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const common_1 = require("../src/utils/common");
(0, vitest_1.describe)("normalizeProvider", () => {
    (0, vitest_1.it)("lowercases and trims", () => {
        (0, vitest_1.expect)((0, common_1.normalizeProvider)("  OpenAI  ")).toBe("openai");
        (0, vitest_1.expect)((0, common_1.normalizeProvider)("Claude")).toBe("claude");
        (0, vitest_1.expect)((0, common_1.normalizeProvider)("GEMINI")).toBe("gemini");
    });
    (0, vitest_1.it)("handles null/undefined", () => {
        (0, vitest_1.expect)((0, common_1.normalizeProvider)(null)).toBe("");
        (0, vitest_1.expect)((0, common_1.normalizeProvider)(undefined)).toBe("");
    });
});
(0, vitest_1.describe)("normalizeTask", () => {
    (0, vitest_1.it)("normalizes known tasks", () => {
        (0, vitest_1.expect)((0, common_1.normalizeTask)("dialogue")).toBe("dialogue");
        (0, vitest_1.expect)((0, common_1.normalizeTask)("code_implement")).toBe("code_implement");
        (0, vitest_1.expect)((0, common_1.normalizeTask)("REASONING")).toBe("reasoning");
    });
    (0, vitest_1.it)("maps aliases", () => {
        (0, vitest_1.expect)((0, common_1.normalizeTask)("code_refactor")).toBe("code_refactor_review");
        (0, vitest_1.expect)((0, common_1.normalizeTask)("code_review")).toBe("code_refactor_review");
        (0, vitest_1.expect)((0, common_1.normalizeTask)("document")).toBe("word");
        (0, vitest_1.expect)((0, common_1.normalizeTask)("spreadsheet")).toBe("excel");
        (0, vitest_1.expect)((0, common_1.normalizeTask)("slides")).toBe("ppt");
    });
    (0, vitest_1.it)("defaults to dialogue", () => {
        (0, vitest_1.expect)((0, common_1.normalizeTask)("")).toBe("dialogue");
        (0, vitest_1.expect)((0, common_1.normalizeTask)(null)).toBe("dialogue");
        (0, vitest_1.expect)((0, common_1.normalizeTask)("unknown_task")).toBe("dialogue");
    });
});
(0, vitest_1.describe)("hasText", () => {
    (0, vitest_1.it)("returns true for non-empty strings", () => {
        (0, vitest_1.expect)((0, common_1.hasText)("hello")).toBe(true);
        (0, vitest_1.expect)((0, common_1.hasText)("  text  ")).toBe(true);
    });
    (0, vitest_1.it)("returns false for empty/non-string", () => {
        (0, vitest_1.expect)((0, common_1.hasText)("")).toBe(false);
        (0, vitest_1.expect)((0, common_1.hasText)("   ")).toBe(false);
        (0, vitest_1.expect)((0, common_1.hasText)(null)).toBe(false);
        (0, vitest_1.expect)((0, common_1.hasText)(undefined)).toBe(false);
        (0, vitest_1.expect)((0, common_1.hasText)(123)).toBe(false);
    });
});
(0, vitest_1.describe)("clamp", () => {
    (0, vitest_1.it)("clamps values within range", () => {
        (0, vitest_1.expect)((0, common_1.clamp)(5, 0, 10)).toBe(5);
        (0, vitest_1.expect)((0, common_1.clamp)(-1, 0, 10)).toBe(0);
        (0, vitest_1.expect)((0, common_1.clamp)(15, 0, 10)).toBe(10);
    });
});
(0, vitest_1.describe)("round", () => {
    (0, vitest_1.it)("rounds to specified decimals", () => {
        (0, vitest_1.expect)((0, common_1.round)(3.14159, 2)).toBe(3.14);
        (0, vitest_1.expect)((0, common_1.round)(3.14159, 4)).toBe(3.1416);
    });
});
(0, vitest_1.describe)("safeNumber", () => {
    (0, vitest_1.it)("converts valid numbers", () => {
        (0, vitest_1.expect)((0, common_1.safeNumber)(42)).toBe(42);
        (0, vitest_1.expect)((0, common_1.safeNumber)("3.14")).toBe(3.14);
    });
    (0, vitest_1.it)("returns fallback for invalid", () => {
        (0, vitest_1.expect)((0, common_1.safeNumber)(null)).toBe(0);
        (0, vitest_1.expect)((0, common_1.safeNumber)("abc")).toBe(0);
        (0, vitest_1.expect)((0, common_1.safeNumber)(NaN, -1)).toBe(-1);
        (0, vitest_1.expect)((0, common_1.safeNumber)(Infinity, 0)).toBe(0);
    });
});
(0, vitest_1.describe)("uniqueStrings", () => {
    (0, vitest_1.it)("deduplicates case-insensitively", () => {
        (0, vitest_1.expect)((0, common_1.uniqueStrings)(["OpenAI", "openai", "Claude", "CLAUDE"])).toEqual(["openai", "claude"]);
    });
    (0, vitest_1.it)("filters empty values", () => {
        (0, vitest_1.expect)((0, common_1.uniqueStrings)(["", "  ", "openai"])).toEqual(["openai"]);
    });
});
