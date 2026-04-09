// Repository interfaces for persistence abstraction
// Current implementation: JSON files (fileStore.ts)
// Future: SQLite or PostgreSQL

export interface ThreadMemoryEntry {
  thread_id: string
  project_id: string
  title?: string
  messages: any[]
  winner_provider?: string
  structured?: {
    summary: string
    facts: string[]
    decisions: string[]
    open_questions: string[]
    entities: string[]
    updated_at: number
  }
  created_at?: number
  updated_at?: number
}

export interface ProjectMemoryEntry {
  project_id: string
  task: string
  output: any
  timestamp: number
}

export interface SourceAsset {
  id: string
  project_id: string
  type: "text" | "file" | "link" | "thread_extract"
  title: string
  content: string
  url?: string
  status: "draft" | "confirmed"
  created_at: number
  updated_at?: number
  origin_thread_id?: string
  origin_message_id?: string
  tags?: string[]
}

export interface ScoreboardEntry {
  provider: string
  uses: number
  wins: number
  recent_uses: number
  recent_wins: number
  avg_latency: number
  avg_cost: number
  conflict_penalty: number
  last_used_at: number
}

export interface ThreadRepository {
  upsert(entry: ThreadMemoryEntry): void
  getById(threadId: string): ThreadMemoryEntry | null
  getByProject(projectId: string): ThreadMemoryEntry[]
  findSimilar(query: string, projectId: string, options?: { threshold?: number; limit?: number }): any[]
  clear(): void
}

export interface ProjectRepository {
  append(entry: ProjectMemoryEntry): void
  getByProject(projectId: string): ProjectMemoryEntry[]
  getSourceAssets(projectId: string): SourceAsset[]
  addSourceAsset(projectId: string, asset: SourceAsset): void
  updateSourceAsset(projectId: string, assetId: string, patch: Partial<SourceAsset>): void
  removeSourceAsset(projectId: string, assetId: string): void
  clear(): void
}

export interface ScoreboardRepository {
  read(): Record<string, any>
  save(data: Record<string, any>): void
  recordExecution(provider: string, result: any): void
  recordConflict(provider: string, payload: any): void
  recordJudgeOutcome(params: any): void
  getRoutingScore(provider: string, task?: string): any
  reset(): void
}
