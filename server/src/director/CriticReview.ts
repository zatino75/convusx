import type { DeptReport } from "./ProjectSession.js";
import type { DeptId } from "./TaskDecomposer.js";
import { logger } from "../observability/logger.js";

export interface CriticReviewResult {
  verdict: "pass" | "needs_followup";
  keyIssues: string[];
  contradictions: string[];
  verificationNeeded: string[];
  confidence: number;
  summary: string;
  /** 가장 문제 있는 부서 ID — 프론트 CRITIC walk 애니메이션 타깃 */
  targetDeptId?: DeptId;
}

interface DeptReportEntry {
  deptId: DeptId;
  report: DeptReport;
}

const CRITIC_SYSTEM_PROMPT = `당신은 CORVUS X의 감사/비평 에이전트(Critic)입니다.

역할:
- 부서 보고서들의 논리적 충돌, 숫자 모순, 근거 부족을 탐지합니다.
- 과도한 낙관 가정과 실행 불가능 권고를 선제적으로 표시합니다.
- 최종 보고서에 반드시 반영해야 할 검증 필요 항목을 정리합니다.
- 가장 문제 있는 부서 ID를 targetDeptId로 명시합니다.

반드시 JSON만 출력:
{
  "verdict": "pass" | "needs_followup",
  "targetDeptId": "marketing|finance|legal|market|compete|rnd|data|content|sns",
  "keyIssues": ["핵심 이슈"],
  "contradictions": ["상충 신호"],
  "verificationNeeded": ["검증 필요 항목"],
  "confidence": 0.0,
  "summary": "요약"
}

규칙:
- verdict는 문제가 경미하면 pass, 주요 모순이 있으면 needs_followup
- targetDeptId는 needs_followup 시에만 지정 (가장 약한 부서)
- confidence는 0~1 숫자
- 배열 항목은 최대 5개`;

function pickTopItems(items: string[], max = 5): string[] {
  return items.map((item) => item.trim()).filter(Boolean).slice(0, max);
}

function clampConfidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.65;
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}

function tryParseJson(text: string): Record<string, unknown> | null {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = codeBlock?.[1] ?? text.match(/(\{[\s\S]*\})/)?.[1] ?? "";
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

function buildFallbackReview(reports: DeptReportEntry[]): CriticReviewResult {
  const lowConfidence = reports
    .filter((entry) => (entry.report.confidence ?? 0) < 0.65)
    .map((entry) => `${entry.deptId} 부서 신뢰도 ${(entry.report.confidence * 100).toFixed(0)}%로 낮음`);

  const verdict: CriticReviewResult["verdict"] = lowConfidence.length > 0 ? "needs_followup" : "pass";

  let target: DeptId | undefined;
  if (lowConfidence.length > 0) {
    const worst = reports.slice().sort((a, b) => (a.report.confidence ?? 1) - (b.report.confidence ?? 1))[0];
    target = worst?.deptId;
  }

  return {
    verdict,
    keyIssues: pickTopItems(lowConfidence.length > 0 ? lowConfidence : ["중대한 충돌은 감지되지 않았습니다."]),
    contradictions: [],
    verificationNeeded: pickTopItems(
      lowConfidence.length > 0
        ? ["낮은 신뢰도 부서 결과의 원본 근거 재검토", "핵심 수치의 외부 데이터 교차검증"]
        : ["실행 전 비용/법규 항목 최종 검증"]
    ),
    confidence: lowConfidence.length > 0 ? 0.58 : 0.78,
    summary: lowConfidence.length > 0
      ? "일부 부서 결과의 신뢰도가 낮아 추가 검증이 필요합니다."
      : "현재 보고서 기준에서 즉시 실행 가능한 수준입니다.",
    targetDeptId: target,
  };
}

async function callCriticModel(userPrompt: string): Promise<string> {
  const { callClaude } = await import("../adapters/wrappers.js");
  return callClaude(CRITIC_SYSTEM_PROMPT, userPrompt, 3000);
}

function buildPrompt(directive: string, reports: DeptReportEntry[]): string {
  const compactReports = reports.map((entry) => {
    const sections = entry.report.sections
      .slice(0, 4)
      .map((section) => `- ${section.heading}: ${section.items.slice(0, 3).join(" | ")}`)
      .join("\n");
    return [
      `[${entry.deptId}]`,
      `title: ${entry.report.title}`,
      `confidence: ${entry.report.confidence}`,
      sections,
    ].join("\n");
  }).join("\n\n");

  return [
    `CEO 지시: ${directive}`,
    "",
    "부서 보고서 요약:",
    compactReports,
    "",
    "위 결과를 교차검증해 Critic JSON을 생성하세요. needs_followup 시 가장 약한 부서를 targetDeptId에 명시.",
  ].join("\n");
}

export async function runCriticReview(
  directive: string,
  reports: DeptReportEntry[],
): Promise<CriticReviewResult> {
  if (reports.length === 0) {
    return {
      verdict: "needs_followup",
      keyIssues: ["검토 가능한 부서 보고서가 없어 평가를 완료할 수 없습니다."],
      contradictions: [],
      verificationNeeded: ["최소 1개 이상의 부서 결과를 확보한 후 재평가"],
      confidence: 0.3,
      summary: "입력 데이터 부족",
    };
  }

  try {
    const text = await callCriticModel(buildPrompt(directive, reports));
    const parsed = tryParseJson(text);
    if (!parsed) return buildFallbackReview(reports);

    const verdict = parsed.verdict === "pass" ? "pass" : "needs_followup";

    let targetDeptId: DeptId | undefined;
    if (typeof parsed.targetDeptId === "string") {
      targetDeptId = parsed.targetDeptId as DeptId;
    } else if (verdict === "needs_followup") {
      const worst = reports.slice().sort((a, b) => (a.report.confidence ?? 1) - (b.report.confidence ?? 1))[0];
      targetDeptId = worst?.deptId;
    }

    return {
      verdict,
      keyIssues: pickTopItems(Array.isArray(parsed.keyIssues) ? parsed.keyIssues.map(String) : []),
      contradictions: pickTopItems(Array.isArray(parsed.contradictions) ? parsed.contradictions.map(String) : []),
      verificationNeeded: pickTopItems(Array.isArray(parsed.verificationNeeded) ? parsed.verificationNeeded.map(String) : []),
      confidence: clampConfidence(parsed.confidence),
      summary: typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : "Critic 검토가 완료되었습니다.",
      targetDeptId,
    };
  } catch (err) {
    logger.warn({ err }, "[CriticReview] 모델 호출 실패, fallback 사용");
    return buildFallbackReview(reports);
  }
}
