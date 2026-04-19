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

const PRIMARY_TIMEOUT_MS = 25000;
const FALLBACK_TIMEOUT_MS = 40000;  // 15s 는 adapter /v1/responses 경로에서 첫 호출 시 타임아웃
const MAX_TOKENS = 2500;            // 800 은 6-dept 한국어 JSON 중간에 잘림 (UTF-8 tokenization 비용)
const MAX_DEPTS = 6;

const ALL_DEPT_IDS: DeptId[] = [
  'market', 'compete', 'legal', 'finance',
  'marketing', 'rnd', 'data', 'content', 'sns', 'design',
];

function buildSystemPrompt(): string {
  return `당신은 CORVUS X의 상무입니다.
사용자 지시를 분석해서 업무를 배분합니다.

사용 가능한 부서 (10개):
- market: 시장조사, 트렌드, 시장규모, CAGR, 소비자 동향
- compete: 경쟁사 분석, 점유율 비교, 강약점, 벤치마킹
- legal: 법률 검토, 규제 확인, 담배사업법, 식약처, 인허가
- finance: 재무 분석, 비용 산출, 투자 수익률, 가격 전략
- marketing: 마케팅 전략 기획, 브랜드 포지셔닝, 캠페인 설계 (비주얼 제작 제외)
- rnd: 연구개발, 성분 분석, 레시피 설계, 식품/화장품 제조
- data: 데이터 분석, 감성 분석, KPI 추적, 매출 통계
- content: 콘텐츠 기획, 카피라이팅, 스크립트, 블로그, 기사 (비주얼 제작 제외)
- sns: SNS 채널 전략, 플랫폼별 운영, 게시 일정, 해시태그 (비주얼 제작 제외)
- design: 이미지 생성, 영상 제작, 3D 모델링, 스케치, 인테리어, 로고, 배너, 포스터, 패키지, 무드보드

협업 규칙:
- 비주얼 에셋(이미지/영상/3D/디자인/로고/배너/포스터/인테리어/무드보드)이 필요한 요청은 반드시 design 포함
- marketing + design: 마케팅 전략 + 크리에이티브 에셋
- content + design: 콘텐츠 기획 + 썸네일/배너
- sns + design: SNS 전략 + 게시물 이미지/영상
- rnd + design: 제품 개발 + 제품 컨셉 3D/스케치
- compete + design: 경쟁사 분석 + 비교 인포그래픽
비주얼 키워드 감지: 이미지, 사진, 영상, 동영상, 3D, 스케치, 디자인, 로고, 배너, 포스터, 인테리어, 패키지, 목업, 무드보드, 컨셉아트, 인포그래픽

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

// 균형잡힌 중괄호 스캐너 — 첫 번째 완전한 JSON 오브젝트를 추출.
// 문자열 내부의 중괄호는 무시, 이스케이프 처리.
function extractFirstJsonObject(text: string): string | null {
  const s = text;
  let i = 0;
  // 첫 { 찾기
  while (i < s.length && s[i] !== '{') i++;
  if (i >= s.length) return null;
  const start = i;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

function tryParseJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  // 1) <thinking> 블록 제거 (Claude extended thinking 흔적)
  let cleaned = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
  // 2) code block 우선
  const codeBlock = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates: string[] = [];
  if (codeBlock?.[1]) candidates.push(codeBlock[1].trim());
  // 3) 균형잡힌 추출
  const balanced = extractFirstJsonObject(cleaned);
  if (balanced) candidates.push(balanced);
  // 4) 마지막 수단: 전체 텍스트
  candidates.push(cleaned);
  for (const raw of candidates) {
    const attempts = [
      raw,
      // 트레일링 콤마 제거
      raw.replace(/,\s*([}\]])/g, '$1'),
      // 스마트 따옴표 → 일반 따옴표
      raw.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'"),
    ];
    for (const attempt of attempts) {
      try {
        const parsed = JSON.parse(attempt);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch { /* next */ }
    }
  }
  return null;
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

// ─── Fallback: GPT-5.4-pro (via main openaiAdapter → /v1/responses with chat fallback) ─
async function callOpenAIFallback(systemPrompt: string, userPrompt: string): Promise<string | null> {
  const apiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? '').trim();
  if (!apiKey) return null;

  try {
    const { callOpenAI } = await import('../adapters/wrappers.js');
    // wrappers.callOpenAI 는 openaiAdapter 를 통해 /v1/responses (가능 시) 또는
    // /v1/chat/completions 로 자동 라우팅한다. 게이트에서 직접 fetch 하면
    // gpt-5.4-pro 는 chat endpoint 에서 404 가 나므로 어댑터 경로를 타야 한다.
    const text = await Promise.race([
      callOpenAI(systemPrompt, userPrompt, MAX_TOKENS),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('openai_timeout')), FALLBACK_TIMEOUT_MS),
      ),
    ]);
    if (typeof text === 'string' && text.trim()) return text.trim();
    logger.warn('[ExecutiveGate] GPT fallback 빈 응답');
    return null;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[ExecutiveGate] GPT fallback 호출 오류');
    return null;
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
      logger.warn({ preview: primaryText.slice(0, 300) }, '[ExecutiveGate] Claude primary 정규화 실패');
    } else {
      logger.warn({ preview: primaryText.slice(0, 300) }, '[ExecutiveGate] Claude primary JSON 파싱 실패');
    }
  }

  // Fallback
  const fallbackText = await callOpenAIFallback(systemPrompt, userPrompt);
  if (fallbackText) {
    const parsed = tryParseJson(fallbackText);
    if (parsed) {
      const normalized = normalizeGateResult(parsed);
      if (normalized) return normalized;
      logger.warn({ preview: fallbackText.slice(0, 300) }, '[ExecutiveGate] GPT fallback 정규화 실패');
    } else {
      logger.warn({ preview: fallbackText.slice(0, 300) }, '[ExecutiveGate] GPT fallback JSON 파싱 실패');
    }
  }

  logger.warn('[ExecutiveGate] 양쪽 모두 실패 → single_agent fallback');
  return { complexity: 'simple', action: 'single_agent', departments: [], reason: 'gate_error' };
}
