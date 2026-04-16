#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# deploy-all.sh — CORVUS X 전체 배포 스크립트
# 대상: root@1.201.125.92 (gabia Ubuntu 22.04)
#
# 사용법:
#   bash deploy-all.sh              # 전체 배포 (백엔드 + 게임 HTML)
#   bash deploy-all.sh --dry-run    # 실제 배포 없이 검사만
#   bash deploy-all.sh --no-build   # 소스 동기화만 (빌드/재시작 없음)
#
# 전제:
#  - ssh key 로 root@1.201.125.92 접속 가능 (ssh-copy-id 완료)
#  - 원격 /opt/corvusx/server 이미 존재
#  - /var/www/corvusx nginx root 이미 존재
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ─── 색상 ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()     { printf "${CYAN}[deploy]${NC} %s\n" "$*"; }
ok()      { printf "${GREEN}[  OK  ]${NC} %s\n" "$*"; }
warn()    { printf "${YELLOW}[ WARN ]${NC} %s\n" "$*"; }
err()     { printf "${RED}[ERROR ]${NC} %s\n" "$*" >&2; }
section() { printf "\n${BOLD}${CYAN}══ %s ══${NC}\n" "$*"; }

# ─── 설정 ─────────────────────────────────────────────────────────────────────
REMOTE_HOST="root@1.201.125.92"
REMOTE_SERVER="/opt/corvusx/server"
REMOTE_WEB="/var/www/corvusx"

LOCAL_ROOT="$(cd "$(dirname "$0")" && pwd)"
LOCAL_SERVER_SRC="${LOCAL_ROOT}/server/src"
LOCAL_GAME_HTML="${LOCAL_ROOT}/corvusx-game.html"

# ─── 플래그 ───────────────────────────────────────────────────────────────────
DRY_RUN=false
NO_BUILD=false

for arg in "$@"; do
  case "$arg" in
    --dry-run)  DRY_RUN=true ;;
    --no-build) NO_BUILD=true ;;
    --help|-h)
      echo "사용법: bash deploy-all.sh [--dry-run] [--no-build]"
      exit 0 ;;
  esac
done

$DRY_RUN && warn "DRY-RUN 모드 — 실제 전송/실행 없이 검사만 수행"

# ─── SSH 연결 확인 ─────────────────────────────────────────────────────────────
section "SSH 연결 확인"
if ! ssh -o ConnectTimeout=10 -o BatchMode=yes "${REMOTE_HOST}" "echo connected" &>/dev/null; then
  err "SSH 연결 실패: ${REMOTE_HOST}"
  err "SSH 키 설정 확인: ssh-copy-id ${REMOTE_HOST}"
  exit 1
fi
ok "SSH 연결: ${REMOTE_HOST}"

# ═══════════════════════════════════════════════════════════════════════════════
# 1. 서버 TypeScript 소스 동기화
# ═══════════════════════════════════════════════════════════════════════════════
section "서버 소스 동기화"

# 이번 세션에서 추가/수정된 핵심 파일 목록
declare -a NEW_FILES=(
  "director/DirectorAgent.ts"
  "director/CeoBriefing.ts"
  "director/TaskDecomposer.ts"
  "director/ProjectSession.ts"
  "departments/DepartmentAgent.ts"
  "departments/DepartmentRegistry.ts"
  "memory/sqliteMemory.ts"
  "routes/director.ts"
  "routes/directorStream.ts"
  "adapters/wrappers.ts"
  "index.ts"
)

log "변경 파일 목록:"
for rel in "${NEW_FILES[@]}"; do
  if [[ -e "${LOCAL_SERVER_SRC}/${rel}" ]]; then
    printf "  ${GREEN}✔${NC} %s\n" "$rel"
  else
    printf "  ${YELLOW}?${NC} %s (로컬에 없음 — 스킵)\n" "$rel"
  fi
done

if $DRY_RUN; then
  log "[DRY-RUN] rsync 스킵"
else
  # 전체 src/ 미러링 (삭제 없이 — 안전)
  rsync -avz \
    --exclude='node_modules' \
    --exclude='dist' \
    --exclude='*.db' \
    --exclude='*.db-*' \
    --exclude='.env' \
    "${LOCAL_SERVER_SRC}/" \
    "${REMOTE_HOST}:${REMOTE_SERVER}/src/"
  ok "src/ 동기화 완료"

  # package.json + tsconfig 동기화
  rsync -avz \
    "${LOCAL_ROOT}/server/package.json" \
    "${LOCAL_ROOT}/server/tsconfig.json" \
    "${REMOTE_HOST}:${REMOTE_SERVER}/" 2>/dev/null || \
    warn "package.json / tsconfig.json 동기화 건너뜀 (파일 없음)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 2. 게임 HTML 배포
# ═══════════════════════════════════════════════════════════════════════════════
section "게임 HTML 배포"

if [[ -f "${LOCAL_GAME_HTML}" ]]; then
  if $DRY_RUN; then
    log "[DRY-RUN] corvusx-game.html 전송 스킵"
  else
    rsync -avz "${LOCAL_GAME_HTML}" "${REMOTE_HOST}:${REMOTE_WEB}/corvusx-game.html"
    ok "corvusx-game.html 배포 완료"
  fi
else
  warn "corvusx-game.html 없음: ${LOCAL_GAME_HTML} — 스킵"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 3. 원격 빌드 + 서비스 재시작
# ═══════════════════════════════════════════════════════════════════════════════
if $NO_BUILD; then
  warn "--no-build 플래그 — 빌드/재시작 스킵"
elif $DRY_RUN; then
  log "[DRY-RUN] 원격 빌드 스킵"
else
  section "원격 TypeScript 빌드 + 서비스 재시작"

  ssh "${REMOTE_HOST}" bash -s <<'REMOTE_EOF'
set -euo pipefail
cd /opt/corvusx/server

echo "▶ npm install (의존성 갱신)"
npm install --omit=dev 2>&1 | tail -3

echo "▶ TypeScript 컴파일"
rm -rf dist
./node_modules/.bin/tsc 2>&1
echo "✔ 컴파일 성공"

echo "▶ 서비스 재시작"
systemctl restart corvusx-backend

echo "▶ 5초 대기 후 상태 확인"
sleep 5

if systemctl is-active --quiet corvusx-backend; then
  echo "✔ corvusx-backend: ACTIVE"
else
  echo "✘ corvusx-backend: FAILED — 최근 로그:"
  journalctl -u corvusx-backend -n 40 --no-pager
  exit 1
fi

echo "▶ 로컬 API 헬스체크"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/api/auth/me || echo "000")
if [[ "$HTTP" == "200" || "$HTTP" == "401" ]]; then
  echo "✔ API 응답 정상: HTTP $HTTP"
else
  echo "✘ API 무응답: HTTP $HTTP"
  journalctl -u corvusx-backend -n 20 --no-pager
  exit 1
fi
REMOTE_EOF

  ok "백엔드 빌드 & 재시작 완료"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 4. 최종 검증
# ═══════════════════════════════════════════════════════════════════════════════
section "최종 검증"

if $DRY_RUN; then
  log "[DRY-RUN] 검증 스킵"
else
  ssh "${REMOTE_HOST}" bash -s <<'VERIFY_EOF'
echo "── 포트 LISTEN ──"
ss -tlnp | grep -E ':(80|443|8000)' || echo "(없음)"

echo ""
echo "── 서비스 상태 ──"
systemctl status corvusx-backend --no-pager -l | head -10

echo ""
echo "── 최근 로그 (5줄) ──"
journalctl -u corvusx-backend -n 5 --no-pager

echo ""
echo "── 외부 접근 확인 ──"
EXT=$(curl -s -o /dev/null -w "%{http_code}" https://app.cloudcookie.co.kr/api/auth/me 2>/dev/null || echo "ERR")
echo "https://app.cloudcookie.co.kr → HTTP $EXT"

echo ""
echo "── SSE 엔드포인트 확인 ──"
SSE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X OPTIONS https://app.cloudcookie.co.kr/api/director/stream 2>/dev/null || echo "ERR")
echo "OPTIONS /api/director/stream → HTTP $SSE"
VERIFY_EOF
fi

# ─── 완료 ─────────────────────────────────────────────────────────────────────
printf "\n${GREEN}${BOLD}"
printf "╔══════════════════════════════════════════╗\n"
printf "║  CORVUS X 배포 완료 ✔                    ║\n"
printf "║  https://app.cloudcookie.co.kr           ║\n"
printf "╚══════════════════════════════════════════╝\n"
printf "${NC}\n"
