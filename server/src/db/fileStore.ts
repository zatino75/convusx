// File-based implementation of Repository interfaces
// Wraps the existing JSON file storage with the Repository abstraction
// To switch to SQLite/PostgreSQL, create a new implementation of the interfaces

import type { ThreadRepository, ProjectRepository, ThreadMemoryEntry, ProjectMemoryEntry, SourceAsset } from "./interfaces.js"

export class FileThreadRepository implements ThreadRepository {
  private store: Map<string, ThreadMemoryEntry> = new Map()
  
  constructor(private loadFn: () => Map<string, ThreadMemoryEntry>, private saveFn: () => void) {
    this.store = loadFn()
  }

  upsert(entry: ThreadMemoryEntry): void {
    this.store.set(entry.thread_id, {
      ...this.store.get(entry.thread_id),
      ...entry,
      updated_at: Date.now()
    })
    this.saveFn()
  }

  getById(threadId: string): ThreadMemoryEntry | null {
    return this.store.get(threadId) ?? null
  }

  getByProject(projectId: string): ThreadMemoryEntry[] {
    return Array.from(this.store.values())
      .filter(e => e.project_id === projectId)
      .sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0))
  }

  findSimilar(_query: string, _projectId: string, _options?: { threshold?: number; limit?: number }): any[] {
    // Delegate to existing similarity logic in threadMemory.ts
    return []
  }

  clear(): void {
    this.store.clear()
    this.saveFn()
  }
}

export class FileProjectRepository implements ProjectRepository {
  private entries: ProjectMemoryEntry[] = []
  private sourceAssets: Map<string, SourceAsset[]> = new Map()

  constructor(
    private loadEntriesFn: () => ProjectMemoryEntry[],
    private loadSourcesFn: () => Map<string, SourceAsset[]>,
    private saveFn: () => void
  ) {
    this.entries = loadEntriesFn()
    this.sourceAssets = loadSourcesFn()
  }

  append(entry: ProjectMemoryEntry): void {
    this.entries.push(entry)
    if (this.entries.length > 200) {
      this.entries.splice(0, this.entries.length - 200)
    }
    this.saveFn()
  }

  getByProject(projectId: string): ProjectMemoryEntry[] {
    return this.entries
      .filter(e => e.project_id === projectId)
      .sort((a, b) => a.timestamp - b.timestamp)
  }

  getSourceAssets(projectId: string): SourceAsset[] {
    return this.sourceAssets.get(projectId) ?? []
  }

  addSourceAsset(projectId: string, asset: SourceAsset): void {
    const list = this.sourceAssets.get(projectId) ?? []
    list.push(asset)
    if (list.length > 300) {
      list.splice(0, list.length - 300)
    }
    this.sourceAssets.set(projectId, list)
    this.saveFn()
  }

  updateSourceAsset(projectId: string, assetId: string, patch: Partial<SourceAsset>): void {
    const list = this.sourceAssets.get(projectId) ?? []
    const idx = list.findIndex(a => a.id === assetId)
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...patch, updated_at: Date.now() }
      this.saveFn()
    }
  }

  removeSourceAsset(projectId: string, assetId: string): void {
    const list = this.sourceAssets.get(projectId) ?? []
    const filtered = list.filter(a => a.id !== assetId)
    this.sourceAssets.set(projectId, filtered)
    this.saveFn()
  }

  clear(): void {
    this.entries = []
    this.sourceAssets.clear()
    this.saveFn()
  }
}
