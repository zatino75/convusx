/**
 * EnsembleRunner.ts
 * 3-AI 병렬 앙상블 — Claude Opus 4.6 / GPT-5.4-pro / Gemini 2.5 Pro
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

/** 고가치 부서 식별 — 2026-04-17: 앙상블 대상을 legal/finance 2개로 축소.
 *  사유: 3-AI 병렬 호출 비용/지연 최소화. 타 부서는 단독 모델 + 상무 검토로 충분. */
export const HIGH_VALUE_DEPTS: ReadonlySet<DeptId> = new Set<DeptId>([
  "legal",
  "finance",
] as DeptId[]);

/** 고가치 task 감지 — 2026-04-17: HIGH_VALUE_DEPTS 에 속한 부서만 앙상블 발동. */
export function detectHighValue(_directive: string, deptId: DeptId): boolean {
  return HIGH_VALUE_DEPTS.has(deptId);
}

// Ensemble Synth(3-AI 통합 합성) 는 2026-04-17 구조에서 제거되었다.
// 3개 모델의 원본 draft 를 상무(CriticReview) / CEO(CeoBriefing) 가 직접 판단한다.

// Promise timeout helper (외부 AbortController 와 무관하게 강제 종료)
function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

const PER_MODEL_TIMEOUT_MS = 60000;
const ENSEMBLE_TOTAL_TIMEOUT_MS = 90000;

async function callOne(
  model: "claude" | "gpt" | "gemini",
  systemPrompt: string,
  userPrompt: string,
): Promise<{ text: string; durationMs: number; error?: string }> {
  const start = Date.now();
  try {
    const wrappers = await import("../adapters/wrappers.js");
    const task = (async () => {
      if (model === "claude") return wrappers.callClaude(systemPrompt, userPrompt, 3000);
      if (model === "gpt")    return wrappers.callOpenAI(systemPrompt, userPrompt, 3000);
      return wrappers.callGemini(systemPrompt, userPrompt, 3000);
    })();
    const text = await withDeadline(task, PER_MODEL_TIMEOUT_MS, `ensemble_${model}`);
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

  // 3개 모델을 진짜 병렬로 호출 — 전체 90s 상한
  const all = Promise.all([
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

  let claudeRes: { text: string; durationMs: number; error?: string };
  let gptRes: { text: string; durationMs: number; error?: string };
  let geminiRes: { text: string; durationMs: number; error?: string };
  try {
    [claudeRes, gptRes, geminiRes] = await withDeadline(all, ENSEMBLE_TOTAL_TIMEOUT_MS, "ensemble_total");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, deptId }, "[Ensemble] 전체 타임아웃 — low_confidence");
    send({ type: "ensemble_done", deptId, verdict: "low_confidence", summary: `3-AI 앙상블 타임아웃 (${msg})` });
    return {
      drafts: [
        { model: MODEL_LABEL.claude, text: "", durationMs: ENSEMBLE_TOTAL_TIMEOUT_MS, error: "total_timeout" },
        { model: MODEL_LABEL.gpt,    text: "", durationMs: ENSEMBLE_TOTAL_TIMEOUT_MS, error: "total_timeout" },
        { model: MODEL_LABEL.gemini, text: "", durationMs: ENSEMBLE_TOTAL_TIMEOUT_MS, error: "total_timeout" },
      ],
      synthesis: "",
      verdict: "low_confidence",
      summary: "3-AI 앙상블 전체 타임아웃",
    };
  }

  const drafts = [
    { model: MODEL_LABEL.claude, ...claudeRes },
    { model: MODEL_LABEL.gpt, ...gptRes },
    { model: MODEL_LABEL.gemini, ...geminiRes },
  ];

  const validDrafts = drafts.filter((d) => !d.error && d.text.trim().length > 0);
  let verdict = "consensus";
  let summary = `${deptId} 부서 3-AI 병렬 분석 완료 (${validDrafts.length}/3)`;
  let synthesis = "";

  if (validDrafts.length === 0) {
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

  if (validDrafts.length < drafts.length) {
    const partialFailures = drafts
      .filter((d) => d.error || d.text.trim().length === 0)
      .map((d) => ({ model: d.model, reason: d.error ?? "empty_response" }));
    logger.warn(
      { deptId, validCount: validDrafts.length, totalCount: drafts.length, partialFailures },
      "[Ensemble] 일부 모델 draft 실패 — 나머지 모델로 그대로 전달"
    );
    verdict = "split";
  }

  // Ensemble Synth 제거 (2026-04-17) — 3-AI 결과를 그대로 합쳐 반환.
  // 각 모델의 원본 draft 를 상무/CEO 층이 직접 판단하도록 한다.
  synthesis = validDrafts
    .map((d) => `─── ${d.model} ───\n${d.text}`)
    .join("\n\n");

  send({ type: "ensemble_done", deptId, verdict, summary });
  return { drafts, synthesis, verdict, summary };
}
