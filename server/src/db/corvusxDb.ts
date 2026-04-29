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
    type      TEXT NOT NULL CHECK(type IN ('charge','usage','set_balance','reset')),
    amount    REAL NOT NULL,
    memo      TEXT,
    timestamp INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_credit_provider  ON credit_entries(provider);
  CREATE INDEX IF NOT EXISTS idx_credit_timestamp ON credit_entries(timestamp);

  -- 설정 시스템 (2026-04-29 추가) ─────────────────────────────────
  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS instructions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    scope      TEXT NOT NULL,
    content    TEXT NOT NULL,
    enabled    INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_instructions_scope ON instructions(scope);

  CREATE TABLE IF NOT EXISTS api_keys_meta (
    provider    TEXT PRIMARY KEY,
    masked_key  TEXT NOT NULL,
    is_valid    INTEGER NOT NULL DEFAULT 0,
    last_tested INTEGER,
    updated_at  INTEGER NOT NULL
  );

  -- Pre-fetch 데이터 캐시 (2026-04-29 추가, Session 8) ──────────────
  -- 부서/소스/쿼리별 외부 데이터 수집 결과 캐시. expires_at 만료 시 정리.
  CREATE TABLE IF NOT EXISTS prefetch_cache (
    cache_key   TEXT PRIMARY KEY,
    dept        TEXT NOT NULL,
    source_key  TEXT NOT NULL,
    content     TEXT NOT NULL,
    url         TEXT,
    fetched_at  INTEGER NOT NULL,
    ttl_seconds INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_prefetch_expires ON prefetch_cache(expires_at);
  CREATE INDEX IF NOT EXISTS idx_prefetch_dept_src ON prefetch_cache(dept, source_key);
`)

// ── 마이그레이션: 기존 CHECK 제약(charge/usage 만 허용) → set_balance/reset 추가 ──
// 2026-04-26: 잔액 직접 설정 / 사용량 리셋 entry 타입 도입.
// SQLite 는 CHECK 제약 ALTER 를 지원하지 않으므로 테이블 재생성 방식으로 마이그레이션.
try {
  const tableInfo = corvusxDb
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='credit_entries'")
    .get() as { sql?: string } | undefined
  const sqlText = String(tableInfo?.sql ?? "")
  if (sqlText && !sqlText.includes("set_balance")) {
    logger.info("[corvusxDb] migrating credit_entries CHECK constraint (add set_balance/reset)")
    corvusxDb.exec(`
      BEGIN;
      CREATE TABLE credit_entries_new (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        provider  TEXT NOT NULL,
        type      TEXT NOT NULL CHECK(type IN ('charge','usage','set_balance','reset')),
        amount    REAL NOT NULL,
        memo      TEXT,
        timestamp INTEGER NOT NULL
      );
      INSERT INTO credit_entries_new (id, provider, type, amount, memo, timestamp)
        SELECT id, provider, type, amount, memo, timestamp FROM credit_entries;
      DROP TABLE credit_entries;
      ALTER TABLE credit_entries_new RENAME TO credit_entries;
      CREATE INDEX IF NOT EXISTS idx_credit_provider  ON credit_entries(provider);
      CREATE INDEX IF NOT EXISTS idx_credit_timestamp ON credit_entries(timestamp);
      COMMIT;
    `)
  }
} catch (e) {
  logger.warn("[corvusxDb] credit_entries migration failed", { error: String(e) })
}

logger.info("[corvusxDb] opened", { path: DB_PATH })

/** 디버그/테스트용 — 두 테이블 비우기. */
export function _wipeAll(): void {
  corvusxDb.exec("DELETE FROM cost_entries; DELETE FROM credit_entries;")
}

/** 만료된 prefetch_cache 항목 삭제. scheduler 가 주기적으로 호출. */
export function purgeExpiredPrefetchCache(): { deleted: number } {
  const now = Math.floor(Date.now() / 1000)
  const r = corvusxDb.prepare(`DELETE FROM prefetch_cache WHERE expires_at < ?`).run(now)
  return { deleted: Number(r.changes ?? 0) }
}

export function getCorvusxDbPath(): string {
  return DB_PATH
}
