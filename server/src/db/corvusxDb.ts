/**
 * corvusxDb.ts — 비용/크레딧 영구 저장용 SQLite 인스턴스.
 *
 * 2026-04-25 신규 (Phase 8 — SQLite 영구 저장).
 *
 * DB 파일: <server>/data/corvusx.db
 *   - 운영(systemd WorkingDirectory=/opt/corvusx/server) → /opt/corvusx/server/data/corvusx.db
 *   - 로컬 dev(Windows)                                 → <repo>/server/data/corvusx.db
 *
 * 기존 `corvus.db`(db/database.ts)는 projects/threads/messages 용으로 분리되어 있다.
 * 비용·크레딧은 별도 파일로 운용 → 백업/복구 단위 분리.
 *
 * 테이블:
 *   cost_entries   — LLM 호출 단위 비용 entry
 *   credit_entries — provider 별 충전/사용 거래
 *
 * ⚠️ CLAUDE.md 규칙 #22 — 다시 in-memory 로 회귀 금지. 서버 재시작 후에도 데이터 유지.
 */

import Database from "better-sqlite3"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { mkdirSync } from "node:fs"
import { logger } from "../observability/logger.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// dist/db/corvusxDb.js → ../../data == server/data
const DATA_DIR = resolve(__dirname, "../../data")
mkdirSync(DATA_DIR, { recursive: true })

const DB_PATH = resolve(DATA_DIR, "corvusx.db")

export const corvusxDb = new Database(DB_PATH)
corvusxDb.pragma("journal_mode = WAL")
corvusxDb.pragma("foreign_keys = ON")

corvusxDb.exec(`
  CREATE TABLE IF NOT EXISTS cost_entries (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp     INTEGER NOT NULL,
    model         TEXT NOT NULL,
    provider      TEXT NOT NULL DEFAULT 'unknown',
    department    TEXT NOT NULL,
    input_tokens  INTEGER,
    output_tokens INTEGER,
    cost_usd      REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_cost_timestamp ON cost_entries(timestamp);
  CREATE INDEX IF NOT EXISTS idx_cost_model     ON cost_entries(model);

  CREATE TABLE IF NOT EXISTS credit_entries (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    provider  TEXT NOT NULL,
    type      TEXT NOT NULL CHECK(type IN ('charge','usage')),
    amount    REAL NOT NULL,
    memo      TEXT,
    timestamp INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_credit_provider  ON credit_entries(provider);
  CREATE INDEX IF NOT EXISTS idx_credit_timestamp ON credit_entries(timestamp);
`)

logger.info("[corvusxDb] opened", { path: DB_PATH })

/** 디버그/테스트용 — 두 테이블 비우기. */
export function _wipeAll(): void {
  corvusxDb.exec("DELETE FROM cost_entries; DELETE FROM credit_entries;")
}

export function getCorvusxDbPath(): string {
  return DB_PATH
}
