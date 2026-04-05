import type { Message, MessageStatus, Thread } from "./types/workspace";

export function createMessage(
  role: "user" | "assistant",
  content: string,
  status?: MessageStatus,
  extra?: Partial<Message>
): Message {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    role,
    content,
    createdAt: nowIso(),
    status,
    requestMeta: null,
    ...extra
  };
}

export function normalizeThreadTitle(input: string | null | undefined) {
  return String(input ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function nowIso() { return new Date().toISOString() }

function isGenericThreadTitle(input: string | null | undefined) {
  const normalized = normalizeThreadTitle(input);

  if (!normalized) return true;

  const genericTitles = new Set([
    "새 채팅",
    "새채팅",
    "new chat",
    "untitled",
    "chat",
    "thread",
    "global chat",
    "globalchat",
    "글로벌채팅",
    "글로벌 채팅",
    "일반채팅",
    "일반 채팅",
    "general chat"
  ]);

  return genericTitles.has(normalized);
}

export function makeThreadTitle(input: string) {
  const oneLine = input.replace(/\s+/g, " ").trim();
  if (!oneLine) return "새 채팅";
  return oneLine.slice(0, 32);
}

export function getVisibleMessages(thread: Thread | null) {
  return (thread?.messages ?? []).filter((message) => !message.isHidden);
}

function findBaseUserMessageIndex(messages: Message[], messageId: string) {
  return messages.findIndex((item) => item.id === messageId);
}

function findNextUserMessageIndex(messages: Message[], startIndex: number) {
  for (let index = startIndex + 1; index < messages.length; index += 1) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }
  return -1;
}

export function updateMessageStatus(
  messages: Message[],
  targetId: string,
  updater: (message: Message) => Message
): Message[] {
  return messages.map((message) => (message.id === targetId ? updater(message) : message));
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

type MediaItem = {
  id: string;
  url: string;
  alt: string;
  threadTitle: string;
  type: "image" | "video";
  provider?: string;
};

export function extractMediaFromThreads(threads: Thread[]): MediaItem[] {
  const results: MediaItem[] = [];
  const seen = new Set<string>();
  const mdImgRe = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  const htmlImgRe = /<img[^>]+src=["'](https?:\/\/[^"']+)["'][^>]*>/g;

  for (const thread of threads) {
    for (const msg of thread.messages ?? []) {
      const content = msg.content ?? "";
      const meta = (msg as any)?.requestMeta ?? {};

      // requestMeta.image_url — AI 생성 이미지 (DALL-E / Imagen / Midjourney)
      if (meta.image_url && !seen.has(meta.image_url)) {
        seen.add(meta.image_url);
        results.push({ id: `${thread.id}_meta_${results.length}`, url: meta.image_url, alt: "AI 생성 이미지", threadTitle: thread.title ?? "", type: "image", provider: meta.provider });
      }
      // requestMeta.image_urls — Midjourney 4장 그리드
      for (const url of (meta.image_urls ?? []) as string[]) {
        if (url && !seen.has(url)) {
          seen.add(url);
          results.push({ id: `${thread.id}_grid_${results.length}`, url, alt: "AI 생성 이미지", threadTitle: thread.title ?? "", type: "image", provider: "midjourney" });
        }
      }
      // requestMeta.video_url — Runway / Veo
      if (meta.video_url && !seen.has(meta.video_url)) {
        seen.add(meta.video_url);
        results.push({ id: `${thread.id}_video_${results.length}`, url: meta.video_url, alt: "AI 생성 비디오", threadTitle: thread.title ?? "", type: "video", provider: meta.provider });
      }

      // 마크다운 / HTML 이미지
      let m: RegExpExecArray | null;
      mdImgRe.lastIndex = 0;
      while ((m = mdImgRe.exec(content)) !== null) {
        const url = m[2];
        if (!seen.has(url)) { seen.add(url); results.push({ id: `${thread.id}_md_${results.length}`, url, alt: m[1] || "image", threadTitle: thread.title ?? "", type: "image" }); }
      }
      htmlImgRe.lastIndex = 0;
      while ((m = htmlImgRe.exec(content)) !== null) {
        const url = m[1];
        if (!seen.has(url)) { seen.add(url); results.push({ id: `${thread.id}_html_${results.length}`, url, alt: "image", threadTitle: thread.title ?? "", type: "image" }); }
      }
    }
  }
  return results;
}


type BenchmarkResult = {
  ok: boolean;
  case_count: number;
  single_providers: string[];
  comparison: {
    summary: { orchestra_wins: number; best_single_wins: number; ties: number; total_cases?: number; win_rate?: number; avg_quality_orchestra?: number; avg_quality_single?: number };
    pairwise: any[];
    task_improvement: Record<string, { total: number; orchestra_win: number; best_single_win: number; tie: number }>;
  };
};

export type { MediaItem };
