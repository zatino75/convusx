/**
 * EnsembleRunner.ts
 * 3-AI 병렬 앙상블 — Claude Opus 4.6 / GPT-5.4-pro / Gemini 2.5 Pro
 *
 * 고가치 task(legal / finance) 에서 DirectorAgent 가 부서 에이전트 호출 직전에
 * 호출한다. 3개 모델을 동시 호출 → 각각의 draft 를 ensemble_voice 이벤트로
 * 스트리밍 → confidence 산출 → similarity 기반 consensus 판단 → uniqueInsights
 * 추출 → Claude 통합 synthesis → ensemble_done 이벤트.
 *
 * 2026-04-18 품질 고도화:
 *  A) 각 draft confidence (길이/구조/수치/헤지 표현 기반 휴리스틱)
 *  B) 페어와이즈 Jaccard similarity → consensus / split / contradictory
 *  C) uniqueInsights — 다른 모델 토큰 집합에 없는 핵심 명사구 추출
 *  D) 통합 synthesis — Claude 가 4가지 규칙(불일치 섹션 / 주목할 관점 / 액션 ≥3 / 한국어)으로 작성
 */

import type { DeptId } from "./TaskDecomposer.js";
import { logger } from "../observability/logger.js";
import { GEMINI_DISPLAY_LABEL } from "../adapters/gemini.js";

export interface DraftQuality {
  confidence: number;        // 0.0 ~ 1.0 — 휴리스틱 점수
  charLen: number;
  hedgeCount: number;
  numericHits: number;
  uniqueInsights: string[];  // 다른 두 모델에 없는 명사구 (최대 5개)
}

export interface EnsembleDraft {
  model: string;
  text: string;
  durationMs: number;
  error?: string;
  quality?: DraftQuality;
}

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
  confidence?: number;
}

export interface EnsembleResult {
  drafts: EnsembleDraft[];
  synthesis: string;        // Claude 통합본 (마크다운)
  verdict: string;          // consensus | split | contradictory | low_confidence
  summary: string;          // ensemble_done 에 실리는 짧은 헤드라인 (한 줄)
  similarity: number;       // 평균 Jaccard 유사도
}

export const HIGH_VALUE_DEPTS: ReadonlySet<DeptId> = new Set<DeptId>([
  "legal",
  "finance",
] as DeptId[]);

export function detectHighValue(_directive: string, deptId: DeptId): boolean {
  return HIGH_VALUE_DEPTS.has(deptId);
}

// ─── Promise timeout 헬퍼 ────────────────────────────────────────────────────
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
const SYNTHESIS_TIMEOUT_MS = 30000;

// ─── 모델 호출 ──────────────────────────────────────────────────────────────
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

const MODEL_LABEL: Record<string, string> = {
  claude: "claude-opus-4-6",
  gpt: "gpt-5.4-pro",
  gemini: GEMINI_DISPLAY_LABEL,
};

// ─── A) confidence 휴리스틱 ──────────────────────────────────────────────────
// 길이 / 구조 / 수치 / 헤지(불확실) 표현으로 0~1 점수 산출
const HEDGE_PATTERNS = [
  /아마/g, /것\s*같다/g, /것\s*같습니다/g, /추측/g, /불확실/g, /확실하지\s*않/g,
  /어쩌면/g, /가능\s*성도/g, /모르겠/g, /추정/g,
  /\bmay\b/gi, /\bmight\b/gi, /\bpossibly\b/gi, /\bperhaps\b/gi,
  /\bunclear\b/gi, /\bunsure\b/gi, /\bI think\b/gi, /\bI believe\b/gi,
];

function scoreConfidence(text: string): DraftQuality {
  const trimmed = (text ?? "").trim();
  const charLen = trimmed.length;

  // 헤지 표현 카운트
  let hedgeCount = 0;
  for (const re of HEDGE_PATTERNS) {
    const m = trimmed.match(re);
    if (m) hedgeCount += m.length;
  }

  // 수치/% 포함 횟수 (정량 근거 가산)
  const numericMatches = trimmed.match(/\d+(?:[.,]\d+)?\s*(?:%|원|만원|억|천|개|건|명|위|배|시간|일|월|년|kg|m|cm|mm)?/g) ?? [];
  const numericHits = numericMatches.length;

  // 구조 마커 (-, **, ##, |) 횟수 — 정리된 응답 가산
  const structureHits =
    (trimmed.match(/^[-*]\s/gm)?.length ?? 0) +
    (trimmed.match(/^#{1,4}\s/gm)?.length ?? 0) +
    (trimmed.match(/\*\*[^*]+\*\*/g)?.length ?? 0);

  // 점수 산출
  let score = 0.5;
  // 길이: 200자 +0.10, 600자 +0.20 (cap)
  score += Math.min(0.20, (charLen / 200) * 0.10);
  // 수치: 회당 +0.04 (cap +0.16)
  score += Math.min(0.16, numericHits * 0.04);
  // 구조: 회당 +0.02 (cap +0.10)
  score += Math.min(0.10, structureHits * 0.02);
  // 헤지: 회당 -0.07 (cap -0.25)
  score -= Math.min(0.25, hedgeCount * 0.07);

  // 빈 응답이면 0
  if (charLen === 0) score = 0;

  return {
    confidence: Math.max(0, Math.min(1, Math.round(score * 100) / 100)),
    charLen,
    hedgeCount,
    numericHits,
    uniqueInsights: [],
  };
}

// ─── B) 토큰화 + Jaccard 유사도 ──────────────────────────────────────────────
// 한국어/영문 혼합을 단순 토큰화 — 길이 2 이상 한글/영문 단어
function tokenize(text: string): Set<string> {
  const tokens = (text || "").toLowerCase()
    .replace(/[^\w\s가-힣]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function pairwiseAvgSim(tokenSets: Set<string>[]): number {
  if (tokenSets.length < 2) return 1;
  let sum = 0, n = 0;
  for (let i = 0; i < tokenSets.length; i++) {
    for (let j = i + 1; j < tokenSets.length; j++) {
      sum += jaccard(tokenSets[i], tokenSets[j]);
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}

function similarityToVerdict(sim: number, validCount: number, totalCount: number): string {
  if (validCount === 0) return "low_confidence";
  if (validCount < totalCount) return "split";
  if (sim >= 0.40) return "consensus";
  if (sim >= 0.20) return "split";
  return "contradictory";
}

// ─── C) uniqueInsights — 다른 모델에 없는 명사구 ────────────────────────────
// 단순 휴리스틱: 본인 빈도 ≥ 2 && 다른 두 모델 토큰셋에 없음
function extractUniqueInsights(
  texts: string[],
  tokenSets: Set<string>[],
  topN = 5
): string[][] {
  const result: string[][] = [];
  for (let i = 0; i < texts.length; i++) {
    const own = (texts[i] || "").toLowerCase()
      .replace(/[^\w\s가-힣]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2);

    const ownFreq: Record<string, number> = {};
    for (const t of own) ownFreq[t] = (ownFreq[t] ?? 0) + 1;

    const others = new Set<string>();
    for (let j = 0; j < tokenSets.length; j++) {
      if (i === j) continue;
      for (const t of tokenSets[j]) others.add(t);
    }

    const candidates = Object.entries(ownFreq)
      .filter(([t, f]) => f >= 2 && !others.has(t))
      .filter(([t]) => !STOPWORDS.has(t))
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([t]) => t);

    result.push(candidates);
  }
  return result;
}

const STOPWORDS = new Set<string>([
  "있다", "없다", "한다", "하는", "위한", "위해", "통해", "또한", "그리고", "하지만",
  "the", "and", "for", "with", "from", "this", "that", "which", "have", "has",
  "are", "was", "were", "will", "can", "should", "would", "could", "may", "might",
  "분석", "결과", "기반", "제시", "내용", "필요", "경우", "가능", "관련", "대한",
]);

// ─── D) 통합 synthesis 프롬프트 ──────────────────────────────────────────────
function buildSynthesisPrompt(
  deptId: DeptId,
  objective: string,
  drafts: EnsembleDraft[],
  similarity: number
): { system: string; user: string } {
  const system = `당신은 CORVUS X Director 산하 ${deptId} 부서 통합 분석가입니다.
3-AI(Claude / GPT / Gemini)가 동일 task에 대해 작성한 draft를 받아, 사용자에게 보여줄 통합 보고서를 한국어 마크다운으로 작성합니다.

규칙:
1. contradictions(서로 충돌하는 주장)이 있으면 반드시 "## ⚠️ 모델 간 의견 불일치" 섹션을 작성하고 어떤 모델이 어떤 주장을 했는지 명시
2. uniqueInsights(한 모델만 제기한 관점)이 있으면 "## 💡 주목할 관점" 섹션으로 표시
3. recommendation은 반드시 구체적인 액션 아이템 3개 이상 (## 🎯 핵심 권고)
4. 모든 응답은 한국어. 표(|...|) 와 불릿(-) 을 적극 활용해 가독성을 높일 것
5. 통합 결론(## 통합 결론)은 2~3문장으로 짧고 명확하게
6. 빈 섹션 금지. 해당 항목이 없으면 그 섹션 자체를 출력하지 말 것 (단, "통합 결론"과 "핵심 권고"는 필수)`;

  const draftBlocks = drafts.map((d) => {
    const q = d.quality;
    const confLabel = q ? `confidence=${q.confidence.toFixed(2)}` : "";
    const insightsLabel = q && q.uniqueInsights.length > 0
      ? `unique=[${q.uniqueInsights.join(", ")}]`
      : "";
    const errorLabel = d.error ? `(오류: ${d.error.slice(0, 60)})` : "";
    return `### ${d.model} ${confLabel} ${insightsLabel} ${errorLabel}\n${d.text || "(빈 응답)"}`;
  }).join("\n\n");

  const user = `# 부서: ${deptId}
# 목표: ${objective}
# 평균 모델 유사도: ${similarity.toFixed(2)} (1.0=완전 일치, 0.0=완전 상이)

## 3-AI 원본 응답
${draftBlocks}

위 원본 draft를 기반으로 통합 보고서를 작성하세요. 4가지 규칙을 반드시 지키세요.`;

  return { system, user };
}

async function runSynthesis(
  deptId: DeptId,
  objective: string,
  drafts: EnsembleDraft[],
  similarity: number
): Promise<string> {
  const { system, user } = buildSynthesisPrompt(deptId, objective, drafts, similarity);
  try {
    const wrappers = await import("../adapters/wrappers.js");
    const task = wrappers.callClaude(system, user, 2000);
    const text = await withDeadline(task, SYNTHESIS_TIMEOUT_MS, "ensemble_synthesis");
    return (text || "").trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, deptId }, "[Ensemble] synthesis 실패 — fallback");
    // fallback: 원본 draft 단순 합치기
    return drafts.map((d) => `### ${d.model}\n${d.text || "(빈 응답)"}`).join("\n\n");
  }
}

// ─── 메인: runEnsemble ──────────────────────────────────────────────────────
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

  // 3개 모델 병렬 호출 (전체 90s 상한)
  const all = Promise.all([
    callOne("claude", systemPrompt, userPrompt).then((r) => {
      const q = scoreConfidence(r.text);
      send({
        type: "ensemble_voice",
        deptId,
        model: MODEL_LABEL.claude,
        message: r.error ? `[오류] ${r.error.slice(0, 80)}` : (r.text.slice(0, 120) || "(빈 응답)"),
        draft: r.text,
        durationMs: r.durationMs,
        confidence: q.confidence,
      });
      return { ...r, quality: q };
    }),
    callOne("gpt", systemPrompt, userPrompt).then((r) => {
      const q = scoreConfidence(r.text);
      send({
        type: "ensemble_voice",
        deptId,
        model: MODEL_LABEL.gpt,
        message: r.error ? `[오류] ${r.error.slice(0, 80)}` : (r.text.slice(0, 120) || "(빈 응답)"),
        draft: r.text,
        durationMs: r.durationMs,
        confidence: q.confidence,
      });
      return { ...r, quality: q };
    }),
    callOne("gemini", systemPrompt, userPrompt).then((r) => {
      const q = scoreConfidence(r.text);
      send({
        type: "ensemble_voice",
        deptId,
        model: MODEL_LABEL.gemini,
        message: r.error ? `[오류] ${r.error.slice(0, 80)}` : (r.text.slice(0, 120) || "(빈 응답)"),
        draft: r.text,
        durationMs: r.durationMs,
        confidence: q.confidence,
      });
      return { ...r, quality: q };
    }),
  ]);

  let claudeRes: { text: string; durationMs: number; error?: string; quality: DraftQuality };
  let gptRes:    { text: string; durationMs: number; error?: string; quality: DraftQuality };
  let geminiRes: { text: string; durationMs: number; error?: string; quality: DraftQuality };
  try {
    [claudeRes, gptRes, geminiRes] = await withDeadline(all, ENSEMBLE_TOTAL_TIMEOUT_MS, "ensemble_total");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, deptId }, "[Ensemble] 전체 타임아웃 — low_confidence");
    const summary = `3-AI 앙상블 타임아웃 (${msg})`;
    send({ type: "ensemble_done", deptId, verdict: "low_confidence", summary });
    return {
      drafts: [
        { model: MODEL_LABEL.claude, text: "", durationMs: ENSEMBLE_TOTAL_TIMEOUT_MS, error: "total_timeout" },
        { model: MODEL_LABEL.gpt,    text: "", durationMs: ENSEMBLE_TOTAL_TIMEOUT_MS, error: "total_timeout" },
        { model: MODEL_LABEL.gemini, text: "", durationMs: ENSEMBLE_TOTAL_TIMEOUT_MS, error: "total_timeout" },
      ],
      synthesis: "",
      verdict: "low_confidence",
      summary,
      similarity: 0,
    };
  }

  const drafts: EnsembleDraft[] = [
    { model: MODEL_LABEL.claude, ...claudeRes },
    { model: MODEL_LABEL.gpt,    ...gptRes },
    { model: MODEL_LABEL.gemini, ...geminiRes },
  ];

  const validDrafts = drafts.filter((d) => !d.error && d.text.trim().length > 0);

  if (validDrafts.length === 0) {
    const summary = "3-AI 모두 응답 실패 — 부서 단독 모델 fallback";
    logger.warn({ deptId, objective: objective.slice(0, 120) }, "[Ensemble] 3-AI 모두 유효 draft 생성 실패");
    send({ type: "ensemble_done", deptId, verdict: "low_confidence", summary });
    return { drafts, synthesis: summary, verdict: "low_confidence", summary, similarity: 0 };
  }

  // ─── B) similarity 계산 ─────────────────────────────────────────────────
  const tokenSets = validDrafts.map((d) => tokenize(d.text));
  const similarity = pairwiseAvgSim(tokenSets);
  const verdict = similarityToVerdict(similarity, validDrafts.length, drafts.length);

  // ─── C) uniqueInsights ─────────────────────────────────────────────────
  const insights = extractUniqueInsights(validDrafts.map((d) => d.text), tokenSets);
  validDrafts.forEach((d, i) => {
    if (d.quality) d.quality.uniqueInsights = insights[i] ?? [];
  });

  // ─── D) 통합 synthesis ─────────────────────────────────────────────────
  const synthesis = await runSynthesis(deptId, objective, drafts, similarity);

  // 헤드라인 — 한 줄 요약 (synthesis 의 "## 통합 결론" 다음 첫 문장 추출 시도)
  const headlineMatch = synthesis.match(/##\s*통합\s*결론\s*\n+([^\n#]+)/);
  const headline = headlineMatch
    ? headlineMatch[1].trim().slice(0, 120)
    : `${deptId} 3-AI 앙상블 ${verdict} (sim=${similarity.toFixed(2)}, ${validDrafts.length}/${drafts.length})`;

  const summary = headline;

  send({ type: "ensemble_done", deptId, verdict, summary });
  return { drafts, synthesis, verdict, summary, similarity };
}
