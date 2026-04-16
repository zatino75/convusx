import { useCallback, useEffect, useState } from "react";

/**
 * Phase 3 — 단일 에이전트 루프 vs Director 멀티에이전트 모드 토글.
 *
 *   "auto"     — 서버 shouldRouteToDirector 휴리스틱에 맡김 (CEO/부서/전략 등 키워드 감지)
 *   "agent"    — 강제로 단일 에이전트 루프 (force_single_agent)
 *   "director" — 강제로 Director 모드 (force_director)
 *
 * useSendChat 가 읽어서 force_* 플래그를 백엔드로 넘긴다.
 * ChatView 의 composer 영역이 토글 pill UI 를 렌더한다.
 */
export type ChatMode = "auto" | "agent" | "director";

const STORAGE_KEY = "corvus-x.chat-mode";
const VALID_MODES: ReadonlySet<ChatMode> = new Set(["auto", "agent", "director"]);

function readInitial(): ChatMode {
  if (typeof window === "undefined") return "auto";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && VALID_MODES.has(raw as ChatMode)) return raw as ChatMode;
  } catch {
    /* localStorage 접근 불가 환경은 기본값 */
  }
  return "auto";
}

export function useChatMode(): {
  chatMode: ChatMode;
  setChatMode: (mode: ChatMode) => void;
} {
  const [chatMode, setChatModeState] = useState<ChatMode>(readInitial);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, chatMode);
    } catch {
      /* ignore */
    }
  }, [chatMode]);

  const setChatMode = useCallback((mode: ChatMode) => {
    if (VALID_MODES.has(mode)) setChatModeState(mode);
  }, []);

  return { chatMode, setChatMode };
}
