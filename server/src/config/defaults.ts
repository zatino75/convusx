// ── 설정 기본값 ──
// 코드에 산재된 매직넘버를 한 곳에서 관리

// ── API Base URLs ──
export const OPENAI_BASE      = "https://api.openai.com"
export const ANTHROPIC_BASE   = "https://api.anthropic.com"
export const GEMINI_HOST      = "https://generativelanguage.googleapis.com"
export const GEMINI_BASE      = `${GEMINI_HOST}/v1beta`
export const PERPLEXITY_BASE  = "https://api.perplexity.ai"

// ── 어댑터 타임아웃 ──
// 2026-04-17: 현실화. high-value 부서(claude-opus-4-6) 는 90s, 일반 60s, Gemini 45s 로
// DepartmentAgent.callPrimaryModel 에서 prefix 매칭해 분기한다.
// 여기서는 어댑터 네트워크 레벨 하드 상한만 관리.
export const ADAPTER_TIMEOUT_MS = 120000       // 텍스트 생성 (Claude/OpenAI/Perplexity) 최상한
export const ADAPTER_TIMEOUT_GEMINI_MS = 60000 // Gemini 비스트리밍
export const ADAPTER_TIMEOUT_STREAM_GEMINI_MS = 120000 // Gemini 스트리밍
export const IMAGE_GEN_TIMEOUT_MS = 120000     // 이미지/영상 생성
export const ROUTE_TIMEOUT_MS = 120000         // 라우트 레벨 API 호출
export const TITLE_GEN_TIMEOUT_MS = 8000       // 스레드 제목 자동 생성

// ── 컨텍스트 트리밍 ──
export const MAX_CONV_MESSAGES = 20  // system 제외 최대 유지 메시지 수
export const MAX_MSG_CHARS = 3000

// ── 오케스트라 ──
export const MAX_FALLBACK_PROVIDERS = 1
export const VERIFIER_TIMEOUT_MS = 15000
export const FUSION_TOTAL_CAP = 3000
export const THREAD_FUSION_THRESHOLD = 0.25
export const ENTITY_MATCH_MIN = 2

// ── Judge ──
export const JUDGE_AI_TRUNCATE_CHARS = 2000
export const PRIMARY_SURVIVAL_SCORE_GAP = 0.12
export const PRIMARY_SURVIVAL_CONFIDENCE = 0.75
export const OPTIONAL_SURVIVAL_SCORE_GAP = 0.08
export const OPTIONAL_SURVIVAL_CONFIDENCE = 0.72

// ── Escalation ──
export const ESCALATION_CONFLICT_COUNT = 2
export const ESCALATION_CONFLICT_SCORE = 1.05
export const ESCALATION_CONFIDENCE_MIN = 0.55

// ── Rate Limiting ──
export const RATE_LIMIT_CHAT_RPM = 30          // /api/chat, /api/chat/stream 분당 요청 수
export const RATE_LIMIT_CHAT_BURST = 5         // chat 버스트 허용량
export const RATE_LIMIT_GENERAL_RPM = 120      // 기타 API 분당 요청 수
export const RATE_LIMIT_GENERAL_BURST = 20     // general 버스트 허용량
export const RATE_LIMIT_WINDOW_MS = 60000      // 윈도우 크기 (1분)

// ── Memory ──
export const PROJECT_MEMORY_CAP = 200
export const SOURCE_ASSET_CAP = 300
export const THREAD_MEMORY_SIMILAR_THRESHOLD = 0.15
export const REUSE_SIMILARITY_THRESHOLD = 999  // 비활성화 상태
export const REUSE_PAST_WINNER_CONFIDENCE = 999  // 비활성화 상태

// ── Gemini 모델 문자열 단일 출처 (single source of truth) ──
// adapters/gemini.ts 도 여기서 re-export 한다. 이전엔 adapters/gemini.ts 가 소유했지만
// defaults.ts ← adapters/gemini.ts 방향의 순환 import 위험이 있어 여기로 끌어올렸다.
export const GEMINI_MODEL_ID = "gemini-2.5-pro"
export const GEMINI_FLASH_MODEL_ID = "gemini-2.0-flash"
export const GEMINI_DISPLAY_LABEL = "Gemini 2.5 Pro"

// ── 비용 ──
export const MODEL_PRICING_USD_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  "gpt-5.2":               { input: 0.003,  output: 0.012 },
  "gpt-5.4-pro":           { input: 0.015,  output: 0.06 },
  "gpt-5.3-codex":         { input: 0.003,  output: 0.012 },
  "claude-sonnet-4-6":     { input: 0.003,  output: 0.015 },
  "claude-opus-4-6":       { input: 0.015,  output: 0.075 },
  [GEMINI_MODEL_ID]:       { input: 0.00125,output: 0.01 },
  [GEMINI_FLASH_MODEL_ID]: { input: 0.0001, output: 0.0004 },
  "sonar-pro":             { input: 0.003,  output: 0.015 },
  "sonar-reasoning-pro":   { input: 0.002,  output: 0.008 },
  "sonar":                 { input: 0.001,  output: 0.001 },
}

// ── 모델 기본값 ──
export const DEFAULT_MODELS: Record<string, string> = {
  openai:       "gpt-5.2",
  openai_pro:   "gpt-5.4-pro",
  claude:       "claude-sonnet-4-6",
  gemini:       GEMINI_MODEL_ID,
  gemini_flash: GEMINI_FLASH_MODEL_ID,
  perplexity:   "sonar-pro",
}

// ── Compression ──
export const COMPRESSION_MIN_BYTES = 1024  // 이 크기 미만 응답은 압축 스킵

// ── Context Window ──
export const MODEL_CONTEXT_LIMIT = 128_000  // 기본 컨텍스트 윈도우 크기
export const TOKEN_BUDGET_WARN_RATIO = 0.7  // 이 비율 초과 시 경고 로깅
