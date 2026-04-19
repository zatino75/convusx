/**
 * deepseek.ts — DeepSeek V3.2 어댑터
 * 현재는 CriticReview 1곳에서 사용.
 * 키 미설정 시 null 반환 → 호출부가 다음 폴백(Haiku)으로 자동 전환.
 */

import { logger } from "../observability/logger.js"

const DEEPSEEK_BASE = "https://api.deepseek.com/v1"

export interface DeepSeekMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface DeepSeekCallOptions {
  timeoutMs?: number
  maxTokens?: number
  temperature?: number
}

export async function callDeepSeek(
  model: string,
  messages: DeepSeekMessage[],
  opts: DeepSeekCallOptions = {},
): Promise<string | null> {
  const apiKey = String((globalThis as any)?.process?.env?.DEEPSEEK_API_KEY ?? "").trim()
  if (!apiKey) return null

  const timeoutMs = opts.timeoutMs ?? 30000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: opts.maxTokens ?? 2000,
        temperature: opts.temperature ?? 0.3,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      logger.warn({ status: res.status }, "[DeepSeek] 응답 실패")
      return null
    }
    const data: any = await res.json()
    const text = data?.choices?.[0]?.message?.content
    return typeof text === "string" ? text : null
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[DeepSeek] 호출 오류",
    )
    return null
  } finally {
    clearTimeout(timer)
  }
}
