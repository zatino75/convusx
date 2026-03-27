export type ThreadMemory = {
  threadId: string;
  projectId: string;

  summary: string;
  decisions: string[];
  facts: string[];
  openQuestions: string[];
  entities: string[];

  updatedAt: number;
};

type State = {
  memories: ThreadMemory[];
};

const state: State = {
  memories: []
};

const API_BASE = "http://localhost:8000";

function normalizeText(value: string): string {
  return String(value ?? "").trim();
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(normalized);
  }

  return out;
}

function normalizeMemory(memory: Partial<ThreadMemory>): ThreadMemory {
  return {
    threadId: normalizeText(String(memory?.threadId ?? "")),
    projectId: normalizeText(String(memory?.projectId ?? "")),
    summary: normalizeText(String(memory?.summary ?? "")),
    decisions: uniqueStrings(Array.isArray(memory?.decisions) ? memory.decisions : []),
    facts: uniqueStrings(Array.isArray(memory?.facts) ? memory.facts : []),
    openQuestions: uniqueStrings(Array.isArray(memory?.openQuestions) ? memory.openQuestions : []),
    entities: uniqueStrings(Array.isArray(memory?.entities) ? memory.entities : []),
    updatedAt: Number(memory?.updatedAt ?? Date.now())
  };
}

function sortMemories(memories: ThreadMemory[]): ThreadMemory[] {
  return [...memories].sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));
}

function upsertLocalMemory(memory: ThreadMemory) {
  const idx = state.memories.findIndex((m) => m.threadId === memory.threadId);

  if (idx === -1) {
    state.memories.push(memory);
  } else {
    state.memories[idx] = memory;
  }
}

function replaceProjectMemories(projectId: string, nextMemories: ThreadMemory[]) {
  state.memories = state.memories.filter((memory) => memory.projectId !== projectId);
  state.memories.push(...nextMemories);
}

export function upsertThreadMemory(memory: ThreadMemory) {
  const normalized = normalizeMemory(memory);
  if (!normalized.threadId) return;

  upsertLocalMemory(normalized);
}

export function getThreadMemory(threadId: string): ThreadMemory | undefined {
  return state.memories.find((m) => m.threadId === threadId);
}

export function getProjectMemories(projectId: string): ThreadMemory[] {
  return sortMemories(
    state.memories.filter((m) => m.projectId === projectId)
  );
}

export async function fetchThreadMemory(threadId: string): Promise<ThreadMemory | null> {
  const safeThreadId = normalizeText(threadId);
  if (!safeThreadId) return null;

  const url = new URL("/api/thread-memory", API_BASE);
  url.searchParams.set("threadId", safeThreadId);

  const response = await fetch(url.toString(), {
    method: "GET"
  });

  if (!response.ok) {
    throw new Error("failed_to_fetch_thread_memory");
  }

  const payload = await response.json();
  const data = payload?.data;

  if (!data) return null;

  const structured = data?.structured ?? {};

  const normalized = normalizeMemory({
    threadId: data?.thread_id,
    projectId: data?.project_id,
    summary: structured?.summary,
    decisions: structured?.decisions,
    facts: structured?.facts,
    openQuestions: structured?.open_questions,
    entities: structured?.entities,
    updatedAt: data?.updated_at
  });

  if (normalized.threadId) {
    upsertLocalMemory(normalized);
  }

  return normalized.threadId ? normalized : null;
}

export async function fetchProjectThreadMemories(projectId: string): Promise<ThreadMemory[]> {
  const safeProjectId = normalizeText(projectId);
  if (!safeProjectId) return [];

  const url = new URL("/api/project-thread-memories", API_BASE);
  url.searchParams.set("projectId", safeProjectId);

  const response = await fetch(url.toString(), {
    method: "GET"
  });

  if (!response.ok) {
    throw new Error("failed_to_fetch_project_thread_memories");
  }

  const payload = await response.json();
  const data = Array.isArray(payload?.data) ? payload.data : [];

  const normalizedMemories = data
    .map((entry: any) =>
      normalizeMemory({
        threadId: entry?.thread_id,
        projectId: entry?.project_id,
        summary: entry?.structured?.summary,
        decisions: entry?.structured?.decisions,
        facts: entry?.structured?.facts,
        openQuestions: entry?.structured?.open_questions,
        entities: entry?.structured?.entities,
        updatedAt: entry?.updated_at
      })
    )
    .filter((memory: ThreadMemory) => memory.threadId.length > 0 && memory.projectId.length > 0);

  replaceProjectMemories(safeProjectId, normalizedMemories);
  return getProjectMemories(safeProjectId);
}

export async function refreshProjectThreadMemories(projectId: string): Promise<ThreadMemory[]> {
  return fetchProjectThreadMemories(projectId);
}
