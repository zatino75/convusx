import fs from "fs"
import path from "path"

export type UsageProviderNode = {
  calls: number
  success: number
  failure: number
  total_latency_ms: number
  avg_latency_ms: number
  total_input_tokens: number
  total_output_tokens: number
  total_tokens: number
  estimated_cost_usd: number
  last_model: string | null
  last_called_at: string | null
}

export type UsageStore = {
  providers: Record<string, UsageProviderNode>
  models: Record<string, UsageProviderNode>
  totals: UsageProviderNode
}

const USAGE_PATH = path.join(process.cwd(), "server", "usage.json")

function createNode(): UsageProviderNode {
  return {
    calls: 0,
    success: 0,
    failure: 0,
    total_latency_ms: 0,
    avg_latency_ms: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: 0,
    last_model: null,
    last_called_at: null
  }
}

function createStore(): UsageStore {
  return {
    providers: {},
    models: {},
    totals: createNode()
  }
}

function round(value: number, digits = 6) {
  return Number(Number(value || 0).toFixed(digits))
}

function loadUsage(): UsageStore {
  try {
    if (!fs.existsSync(USAGE_PATH)) {
      return createStore()
    }

    const raw = fs.readFileSync(USAGE_PATH, "utf-8")
    const parsed = JSON.parse(raw)

    return {
      providers: parsed?.providers ?? {},
      models: parsed?.models ?? {},
      totals: parsed?.totals ?? createNode()
    }
  } catch {
    return createStore()
  }
}

function saveUsage(store: UsageStore) {
  fs.writeFileSync(USAGE_PATH, JSON.stringify(store, null, 2), "utf-8")
}

function ensureNode(container: Record<string, UsageProviderNode>, key: string): UsageProviderNode {
  if (!container[key]) {
    container[key] = createNode()
  }
  return container[key]
}

function recalcNode(node: UsageProviderNode) {
  node.avg_latency_ms = node.calls > 0
    ? Math.round(node.total_latency_ms / node.calls)
    : 0

  node.total_tokens = node.total_input_tokens + node.total_output_tokens
  node.estimated_cost_usd = round(node.estimated_cost_usd, 8)
}

function applyUsage(node: UsageProviderNode, payload: any) {
  const success = Boolean(payload?.success)
  const latencyMs = Math.max(0, Number(payload?.latency_ms ?? 0))
  const inputTokens = Math.max(0, Number(payload?.input_tokens ?? 0))
  const outputTokens = Math.max(0, Number(payload?.output_tokens ?? 0))
  const estimatedCostUsd = Math.max(0, Number(payload?.estimated_cost_usd ?? 0))
  const model = typeof payload?.model === "string" && payload.model.trim().length > 0
    ? payload.model.trim()
    : null
  const calledAt = typeof payload?.called_at === "string" && payload.called_at.trim().length > 0
    ? payload.called_at
    : new Date().toISOString()

  node.calls += 1
  node.success += success ? 1 : 0
  node.failure += success ? 0 : 1
  node.total_latency_ms += latencyMs
  node.total_input_tokens += inputTokens
  node.total_output_tokens += outputTokens
  node.estimated_cost_usd += estimatedCostUsd
  node.last_model = model ?? node.last_model
  node.last_called_at = calledAt

  recalcNode(node)
}

function sortNodes<T extends Record<string, UsageProviderNode>>(input: T): T {
  const entries = Object.entries(input).sort((a, b) => {
    const costDelta = Number(b[1]?.estimated_cost_usd ?? 0) - Number(a[1]?.estimated_cost_usd ?? 0)
    if (costDelta !== 0) return costDelta
    return Number(b[1]?.calls ?? 0) - Number(a[1]?.calls ?? 0)
  })

  return Object.fromEntries(entries) as T
}

export function recordUsage(payload: {
  provider: string
  model?: string | null
  success: boolean
  latency_ms?: number
  input_tokens?: number
  output_tokens?: number
  estimated_cost_usd?: number
  called_at?: string
}) {
  const provider = String(payload?.provider ?? "").trim().toLowerCase()
  if (!provider) return

  const model = typeof payload?.model === "string" && payload.model.trim().length > 0
    ? payload.model.trim()
    : null

  const store = loadUsage()

  applyUsage(ensureNode(store.providers, provider), payload)

  if (model) {
    applyUsage(ensureNode(store.models, model), payload)
  }

  applyUsage(store.totals, payload)
  store.totals.last_called_at = payload?.called_at ?? new Date().toISOString()

  store.providers = sortNodes(store.providers)
  store.models = sortNodes(store.models)

  saveUsage(store)
}

export function readUsage(): UsageStore {
  const store = loadUsage()
  store.providers = sortNodes(store.providers)
  store.models = sortNodes(store.models)
  return store
}

export function buildUsageSummary() {
  const store = readUsage()

  return {
    providers: store.providers,
    models: store.models,
    totals: store.totals,
    top_provider_by_cost:
      Object.entries(store.providers)[0]?.[0] ?? null,
    top_model_by_cost:
      Object.entries(store.models)[0]?.[0] ?? null
  }
}
