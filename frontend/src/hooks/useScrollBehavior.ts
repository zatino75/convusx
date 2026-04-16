import { useEffect, useRef, useState } from "react"

/**
 * useScrollBehavior — 채팅 스크롤 자동 고정 + "맨 아래로" 버튼 표시 로직
 * scrollRef: 스크롤 컨테이너에 연결
 * markScrollToBottom: 다음 렌더에서 강제 스크롤 예약
 */
export function useScrollBehavior({
  activeThreadId,
  sidebarView,
  threads,
}: {
  activeThreadId: string | null
  sidebarView: string
  threads: any[]
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const shouldAutoStickRef = useRef(true)
  const pendingScrollBehaviorRef = useRef<ScrollBehavior | null>("auto")
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)

  // 스크롤 위치에 따라 자동 고정 여부 + 버튼 표시 결정
  useEffect(() => {
    const el = scrollRef.current
    if (!el) { setShowScrollToBottom(false); return }

    const updateStickiness = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      shouldAutoStickRef.current = distanceFromBottom <= 96
      setShowScrollToBottom(distanceFromBottom > 120)
    }

    updateStickiness()
    el.addEventListener("scroll", updateStickiness, { passive: true })
    return () => el.removeEventListener("scroll", updateStickiness)
  }, [activeThreadId, sidebarView])

  // 새 메시지/스레드 변경 시 자동 스크롤 실행
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (!shouldAutoStickRef.current && pendingScrollBehaviorRef.current === null) return

    // 명시적 markScrollToBottom 호출 여부를 rAF 이전에 캡처
    const isExplicitRequest = pendingScrollBehaviorRef.current !== null
    const behavior = pendingScrollBehaviorRef.current ?? "auto"
    requestAnimationFrame(() => {
      const latest = scrollRef.current
      if (!latest) return
      // rAF 대기 중 사용자가 위로 스크롤한 경우: 명시적 요청이 아니면 강제 스크롤 취소
      if (!isExplicitRequest && !shouldAutoStickRef.current) {
        pendingScrollBehaviorRef.current = null
        return
      }
      latest.scrollTo({ top: latest.scrollHeight, behavior })
      const distanceFromBottom = latest.scrollHeight - latest.scrollTop - latest.clientHeight
      setShowScrollToBottom(distanceFromBottom > 120)
      pendingScrollBehaviorRef.current = null
    })
  }, [threads, activeThreadId])

  function markScrollToBottom(behavior: ScrollBehavior = "auto") {
    shouldAutoStickRef.current = true
    pendingScrollBehaviorRef.current = behavior
    setShowScrollToBottom(false)
  }

  function handleScrollToBottom() {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    shouldAutoStickRef.current = true
    setShowScrollToBottom(false)
  }

  return {
    scrollRef,
    showScrollToBottom,
    markScrollToBottom,
    handleScrollToBottom,
  }
}
