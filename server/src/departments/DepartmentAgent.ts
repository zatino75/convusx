/**
 * DepartmentAgent.ts
 * 부서별 자율 실행 에이전트 — DeptTask를 받아 AI + 커넥터로 실행하고 DeptReport를 반환
 */

import type { DeptTask, DeptId } from '../director/TaskDecomposer.js';
import type { DeptReport } from '../director/ProjectSession.js';
import { getDept } from './DepartmentRegistry.js';
import type { DeptConfig } from './DepartmentRegistry.js';
import { estimateCostUsd } from '../cost/costCalc.js';
import type { ModelUsage } from '../adapters/types.js';

export type ProgressCallback = (deptId: DeptId, message: string, percent: number) => void;

export interface AgentRunOptions {
  sessionId: string;
  roundNumber: number;
  onProgress?: ProgressCallback;
  availableConnectors?: Set<string>;  // 현재 연결된 커넥터 ID 목록
}

export interface AgentRunResult {
  report: DeptReport;
  tokensUsed: number;
  modelUsed: string;
  connectorsUsed: string[];
  durationMs: number;
  /** 주요 AI 모델 호출 비용 (USD). MODEL_PRICING_USD_PER_1K_TOKENS 기반 추정. */
  costUsd: number;
}

// ─── AI 어댑터 — wrappers.ts 의 detailed 변형을 dynamic import 로 사용.
// 주요 AI 호출 결과는 toks·modelId 와 함께 돌려받아 비용을 계산한다.

type DetailedCall = { text: string; usage: ModelUsage; model: string };

async function callClaudeDetailed(systemPrompt: string, userPrompt: string, maxTokens: number, thinkingBudget?: number): Promise<DetailedCall> {
  const { callClaudeDetailed: _call } = await import('../adapters/wrappers.js');
  return _call(systemPrompt, userPrompt, maxTokens, thinkingBudget);
}

async function callOpenAIDetailed(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<DetailedCall> {
  const { callOpenAIDetailed: _call } = await import('../adapters/wrappers.js');
  return _call(systemPrompt, userPrompt, maxTokens);
}

async function callGeminiDetailed(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<DetailedCall> {
  const { callGeminiDetailed: _call } = await import('../adapters/wrappers.js');
  return _call(systemPrompt, userPrompt, maxTokens);
}

async function callPerplexity(query: string, maxTokens: number): Promise<string> {
  const { callPerplexity: _call } = await import('../adapters/wrappers.js');
  return _call(query, maxTokens);
}

function clampConfidence(value: unknown, fallback = 0.7): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}

function pickList(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, max);
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = codeBlock?.[1] ?? text.match(/(\{[\s\S]*\})/)?.[1] ?? '';
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseStructuredOutput(rawText: string, task: DeptTask): DeptReport['structured'] | null {
  const parsed = extractJsonObject(rawText);
  if (!parsed) return null;

  const summary = String(parsed.summary ?? '').trim();
  const keyFindings = pickList(parsed.key_findings ?? parsed.keyFindings, 10);
  const risks = pickList(parsed.risks, 8);
  const assumptions = pickList(parsed.assumptions, 8);
  const needsFollowup = pickList(parsed.needs_followup ?? parsed.needsFollowup, 8);
  const citations = pickList(parsed.citations ?? parsed.sources, 10);
  const confidence = clampConfidence(parsed.confidence, 0.72);

  if (!summary && keyFindings.length === 0 && risks.length === 0) return null;

  return {
    summary: summary || `${task.deptId.toUpperCase()} 분석 요약`,
    keyFindings,
    risks,
    assumptions,
    needsFollowup,
    confidence,
    citations: citations.length > 0 ? citations : undefined,
  };
}

// ─── 커넥터 호출 헬퍼 ─────────────────────────────────────────────────────────
async function runConnector(connectorId: string, query: string): Promise<string> {
  try {
    switch (connectorId) {
      case 'tavily': {
        const { callTavily } = await import('../connectors/tavily.js');
        return await callTavily(query);
      }
      case 'perplexity': {
        return await callPerplexity(query, 2000);
      }
      case 'posthog': {
        const { callPostHog } = await import('../connectors/posthog.js');
        return await callPostHog(query);
      }
      case 'pubmed': {
        const { callPubMed } = await import('../connectors/pubmed.js');
        return await callPubMed(query);
      }
      case 'supabase': {
        const { callSupabase } = await import('../connectors/supabase.js');
        return await callSupabase(query);
      }
      default:
        return `[${connectorId} 커넥터: 데이터 수집 완료]`;
    }
  } catch (e) {
    return `[${connectorId} 커넥터 오류: ${e instanceof Error ? e.message : '알 수 없는 오류'}]`;
  }
}

// ─── 사전 조사 단계 ───────────────────────────────────────────────────────────
async function runPreResearch(
  task: DeptTask,
  dept: DeptConfig,
  available: Set<string>,
  onProgress?: ProgressCallback
): Promise<{ data: string; connectorsUsed: string[] }> {
  const connectors = dept.connectors ?? dept.connectorPriority.map((id) => ({
    id,
    name: id.toUpperCase(),
    purpose: '사전 조사',
    required: false,
  }));

  const connectorsUsed: string[] = [];
  const parts: string[] = [];

  onProgress?.(task.deptId, '사전 조사 중...', 10);

  // 필수 커넥터 우선 실행
  const required = connectors.filter((c) => c.required && available.has(c.id));
  const optional = connectors.filter((c) => !c.required && available.has(c.id));
  const toRun = [...required, ...optional].slice(0, 3); // 최대 3개 커넥터 병렬

  if (toRun.length === 0) {
    // 커넥터 없으면 Perplexity로 웹 조사
    const query = `${task.objective} - ${task.context}`;
    const result = await callPerplexity(query, 1500).catch(() => '');
    if (result) {
      parts.push(`[웹 조사 결과]\n${result}`);
      connectorsUsed.push('perplexity');
    }
  } else {
    const results = await Promise.allSettled(
      toRun.map(async c => {
        const query = `${task.objective} 관련 ${c.purpose}: ${task.context}`;
        const result = await runConnector(c.id, query);
        return { id: c.id, name: c.name, result };
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        parts.push(`[${r.value.name} 데이터]\n${r.value.result}`);
        connectorsUsed.push(r.value.id);
      }
    }
  }

  return { data: parts.join('\n\n'), connectorsUsed };
}

// ─── AI 모델 선택 및 호출 ─────────────────────────────────────────────────────
async function callPrimaryModel(
  dept: DeptConfig,
  systemPrompt: string,
  userPrompt: string,
  onProgress?: ProgressCallback,
  deptId?: DeptId
): Promise<{ text: string; model: string; usage: ModelUsage; modelIdForPricing: string }> {
  const model = dept.primaryModel;

  if (deptId) onProgress?.(deptId, `${model} 분석 중...`, 50);

  const route = async (
    m: string,
    thinkingBudget?: number
  ): Promise<{ text: string; usage: ModelUsage; modelIdForPricing: string }> => {
    if (m.startsWith('claude')) {
      const r = await callClaudeDetailed(systemPrompt, userPrompt, dept.maxTokens, thinkingBudget);
      return { text: r.text, usage: r.usage, modelIdForPricing: r.model };
    }
    if (m.startsWith('gpt') || m.startsWith('o')) {
      const r = await callOpenAIDetailed(systemPrompt, userPrompt, dept.maxTokens);
      return { text: r.text, usage: r.usage, modelIdForPricing: r.model };
    }
    if (m.startsWith('gemini')) {
      const r = await callGeminiDetailed(systemPrompt, userPrompt, dept.maxTokens);
      return { text: r.text, usage: r.usage, modelIdForPricing: r.model };
    }
    // 미지원 prefix → Claude fallback
    const r = await callClaudeDetailed(systemPrompt, userPrompt, dept.maxTokens);
    return { text: r.text, usage: r.usage, modelIdForPricing: r.model };
  };

  try {
    const r = await route(model, dept.thinkingBudget);
    return { text: r.text, model, usage: r.usage, modelIdForPricing: r.modelIdForPricing };
  } catch (err) {
    if (dept.fallbackModel) {
      if (deptId) onProgress?.(deptId, `${dept.fallbackModel}로 재시도 중...`, 55);
      try {
        const r = await route(dept.fallbackModel);
        return {
          text: r.text,
          model: `${dept.fallbackModel} (fallback)`,
          usage: r.usage,
          modelIdForPricing: r.modelIdForPricing,
        };
      } catch {
        // fallback도 실패 → 원래 에러 전파
      }
    }
    throw err;
  }
}

// ─── AI 응답 → DeptReport 파싱 ────────────────────────────────────────────────
function parseReportFromText(text: string, task: DeptTask): DeptReport {
  const structured = parseStructuredOutput(text, task);
  if (structured) {
    const sections: DeptReport['sections'] = [
      { heading: '핵심 결론', items: [structured.summary] },
      ...(structured.keyFindings.length > 0 ? [{ heading: '핵심 근거', items: structured.keyFindings }] : []),
      ...(structured.risks.length > 0 ? [{ heading: '리스크', items: structured.risks }] : []),
      ...(structured.assumptions.length > 0 ? [{ heading: '가정', items: structured.assumptions }] : []),
      ...(structured.needsFollowup.length > 0 ? [{ heading: '추가 확인', items: structured.needsFollowup }] : []),
    ];

    return {
      title: `[${task.deptId.toUpperCase()}] ${task.objective}`,
      sections,
      confidence: structured.confidence,
      sources: structured.citations,
      structured,
    };
  }

  // 섹션을 ## 또는 **헤딩** 기준으로 파싱
  const lines = text.split('\n');
  const sections: DeptReport['sections'] = [];
  let currentHeading = '';
  let currentItems: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // ## 헤딩 또는 **굵은** 헤딩 감지
    const headingMatch = trimmed.match(/^#{1,3}\s+(.+)$/) || trimmed.match(/^\*\*(.+)\*\*$/);
    if (headingMatch) {
      if (currentHeading && currentItems.length > 0) {
        sections.push({ heading: currentHeading, items: [...currentItems] });
      }
      currentHeading = headingMatch[1];
      currentItems = [];
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('• ') || trimmed.match(/^\d+\.\s/)) {
      // 리스트 아이템
      const item = trimmed.replace(/^[-•]\s+/, '').replace(/^\d+\.\s+/, '');
      if (item) currentItems.push(item);
    } else if (currentHeading) {
      // 일반 텍스트는 현재 섹션 아이템으로
      if (trimmed.length > 10) currentItems.push(trimmed);
    }
  }

  // 마지막 섹션 추가
  if (currentHeading && currentItems.length > 0) {
    sections.push({ heading: currentHeading, items: currentItems });
  }

  // 파싱 결과가 없으면 전체 텍스트를 단일 섹션으로
  if (sections.length === 0) {
    const allItems = lines
      .filter(l => l.trim().length > 10)
      .map(l => l.trim())
      .slice(0, 20);
    sections.push({ heading: task.deliverable, items: allItems });
  }

  // confidence는 섹션 수와 아이템 수 기반 휴리스틱
  const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);
  const confidence = Math.min(0.95, 0.5 + totalItems * 0.02 + sections.length * 0.05);

  return {
    title: `[${task.deptId.toUpperCase()}] ${task.objective}`,
    sections,
    confidence,
  };
}

// ─── 메인 실행 함수 ───────────────────────────────────────────────────────────
export async function runDepartmentAgent(
  task: DeptTask,
  options: AgentRunOptions
): Promise<AgentRunResult> {
  const startTime = Date.now();
  const dept = getDept(task.deptId);
  if (!dept) throw new Error(`부서 설정 없음: ${task.deptId}`);

  const available = options.availableConnectors ?? new Set<string>();
  const { onProgress } = options;

  onProgress?.(task.deptId, '부서 활성화...', 5);

  // ① 사전 조사 (커넥터 또는 Perplexity)
  const { data: preResearchData, connectorsUsed } = await runPreResearch(
    task,
    dept,
    available,
    onProgress
  );

  onProgress?.(task.deptId, 'AI 분석 준비 중...', 35);

  // ② 분석 프롬프트 구성
  const userPrompt = buildUserPrompt(task, preResearchData);

  // ③ 주요 AI 모델 호출
  const {
    text: rawOutput,
    model: modelUsed,
    usage,
    modelIdForPricing,
  } = await callPrimaryModel(
    dept,
    dept.systemPrompt,
    userPrompt,
    onProgress,
    task.deptId
  );

  onProgress?.(task.deptId, '보고서 작성 중...', 85);

  // ④ 결과 파싱 → DeptReport
  const report = parseReportFromText(rawOutput, task);

  // ⑤ 비용 계산 (MODEL_PRICING_USD_PER_1K_TOKENS 기반). usage 미수집 시 0.
  const costUsd = estimateCostUsd(modelIdForPricing, usage);

  // tokensUsed 는 usage 실측값(있으면) 우선, 없으면 문자 길이 기반 추정
  const actualTokens =
    (usage.input_tokens ?? usage.prompt_tokens ?? 0) +
    (usage.output_tokens ?? usage.completion_tokens ?? 0);
  const tokensUsed = actualTokens > 0 ? actualTokens : estimateTokens(userPrompt + rawOutput);

  onProgress?.(task.deptId, '완료', 100);

  return {
    report,
    tokensUsed,
    modelUsed,
    connectorsUsed,
    durationMs: Date.now() - startTime,
    costUsd,
  };
}

// ─── 사용자 프롬프트 빌더 ─────────────────────────────────────────────────────
function buildUserPrompt(task: DeptTask, preResearchData: string): string {
  return `
## 부서 임무
**목표**: ${task.objective}
**배경**: ${task.context}
**기대 산출물**: ${task.deliverable}
**우선순위**: ${task.priority}

${preResearchData ? `## 사전 조사 데이터\n${preResearchData}\n` : ''}

## 요청
위 임무와 데이터를 바탕으로 전문가 수준의 분석을 수행하고, 아래 JSON 스키마로만 응답하라.
{
  "summary": "핵심 요약 2~3문장",
  "key_findings": ["핵심 근거"],
  "risks": ["핵심 리스크"],
  "assumptions": ["가정"],
  "needs_followup": ["추가 확인 필요 항목"],
  "confidence": 0.0,
  "citations": ["출처 또는 데이터 근거"]
}

규칙:
- confidence는 0~1 숫자
- key_findings/risks/assumptions/needs_followup는 각각 최대 8개
- 근거가 불충분하면 needs_followup에 명시
- JSON 외 설명 텍스트는 금지
`.trim();
}

// ─── 토큰 추정 (정밀하지 않지만 빠름) ────────────────────────────────────────
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
