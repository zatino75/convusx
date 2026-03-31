import type { DetectedConflict } from "./conflicts.js"
import { getProviderRoutingScore } from "./scoreboard.js"

type JudgeCandidate = {
  provider: string
  answer_text: string
  raw?: any
}

type JudgeScoreRow = {
  provider: string
  score: number
  reasons: string[]
}

function normalizeText(input: string) {
  return String(input ?? "").replace(/\r\n/g, "\n").trim()
}

function splitSentences(input: string): string[] {
  const text = normalizeText(input)
  if (!text) return []
  return (text.match(/[^.!?\n]+[.!?\n]?/g) ?? [])
    .map((p) => p.trim())
    .filter(Boolean)
}

function extractNumbers(input: string): number[] {
  const matches = normalizeText(input).match(/-?\d+(?:\.\d+)?/g) ?? []
  return matches.map(Number).filter(Number.isFinite)
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function estimateCoverage(answer: string): number {
  const sentences = splitSentences(answer)
  const lengthScore = Math.min(1, normalizeText(answer).length / 800)
  const sentenceScore = Math.min(1, sentences.length / 10)
  return Number(((lengthScore * 0.6) + (sentenceScore * 0.4)).toFixed(4))
}

function estimateStructure(answer: string): number {
  const text = normalizeText(answer)
  let score = 0.40
  if (/(^\n)\s*[-*]\s+/.test(text)) score += 0.18
  if (/(^\n)\s*\d+\.\s+/.test(text)) score += 0.14
  if (/\n\s*\n/.test(text)) score += 0.10
  if (splitSentences(text).length >= 5) score += 0.10
  if (/#{1,3}\s+\S+/.test(text)) score += 0.08  // 헤더 구조
  return Number(Math.min(1, score).toFixed(4))
}

function estimateSpecificity(answer: string): number {
  const text = normalizeText(answer)
  const numbers = extractNumbers(text)
  let score = 0.38
  score += Math.min(0.22, numbers.length * 0.04)
  if (/"[^"]+"/.test(text)) score += 0.08
  if (/: /.test(text)) score += 0.08
  score += Math.min(0.22, unique(text.split(/\s+/).filter((w) => w.length >= 7)).length * 0.01)
  return Number(Math.min(1, score).toFixed(4))
}

// 메타 응답 감지 — "도와드리겠습니다", "알겠습니다" 등
function hasMetaResponse(answer: string): boolean {
  const text = normalizeText(answer).toLowerCase()
  const metaPatterns = [
    /^(알겠습니다|도와드리겠습니다|물론이죠|네,\s)/,
    /^(sure|certainly|of course|i'd be happy)/i,
    /어떤 방식으로.*원하시나요/,
    /어떤 형식.*원하시나요/,
    /구체적으로.*알려주시면/,
  ]
  return metaPatterns.some((p) => p.test(text.slice(0, 100)))
}

function getConflictTypeWeight(typeInput: string) {
  const type = String(typeInput ?? "").trim().toLowerCase()
  if (!type) return 0.07
  if (type.includes("numeric")) return 0.22
  if (type.includes("fact")) return 0.16
  if (type.includes("risk")) return 0.12
  if (type.includes("implementation")) return 0.10
  if (type.includes("context")) return 0.18
  if (type.includes("comparison")) return 0.08
  if (type.includes("recommendation")) return 0.06
  return 0.07
}

function getSeverityBase(severityInput: string) {
  const severity = String(severityInput ?? "").trim().toLowerCase()
  if (severity === "high") return 0.12
  if (severity === "medium") return 0.06
  return 0.03
}

function scoreCandidate(
  candidate: JudgeCandidate,
  task: string,
  conflicts: DetectedConflict[]
): JudgeScoreRow {
  const reasons: string[] = []
  const coverage = estimateCoverage(candidate.answer_text)
  const structure = estimateStructure(candidate.answer_text)
  const specificity = estimateSpecificity(candidate.answer_text)
  const normalizedTask = String(task ?? "").trim().toLowerCase()

  // task별 가중치
  let coverageW = 0.22
  let structureW = 0.16
  let specificityW = 0.17

  if (normalizedTask === "code") {
    coverageW = 0.14; structureW = 0.14; specificityW = 0.25
  } else if (normalizedTask === "research") {
    coverageW = 0.20; structureW = 0.22; specificityW = 0.13
  } else if (normalizedTask === "reasoning") {
    coverageW = 0.18; structureW = 0.14; specificityW = 0.23
  } else if (normalizedTask === "writing") {
    coverageW = 0.26; structureW = 0.20; specificityW = 0.12
  } else if (normalizedTask === "long_doc") {
    coverageW = 0.24; structureW = 0.24; specificityW = 0.10
  }

  let score = 0.45
  score += coverage * coverageW
  score += structure * structureW
  score += specificity * specificityW

  // conflict 패널티
  const providerConflicts = conflicts.filter((c) =>
    Array.isArray(c.providers) && c.providers.includes(candidate.provider)
  )

  const highConflicts = providerConflicts.filter((c) => c.severity === "high").length
  const mediumConflicts = providerConflicts.filter((c) => c.severity === "medium").length
  const lowConflicts = providerConflicts.filter((c) => c.severity === "low").length

  const weightedPenalty = providerConflicts.reduce((acc, c) => {
    const severityBase = getSeverityBase(String(c?.severity ?? "low"))
    const explicitWeight = typeof (c as any).weight === "number" ? Number((c as any).weight) : 0.5
    const typeWeight = getConflictTypeWeight(String(c?.type ?? ""))
    return acc + (severityBase * explicitWeight) + typeWeight
  }, 0)

  score -= weightedPenalty

  const numericConflicts = providerConflicts.filter((c) => String(c?.type ?? "").toLowerCase().includes("numeric")).length
  const factConflicts = providerConflicts.filter((c) => String(c?.type ?? "").toLowerCase().includes("fact")).length
  const contextConflicts = providerConflicts.filter((c) => Array.isArray(c.providers) && c.providers.includes("context")).length
  const recommendationConflicts = providerConflicts.filter((c) => String(c?.type ?? "").toLowerCase().includes("recommendation")).length
  const comparisonConflicts = providerConflicts.filter((c) => String(c?.type ?? "").toLowerCase().includes("comparison")).length

  reasons.push(`coverage:${coverage.toFixed(4)}`)
  reasons.push(`structure:${structure.toFixed(4)}`)
  reasons.push(`specificity:${specificity.toFixed(4)}`)
  reasons.push(`conflict_penalty:${weightedPenalty.toFixed(3)}`)

  if (highConflicts > 0) reasons.push(`high_conflicts:${highConflicts}`)
  if (mediumConflicts > 0) reasons.push(`medium_conflicts:${mediumConflicts}`)
  if (lowConflicts > 0) reasons.push(`low_conflicts:${lowConflicts}`)
  if (numericConflicts > 0) reasons.push(`numeric_conflicts:${numericConflicts}`)
  if (factConflicts > 0) reasons.push(`fact_conflicts:${factConflicts}`)
  if (contextConflicts > 0) reasons.push(`context_conflicts:${contextConflicts}`)
  if (recommendationConflicts > 0) reasons.push(`recommendation_conflicts:${recommendationConflicts}`)
  if (comparisonConflicts > 0) reasons.push(`comparison_conflicts:${comparisonConflicts}`)

  if (highConflicts >= 2) { score -= 0.15; reasons.push("multi_high_conflict_penalty") }
  if (numericConflicts >= 2) { score -= 0.08; reasons.push("multi_numeric_conflict_penalty") }
  if (contextConflicts >= 2) { score -= 0.10; reasons.push("multi_context_conflict_penalty") }

  // 보너스
  if (normalizedTask === "research" || normalizedTask === "reasoning" || normalizedTask === "comparison") {
    if (/\|.+\|.+\|/.test(candidate.answer_text)) { score += 0.06; reasons.push("table_bonus") }
  }

  if (/(결론|권고|추천|따라서|최종|결정|선택|recommend|conclusion|therefore)/i.test(candidate.answer_text)) {
    score += 0.05; reasons.push("conclusion_bonus")
  }

  if (normalizedTask === "code") {
    const hasCodeFence = /```/.test(candidate.answer_text)
    const hasPathLike = /[A-Za-z0-9_\-/\\]+\.[A-Za-z0-9]+/.test(candidate.answer_text)
    if (hasCodeFence) { score += 0.05; reasons.push("code_fence_bonus") }
    if (hasCodeFence && /(function|const|def |class |import |return )/i.test(candidate.answer_text)) {
      score += 0.04; reasons.push("executable_code_bonus")
    }
    if (hasPathLike) { score += 0.03; reasons.push("path_specific_bonus") }
  }

  if (normalizedTask === "research" || normalizedTask === "reasoning") {
    if (/(because|therefore|however|근거|따라서|하지만|반면)/i.test(candidate.answer_text)) {
      score += 0.04; reasons.push("reasoning_connector_bonus")
    }
  }

  if (normalizedTask === "writing") {
    const textLen = candidate.answer_text.trim().length
    if (textLen >= 300) { score += 0.04; reasons.push("writing_length_bonus") }
    if (/(서론|본론|결론|introduction|paragraph|문단)/i.test(candidate.answer_text)) {
      score += 0.04; reasons.push("writing_structure_bonus")
    }
    if (/(compelling|설득력|자연스럽|readable|engaging|간결)/i.test(candidate.answer_text)) {
      score += 0.03; reasons.push("writing_quality_bonus")
    }
  }

  if (normalizedTask === "long_doc") {
    if (/(핵심|요약|결론|key point|summary|takeaway|실행 항목)/i.test(candidate.answer_text)) {
      score += 0.05; reasons.push("long_doc_extraction_bonus")
    }
    if (/(리스크|의사결정|실행|action|decision|risk)/i.test(candidate.answer_text)) {
      score += 0.04; reasons.push("long_doc_decision_bonus")
    }
    const textLen = candidate.answer_text.trim().length
    if (textLen >= 400) { score += 0.03; reasons.push("long_doc_depth_bonus") }
  }

  // 패널티
  if (normalizeText(candidate.answer_text).length < 180) {
    score -= 0.08; reasons.push("too_short_penalty")
  }

  if (hasMetaResponse(candidate.answer_text)) {
    score -= 0.12; reasons.push("meta_response_penalty")
  }

  return {
    provider: candidate.provider,
    score: Number(Math.max(0, Math.min(1, score)).toFixed(4)),
    reasons
  }
}

// Task별 상세 Judge rubric
const TASK_RUBRIC: Record<string, string> = {
  dialogue: `
평가 기준 (각 항목 0-10점):
1. 즉각성: 서론/면책조항 없이 바로 답변에 진입하는가?
2. 정확성: 사실 오류나 논리적 모순이 없는가?
3. 간결성: 불필요한 반복/패딩 없이 핵심만 전달하는가?
4. 공감성: 사용자 의도를 정확히 파악하고 맥락에 맞게 답했는가?
5. 실용성: 즉시 활용 가능한 정보나 행동 지침을 제공하는가?

감점 요소: "알겠습니다", "도와드리겠습니다" 등 메타 응답으로 시작하는 경우 -2점`,

  code: `
평가 기준 (각 항목 0-10점):
1. 실행 가능성: 코드가 실제로 동작하는가? 플레이스홀더가 없는가?
2. 완전성: 엣지케이스, 에러 핸들링, import 구문이 포함되어 있는가?
3. 코드 품질: 변수명, 구조, 가독성이 프로덕션 수준인가?
4. 설명 품질: 핵심 로직에 대한 적절한 주석이나 설명이 있는가?
5. 문제 해결: 질문의 핵심 요구사항을 정확히 해결했는가?

가점 요소: 코드 블록(\`\`\`) 사용, 실제 파일 경로/함수명 포함
감점 요소: TODO/placeholder 존재, 코드 없이 설명만 있는 경우`,

  research: `
평가 기준 (각 항목 0-10점):
1. 사실 정확성: 데이터, 수치, 날짜가 정확하고 출처 언급이 있는가?
2. 포괄성: 주제의 핵심 측면을 빠짐없이 다뤘는가?
3. 구조화: 헤더, 목록, 표 등으로 정보가 체계적으로 정리되어 있는가?
4. 깊이: 표면적 요약을 넘어 분석과 인사이트를 제공하는가?
5. 실용성: 독자가 바로 활용할 수 있는 결론/권고안이 있는가?

가점 요소: 구체적 수치 포함, 비교 표 포함, 명확한 결론`,

  reasoning: `
평가 기준 (각 항목 0-10점):
1. 논리 흐름: 전제 → 근거 → 결론이 명확하게 연결되는가?
2. 근거 품질: 주장을 뒷받침하는 구체적 근거가 있는가?
3. 반론 고려: 반대 의견이나 한계를 인식하고 다루는가?
4. 결론 명확성: 애매한 중립이 아닌 명확한 입장을 취하는가?
5. 일관성: 논증 전체에서 모순이 없는가?

감점 요소: "경우에 따라 다릅니다" 등 결론 회피, 반복적 내용`,

  writing: "문체 자연스러움(25%), 구조와 흐름(20%), 창의성(20%), 독자 관점(20%), 완성도(15%)를 기준으로 평가.",
  long_doc: "정보 밀도(25%), 구조화(25%), 핵심 추출(25%), 누락 여부(25%)를 기준으로 평가.",

  legal_review: `
평가 기준 (각 항목 0-10점):
1. 위험 식별: 법적 리스크와 불리한 조항을 정확히 찾아냈는가?
2. 근거 명확성: 관련 법령/판례를 구체적으로 인용했는가?
3. 심각도 분류: HIGH/MEDIUM/LOW 위험 등급이 적절한가?
4. 수정 권고: 실행 가능한 구체적 수정안을 제시했는가?
5. 구조화: 조항별로 체계적으로 정리되어 있는가?`,

  data_analysis: `
평가 기준 (각 항목 0-10점):
1. 수치 정확성: 통계/지표 계산이 올바른가?
2. 패턴 발견: 트렌드, 이상치, 상관관계를 명확히 식별했는가?
3. 인사이트: 데이터를 비즈니스 관점으로 해석했는가?
4. 시각화 제안: 적절한 차트/그래프 유형을 제안했는가?
5. 실행 가능성: 즉시 활용 가능한 권고사항이 있는가?`,

  finance_analysis: `
평가 기준 (각 항목 0-10점):
1. 지표 정확성: PER/PBR/ROE 등 재무 지표 계산이 정확한가?
2. 비교 분석: 업계 평균 대비 비교가 포함되어 있는가?
3. 다각도 분석: 수익성/안정성/성장성을 모두 다뤘는가?
4. 리스크 식별: 재무적 위험 요소를 명확히 제시했는가?
5. 투자 관점: 객관적인 투자 관점의 종합 평가가 있는가?`,

  product_development: `
평가 기준 (각 항목 0-10점):
1. 시장 분석: 타겟 시장과 경쟁 환경을 정확히 파악했는가?
2. 차별화: 명확한 USP(핵심 차별점)를 제시했는가?
3. 실행 가능성: GTM 전략이 구체적이고 실행 가능한가?
4. 리스크: 예상 위험과 대응 방안을 포함했는가?
5. 구조화: 기획서 형식으로 체계적으로 정리되어 있는가?`
}

// AI Judge — task별 상세 루브릭 기반
async function aiJudge(params: {
  candidates: JudgeCandidate[]
  task: string
  question: string
}): Promise<{ winner: string; scores: Record<string, number>; rationale: string } | null> {
  const apiKey = String((globalThis as any)?.process?.env?.OPENAI_API_KEY ?? "").trim()
  if (!apiKey || params.candidates.length < 2) return null

  const rubric = TASK_RUBRIC[params.task] ?? "전반적인 품질, 정확성, 유용성, 즉각성을 기준으로 평가."
  const task = params.task

  // 답변 1500자로 확대
  const candidateSummaries = params.candidates.map((c, idx) => {
    const text = String(c.answer_text ?? "").slice(0, 1500)
    return `[답변 ${idx + 1} — ${c.provider}]\n${text}`
  }).join("\n\n---\n\n")

  const prompt = `당신은 AI 응답 품질 평가 전문가입니다. 아래 기준에 따라 엄격하고 공정하게 평가하세요.

[Task 유형]: ${task}

[평가 루브릭]:
${rubric}

[사용자 질문]:
${params.question.slice(0, 400)}

[평가 대상 답변 ${params.candidates.length}개]:
${candidateSummaries}

지시사항:
- 각 답변에 0-10점을 부여하세요 (소수점 1자리)
- 점수 차이가 의미있게 나타나도록 변별력 있게 평가하세요
- 길이가 길다고 좋은 것이 아닙니다 — 질문에 얼마나 직접적으로 답하는지가 핵심입니다
- 반드시 아래 JSON만 출력하세요 (다른 텍스트 없이):

{
  "winner": "provider_name",
  "scores": {"provider1": 8.5, "provider2": 7.2},
  "rationale": "선택 이유를 한 문장으로"
}`

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.2",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 400,
        temperature: 0
      }),
      signal: AbortSignal.timeout(20000)
    })

    const data = await resp.json().catch(() => ({}))
    const text = String(data?.choices?.[0]?.message?.content ?? "")
    const clean = text.replace(/```json|```/g, "").trim()
    const parsed = JSON.parse(clean)

    if (!parsed?.winner || !parsed?.scores) return null
    return {
      winner: String(parsed.winner),
      scores: parsed.scores,
      rationale: String(parsed.rationale ?? "")
    }
  } catch {
    return null
  }
}

export async function judge(params: {
  candidates: JudgeCandidate[]
  task?: string
  conflicts?: DetectedConflict[]
  question?: string
}) {
  const candidates = Array.isArray(params?.candidates) ? params.candidates : []
  const task = String(params?.task ?? "").trim().toLowerCase()
  const conflicts = Array.isArray(params?.conflicts) ? params.conflicts : []
  const question = String(params?.question ?? "").trim()

  if (candidates.length === 0) {
    return {
      provider: null,
      answer_text: "",
      ok: false,
      meta: {
        judge_selected_provider: null,
        judge_scores: [],
        judge_rationale: "no_candidates",
        judge_confidence: 0,
        conflict_count: 0,
        conflicts: [],
        claims: []
      }
    }
  }

  if (candidates.length === 1) {
    return {
      ...candidates[0],
      ok: true,
      meta: {
        judge_selected_provider: candidates[0].provider,
        judge_scores: [{ provider: candidates[0].provider, score: 1, reasons: ["single_candidate"] }],
        judge_rationale: "single_candidate",
        judge_confidence: 1,
        conflict_count: conflicts.length,
        conflicts,
        claims: []
      }
    }
  }

  // 1. 휴리스틱 점수
  const heuristicScores = candidates
    .map((c) => scoreCandidate(c, task, conflicts))
    .sort((a, b) => b.score - a.score)

  // 2. Scoreboard win_rate 반영 (피드백 누적 반영)
  const scoreboardWeights: Record<string, number> = {}
  for (const c of candidates) {
    try {
      const routing = getProviderRoutingScore(c.provider, task)
      // effective_win_rate 또는 blended_win_rate 사용
      const winRate = Number(routing?.effective_win_rate ?? routing?.blended_win_rate ?? 0.5)
      scoreboardWeights[c.provider] = Number(Math.max(0.2, Math.min(0.85, winRate)).toFixed(4))
    } catch {
      scoreboardWeights[c.provider] = 0.5
    }
  }

  // 3. AI Judge
  let aiResult: { winner: string; scores: Record<string, number>; rationale: string } | null = null
  try {
    aiResult = await aiJudge({ candidates, task, question })
  } catch {}

  // 4. 혼합 점수 — AI 50% + 휴리스틱 25% + Scoreboard 25%
  const blendedScores = heuristicScores.map((h) => {
    const aiScore = aiResult?.scores?.[h.provider]
    const aiNormalized = typeof aiScore === "number" ? aiScore / 10 : null
    const sbWeight = scoreboardWeights[h.provider] ?? 0.5

    let blended: number
    if (aiNormalized !== null) {
      blended = (aiNormalized * 0.50) + (h.score * 0.25) + (sbWeight * 0.25)
    } else {
      // AI Judge 없을 때: 휴리스틱 60% + Scoreboard 40%
      blended = (h.score * 0.60) + (sbWeight * 0.40)
    }

    return {
      provider: h.provider,
      score: Number(Math.max(0, Math.min(1, blended)).toFixed(4)),
      reasons: [
        ...h.reasons,
        aiNormalized !== null ? `ai_judge:${aiNormalized.toFixed(2)}` : "ai_judge:fallback",
        `scoreboard_win_rate:${sbWeight.toFixed(2)}`
      ]
    }
  }).sort((a, b) => b.score - a.score)

  // AI winner가 명확하면 우선 적용
  const winner = (aiResult?.winner && blendedScores.find(s => s.provider === aiResult!.winner))
    ? blendedScores.find(s => s.provider === aiResult!.winner)!
    : blendedScores[0]

  const runnerUp = blendedScores.find(s => s.provider !== winner.provider)
  const scoreDiff = (winner.score ?? 0) - (runnerUp?.score ?? 0)
  const winnerScore = winner.score ?? 0

  // confidence: AI 사용 여부, score 차이, 절대 점수 반영
  const confidence = Number(
    Math.max(0.55, Math.min(0.98,
      (winnerScore * 0.40) +
      (Math.min(scoreDiff * 3.0, 0.25)) +
      (aiResult ? 0.18 : 0) +
      0.25
    )).toFixed(4)
  )

  const selected = candidates.find(c => c.provider === winner.provider) ?? candidates[0]

  return {
    ...selected,
    ok: true,
    meta: {
      judge_selected_provider: selected.provider,
      judge_scores: blendedScores,
      judge_rationale: aiResult?.rationale
        ? `AI: ${aiResult.rationale}`
        : `selected ${selected.provider} by heuristic+scoreboard`,
      judge_confidence: confidence,
      conflict_count: conflicts.length,
      conflicts,
      claims: [],
      ai_judge_used: Boolean(aiResult),
      scoreboard_weights: scoreboardWeights
    }
  }
}
