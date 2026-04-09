// ── 환경별 설정 ──
// NODE_ENV 기반으로 dev/staging/production 설정 분리
// defaults.ts의 값을 기본값으로 유지하며, 환경별로 오버라이드

import {
  RATE_LIMIT_CHAT_RPM,
  RATE_LIMIT_GENERAL_RPM,
  RATE_LIMIT_CHAT_BURST,
  RATE_LIMIT_GENERAL_BURST
} from "./defaults.js"

export type AppEnv = "development" | "staging" | "production"

export function getAppEnv(): AppEnv {
  const raw = String(process.env.NODE_ENV ?? "development").trim().toLowerCase()
  if (raw === "production" || raw === "prod") return "production"
  if (raw === "staging" || raw === "stage") return "staging"
  return "development"
}

export interface EnvConfig {
  /** CORS 허용 도메인 목록 (빈 배열 = 전체 허용 "*") */
  corsOrigins: string[]
  /** 로그 레벨 */
  logLevel: string
  /** Chat rate limit RPM */
  rateLimitChatRpm: number
  /** General rate limit RPM */
  rateLimitGeneralRpm: number
  /** Chat burst */
  rateLimitChatBurst: number
  /** General burst */
  rateLimitGeneralBurst: number
  /** 응답 압축 활성화 */
  compressionEnabled: boolean
  /** DB 파일 경로 */
  dbPath: string
}

const ENV_DEFAULTS: Record<AppEnv, EnvConfig> = {
  development: {
    corsOrigins: [],  // 전체 허용
    logLevel: "debug",
    rateLimitChatRpm: RATE_LIMIT_CHAT_RPM,
    rateLimitGeneralRpm: RATE_LIMIT_GENERAL_RPM,
    rateLimitChatBurst: RATE_LIMIT_CHAT_BURST,
    rateLimitGeneralBurst: RATE_LIMIT_GENERAL_BURST,
    compressionEnabled: false,
    dbPath: "server/data/corvus.db"
  },
  staging: {
    corsOrigins: [],
    logLevel: "info",
    rateLimitChatRpm: RATE_LIMIT_CHAT_RPM,
    rateLimitGeneralRpm: RATE_LIMIT_GENERAL_RPM,
    rateLimitChatBurst: RATE_LIMIT_CHAT_BURST,
    rateLimitGeneralBurst: RATE_LIMIT_GENERAL_BURST,
    compressionEnabled: true,
    dbPath: "server/data/corvus.db"
  },
  production: {
    corsOrigins: [],  // .env의 CORS_ORIGINS로 오버라이드 권장
    logLevel: "warn",
    rateLimitChatRpm: RATE_LIMIT_CHAT_RPM * 2,
    rateLimitGeneralRpm: RATE_LIMIT_GENERAL_RPM * 2,
    rateLimitChatBurst: RATE_LIMIT_CHAT_BURST,
    rateLimitGeneralBurst: RATE_LIMIT_GENERAL_BURST,
    compressionEnabled: true,
    dbPath: "server/data/corvus.db"
  }
}

/** 현재 환경에 맞는 설정 반환 (.env 오버라이드 적용) */
export function getEnvConfig(): EnvConfig {
  const appEnv = getAppEnv()
  const defaults = { ...ENV_DEFAULTS[appEnv] }

  // .env 오버라이드
  const corsRaw = String(process.env.CORS_ORIGINS ?? "").trim()
  if (corsRaw) {
    defaults.corsOrigins = corsRaw.split(",").map(s => s.trim()).filter(Boolean)
  }

  const logLevel = String(process.env.LOG_LEVEL ?? "").trim()
  if (logLevel) defaults.logLevel = logLevel

  const dbPath = String(process.env.DB_PATH ?? "").trim()
  if (dbPath) defaults.dbPath = dbPath

  const compression = String(process.env.COMPRESSION_ENABLED ?? "").trim().toLowerCase()
  if (compression === "true") defaults.compressionEnabled = true
  if (compression === "false") defaults.compressionEnabled = false

  return defaults
}
