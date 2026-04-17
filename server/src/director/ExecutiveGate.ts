/**
 * ExecutiveGate.ts — 상무 게이트키퍼
 *
 * 유저 지시를 Claude Sonnet 이 받아 단순/복잡 판단 + 부서 선별 + 맞춤 지시 생성.
 * Director / single-agent 분기의 단일 진입점.
 *
 * Primary : claude-sonnet-4-6, max_tokens 800, 20s
 * Fallback: gpt-5.4-pro, max_tokens 800, 15s
 *
 * 양쪽 실패 시: { action: 'single_agent', departments: [], reason: 'gate_error' }
 */

import type { DeptId } from './TaskDecomposer.js';
import { logger } from '../observability/logger.js';

export type GateDomain = 'ecig' | 'food' | 'cosmetic' | 'general';

export interface GateDepartment {
  id: DeptId;
  instruction: string;
}

export interface ExecutiveGateResult {
  complexity: 'simple' | 'complex';
  action: 'single_agent' | 'director';
  departments: GateDepartment[];
  reason: string;
}

const PRIMARY_TIMEOUT_MS = 20000;
const FALLBACK_TIMEOUT_MS = 15000;
const MAX_TOKENS = 800;
const MAX_DEPTS = 5;

const ALL_DEPT_IDS: DeptId[] = [
  'market', 'compete', 'legal', 'finance',
  'marketing', 'rnd', 'data', 'content', 'sns',
];

function buildSystemPrompt(): string {
  return `당신은 CORVUS X의 상무입니다.
사용자 지시를 분석해서 업무를 배분합니다.

사용 가능한 부서:
- market: 시장규모/트렌드/소비자
- compete: 경쟁사/포지셔닝
- legal: 법규/규제/인허가
- finance: 재무/투자/수익
- marketing: 브랜드/마케팅
- rnd: 제품개발/성분/레시피
- data: 검색트렌드/리뷰데이터
- content: 콘텐츠기획
- sns: SNS전략

판단:
1. 단순 질문/정보 요청 → single_agent
2. 전략/개발/다각도 검토 → director (최대 ${MAX_DEPTS}개 부서)
3. 각 부서 지시는 원문 그대로 말고 해당 부서에 맞게 구체적으로 재가공

JSON만 반환 (다른 텍스트 금지):
{
  "complexity": "simple" 또는 "complex",
  "action": "single_agent" 또는 "director",
  "departments": [{"id": "market", "instruction": "시장 규모와 ... 조사"}],
  "reason": "판단 이유"
}`;
}

function buildUserPrompt(directive: string, domain: GateDomain): string {
  return `지시: ${directive}\n도메인: ${domain}`;
}

function tryParseJson(text: string): Record<string, unknown> | null {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = codeBlock?.[1] ?? text.match(/(\{[\s\S]*\})/)?.[1] ?? '';
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

function normalizeDepartments(raw: unknown): GateDepartment[] {
  if (!Array.isArray(raw)) return [];
  const out: GateDepartment[] = [];
  const seen = new Set<DeptId>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = String((item as any).id ?? '').trim().toLowerCase() as DeptId;
    if (!ALL_DEPT_IDS.includes(id) || seen.has(id)) continue;
    const instruction = String((item as any).instruction ?? '').trim();
    if (!instruction) continue;
    out.push({ id, instruction: instruction.slice(0, 1200) });
    seen.add(id);
    if (out.length >= MAX_DEPTS) break;
  }
  return out;
}

function normalizeGateResult(parsed: Record<string, unknown>): ExecutiveGateResult | null {
  const rawAction = String(parsed.action ?? '').trim().toLowerCase();
  const rawComplexity = String(parsed.complexity ?? '').trim().toLowerCase();
  const departments = normalizeDepartments(parsed.departments);
  const reason = String(parsed.reason ?? '').trim().slice(0, 400);

  const action: ExecutiveGateResult['action'] =
    rawAction === 'director' ? 'director' : 'single_agent';
  const complexity: ExecutiveGateResult['complexity'] =
    rawComplexity === 'complex' ? 'complex' : 'simple';

  // director 로 판정했는데 부서가 0개면 의미 없음 → single_agent 로 강등
  if (action === 'director' && departments.length === 0) {
    return {
      complexity: 'simple',
      action: 'single_agent',
      departments: [],
      reason: reason || 'director_no_departments_fallback',
    };
  }

  return { complexity, action, departments, reason: reason || 'gate_ok' };
}

// ─── Primary: Claude Sonnet 4.6 ─────────────────────────────────────────────
async function callClaudePrimary(systemPrompt: string, userPrompt: string): Promise<string | null> {
  const apiKey = String((globalThis as any)?.process?.env?.ANTHROPIC_API_KEY ?? '').trim();
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PRIMARY_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, '[ExecutiveGate] Claude primary 응답 실패');
      return null;
    }
    const data: any = await res.json();
    return Array.isArray(data?.content)
      ? data.content.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('').trim()
      : '';
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[ExecutiveGate] Claude primary 호출 오류');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Fallback: GPT-5.4-pro ──────────────────────────────────────────────────
async function callOpenAIFallback(systemPrompt: string, userPrompt: string): Promise<string | null> {
  const apiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? '').trim();
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FALLBACK_TIMEOUT_MS);
  try {
    const { OPENAI_BASE } = await import('../config/defaults.js');
    const res = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5.4-pro',
        max_tokens: MAX_TOKENS,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, '[ExecutiveGate] GPT fallback 응답 실패');
      return null;
    }
    const data: any = await res.json();
    const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
    const content = choice?.message?.content;
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
      return content.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).filter(Boolean).join('\n').trim();
    }
    return '';
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[ExecutiveGate] GPT fallback 호출 오류');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function runExecutiveGate(
  directive: string,
  domain: GateDomain,
): Promise<ExecutiveGateResult> {
  const trimmed = String(directive ?? '').trim();
  if (!trimmed) {
    return { complexity: 'simple', action: 'single_agent', departments: [], reason: 'empty_directive' };
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(trimmed, domain);

  // Primary
  const primaryText = await callClaudePrimary(systemPrompt, userPrompt);
  if (primaryText) {
    const parsed = tryParseJson(primaryText);
    if (parsed) {
      const normalized = normalizeGateResult(parsed);
      if (normalized) return normalized;
    }
    logger.warn('[ExecutiveGate] Claude primary 결과 파싱 실패 → GPT fallback');
  }

  // Fallback
  const fallbackText = await callOpenAIFallback(systemPrompt, userPrompt);
  if (fallbackText) {
    const parsed = tryParseJson(fallbackText);
    if (parsed) {
      const normalized = normalizeGateResult(parsed);
      if (normalized) return normalized;
    }
  }

  logger.warn('[ExecutiveGate] 양쪽 모두 실패 → single_agent fallback');
  return { complexity: 'simple', action: 'single_agent', departments: [], reason: 'gate_error' };
}
