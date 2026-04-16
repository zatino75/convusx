/**
 * routes/departments.ts — Phase 5 부서 통계 엔드포인트
 *
 * GET /api/departments/stats
 *   9개 부서의 XP/레벨/누적 완료건수/비용/성공률을 반환.
 *   프런트엔드 DashboardView/WorkforceView 의 타이쿤 카드가 폴링.
 */

import type { ExpressLikeResponse } from '../http/response.js';
import { getAllDeptStats } from '../departments/deptXp.js';

export async function getDepartmentsStatsRoute(_req: unknown, res: ExpressLikeResponse) {
  try {
    const stats = getAllDeptStats();
    return res.json?.({ ok: true, ...stats });
  } catch (e: any) {
    return res.json?.({ ok: false, error: String(e?.message ?? 'departments_stats_error') });
  }
}
