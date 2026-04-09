/**
 * CORVUS X — 입력 검증 유틸리티
 *
 * 기존 코드의 수동 검증 패턴과 일관성을 유지하면서
 * 재사용 가능한 검증 함수 모음 제공.
 * 외부 의존성 없이 순수 TypeScript로 구현.
 */

// ── 기본 타입 검증 ──

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

export function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

export function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
}

// ── 문자열 정제 ──

/** 안전한 문자열 변환 + trim (최대 길이 제한 포함) */
export function sanitizeString(value: unknown, maxLength = 10_000): string {
  const raw = String(value ?? "").trim()
  return raw.length > maxLength ? raw.slice(0, maxLength) : raw
}

/** provider 이름 정규화 (lowercase + trim) */
export function sanitizeProvider(value: unknown): string {
  return sanitizeString(value, 50).toLowerCase()
}

/** ID 형태의 문자열 정제 (영문, 숫자, -, _ 만 허용) */
export function sanitizeId(value: unknown, maxLength = 128): string {
  const raw = sanitizeString(value, maxLength)
  return /^[\w\-]+$/.test(raw) ? raw : ""
}

// ── 검증 결과 타입 ──

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: string; field?: string }

// ── 스키마 기반 검증 ──

type FieldRule = {
  field: string
  required?: boolean
  type?: "string" | "number" | "boolean" | "array" | "object"
  minLength?: number
  maxLength?: number
  oneOf?: readonly string[]
  custom?: (value: unknown) => string | null  // null = ok, string = error message
}

/** 규칙 배열로 body 검증 */
export function validateBody(body: Record<string, unknown>, rules: FieldRule[]): ValidationResult {
  for (const rule of rules) {
    const value = body[rule.field]

    // required 체크
    if (rule.required) {
      if (value === undefined || value === null || value === "") {
        return { ok: false, error: `${rule.field} is required`, field: rule.field }
      }
    }

    // 값이 없으면 이후 검증 스킵 (optional)
    if (value === undefined || value === null) continue

    // type 체크
    if (rule.type) {
      if (rule.type === "array" && !Array.isArray(value)) {
        return { ok: false, error: `${rule.field} must be an array`, field: rule.field }
      }
      if (rule.type === "object" && (typeof value !== "object" || Array.isArray(value))) {
        return { ok: false, error: `${rule.field} must be an object`, field: rule.field }
      }
      if (rule.type === "string" && typeof value !== "string") {
        return { ok: false, error: `${rule.field} must be a string`, field: rule.field }
      }
      if (rule.type === "number" && typeof value !== "number") {
        return { ok: false, error: `${rule.field} must be a number`, field: rule.field }
      }
      if (rule.type === "boolean" && typeof value !== "boolean") {
        return { ok: false, error: `${rule.field} must be a boolean`, field: rule.field }
      }
    }

    // string 길이 체크
    if (typeof value === "string") {
      if (rule.minLength !== undefined && value.trim().length < rule.minLength) {
        return { ok: false, error: `${rule.field} must be at least ${rule.minLength} characters`, field: rule.field }
      }
      if (rule.maxLength !== undefined && value.length > rule.maxLength) {
        return { ok: false, error: `${rule.field} must be at most ${rule.maxLength} characters`, field: rule.field }
      }
    }

    // oneOf 체크
    if (rule.oneOf && !isOneOf(value, rule.oneOf)) {
      return { ok: false, error: `${rule.field} must be one of: ${rule.oneOf.join(", ")}`, field: rule.field }
    }

    // custom 체크
    if (rule.custom) {
      const customError = rule.custom(value)
      if (customError) {
        return { ok: false, error: customError, field: rule.field }
      }
    }
  }

  return { ok: true }
}

// ── 엔드포인트별 사전 정의 검증 ──

const VALID_PROVIDERS = ["openai", "claude", "anthropic", "gemini", "perplexity", "midjourney", "runway"] as const
const VALID_FEEDBACK = ["up", "down"] as const
const VALID_RESET_TARGETS = ["thread-memory", "project-memory", "scoreboard", "all"] as const

export const chatRules: FieldRule[] = [
  { field: "message", type: "string", maxLength: 50_000 },
  { field: "messages", type: "array" },
  { field: "thread_id", type: "string", maxLength: 128 },
  { field: "project_id", type: "string", maxLength: 128 },
  {
    field: "__validate_has_input",
    custom: (_value: unknown, ..._args: unknown[]) => null  // chat에서는 message 또는 messages 중 하나 필요 — route 자체에서 체크
  }
]

export const feedbackRules: FieldRule[] = [
  { field: "feedback", required: true, type: "string", oneOf: VALID_FEEDBACK },
  { field: "provider", required: true, type: "string", minLength: 1, maxLength: 50 },
  { field: "task", type: "string", maxLength: 50 },
  { field: "message_id", type: "string", maxLength: 128 },
  { field: "runner_up", type: "string", maxLength: 50 }
]

export const settingsKeysRules: FieldRule[] = [
  // 각 provider 키는 optional, 값이 있으면 문자열
  ...VALID_PROVIDERS.map(p => ({ field: p, type: "string" as const, maxLength: 200 }))
]

export const settingsResetRules: FieldRule[] = [
  { field: "target", required: true, type: "string", oneOf: VALID_RESET_TARGETS }
]

export const workspaceProjectRules: FieldRule[] = [
  { field: "id", required: true, type: "string", minLength: 1, maxLength: 128 },
  { field: "title", required: true, type: "string", minLength: 1, maxLength: 200 }
]

export const workspaceThreadRules: FieldRule[] = [
  { field: "id", required: true, type: "string", minLength: 1, maxLength: 128 },
  { field: "projectId", required: true, type: "string", minLength: 1, maxLength: 128 }
]

export const workspaceMessageRules: FieldRule[] = [
  { field: "threadId", required: true, type: "string", minLength: 1, maxLength: 128 },
  { field: "messages", required: true, type: "array" }
]

export const benchmarkRules: FieldRule[] = [
  { field: "cases", type: "array" },
  { field: "max_cases", type: "number" },
  { field: "single_providers", type: "array" }
]

export const exportRules: FieldRule[] = [
  { field: "threadId", required: true, type: "string", minLength: 1 },
  { field: "format", type: "string", oneOf: ["markdown", "text"] }
]

export const validateKeyRules: FieldRule[] = [
  { field: "provider", required: true, type: "string", oneOf: VALID_PROVIDERS }
]
