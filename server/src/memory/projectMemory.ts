type ProjectMemoryEntry = {
  project_id: string
  thread_id: string
  timestamp?: number
  goal?: any
  task?: string
  winner_provider?: string | null
  claims?: Record<string, string[]>
  provider_health?: any
  provider_latency?: any
  scoreboard?: any[]
  output?: any
}

type ProjectMemoryState = {
  entries: ProjectMemoryEntry[]
}

const ProjectStore: Record<string, ProjectMemoryState> = {}

export function appendProjectMemory(entry: ProjectMemoryEntry) {
  const projectId =
    entry?.project_id ??
    "default"

  const state =
    ProjectStore[projectId] ??
    { entries: [] }

  state.entries.push({
    ...entry,
    timestamp: entry?.timestamp ?? Date.now()
  })

  if (state.entries.length > 200) {
    state.entries.shift()
  }

  ProjectStore[projectId] = state
}

export function getProjectMemory(projectId: string) {
  return ProjectStore[projectId]?.entries ?? []
}

export function getLatestProjectContext(projectId: string) {
  const entries =
    ProjectStore[projectId]?.entries ??
    []

  const latest =
    entries.length > 0
      ? entries[entries.length - 1]
      : null

  return {
    project_id: projectId,
    entry_count: entries.length,
    latest_goal: latest?.goal ?? null,
    latest_task: latest?.task ?? null,
    latest_winner_provider: latest?.winner_provider ?? null,
    latest_scoreboard: latest?.scoreboard ?? [],
    latest_provider_health: latest?.provider_health ?? {},
    latest_provider_latency: latest?.provider_latency ?? {},
    latest_claims: latest?.claims ?? {},
    latest_output: latest?.output ?? null
  }
}
