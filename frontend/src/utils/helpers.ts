// ── 프론트엔드 공용 유틸 ──
// App.tsx, ChatView.tsx, HomeView.tsx, Sidebar.tsx 등에서 중복 제거

export function nowIso(): string {
  return new Date().toISOString()
}

export function stripMarkdown(text: string): string {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\[\d+\]/g, "")
    .replace(/!?\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

const GENERIC_TITLES = [
  "새 대화", "New Thread", "새 스레드", "Untitled",
  "New Conversation", "제목 없음", "CORVUS X",
  "AI ORCHESTRA", "AI Orchestra", "CONVUS X",
]

export function isGenericThreadTitle(title: string): boolean {
  if (!title || title.trim().length === 0) return true
  const t = title.trim()
  return GENERIC_TITLES.some((g) => t === g || t.startsWith(g + " "))
}

export function findBaseUserMessageIndex(
  messages: Array<{ role: string }>,
  targetIndex: number
): number {
  for (let i = targetIndex; i >= 0; i--) {
    if (messages[i]?.role === "user") return i
  }
  return targetIndex
}

export function findNextUserMessageIndex(
  messages: Array<{ role: string }>,
  fromIndex: number
): number {
  for (let i = fromIndex + 1; i < messages.length; i++) {
    if (messages[i]?.role === "user") return i
  }
  return messages.length
}

// URL 스킴 화이트리스트 (javascript: URL 방지)
export function isSafeUrl(url: string): boolean {
  const trimmed = String(url ?? "").trim().toLowerCase()
  if (!trimmed) return false
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("mailto:") || trimmed.startsWith("/") || trimmed.startsWith("#")) return true
  // 프로토콜 없는 상대 경로 허용
  if (!trimmed.includes(":")) return true
  return false
}

// ── 조건부 로깅 (dev 환경에서만 출력) ──
const IS_DEV = (import.meta as any).env?.DEV ?? (typeof process !== "undefined" && process.env?.NODE_ENV !== "production")

export const devLog = {
  log: (...args: unknown[]) => { if (IS_DEV) console.log(...args) },
  warn: (...args: unknown[]) => { if (IS_DEV) console.warn(...args) },
  error: (...args: unknown[]) => { console.error(...args) },  // 에러는 항상 출력
}

// debounce 유틸
export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>
  return ((...args: any[]) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }) as T
}
