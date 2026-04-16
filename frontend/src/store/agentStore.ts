/**
 * store/agentStore.ts — CORVUS X 에이전트 루프 런타임 상태 관리
 *
 * CLAUDE.md 구조:
 *   - AgentSettings (전역 지침 / 도메인 프로파일 / 앙상블 토글 / 법규 갱신 주기)
 *   - AgentTurnSession (한 turn 의 실행 세션 — 도구 타임라인 + 앙상블 + 비평)
 *   - RegulationWatcherStatus (자동 법규 갱신 상태)
 *
 * localStorage 저장 키:
 *   corvus-x.agent.settings.v1
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentRunState,
  AgentSettings,
  AgentTurnSession,
  DomainProfile,
  EnsembleState,
  FusionInjection,
  RegulationWatcherStatus,
  RouteDecision,
  ToolCallEntry,
} from "../types/agent";

// ─────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────

const SETTINGS_KEY = "corvus-x.agent.settings.v1";

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  globalInstruction: "",
  domainProfile: "general",
  ensembleEnabled: false,
  regulationUpdateIntervalMinutes: 1440, // 1일
  highValueAutoDetect: true,
};

// ─────────────────────────────────────────────────────────────
// localStorage 헬퍼
// ─────────────────────────────────────────────────────────────

function loadSettings(): AgentSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_AGENT_SETTINGS;
    return { ...DEFAULT_AGENT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_AGENT_SETTINGS;
  }
}

function saveSettings(settings: AgentSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // storage quota exceeded — ignore
  }
}

// ─────────────────────────────────────────────────────────────
// 싱글턴 전역 상태 (React context 없이 모듈 수준으로 공유)
// ─────────────────────────────────────────────────────────────

let _settings: AgentSettings = DEFAULT_AGENT_SETTINGS;
let _settingsLoaded = false;

const _settingsSubscribers = new Set<() => void>();
const _turnSubscribers = new Set<() => void>();

let _currentTurn: AgentTurnSession | null = null;
let _regulationStatus: RegulationWatcherStatus = {};

function notifySettings() {
  _settingsSubscribers.forEach((fn) => fn());
}

function notifyTurn() {
  _turnSubscribers.forEach((fn) => fn());
}

// ─────────────────────────────────────────────────────────────
// 설정 Actions
// ─────────────────────────────────────────────────────────────

export function initAgentSettings() {
  if (_settingsLoaded) return;
  _settingsLoaded = true;
  _settings = loadSettings();
}

export function setDomainProfile(profile: DomainProfile) {
  _settings = { ..._settings, domainProfile: profile };
  saveSettings(_settings);
  notifySettings();
}

export function setEnsembleEnabled(enabled: boolean) {
  _settings = { ..._settings, ensembleEnabled: enabled };
  saveSettings(_settings);
  notifySettings();
}

export function setGlobalInstruction(instruction: string) {
  _settings = { ..._settings, globalInstruction: instruction };
  saveSettings(_settings);
  notifySettings();
}

export function setRegulationUpdateInterval(minutes: number) {
  _settings = { ..._settings, regulationUpdateIntervalMinutes: minutes };
  saveSettings(_settings);
  notifySettings();
}

export function setHighValueAutoDetect(enabled: boolean) {
  _settings = { ..._settings, highValueAutoDetect: enabled };
  saveSettings(_settings);
  notifySettings();
}

export function patchAgentSettings(patch: Partial<AgentSettings>) {
  _settings = { ..._settings, ...patch };
  saveSettings(_settings);
  notifySettings();
}

export function getAgentSettings(): AgentSettings {
  return _settings;
}

// ─────────────────────────────────────────────────────────────
// Turn Session Actions
// ─────────────────────────────────────────────────────────────

export function startAgentTurn(turnId: string, threadId: string): AgentTurnSession {
  const session: AgentTurnSession = {
    turn_id: turnId,
    thread_id: threadId,
    state: "thinking",
    toolTimeline: [],
    startedAt: Date.now(),
  };
  _currentTurn = session;
  notifyTurn();
  return session;
}

export function setTurnState(state: AgentRunState) {
  if (!_currentTurn) return;
  _currentTurn = { ..._currentTurn, state };
  notifyTurn();
}

export function setTurnRoute(route: RouteDecision) {
  if (!_currentTurn) return;
  _currentTurn = { ..._currentTurn, route };
  notifyTurn();
}

export function appendToolCall(entry: ToolCallEntry) {
  if (!_currentTurn) return;
  _currentTurn = {
    ..._currentTurn,
    toolTimeline: [..._currentTurn.toolTimeline, entry],
    state: "tool_calling",
  };
  notifyTurn();
}

export function setEnsembleState(ensembleState: EnsembleState) {
  if (!_currentTurn) return;
  _currentTurn = { ..._currentTurn, ensembleState, state: "ensemble_running" };
  notifyTurn();
}

export function setFusionInjection(fusion: FusionInjection) {
  if (!_currentTurn) return;
  _currentTurn = { ..._currentTurn, fusionInjection: fusion };
  notifyTurn();
}

export function finishAgentTurn(error?: string) {
  if (!_currentTurn) return;
  const now = Date.now();
  _currentTurn = {
    ..._currentTurn,
    state: error ? "error" : "done",
    endedAt: now,
    totalLatencyMs: now - _currentTurn.startedAt,
    error: error ?? null,
  };
  notifyTurn();
}

export function clearAgentTurn() {
  _currentTurn = null;
  notifyTurn();
}

export function getCurrentTurn(): AgentTurnSession | null {
  return _currentTurn;
}

// ─────────────────────────────────────────────────────────────
// Regulation Watcher Status
// ─────────────────────────────────────────────────────────────

export function setRegulationStatus(status: RegulationWatcherStatus) {
  _regulationStatus = { ..._regulationStatus, ...status };
  notifySettings();
}

export function getRegulationStatus(): RegulationWatcherStatus {
  return _regulationStatus;
}

// ─────────────────────────────────────────────────────────────
// React Hooks
// ─────────────────────────────────────────────────────────────

/**
 * useAgentSettings — 설정 읽기 + 변경 감지
 */
export function useAgentSettings(): AgentSettings {
  const [, rerender] = useState(0);

  useEffect(() => {
    initAgentSettings();
    const fn = () => rerender((n) => n + 1);
    _settingsSubscribers.add(fn);
    // 초기 렌더링에서 한 번 더 trigger (hydration 보정)
    fn();
    return () => { _settingsSubscribers.delete(fn); };
  }, []);

  return _settings;
}

/**
 * useAgentTurn — 현재 turn 세션 읽기 + 변경 감지
 */
export function useAgentTurn(): AgentTurnSession | null {
  const [, rerender] = useState(0);

  useEffect(() => {
    const fn = () => rerender((n) => n + 1);
    _turnSubscribers.add(fn);
    return () => { _turnSubscribers.delete(fn); };
  }, []);

  return _currentTurn;
}

/**
 * useRegulationStatus — 자동 법규 갱신 상태 읽기
 */
export function useRegulationStatus(): RegulationWatcherStatus {
  const [status, setStatus] = useState<RegulationWatcherStatus>(_regulationStatus);

  useEffect(() => {
    const fn = () => setStatus({ ..._regulationStatus });
    _settingsSubscribers.add(fn);
    return () => { _settingsSubscribers.delete(fn); };
  }, []);

  return status;
}

/**
 * useAgentSettingsActions — 설정 변경 액션 모음
 */
export function useAgentSettingsActions() {
  const handleDomainProfile = useCallback((p: DomainProfile) => setDomainProfile(p), []);
  const handleEnsemble = useCallback((v: boolean) => setEnsembleEnabled(v), []);
  const handleInstruction = useCallback((v: string) => setGlobalInstruction(v), []);
  const handleInterval = useCallback((v: number) => setRegulationUpdateInterval(v), []);
  const handleHighValue = useCallback((v: boolean) => setHighValueAutoDetect(v), []);
  const handlePatch = useCallback((patch: Partial<AgentSettings>) => patchAgentSettings(patch), []);

  return {
    setDomainProfile: handleDomainProfile,
    setEnsembleEnabled: handleEnsemble,
    setGlobalInstruction: handleInstruction,
    setRegulationUpdateInterval: handleInterval,
    setHighValueAutoDetect: handleHighValue,
    patchAgentSettings: handlePatch,
  };
}

// ─────────────────────────────────────────────────────────────
// SSE 이벤트 → agentStore 브릿지
// (useSendChat 에서 tool_call / route_decided / final_answer 이벤트 수신 시 호출)
// ─────────────────────────────────────────────────────────────

export function handleAgentSSEEvent(event: Record<string, unknown>) {
  const type = event.type as string;

  switch (type) {
    case "route_decided": {
      setTurnRoute({
        task: (event.task as string) ?? "unknown",
        provider: (event.provider as string) ?? "claude",
        strategy: (event.strategy as "single" | "ensemble") ?? "single",
        high_value: Boolean(event.high_value),
        prior_research: Boolean(event.prior_research),
        adversarial_critique: Boolean(event.adversarial_critique),
        domain_profile: (event.domain_profile as DomainProfile) ?? undefined,
      });
      break;
    }

    case "tool_call": {
      appendToolCall({
        tool_name: (event.tool_name as string) ?? "unknown",
        ok: Boolean(event.ok),
        latency_ms: (event.latency_ms as number) ?? undefined,
        summary: (event.summary as string) ?? undefined,
        error: (event.error as string | null) ?? null,
        output_text: (event.output_text as string) ?? undefined,
        started_at: (event.started_at as number) ?? undefined,
      });
      break;
    }

    case "ensemble_done": {
      const drafts = (event.drafts as EnsembleState["drafts"]) ?? [];
      setEnsembleState({
        drafts,
        synthesized: (event.synthesized as string) ?? undefined,
        instruction_preview: (event.instruction_preview as string) ?? undefined,
        total_latency_ms: (event.total_latency_ms as number) ?? undefined,
        critique: (event.critique as EnsembleState["critique"]) ?? null,
      });
      break;
    }

    case "fusion_injected": {
      setFusionInjection({
        source_thread_ids: (event.source_thread_ids as string[]) ?? [],
        snippet_count: (event.snippet_count as number) ?? 0,
        injected_at: (event.injected_at as string) ?? new Date().toISOString(),
      });
      break;
    }

    case "regulation_status": {
      setRegulationStatus({
        lastUpdatedAt: (event.last_updated_at as string) ?? null,
        updatedCount: (event.updated_count as number) ?? 0,
        domains: (event.domains as DomainProfile[]) ?? [],
        nextScheduledAt: (event.next_scheduled_at as string) ?? null,
      });
      break;
    }

    case "final_answer": {
      setTurnState("streaming");
      break;
    }

    case "done": {
      finishAgentTurn();
      break;
    }

    case "error": {
      finishAgentTurn((event.error as string) ?? "Unknown error");
      break;
    }

    default:
      break;
  }
}
