import { describe, it, expect } from "vitest";
import {
  nowIso,
  stripMarkdown,
  isGenericThreadTitle,
  isSafeUrl,
  findBaseUserMessageIndex,
  findNextUserMessageIndex,
  debounce
} from "../src/utils/helpers";

describe("nowIso", () => {
  it("ISO 8601 형식 문자열 반환", () => {
    const result = nowIso();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("stripMarkdown", () => {
  it("코드 블록 제거", () => {
    expect(stripMarkdown("텍스트 ```코드``` 뒤")).toBe("텍스트 뒤");
  });

  it("인라인 코드 제거", () => {
    expect(stripMarkdown("앞 `코드` 뒤")).toBe("앞 뒤");
  });

  it("Bold 마크다운 제거", () => {
    expect(stripMarkdown("**굵은 글씨**")).toBe("굵은 글씨");
  });

  it("빈 문자열 처리", () => {
    expect(stripMarkdown("")).toBe("");
  });

  it("null/undefined 안전 처리", () => {
    expect(stripMarkdown(null as any)).toBe("");
    expect(stripMarkdown(undefined as any)).toBe("");
  });
});

describe("isGenericThreadTitle", () => {
  it("기본 제목은 generic으로 판단", () => {
    expect(isGenericThreadTitle("새 대화")).toBe(true);
    expect(isGenericThreadTitle("New Thread")).toBe(true);
    expect(isGenericThreadTitle("Untitled")).toBe(true);
  });

  it("커스텀 제목은 generic이 아님", () => {
    expect(isGenericThreadTitle("프로젝트 기획안")).toBe(false);
    expect(isGenericThreadTitle("API 설계 논의")).toBe(false);
  });

  it("빈 문자열은 generic", () => {
    expect(isGenericThreadTitle("")).toBe(true);
    expect(isGenericThreadTitle("  ")).toBe(true);
  });
});

describe("isSafeUrl", () => {
  it("http/https 허용", () => {
    expect(isSafeUrl("https://example.com")).toBe(true);
    expect(isSafeUrl("http://example.com")).toBe(true);
  });

  it("javascript: 프로토콜 차단", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
  });

  it("상대 경로 허용", () => {
    expect(isSafeUrl("/api/health")).toBe(true);
    expect(isSafeUrl("path/to/file")).toBe(true);
  });

  it("빈 URL 차단", () => {
    expect(isSafeUrl("")).toBe(false);
  });
});

describe("findBaseUserMessageIndex", () => {
  const messages = [
    { role: "user" },
    { role: "assistant" },
    { role: "user" },
    { role: "assistant" },
  ];

  it("이전 user 메시지 인덱스 반환", () => {
    expect(findBaseUserMessageIndex(messages, 3)).toBe(2);
  });

  it("자기 자신이 user인 경우 자신 반환", () => {
    expect(findBaseUserMessageIndex(messages, 0)).toBe(0);
  });
});

describe("findNextUserMessageIndex", () => {
  const messages = [
    { role: "user" },
    { role: "assistant" },
    { role: "user" },
    { role: "assistant" },
  ];

  it("다음 user 메시지 인덱스 반환", () => {
    expect(findNextUserMessageIndex(messages, 0)).toBe(2);
  });

  it("없으면 배열 길이 반환", () => {
    expect(findNextUserMessageIndex(messages, 2)).toBe(4);
  });
});

describe("debounce", () => {
  it("연속 호출 시 마지막 호출만 실행", async () => {
    let count = 0;
    const fn = debounce(() => { count++; }, 50);
    fn();
    fn();
    fn();
    expect(count).toBe(0);
    await new Promise(r => setTimeout(r, 80));
    expect(count).toBe(1);
  });
});
