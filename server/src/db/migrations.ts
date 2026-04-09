/**
 * CORVUS X — DB 마이그레이션 시스템
 *
 * 버전 기반 스키마 마이그레이션.
 * - _migrations 테이블에 적용된 마이그레이션 기록
 * - 각 마이그레이션은 { version, name, up } 형태
 * - 서버 시작 시 자동 실행 (runMigrations)
 * - 이미 적용된 마이그레이션은 스킵
 */

import type Database from "better-sqlite3"
import { logger } from "../observability/logger.js"

interface Migration {
  version: number
  name: string
  up: (db: Database) => void
}

// ── 마이그레이션 정의 ──
// 새 마이그레이션 추가 시 배열 끝에 추가하세요.
// version 번호는 순차 증가, 절대 변경/삭제 금지.

const migrations: Migration[] = [
  {
    version: 1,
    name: "add_rate_limit_buckets",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS rate_limit_buckets (
          bucket_id   TEXT PRIMARY KEY,
          tokens      REAL NOT NULL DEFAULT 0,
          last_refill INTEGER NOT NULL DEFAULT 0,
          updated_at  INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_rl_updated ON rate_limit_buckets(updated_at);
      `)
    }
  },
  {
    version: 2,
    name: "add_backup_metadata",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS backup_metadata (
          id          TEXT PRIMARY KEY,
          created_at  TEXT NOT NULL,
          size_bytes  INTEGER NOT NULL DEFAULT 0,
          description TEXT NOT NULL DEFAULT '',
          checksum    TEXT NOT NULL DEFAULT ''
        );
      `)
    }
  }
]

// ── 마이그레이션 실행 엔진 ──

function ensureMigrationsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TEXT NOT NULL
    );
  `)
}

function getAppliedVersions(db: Database): Set<number> {
  const rows = db.prepare("SELECT version FROM _migrations").all() as { version: number }[]
  return new Set(rows.map(r => r.version))
}

function recordMigration(db: Database, version: number, name: string): void {
  db.prepare(
    "INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)"
  ).run(version, name, new Date().toISOString())
}

/**
 * 미적용 마이그레이션을 순서대로 실행.
 * 서버 시작 시 database.ts에서 호출.
 */
export function runMigrations(db: Database): void {
  ensureMigrationsTable(db)
  const applied = getAppliedVersions(db)

  const pending = migrations.filter(m => !applied.has(m.version))
  if (pending.length === 0) {
    logger.debug("[migrations] no pending migrations")
    return
  }

  // 버전 순서대로 실행
  pending.sort((a, b) => a.version - b.version)

  for (const migration of pending) {
    try {
      logger.info(`[migrations] applying v${migration.version}: ${migration.name}`)
      // 트랜잭션 내에서 실행 (실패 시 롤백)
      const applyMigration = db.transaction(() => {
        migration.up(db)
        recordMigration(db, migration.version, migration.name)
      })
      applyMigration()
      logger.info(`[migrations] v${migration.version} applied successfully`)
    } catch (e) {
      logger.error(`[migrations] v${migration.version} FAILED`, {
        name: migration.name,
        error: e instanceof Error ? e.message : String(e)
      })
      throw e  // 마이그레이션 실패 시 서버 시작 중단
    }
  }

  logger.info(`[migrations] ${pending.length} migration(s) applied`)
}

/** 현재 DB 스키마 버전 반환 */
export function getCurrentVersion(db: Database): number {
  ensureMigrationsTable(db)
  const row = db.prepare("SELECT MAX(version) as max_version FROM _migrations").get() as { max_version: number | null }
  return row?.max_version ?? 0
}
