/**
 * CORVUS X — Conversation Export API
 * 채팅 스레드를 Markdown/Text 형식으로 내보내기
 */
import { getThread, getMessagesByThread } from "../db/database.js";

type Req = { body: any };
type Res = { status(code: number): Res; json(body: any): void; setHeader(name: string, value: string): void; end(body?: any): void };

interface ExportRequest {
  threadId: string;
  format: "markdown" | "text";
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  status?: string;
  isHidden?: boolean;
}

function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return isoString;
  }
}

function sanitizeFilename(text: string): string {
  return text
    .replace(/[^a-zA-Z0-9\uAC00-\uD7AF_-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 100);
}

function generateMarkdown(thread: any, messages: Message[]): string {
  const title = thread.title || "대화";
  const createdAt = formatTime(thread.createdAt);
  const visibleMessages = messages.filter((m: Message) => !m.isHidden);

  let md = `# ${title}\n\n`;
  md += `**생성일**: ${createdAt}\n\n`;
  md += `---\n\n`;

  for (const msg of visibleMessages) {
    const role = msg.role === "user" ? "사용자" : "어시스턴트";
    const time = formatTime(msg.createdAt);
    md += `## ${role} — ${time}\n\n`;
    md += `${msg.content}\n\n`;
    md += `---\n\n`;
  }

  return md;
}

function generatePlainText(thread: any, messages: Message[]): string {
  const title = thread.title || "대화";
  const createdAt = formatTime(thread.createdAt);
  const visibleMessages = messages.filter((m: Message) => !m.isHidden);

  let text = `${title}\n`;
  text += `생성일: ${createdAt}\n`;
  text += `${"=".repeat(60)}\n\n`;

  for (const msg of visibleMessages) {
    const role = msg.role === "user" ? "사용자" : "어시스턴트";
    const time = formatTime(msg.createdAt);
    text += `[${role}] ${time}\n`;
    text += `${msg.content}\n`;
    text += `${"=".repeat(60)}\n\n`;
  }

  return text;
}

export function exportThreadRoute(req: Req, res: Res) {
  const { threadId, format } = (req.body ?? {}) as ExportRequest;

  if (!threadId || typeof threadId !== "string") {
    res.status(400).json({ ok: false, error: "missing_threadId" });
    return;
  }

  if (format !== "markdown" && format !== "text") {
    res.status(400).json({ ok: false, error: "invalid_format" });
    return;
  }

  const thread = getThread(threadId);
  if (!thread) {
    res.status(404).json({ ok: false, error: "thread_not_found" });
    return;
  }

  const messages = getMessagesByThread(threadId);

  let content: string;
  let contentType: string;
  let extension: string;

  if (format === "markdown") {
    content = generateMarkdown(thread, messages);
    contentType = "text/markdown;charset=utf-8";
    extension = "md";
  } else {
    content = generatePlainText(thread, messages);
    contentType = "text/plain;charset=utf-8";
    extension = "txt";
  }

  const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const sanitizedTitle = sanitizeFilename(thread.title);
  const filename = `CORVUS-X_${sanitizedTitle}_${timestamp}.${extension}`;

  res.status(200);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.end(content);
}
