/**
 * supabase.ts — Supabase DB 커넥터 (프로젝트 데이터 조회)
 */

export async function callSupabase(query: string): Promise<string> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return '[Supabase: 환경변수 없음 — DB 조회 건너뜀]';
  return `[Supabase: 쿼리 "${query}" 실행 준비 — 테이블 연결 후 사용 가능]`;
}

