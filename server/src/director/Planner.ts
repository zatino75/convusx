/**
 * Planner.ts — 부서 선별기 (Phase 10, 2026-04-25)
 *
 * Classifier 가 research/strategic 으로 라우팅한 후 Sonnet Planner 대신 먼저 시도.
 * 하이브리드: 키워드 사전선별 + Gemini Flash 정제.
 *
 * 흐름:
 *  1. 키워드 스캔 → 후보 부서 점수 부여
 *  2. Gemini Flash 호출 (cheap/fast) → 후보 리스트를 받아 instruction 맞춤화 + 최종 정렬
 *  3. 키워드 가드 적용 (finance 무관 요청 끼임 방지) → maxDepts cap
 *
 * 실패 시 null 반환 → ExecutiveGate 가 기존 Sonnet/GPT/Gemini Pro 3단계로 폴백.
 *
 * 비용: 키워드+Flash 약 $0.001~$0.003 (Sonnet Planner 의 1/30~1/50).
 */

import type { DeptId } from "./TaskDecomposer.js"
import type { GateDepartment, GateDomain } from "./ExecutiveGate.js"
import { logger } from "../observability/logger.js"
import { GEMINI_FLASH_MODEL_ID } from "../config/defaults.js"

const FLASH_TIMEOUT_MS = 8_000
const FLASH_MAX_TOKENS = 1200
const KEYWORD_TOP_N = 6   // 키워드 스코어 상위 N 개를 LLM 후보로 전달
const PLANNER_MAX_DEPTS = 4  // CLAUDE.md 규칙 #6 — MAX_DEPTS 절대 상한

const ALL_DEPT_IDS: readonly DeptId[] = [
  "market", "compete", "legal", "finance",
  "marketing", "rnd", "data", "content", "sns", "design",
]

const DEPT_KEYWORDS: Record<DeptId, string[]> = {
  market: [
    "시장", "트렌드", "규모", "성장률", "수요", "cagr", "tam", "sam", "som",
    "소비자", "동향", "진입", "세그먼트", "포지셔닝맵", "산업",
  ],
  compete: [
    "경쟁", "경쟁사", "점유율", "비교", "벤치마킹", "라이벌", "포지셔닝",
    "usp", "차별화", "강점", "약점",
  ],
  legal: [
    "법률", "규제", "인허가", "식약처", "담배사업법", "fda", "컴플라이언스",
    "법규", "위반", "인증", "고시", "벌금", "제재", "개정",
  ],
  finance: [
    "예산", "투자", "가격", "비용", "수익", "매출", "재무", "재정", "자본", "자금",
    "단가", "원가", "마진", "손익", "수익성", "객단가", "roi", "p&l", "ebitda", "bep",
  ],
  marketing: [
    "마케팅", "브랜드", "캠페인", "포지셔닝", "imc", "광고", "프로모션",
    "타겟팅", "퍼소나",
  ],
  rnd: [
    "r&d", "연구개발", "개발", "레시피", "성분", "처방", "시제품", "특허",
    "원료", "oem", "odm", "포뮬러", "조향",
  ],
  data: [
    "데이터", "감성분석", "kpi", "통계", "검색량", "코호트", "ltv",
    "전환율", "매출데이터", "리뷰분석",
  ],
  content: [
    "콘텐츠", "카피", "스크립트", "블로그", "기사", "톤", "보이스", "seo",
    "에디토리얼", "콘텐츠캘린더",
  ],
  sns: [
    "sns", "소셜미디어", "인스타", "인스타그램", "틱톡", "tiktok",
    "유튜브", "인플루언서", "게시물", "릴스", "숏폼",
  ],
  design: [
    "이미지", "사진", "영상", "동영상", "3d", "디자인", "로고", "배너",
    "포스터", "인테리어", "패키지", "무드보드", "컨셉아트", "인포그래픽", "썸네일",
  ],
}

const VISUAL_KEYWORDS = DEPT_KEYWORDS.design

interface ScoredDept {
  id: DeptId
  score: number
  matched: string[]
}

function scoreByKeywords(directive: string): ScoredDept[] {
  const q = directive.toLowerCase()
  const scored: ScoredDept[] = []
  for (const id of ALL_DEPT_IDS) {
    const matched: string[] = []
    let score = 0
    for (const kw of DEPT_KEYWORDS[id]) {
      if (q.includes(kw.toLowerCase())) {
        matched.push(kw)
        score += 1
      }
    }
    if (score > 0) scored.push({ id, score, matched })
  }
  // 비주얼 키워드 감지 → design 부서 강제 부스트 (협업 규칙 보장)
  if (VISUAL_KEYWORDS.some((kw) => q.includes(kw))) {
    const existing = scored.find((s) => s.id === "design")
    if (existing) existing.score += 2
    else scored.push({ id: "design", score: 2, matched: ["(visual_boost)"] })
  }
  return scored.sort((a, b) => b.score - a.score)
}

const PLANNER_SYSTEM = `당신은 CORVUS X Planner 입니다.
키워드 스캔 결과로 추려진 후보 부서들 중 최종 ${PLANNER_MAX_DEPTS}개 이하를 선별하고
각 부서에 맞춤 지시문을 작성합니다.

부서:
- market(시장조사) / compete(경쟁분석) / legal(법무) / finance(재무)
- marketing(마케팅 전략) / rnd(R&D) / data(데이터) / content(콘텐츠) / sns(SNS) / design(디자인 비주얼)

규칙:
- 후보에 없는 부서는 추가 금지 (단, 비주얼 키워드 있고 design 누락 시 추가 가능)
- 각 instruction 은 해당 부서가 즉시 작업 가능한 구체 지시로 재가공
- 비주얼 요청이면 design 포함 필수

JSON 만 반환:
{
  "departments": [
    {"id":"market","instruction":"..."},
    {"id":"compete","instruction":"..."}
  ],
  "reason":"한 줄 이유"
}`

function buildUserPrompt(directive: string, domain: GateDomain, candidates: ScoredDept[]): string {
  const list = candidates
    .slice(0, KEYWORD_TOP_N)
    .map((c) => `- ${c.id} (score=${c.score}, 매칭=${c.matched.join(",")})`)
    .join("\n")
  return `지시: ${directive}
도메인: ${domain}

후보 부서 (키워드 점수순, 상위 ${KEYWORD_TOP_N}개):
${list || "(매칭 없음 — 자유 선택)"}`
}

function extractFirstJsonObject(text: string): string | null {
  const s = text
  let i = 0
  while (i < s.length && s[i] !== "{") i++
  if (i >= s.length) return null
  const start = i
  let depth = 0
  let inStr = false
  let escape = false
  for (; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (escape) { escape = false; continue }
      if (ch === "\\") { escape = true; continue }
      if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === "{") depth++
    else if (ch === "}") { depth--; if (depth === 0) return s.slice(start, i + 1) }
  }
  return null
}

function tryParseDepartments(raw: string): GateDepartment[] | null {
  if (!raw) return null
  let cleaned = raw.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim()
  cleaned = cleaned.replace(/```(?:json)?/gi, "").replace(/```/g, "")
  const balanced = extractFirstJsonObject(cleaned) ?? cleaned
  try {
    const obj = JSON.parse(balanced.replace(/,\s*([}\]])/g, "$1"))
    const arr = Array.isArray(obj?.departments) ? obj.departments : []
    const out: GateDepartment[] = []
    const seen = new Set<DeptId>()
    for (const item of arr) {
      const id = String(item?.id ?? "").trim().toLowerCase() as DeptId
      if (!ALL_DEPT_IDS.includes(id) || seen.has(id)) continue
      const instruction = String(item?.instruction ?? "").trim()
      if (!instruction) continue
      out.push({ id, instruction: instruction.slice(0, 1200) })
      seen.add(id)
    }
    return out
  } catch {
    return null
  }
}

async function callFlashPlanner(directive: string, domain: GateDomain, candidates: ScoredDept[]): Promise<string | null> {
  const apiKey = String(process.env.GEMINI_API_KEY ?? "").trim()
  if (!apiKey) return null
  try {
    const { geminiAdapter } = await import("../adapters/gemini.js")
    const userPrompt = buildUserPrompt(directive, domain, candidates)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FLASH_TIMEOUT_MS)
    try {
      const resp = await geminiAdapter.generate({
        provider: "gemini",
        model: GEMINI_FLASH_MODEL_ID,
        messages: [
          { role: "system", content: PLANNER_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        max_tokens: FLASH_MAX_TOKENS,
        abort_signal: ctrl.signal,
      } as any)
      if (resp?.error) return null
      return String(resp?.answer ?? "")
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    logger.warn("[Planner] flash 호출 오류", { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

export interface PlannerResult {
  departments: GateDepartment[]
  source: "planner_flash" | "planner_keyword_only"
  reason: string
}

/**
 * 부서 선별 시도. 실패(빈 결과/오류) 시 null → ExecutiveGate 가 기존 3단계로 폴백.
 */
export async function planDepartments(
  directive: string,
  domain: GateDomain,
  maxDepts: number,
): Promise<PlannerResult | null> {
  const trimmed = String(directive ?? "").trim()
  if (!trimmed) return null
  const cap = Math.min(PLANNER_MAX_DEPTS, Math.max(0, maxDepts))
  if (cap === 0) return null

  // 1) 키워드 스캔
  const candidates = scoreByKeywords(trimmed)

  // 2) Gemini Flash 정제
  const flashRaw = await callFlashPlanner(trimmed, domain, candidates)
  if (flashRaw) {
    const parsed = tryParseDepartments(flashRaw)
    if (parsed && parsed.length > 0) {
      const final = parsed.slice(0, cap)
      logger.info("[Planner] flash 성공", {
        candidates: candidates.length,
        selected: final.length,
        ids: final.map((d) => d.id),
      })
      return { departments: final, source: "planner_flash", reason: "flash_planner_ok" }
    }
    logger.warn("[Planner] flash 응답 파싱 실패", { preview: flashRaw.slice(0, 200) })
  }

  // 3) 키워드 단독 폴백 — 상위 cap개를 generic 지시문으로 채움
  if (candidates.length > 0) {
    const departments: GateDepartment[] = candidates.slice(0, cap).map((c) => ({
      id: c.id,
      instruction: `${trimmed} (${c.id} 부서 관점에서 분석. 매칭 키워드: ${c.matched.join(", ")})`,
    }))
    logger.info("[Planner] 키워드 단독 폴백 사용", { selected: departments.length, ids: departments.map((d) => d.id) })
    return { departments, source: "planner_keyword_only", reason: "keyword_fallback" }
  }

  return null
}
