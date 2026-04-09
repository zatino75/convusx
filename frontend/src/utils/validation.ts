/**
 * CORVUS X — 클라이언트 사이드 폼 유효성 검사 유틸
 *
 * 외부 라이브러리 없이 순수 TypeScript로 구현.
 * 서버 validation.ts와 일관된 패턴.
 */

export type ValidationError = {
  field: string;
  message: string;
};

export type FieldRule = {
  field: string;
  /** 필수 여부 */
  required?: boolean;
  /** 문자열 최소 길이 */
  minLength?: number;
  /** 문자열 최대 길이 */
  maxLength?: number;
  /** 정규식 패턴 */
  pattern?: RegExp;
  /** 패턴 실패 시 표시할 메시지 */
  patternMessage?: string;
  /** 커스텀 검증 함수 (에러 메시지 반환 시 실패) */
  custom?: (value: unknown) => string | null;
};

/**
 * 주어진 데이터를 규칙 배열로 검증.
 * 통과 시 빈 배열, 실패 시 ValidationError[]
 */
export function validateFields(
  data: Record<string, unknown>,
  rules: FieldRule[]
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const rule of rules) {
    const value = data[rule.field];
    const strValue = typeof value === "string" ? value.trim() : "";

    // required 체크
    if (rule.required) {
      if (value === undefined || value === null || strValue === "") {
        errors.push({ field: rule.field, message: `${rule.field} 필수 항목입니다.` });
        continue; // 이후 규칙 스킵
      }
    }

    // 값이 없으면 나머지 검증 스킵
    if (!strValue && !rule.required) continue;

    // minLength
    if (rule.minLength !== undefined && strValue.length < rule.minLength) {
      errors.push({ field: rule.field, message: `${rule.field}은(는) 최소 ${rule.minLength}자 이상이어야 합니다.` });
    }

    // maxLength
    if (rule.maxLength !== undefined && strValue.length > rule.maxLength) {
      errors.push({ field: rule.field, message: `${rule.field}은(는) 최대 ${rule.maxLength}자까지 가능합니다.` });
    }

    // pattern
    if (rule.pattern && !rule.pattern.test(strValue)) {
      errors.push({ field: rule.field, message: rule.patternMessage ?? `${rule.field} 형식이 올바르지 않습니다.` });
    }

    // custom
    if (rule.custom) {
      const msg = rule.custom(value);
      if (msg) errors.push({ field: rule.field, message: msg });
    }
  }

  return errors;
}

/**
 * 개별 필드 유효성 검사 (인라인 실시간 검증용)
 */
export function validateField(value: unknown, rule: FieldRule): string | null {
  const errors = validateFields({ [rule.field]: value }, [rule]);
  return errors.length > 0 ? errors[0].message : null;
}

// ── 사전 정의된 규칙셋 ──

export const projectNameRules: FieldRule[] = [
  { field: "title", required: true, minLength: 1, maxLength: 100 }
];

export const apiKeyRules: FieldRule[] = [
  { field: "key", required: true, minLength: 10, maxLength: 256 }
];
