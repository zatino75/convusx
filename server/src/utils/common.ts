// ── 공용 유틸리티 ──
// 프로젝트 전역에서 사용하는 기본 헬퍼 함수 (중복 제거 목적)

export function normalizeProvider(value: any): string {
  return String(value ?? "").trim().toLowerCase()
}

export function normalizeTask(task: any): string {
  const value = String(task ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")
  if (!value) return "dialogue"
  if (value === "code_refactor" || value === "code_review" || value === "code_refactor/review") return "code_refactor_review"
  if (value === "code_implement" || value === "code_debug" || value === "code_refactor_review") return value
  if (value === "writing_creative" || value === "writing_business") return value
  if (value === "word" || value === "document" || value === "doc") return "word"
  if (value === "sheet" || value === "spreadsheet") return "excel"
  if (value === "slides" || value === "presentation") return "ppt"
  if (["dialogue", "reasoning", "research", "code", "long_doc", "writing", "excel", "word", "ppt", "pdf", "legal_review", "data_analysis", "finance_analysis", "product_development"].includes(value)) {
    return value
  }
  if (value.includes("long_doc")) return "long_doc"
  if (value.includes("writing_creative") || value.includes("creative")) return "writing_creative"
  if (value.includes("writing_business")) return "writing_business"
  if (value.startsWith("writing")) return "writing"
  if (value.includes("legal")) return "legal_review"
  if (value.includes("finance")) return "finance_analysis"
  if (value.includes("data")) return "data_analysis"
  if (value.includes("product")) return "product_development"
  if (value.includes("research") || value.includes("deep_research")) return "research"
  if (value.includes("reasoning")) return "reasoning"
  if (value.includes("code")) return "code"
  return "dialogue"
}

export function env(key: string): string {
  return String(process.env?.[key] ?? "").trim()
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function now(): number {
  return Date.now()
}

export function hasText(value: any): boolean {
  return typeof value === "string" && value.trim().length > 0
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function round(value: number, decimals = 4): number {
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}

export function safeNumber(value: any, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values ?? []) {
    const n = String(v ?? "").trim().toLowerCase()
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}
