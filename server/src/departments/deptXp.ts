/**
 * deptXp.ts — Phase 5 타이쿤 게임 레이어
 *
 * 9개 부서(marketing/finance/legal/market/compete/rnd/data/content/sns) 에 대한
 * XP/레벨/누적 통계를 SQLite 에 보관한다. Director 가 부서 task 를 끝낼 때마다
 * awardXp() 를 호출해 누적한다. 프런트엔드가 /api/departments/stats 로 폴링.
 *
 * 레벨 공식: level = floor(sqrt(xp / 100))
 *   - L1: 100xp, L2: 400xp, L3: 900xp, L5: 2500xp ...
 *   - 완만한 성장 곡선 — 같은 부서를 반복 사용할수록 천천히 레벨업
 *
 * XP 부여:
 *   - 성공 (dept_done): +10 xp, tasks_completed +1
 *   - 실패 (dept_error): +3 xp, tasks_failed +1  (실패도 학습으로 치지만 낮은 보상)
 *
 * 비용/성공률은 파생 통계 — 실시간 계산하여 /api/departments/stats 응답에 포함.
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../observability/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_DIR = resolve(__dirname, '../../../data');
const DB_PATH = resolve(DB_DIR, 'corvusx-memory.db');

export type DeptXpOutcome = 'success' | 'error';

export interface DeptStatsRow {
  dept_id: string;
  xp: number;
  level: number;
  tasks_completed: number;
  tasks_failed: number;
  total_cost_usd: number;
  last_updated: string;
}

export interface DeptStatsResponse {
  departments: Array<DeptStatsRow & {
    success_rate: number;      // 0.0 ~ 1.0
    next_level_xp: number;     // 다음 레벨까지 필요 누적 XP
    progress_to_next: number;  // 0.0 ~ 1.0 (현재 레벨 구간 내 진척도)
  }>;
  aggregate: {
    total_xp: number;
    total_tasks: number;
    total_cost_usd: number;
    overall_success_rate: number;
  };
}

let _db: any = null;

function getDb(): any {
  if (_db) return _db;

  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });

  _db = new Database(DB_PATH);
  _db.exec(`PRAGMA journal_mode = WAL;`);
  _db.exec(`PRAGMA synchronous = NORMAL;`);

  _db.exec(`
    CREATE TABLE IF NOT EXISTS dept_xp (
      dept_id          TEXT PRIMARY KEY,
      xp               INTEGER NOT NULL DEFAULT 0,
      level            INTEGER NOT NULL DEFAULT 0,
      tasks_completed  INTEGER NOT NULL DEFAULT 0,
      tasks_failed     INTEGER NOT NULL DEFAULT 0,
      total_cost_usd   REAL NOT NULL DEFAULT 0,
      last_updated     TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return _db;
}

function calcLevel(xp: number): number {
  return Math.max(0, Math.floor(Math.sqrt(xp / 100)));
}

function xpNeededForLevel(level: number): number {
  // 역함수: level = floor(sqrt(xp/100))  →  xp = level² * 100
  return level * level * 100;
}

/**
 * 부서 task 완료(또는 실패) 시 호출. Director.ts dept_done/dept_error 핸들러에서 사용.
 * blocking 금지 — await 하되 예외는 상위에서 삼키는 식이 권장됨.
 */
export async function awardXp(
  deptId: string,
  outcome: DeptXpOutcome,
  costUsd: number = 0
): Promise<void> {
  try {
    const db = getDb();
    const xpGain = outcome === 'success' ? 10 : 3;

    // UPSERT + 원자적 갱신
    const upsert = db.prepare(`
      INSERT INTO dept_xp (dept_id, xp, level, tasks_completed, tasks_failed, total_cost_usd, last_updated)
      VALUES (@dept_id, @xp_gain, @level, @completed, @failed, @cost, datetime('now'))
      ON CONFLICT(dept_id) DO UPDATE SET
        xp              = xp + @xp_gain,
        tasks_completed = tasks_completed + @completed,
        tasks_failed    = tasks_failed + @failed,
        total_cost_usd  = total_cost_usd + @cost,
        last_updated    = datetime('now')
    `);

    upsert.run({
      dept_id: deptId,
      xp_gain: xpGain,
      level: calcLevel(xpGain),        // 첫 INSERT 시 사용될 level
      completed: outcome === 'success' ? 1 : 0,
      failed: outcome === 'error' ? 1 : 0,
      cost: Number.isFinite(costUsd) && costUsd > 0 ? costUsd : 0,
    });

    // 누적 xp 기반으로 level 재계산 (UPDATE 경로에선 level 이 낡을 수 있음)
    const current = db.prepare(`SELECT xp FROM dept_xp WHERE dept_id = ?`).get(deptId) as
      | { xp: number }
      | undefined;
    if (current) {
      const nextLevel = calcLevel(current.xp);
      db.prepare(`UPDATE dept_xp SET level = ? WHERE dept_id = ?`).run(nextLevel, deptId);
    }
  } catch (err) {
    logger.warn({ err, deptId, outcome }, '[deptXp] awardXp failed — ignoring');
  }
}

/**
 * 모든 부서의 XP/레벨/성공률 + 집계 반환. /api/departments/stats 핸들러에서 사용.
 */
export function getAllDeptStats(): DeptStatsResponse {
  try {
    const db = getDb();
    const rows = db
      .prepare(`SELECT dept_id, xp, level, tasks_completed, tasks_failed, total_cost_usd, last_updated FROM dept_xp ORDER BY xp DESC`)
      .all() as DeptStatsRow[];

    const departments = rows.map((row) => {
      const tasks = row.tasks_completed + row.tasks_failed;
      const success_rate = tasks > 0 ? row.tasks_completed / tasks : 0;
      const currentLevelFloor = xpNeededForLevel(row.level);
      const nextLevelFloor = xpNeededForLevel(row.level + 1);
      const span = Math.max(1, nextLevelFloor - currentLevelFloor);
      const progress_to_next = Math.max(0, Math.min(1, (row.xp - currentLevelFloor) / span));
      return {
        ...row,
        success_rate,
        next_level_xp: nextLevelFloor,
        progress_to_next,
      };
    });

    const total_xp = departments.reduce((acc, d) => acc + d.xp, 0);
    const total_completed = departments.reduce((acc, d) => acc + d.tasks_completed, 0);
    const total_failed = departments.reduce((acc, d) => acc + d.tasks_failed, 0);
    const total_tasks = total_completed + total_failed;
    const total_cost_usd = departments.reduce((acc, d) => acc + d.total_cost_usd, 0);

    return {
      departments,
      aggregate: {
        total_xp,
        total_tasks,
        total_cost_usd,
        overall_success_rate: total_tasks > 0 ? total_completed / total_tasks : 0,
      },
    };
  } catch (err) {
    logger.warn({ err }, '[deptXp] getAllDeptStats failed');
    return {
      departments: [],
      aggregate: { total_xp: 0, total_tasks: 0, total_cost_usd: 0, overall_success_rate: 0 },
    };
  }
}
