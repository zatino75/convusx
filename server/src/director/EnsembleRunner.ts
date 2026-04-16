/**
 * EnsembleRunner.ts
 * 3-AI 병렬 앙상블 — Claude Opus 4.6 / GPT-5.4-pro / Gemini 3.1 Pro Ultra
 *
 * 고가치 task(marketing / finance / legal / product / strategy)에서
 * DirectorAgent가 부서 에이전트 호출 직전에 호출한다.
 * 3개 모델을 동시 호출 → 각각의 draft를 ensemble_voice 이벤트로 스트리밍 →
 * Claude로 통합 verdict 생성 → ensemble_done 이벤트.
 */

import type { DeptId } from "./TaskDecomposer.js";
import { logger } from "../observability/logger.js";
import { GEMINI_DISPLAY_LABEL } from "../adapters/gemini.js";

export interface EnsembleEvent {
  type: "ensemble_start" | "ensemble_voice" | "ensemble_done";
  deptId?: DeptId;
  reason?: string;
  model?: string;
  message?: string;
  draft?: string;
  verdict?: string;
  summary?: string;
  durationMs?: number;
}

export interface EnsembleResult {
  drafts: { model: string; text: string; durationMs: number; error?: string }[];
  synthesis: string;
  verdict: string;
  summary: string;
}

/** 고가치 부서 식별 — 기본 활성 목록 */
export const HIGH_VALUE_DEPTS: ReadonlySet<DeptId> = new Set<DeptId>([
  "marketing",
  "finance",
  "legal",
  "rnd",
] as DeptId[]);

/** 키워드 기반 고가치 task 추가 감지 */
export function detectHighValue(directive: string, deptId: DeptId): boolean {
  if (HIGH_VALUE_DEPTS.has(deptId)) return true;
  const d = directive.toLowerCase();
  return /전략|사업계획|답변서|계약|리스크|상품 ?개발|규제|법규|launch|strategy|risk|contract|legal|product/.test(d);
}

const ENSEMBLE_SYNTH_PROMPT = `당신은 CORVUS X 통합 디렉터입니다. 3개 AI(Claude / GPT / Gemini)가 같은 task를 독립 분석한 결과를 받았습니다.

역할:
- 공통 합의(consensus) 사항 추출
- 상충하는 주장(contradictions) 표시
- 각 모델만의 고유 통찰(unique insights) 보존
- 최종 통합 권고(recommendation) 생성

반드시 JSON만 출력:
{
  "verdict": "consensus" | "split" | "low_confidence",
  "summary": "통합 결론 한 문장",
  "consensus": ["합의 사항"],
  "contradictions": ["상충 신호"],
  "uniqueInsights": [{"model":"claude|gpt|gemini","insight":"고유 통찰"}],
  "recommendation": "최종 권고"
}`;

function tryParseJson(text: string): Record<string, unknown> | null {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = codeBlock?.[1] ?? text.match(/(\{[\s\S]*\})/)?.[1] ?? "";
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function callOne(
  model: "claude" | "gpt" | "gemini",
  systemPrompt: string,
  userPrompt: string,
): Promise<{ text: string; durationMs: number; error?: string }> {
  const start = Date.now();
  try {
    const wrappers = await import("../adapters/wrappers.js");
    let text = "";
    if (model === "claude") text = await wrappers.callClaude(systemPrompt, userPrompt, 3000);
    else if (model === "gpt") text = await wrappers.callOpenAI(systemPrompt, userPrompt, 3000);
    else text = await wrappers.callGemini(systemPrompt, userPrompt, 3000);
    return { text, durationMs: Date.now() - start };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: "", durationMs: Date.now() - start, error: msg };
  }
}

// UI/이벤트 스트림 표시용 레이블 — 실제 API 모델 ID와 분리 관리.
// Gemini 레이블은 adapters/gemini.ts의 GEMINI_DISPLAY_LABEL 단일 출처에서 가져옴.
const MODEL_LABEL: Record<string, string> = {
  claude: "claude-opus-4-6",
  gpt: "gpt-5.4-pro",
  gemini: GEMINI_DISPLAY_LABEL,
};

/**
 * 3-AI 병렬 앙상블 실행 — onEvent 콜백으로 ensemble_* 이벤트 스트리밍
 */
export async function runEnsemble(opts: {
  deptId: DeptId;
  objective: string;
  reason?: string;
  systemPrompt: string;
  userPrompt: string;
  onEvent?: (e: EnsembleEvent) => void;
}): Promise<EnsembleResult> {
  const { deptId, objective, reason, systemPrompt, userPrompt, onEvent } = opts;
  const send = (e: EnsembleEvent) => {
    try { onEvent?.(e); } catch { /* ignore */ }
  };

  send({
    type: "ensemble_start",
    deptId,
    reason: reason ?? `${deptId} — 고가치 3-AI 앙상블 (${objective.slice(0, 40)})`,
  });

  // 3개 모델을 진짜 병렬로 호출
  const [claudeRes, gptRes, geminiRes] = await Promise.all([
    callOne("claude", systemPrompt, userPrompt).then((r) => {
      send({
        type: "ensemble_voice",
        deptId,
        model: MODEL_LABEL.claude,
        message: r.error ? `[오류] ${r.error.slice(0, 80)}` : (r.text.slice(0, 120) || "(빈 응답)"),
        draft: r.text,
        durationMs: r.durationMs,
      });
      return r;
    }),
    callOne("gpt", systemPrompt, userPrompt).then((r) => {
      send({
        type: "ensemble_voice",
        deptId,
        model: MODEL_LABEL.gpt,
        message: r.error ? `[오류] ${r.error.slice(0, 80)}` : (r.text.slice(0, 120) || "(빈 응답)"),
        draft: r.text,
        durationMs: r.durationMs,
      });
      return r;
    }),
    callOne("gemini", systemPrompt, userPrompt).then((r) => {
      send({
        type: "ensemble_voice",
        deptId,
        model: MODEL_LABEL.gemini,
        message: r.error ? `[오류] ${r.error.slice(0, 80)}` : (r.text.slice(0, 120) || "(빈 응답)"),
        draft: r.text,
        durationMs: r.durationMs,
      });
      return r;
    }),
  ]);

  const drafts = [
    { model: MODEL_LABEL.claude, ...claudeRes },
    { model: MODEL_LABEL.gpt, ...gptRes },
    { model: MODEL_LABEL.gemini, ...geminiRes },
  ];

  // 통합 (Claude로 합성)
  let synthesis = "";
  let verdict = "consensus";
  let summary = `${deptId} 부서 3-AI 병렬 분석 완료`;

  const validDrafts = drafts.filter((d) => !d.error && d.text.trim().length > 0);
  if (validDrafts.length === 0) {
    // Phase 6 — 무음 fallback 방지. 3-AI 모두 실패 시 warn 레벨로 가시화.
    // 모델별 실패 원인을 정리해서 로그에 남겨 다음 incident 때 추적 가능하게 함.
    const failureSummary = drafts.map((d) => ({
      model: d.model,
      durationMs: d.durationMs,
      reason: d.error ?? (d.text.trim().length === 0 ? "empty_response" : "unknown"),
    }));
    logger.warn(
      { deptId, objective: objective.slice(0, 120), failures: failureSummary },
      "[Ensemble] 3-AI 모두 유효 draft 생성 실패 — low_confidence fallback"
    );
    verdict = "low_confidence";
    summary = "3-AI 모두 응답 실패 — 부서 단독 모델 fallback";
    synthesis = summary;
    send({ type: "ensemble_done", deptId, verdict, summary });
    return { drafts, synthesis, verdict, summary };
  }

  // 부분 실패(1-2개만 성공)도 상위에서 판단할 수 있도록 warn 로 기록. 흐름은 계속.
  if (validDrafts.length < drafts.length) {
    const partialFailures = drafts
      .filter((d) => d.error || d.text.trim().length === 0)
      .map((d) => ({ model: d.model, reason: d.error ?? "empty_response" }));
    logger.warn(
      { deptId, validCount: validDrafts.length, totalCount: drafts.length, partialFailures },
      "[Ensemble] 일부 모델 draft 실패 — 나머지 모델로 통합 진행"
    );
  }

  try {
    const synthPrompt = [
      `Task 목표: ${objective}`,
      "",
      "─── Claude Opus 4.6 ───",
      claudeRes.text.slice(0, 2000) || "(응답 없음)",
      "",
      "─── GPT-5.4-pro ───",
      gptRes.text.slice(0, 2000) || "(응답 없음)",
      "",
      "─── Gemini 3.1 Pro Ultra ───",
      geminiRes.text.slice(0, 2000) || "(응답 없음)",
      "",
      "위 3개 분석을 통합하세요.",
    ].join("\n");

    const wrappers = await import("../adapters/wrappers.js");
    const synthText = await wrappers.callClaude(ENSEMBLE_SYNTH_PROMPT, synthPrompt, 2000);
    const parsed = tryParseJson(synthText);

    if (parsed) {
      verdict = typeof parsed.verdict === "string" ? parsed.verdict : "consensus";
      summary = typeof parsed.summary === "string" ? parsed.summary : summary;
      synthesis = synthText;
    } else {
      synthesis = synthText || validDrafts.map((d) => d.text).join("\n\n");
    }
  } catch (err) {
    logger.warn({ err, deptId }, "[Ensemble] 통합 실패 — 첫 draft fallback");
    synthesis = validDrafts[0].text;
    verdict = "consensus";
    summary = `${deptId} 통합 — 통합 모델 호출 실패, ${validDrafts[0].model} draft 채택`;
  }

  send({ type: "ensemble_done", deptId, verdict, summary });
  return { drafts, synthesis, verdict, summary };
}
