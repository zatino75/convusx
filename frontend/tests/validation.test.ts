import { describe, it, expect } from "vitest";
import { validateFields, validateField, type FieldRule } from "../src/utils/validation";

describe("validateFields", () => {
  it("required 필드가 비어있으면 에러 반환", () => {
    const rules: FieldRule[] = [{ field: "title", required: true }];
    const errors = validateFields({ title: "" }, rules);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("title");
  });

  it("required 필드에 값이 있으면 통과", () => {
    const rules: FieldRule[] = [{ field: "title", required: true }];
    const errors = validateFields({ title: "테스트" }, rules);
    expect(errors).toHaveLength(0);
  });

  it("minLength 미달 시 에러", () => {
    const rules: FieldRule[] = [{ field: "name", minLength: 3 }];
    const errors = validateFields({ name: "ab" }, rules);
    expect(errors).toHaveLength(1);
  });

  it("maxLength 초과 시 에러", () => {
    const rules: FieldRule[] = [{ field: "name", maxLength: 5 }];
    const errors = validateFields({ name: "abcdef" }, rules);
    expect(errors).toHaveLength(1);
  });

  it("pattern 불일치 시 에러", () => {
    const rules: FieldRule[] = [
      { field: "email", pattern: /^[^@]+@[^@]+$/, patternMessage: "이메일 형식 오류" }
    ];
    const errors = validateFields({ email: "notanemail" }, rules);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("이메일 형식 오류");
  });

  it("pattern 일치 시 통과", () => {
    const rules: FieldRule[] = [
      { field: "email", pattern: /^[^@]+@[^@]+$/ }
    ];
    const errors = validateFields({ email: "user@test.com" }, rules);
    expect(errors).toHaveLength(0);
  });

  it("custom validator 에러 반환", () => {
    const rules: FieldRule[] = [
      { field: "age", custom: (v) => (Number(v) < 0 ? "음수 불가" : null) }
    ];
    const errors = validateFields({ age: "-1" }, rules);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("음수 불가");
  });

  it("여러 규칙 동시 검증", () => {
    const rules: FieldRule[] = [
      { field: "title", required: true },
      { field: "description", maxLength: 10 }
    ];
    const errors = validateFields({ title: "", description: "너무 긴 텍스트입니다 이건" }, rules);
    expect(errors).toHaveLength(2);
  });

  it("optional 필드 비어있으면 스킵", () => {
    const rules: FieldRule[] = [{ field: "nickname", minLength: 3 }];
    const errors = validateFields({ nickname: "" }, rules);
    expect(errors).toHaveLength(0);
  });
});

describe("validateField", () => {
  it("단일 필드 유효성 검사 — 통과", () => {
    const rule: FieldRule = { field: "name", required: true, minLength: 2 };
    expect(validateField("테스트", rule)).toBeNull();
  });

  it("단일 필드 유효성 검사 — 실패", () => {
    const rule: FieldRule = { field: "name", required: true };
    expect(validateField("", rule)).not.toBeNull();
  });
});
