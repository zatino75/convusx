// Task type definitions — single source of truth
// Previously duplicated in planner.ts, judge.ts, adapterDispatcher.ts

export type CanonicalTask =
  | "dialogue"
  | "reasoning"
  | "research"
  | "deep_research"
  | "code"
  | "code_implement"
  | "code_debug"
  | "code_refactor_review"
  | "writing"
  | "writing_creative"
  | "writing_business"
  | "long_doc"
  | "word"
  | "pdf"
  | "excel"
  | "ppt"
  | "legal_review"
  | "data_analysis"
  | "finance_analysis"
  | "product_development"
  | "evidence"
  | "generic"

export type CodeSubtask = "code_implement" | "code_debug" | "code_refactor_review"

export type ProviderRole = "primary" | "verifier" | "judge" | "optional" | "scout" | "fallback" | "synthesis"

// ── Canonical task set (used for membership checks) ──────────────────────
export const CANONICAL_TASKS = new Set<CanonicalTask>([
  "dialogue",
  "reasoning",
  "research",
  "deep_research",
  "code",
  "code_implement",
  "code_debug",
  "code_refactor_review",
  "writing",
  "writing_creative",
  "writing_business",
  "long_doc",
  "word",
  "pdf",
  "excel",
  "ppt",
  "legal_review",
  "data_analysis",
  "finance_analysis",
  "product_development",
  "evidence",
  "generic",
])

// ── High-stakes tasks (trigger stricter scoring / AI Judge) ──────────────
export const HIGH_STAKES_TASKS = new Set<CanonicalTask>([
  "reasoning",
  "research",
  "code_implement",
  "code_debug",
  "code_refactor_review",
  "writing_business",
  "long_doc",
  "pdf",
  "word",
  "excel",
  "ppt",
  "legal_review",
  "data_analysis",
  "finance_analysis",
  "product_development",
])

// ── Benchmark-specific 6-category task types ─────────────────────────────
export const BENCHMARK_TASKS = ["dialogue", "reasoning", "research", "code", "writing", "long_doc"] as const
export type BenchmarkTaskType = typeof BENCHMARK_TASKS[number]

// ── Unified normalizeTask ────────────────────────────────────────────────
// Merges logic from judge.ts + adapterDispatcher.ts
// defaultTask: "generic" for judge scoring, "dialogue" for adapter dispatch
export function normalizeTask(input: string, defaultTask: CanonicalTask = "generic"): CanonicalTask {
  const value = String(input ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")

  if (!value) return defaultTask

  // ── exact alias mapping ──
  if (value === "code_refactor" || value === "code_review" || value === "code_refactor/review") {
    return "code_refactor_review"
  }
  if (value === "legal") return "legal_review"
  if (value === "analysis") return "data_analysis"
  if (value === "finance") return "finance_analysis"
  if (value === "product") return "product_development"

  // ── exact match against canonical set ──
  if (CANONICAL_TASKS.has(value as CanonicalTask)) return value as CanonicalTask

  // ── fuzzy includes-based matching (from adapterDispatcher) ──
  if (value.includes("debug")) return "code_debug"
  if (value.includes("refactor") || value.includes("review")) return "code_refactor_review"
  if (value.includes("implement")) return "code_implement"
  if (value.includes("code")) return "code"

  if (value.includes("long_doc") || value.includes("long_document")) return "long_doc"
  if (value.includes("document") || value.includes("doc")) return "word"
  if (value.includes("spreadsheet") || value.includes("sheet")) return "excel"
  if (value.includes("slide") || value.includes("presentation")) return "ppt"

  if (value.includes("writing_creative") || value.includes("creative_writing")) return "writing_creative"
  if (value.includes("writing_business") || value.includes("business_writing") || value.includes("email_writing")) return "writing_business"
  if (value.includes("writing") || value.includes("write")) return "writing"

  if (value.includes("legal")) return "legal_review"
  if (value.includes("finance")) return "finance_analysis"
  if (value.includes("data")) return "data_analysis"
  if (value.includes("product")) return "product_development"
  if (value.includes("deep_research")) return "deep_research"
  if (value.includes("research")) return "research"
  if (value.includes("reasoning")) return "reasoning"
  if (value.includes("evidence")) return "evidence"

  return defaultTask
}
