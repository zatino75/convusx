export type ProviderName =
  | "openai"
  | "claude"
  | "gemini"
  | "perplexity"
  | string

export type MessageRole =
  | "system"
  | "user"
  | "assistant"
  | string

export type ModelMessage = {
  role: MessageRole
  content: any
}

export type ModelError = {
  provider: ProviderName
  message: string
  code?: string
  retriable?: boolean
}

export type ModelAttempt = {
  provider: ProviderName
  model?: string | null
  status: "success" | "error"
  latency_ms?: number
  error?: string | null
  attempt_no?: number
  outcome?: "success" | "error" | "timeout"
  retriable?: boolean
  http_status?: number
  error_code?: string
}

export type ModelUsage = {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  prompt_tokens?: number
  completion_tokens?: number
  estimated_cost_usd?: number
  [key: string]: any
}

export type ModelRequest = {
  provider: ProviderName
  model?: string
  task?: string
  mode?: string
  messages: ModelMessage[]
  temperature?: number
  max_tokens?: number
  timeout_ms?: number
  max_retries?: number
  metadata?: Record<string, any>
  thread_id?: string
  project_id?: string
  raw_input?: any
  stream?: boolean
  system_prompt?: string
  force_pro?: boolean
  onToken?: (chunk: string, meta?: any) => void | Promise<void>
  onEvent?: (event: any) => void | Promise<void>
}

export type ModelResponse = {
  provider: ProviderName
  model?: string | null
  /** 본문 텍스트의 유일한 공식 필드. 어댑터는 반드시 이 필드에 씀. */
  answer: string
  usage?: ModelUsage
  attempts: ModelAttempt[]
  error?: ModelError
  raw?: any
  output_text?: string
  answer_text?: string
  /**
   * @deprecated 어떤 어댑터도 이 필드를 세팅하지 않음. 사용 금지.
   * 이 필드를 읽던 wrappers.ts 버그로 Director 앙상블이 장기 고장 상태였음 (2026-04-16 수정).
   * 새 코드는 반드시 .answer 를 읽을 것. 호환성 유지를 위해 타입만 남김.
   */
  text?: string
  streaming_supported?: boolean
  [key: string]: any
}

export type ModelAdapter = {
  generate(req: ModelRequest): Promise<ModelResponse>
}
