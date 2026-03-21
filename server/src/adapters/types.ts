export type ProviderName =
  | "openai"
  | "claude"
  | "gemini"
  | "perplexity"


export type OrxTask =
  | "dialogue"
  | "reasoning"
  | "research"
  | "code"
  | "evidence"

export interface ModelRequest {
  provider: ProviderName
  model?: string
  task: OrxTask
  messages: Array<{
    role: "system" | "user" | "assistant"
    content: string
  }>
  temperature?: number
  max_tokens?: number
  stream?: boolean
  metadata?: Record<string, any>
  timeout_ms?: number
  max_retries?: number
}

export interface ModelAttempt {
  model: string
  status: "success" | "error"
  latency_ms: number
  error: string | null
  provider?: ProviderName
  attempt_no?: number
  outcome?: "success" | "error" | "timeout"
  retriable?: boolean
  http_status?: number
  error_code?: string
}

export interface ModelError {
  provider: ProviderName
  message: string
  code?: string
  retriable?: boolean
}

export interface ModelResponse {
  provider: ProviderName
  model: string
  answer: string
  usage?: any
  attempts: ModelAttempt[]
  error?: ModelError
}

export interface ModelAdapter {
  generate(req: ModelRequest): Promise<ModelResponse>
}
