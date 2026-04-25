/**
 * backup-session6.ts — Session 6 (2026-04-25) 스냅샷을 로컬 backup 디렉토리에 모은다.
 *
 * 2026-04-25 신규.
 *
 * 무엇을 모으는가:
 *   1. corvusx.db          (SQLite cost/credit 영구 저장)
 *   2. CLAUDE.md            (프로젝트 기술 truth)
 *   3. .env.template        (서버 .env 의 키 이름만 — 값 마스킹)
 *   4. README.md            (자동 생성 — 백업 인덱스)
 *
 * 이 스크립트는 **로컬 디스크에만** 저장한다 (Drive 업로드 X).
 * 출력 디렉토리: <repo>/backups/sessions/2026-04-25-session6/
 *
 * Drive 로의 업로드는 다음 중 하나로 별도 수행:
 *   - 사용자가 위 폴더를 직접 드래그해서 Drive 의 CORVUSX/sessions/ 에 올림
 *   - rclone copy backups/sessions/2026-04-25-session6 gdrive:CORVUSX/sessions/
 *
 * 사용:
 *   npm run backup-session6
 *   또는: npx tsx server/scripts/backup-session6.ts
 *
 * 환경변수:
 *   CORVUSX_DB_PATH — corvusx.db 절대경로 (기본: <cwd>/data/corvusx.db, 즉
 *                     운영에선 /opt/corvusx/server/data/corvusx.db)
 *   CORVUSX_ENV     — 마스킹할 .env 파일 경로 (기본: /etc/corvusx/.env)
 */

import fs from "node:fs"
import path from "node:path"

const SESSION_TAG = "2026-04-25-session6"

function resolveRepoRoot(startDir: string): string {
  let dir = startDir
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return startDir
}

const REPO_ROOT = resolveRepoRoot(process.cwd())
const OUT_DIR = path.join(REPO_ROOT, "backups", "sessions", SESSION_TAG)

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function copyIfExists(src: string, dstName: string): { ok: boolean; bytes: number; reason?: string } {
  if (!fs.existsSync(src)) return { ok: false, bytes: 0, reason: "missing" }
  try {
    const dst = path.join(OUT_DIR, dstName)
    fs.copyFileSync(src, dst)
    const stat = fs.statSync(dst)
    return { ok: true, bytes: stat.size }
  } catch (e: any) {
    return { ok: false, bytes: 0, reason: String(e?.message ?? e) }
  }
}

/** .env 파일에서 KEY 만 추출, 값은 SET / UNSET 으로 마스킹. */
function maskedEnvTemplate(envPath: string): string | null {
  if (!fs.existsSync(envPath)) return null
  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/)
  const out: string[] = [
    "# CORVUS X — .env keys snapshot (values masked)",
    `# source: ${envPath}`,
    `# session: ${SESSION_TAG}`,
    "",
  ]
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    const val = line.slice(eq + 1).trim()
    out.push(`${key}=${val ? "SET" : "UNSET"}`)
  }
  return out.join("\n") + "\n"
}

function writeReadme(items: Array<{ file: string; status: string; bytes: number }>): void {
  const lines = [
    `# CORVUS X — Session 6 백업 (${SESSION_TAG})`,
    "",
    "스냅샷 시각: " + new Date().toISOString(),
    "",
    "## 포함 파일",
    "",
    "| 파일 | 상태 | 크기 |",
    "|------|------|------|",
    ...items.map(i => `| ${i.file} | ${i.status} | ${i.bytes ? i.bytes + " B" : "—"} |`),
    "",
    "## Google Drive 업로드 (수동)",
    "",
    "이 폴더 전체를 Drive 의 `CORVUSX/sessions/2026-04-25-session6/` 로 업로드.",
    "또는 rclone:",
    "",
    "```bash",
    `rclone copy ${OUT_DIR.replace(/\\/g, "/")} gdrive:CORVUSX/sessions/${SESSION_TAG}/`,
    "```",
    "",
    "## 주의",
    "",
    "- `.env.template` 은 키 이름만 포함, 실제 시크릿 값은 미포함.",
    "- `corvusx.db` 는 비용/크레딧 거래 내역 — 외부 공유 시 주의.",
  ]
  fs.writeFileSync(path.join(OUT_DIR, "README.md"), lines.join("\n") + "\n", "utf-8")
}

function main() {
  ensureDir(OUT_DIR)

  const dbPath = process.env.CORVUSX_DB_PATH?.trim()
    || path.join(process.cwd(), "data", "corvusx.db")
  const envPath = process.env.CORVUSX_ENV?.trim() || "/etc/corvusx/.env"
  const claudeMd = path.join(REPO_ROOT, "CLAUDE.md")

  console.log(`[backup-session6] 출력: ${OUT_DIR}`)

  const items: Array<{ file: string; status: string; bytes: number }> = []

  // 1. SQLite
  const dbResult = copyIfExists(dbPath, "corvusx.db")
  items.push({
    file: "corvusx.db",
    status: dbResult.ok ? "✅ 복사" : `⚠ ${dbResult.reason}`,
    bytes: dbResult.bytes,
  })
  console.log(`  corvusx.db (${dbPath}): ${items[0].status}`)

  // 1b. WAL/SHM 도 같이 (옵션)
  for (const suffix of ["-wal", "-shm"] as const) {
    const r = copyIfExists(dbPath + suffix, `corvusx.db${suffix}`)
    if (r.ok) {
      items.push({ file: `corvusx.db${suffix}`, status: "✅ 복사", bytes: r.bytes })
      console.log(`  corvusx.db${suffix}: ✅`)
    }
  }

  // 2. CLAUDE.md
  const cmResult = copyIfExists(claudeMd, "CLAUDE.md")
  items.push({
    file: "CLAUDE.md",
    status: cmResult.ok ? "✅ 복사" : `⚠ ${cmResult.reason}`,
    bytes: cmResult.bytes,
  })
  console.log(`  CLAUDE.md: ${items.at(-1)!.status}`)

  // 3. .env.template (마스킹)
  const masked = maskedEnvTemplate(envPath)
  if (masked) {
    const dst = path.join(OUT_DIR, ".env.template")
    fs.writeFileSync(dst, masked, "utf-8")
    const stat = fs.statSync(dst)
    items.push({ file: ".env.template", status: "✅ 마스킹 후 저장", bytes: stat.size })
    console.log(`  .env.template (from ${envPath}): ✅ ${stat.size} B`)
  } else {
    items.push({ file: ".env.template", status: `⚠ ${envPath} 없음 (서버에서만 실행 가능)`, bytes: 0 })
    console.log(`  .env.template: ⚠ ${envPath} 없음`)
  }

  // 4. README
  writeReadme(items)
  console.log(`  README.md: ✅`)

  console.log("\n[backup-session6] 완료. Drive 업로드는 수동:")
  console.log(`  ${OUT_DIR}`)
}

main()
