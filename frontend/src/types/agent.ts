/**
 * types/agent.ts — CORVUS X 에이전트 루프 전용 타입
 *
 * agentLoop(서버) → SSE 스트림 → agentStore(클라이언트) 로 흐르는
 * 모든 런타임 데이터의 타입 정의.
 *
 * workspace.ts 의 DebugMeta 와 StreamEvent 를 확장·특화한다.
 */

// ─────────────────────────────────────────────────────────────
// 도구 호출 타임라인 — ToolCallTimeline 컴포넌트 대응
// ─────────────────────────────────────────────────────────────

export type ToolCallEntry = {
  /** 도구 이름 (toolRegistry 의 name 필드) */
  tool_name: string;
  /** 성공 여부 */
  ok: boolean;
  /** 호출 시작 Unix ms */
  started_at?: number;
  /** 호출 완료까지 소요 ms */
  latency_ms?: number;
  /** 요약 (도구가 반환한 짧은 설명) */
  summary?: string;
  /** 에러 메시지 (ok=false 시) */
  error?: string | null;
  /** 도구 결과 원본 텍스트 (선택적 표시용) */
  output_text?: string;
};

// ─────────────────────────────────────────────────────────────
// 병렬 앙상블 — EnsembleCompareView 4탭 대응
// ─────────────────────────────────────────────────────────────

export type EnsembleDraft = {
  provider: string;   // "claude" | "gpt" | "gemini"
  model: string;      // e.g. "claude-opus-4-6"
  ok: boolean;
  draft: string;
  latency_ms?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    estimated_cost_usd?: number;
  };
  error?: string | null;
};

export type AdversarialCritique = {
  critic_provider?: string;
  critic_model?: string;
  draft_provider?: string;
  critique?: string;
};

export type EnsembleState = {
  /** 각 모델의 draft 결과 (최대 3개) */
  drafts: EnsembleDraft[];
  /** 최종 통합본 (에이전트 루프가 synthesize 후 저장) */
  synthesized?: string;
  /** 앙상블 발동에 쓰인 system instruction 일부 (디버그용) */
  instruction_preview?: string;
  /** 전체 소요 ms */
  total_latency_ms?: number;
  /** 적대적 비평 결과 */
  critique?: AdversarialCritique | null;
};

// ─────────────────────────────────────────────────────────────
// 라우팅 결정 — 에이전트 루프가 task 감지 후 결정
// ─────────────────────────────────────────────────────────────

export type RouteDecision = {
  /** 감지된 task 유형 (CLAUDE.md Task 열 기준) */
  task: string;
  /** 기본 경로 primary provider */
  provider: string;
  /** "single" | "ensemble" */
  strategy: "single" | "ensemble";
  /** 고가치 경로 여부 */
  high_value: boolean;
  /** 의무 사전 조사·비평 적용 여부 */
  prior_research: boolean;
  adversarial_critique: boolean;
  /** 활성 도메인 프로파일 */
  domain_profile?: DomainProfile;
};

// ─────────────────────────────────────────────────────────────
// 도메인 프로파일
// ─────────────────────────────────────────────────────────────

export type DomainProfile = "food" | "ecig" | "cosmetic" | "general";

// ─────────────────────────────────────────────────────────────
// 자동 법규 갱신 상태 — regulationWatcher
// ─────────────────────────────────────────────────────────────

export type RegulationWatcherStatus = {
  lastUpdatedAt?: string | null;   // ISO8601
  updatedCount?: number;
  domains?: DomainProfile[];
  nextScheduledAt?: string | null;
};

// ─────────────────────────────────────────────────────────────
// 도구 호출 로그 항목 — tool_call_log 대응
// ─────────────────────────────────────────────────────────────

export type ToolCallLogEntry = {
  id: string;
  thread_id: string;
  tool_name: string;
  args?: Record<string, unknown>;
  result_summary?: string;
  ok: boolean;
  latency_ms?: number;
  error?: string | null;
  created_at: string;
};

// ─────────────────────────────────────────────────────────────
// 에이전트 루프 실행 상태 — agentStore 가 관리
// ─────────────────────────────────────────────────────────────

export type AgentRunState =
  | "idle"
  | "thinking"          // extended thinking 진행 중
  | "tool_calling"      // 도구 호출 중
  | "ensemble_running"  // 병렬 앙상블 실행 중
  | "critique_running"  // 적대적 비평 실행 중
  | "streaming"         // 최종 답변 스트리밍 중
  | "done"
  | "error";

export type AgentSettings = {
  /** 전역 지침 (설정 → 전체 지침) */
  globalInstruction: string;
  /** 활성 도메인 프로파일 */
  domainProfile: DomainProfile;
  /** 3-AI 앙상블 토글 */
  ensembleEnabled: boolean;
  /** 자동 법규 갱신 주기 (분 단위, 0=수동) */
  regulationUpdateIntervalMinutes: number;
  /** 고가치 경로 자동 감지 토글 */
  highValueAutoDetect: boolean;
};

// ─────────────────────────────────────────────────────────────
// Thread Fusion 주입 메타
// ─────────────────────────────────────────────────────────────

export type FusionInjection = {
  source_thread_ids: string[];
  snippet_count: number;
  injected_at: string;
};

// ─────────────────────────────────────────────────────────────
// 에이전트 루프 단일 실행 세션 (한 turn)
// ─────────────────────────────────────────────────────────────

export type AgentTurnSession = {
  turn_id: string;
  thread_id: string;
  route?: RouteDecision;
  state: AgentRunState;
  toolTimeline: ToolCallEntry[];
  ensembleState?: EnsembleState | null;
  fusionInjection?: FusionInjection | null;
  startedAt: number;
  endedAt?: number;
  totalLatencyMs?: number;
  error?: string | null;
};
