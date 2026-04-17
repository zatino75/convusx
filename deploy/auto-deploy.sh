#!/usr/bin/env bash
# auto-deploy.sh — CORVUS X 원클릭 프로덕션 배포 스크립트 (server + frontend)
#
# Usage (서버에서 실행):
#   sudo /opt/corvusx/deploy/auto-deploy.sh [--force]
#
# 전제:
#   - /opt/corvusx 가 git 저장소로 초기화되어 있고 origin 이 설정됨
#     (최초 1회는 deploy/setup-git-remote.sh 로 생성)
#   - /root/.ssh/convusx_deploy 개인키 + 해당 공개키가 GitHub repo
#     zatino75/convusx → Settings → Deploy keys 에 등록되어 있어야 함
#   - systemd unit corvusx-backend 가 설치되어 있음
#   - nginx 가 /var/www/corvusx/ 를 static root 로 서빙 중
#
# 동작:
#   1) git fetch + reset --hard origin/main
#   2) npm install (root → tsc/tsx 설치)
#   3) server 빌드 (tsc) → dist/index.js
#   4) frontend 빌드 (npm ci + npm run build) → rsync → /var/www/corvusx
#   5) systemctl restart corvusx-backend
#   6) /api/health 확인

set -euo pipefail

CORVUS_ROOT="${CORVUS_ROOT:-/opt/corvusx}"
TARGET_BRANCH="${TARGET_BRANCH:-main}"
SERVICE="${SERVICE:-corvusx-backend}"
HEALTH_URL="${HEALTH_URL:-http://localhost:8000/api/health}"
NGINX_ROOT="${NGINX_ROOT:-/var/www/corvusx}"

say() { printf '\n\033[1;36m=== %s ===\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m[ABORT] %s\033[0m\n' "$*" >&2; exit 1; }

[[ -d "${CORVUS_ROOT}/.git" ]] || die "${CORVUS_ROOT} 에 .git 없음. 최초 부트스트랩 필요."
cd "${CORVUS_ROOT}"

# Git 경고(dubious ownership) 우회
git config --global --add safe.directory "${CORVUS_ROOT}" 2>/dev/null || true

say "1. git fetch + reset --hard origin/${TARGET_BRANCH}"
PREV_HEAD=$(git rev-parse HEAD)
if ! git fetch origin "${TARGET_BRANCH}" --depth 50 2>&1; then
  die "git fetch 실패 — deploy key 가 GitHub repo 에 등록됐는지 확인 (/root/.ssh/convusx_deploy.pub)"
fi

# 로컬 수정사항 감지 (배포 중 서버에서 직접 편집된 파일은 보호용으로 stash)
if ! git diff --quiet HEAD || ! git diff --quiet --cached; then
  say "1b. 로컬 수정사항 감지 → 임시 stash"
  git stash push -u -m "auto-deploy-pre-pull-$(date +%s)" || true
fi

git reset --hard "origin/${TARGET_BRANCH}"
NEW_HEAD=$(git rev-parse HEAD)
echo "PREV: ${PREV_HEAD}"
echo "NEW : ${NEW_HEAD}"

say "2. npm install (루트 — tsc/tsx 필요)"
npm install --no-audit --no-fund --loglevel=warn

say "3. 서버 tsc 빌드 (server/)"
cd "${CORVUS_ROOT}/server"
rm -rf dist
"${CORVUS_ROOT}/node_modules/.bin/tsc"
[[ -f dist/index.js ]] || die "tsc 산출물 없음 — 서버 빌드 실패"
echo "server/dist/index.js OK ($(stat -c %y dist/index.js))"

say "4. 프론트엔드 빌드 (frontend/)"
cd "${CORVUS_ROOT}/frontend"
# frontend 는 자체 package-lock.json + node_modules 유지 (root 와 분리)
if [[ ! -d node_modules ]] || [[ package.json -nt node_modules ]]; then
  echo "frontend node_modules 설치/갱신"
  npm ci --no-audit --no-fund --loglevel=warn
fi
npm run build
[[ -f dist/index.html ]] || die "frontend dist/index.html 없음 — vite 빌드 실패"
echo "frontend/dist/index.html OK ($(stat -c %y dist/index.html))"

say "5. nginx root 로 rsync (${NGINX_ROOT})"
mkdir -p "${NGINX_ROOT}"
rsync -a --delete "${CORVUS_ROOT}/frontend/dist/" "${NGINX_ROOT}/"

# 정적 HTML 한 개(corvusx-office.html)는 vite 빌드 밖에 있으므로 별도 복사.
# rsync --delete 이후에 복사해야 살아남음.
if [[ -f "${CORVUS_ROOT}/corvusx-office.html" ]]; then
  cp "${CORVUS_ROOT}/corvusx-office.html" "${NGINX_ROOT}/corvusx-office.html"
  echo "corvusx-office.html copied"
fi

echo "${NGINX_ROOT} 반영:"
ls -la "${NGINX_ROOT}" | head -8

say "6. systemctl restart ${SERVICE}"
systemctl restart "${SERVICE}"
sleep 3
ACTIVE_STATE=$(systemctl is-active "${SERVICE}" || true)
if [[ "${ACTIVE_STATE}" != "active" ]]; then
  journalctl -u "${SERVICE}" -n 30 --no-pager
  die "${SERVICE} 활성화 실패 (state=${ACTIVE_STATE})"
fi

say "7. /api/health 확인"
HTTP_CODE=$(curl -s -o /tmp/corvus_health -w "%{http_code}" "${HEALTH_URL}" || echo "000")
head -c 400 /tmp/corvus_health || true
echo ""
if [[ "${HTTP_CODE}" != "200" ]]; then
  journalctl -u "${SERVICE}" -n 30 --no-pager
  die "헬스체크 실패 (HTTP ${HTTP_CODE})"
fi

say "DEPLOY OK"
echo "${PREV_HEAD} → ${NEW_HEAD}"
echo "Service: ${SERVICE} (${ACTIVE_STATE})"
echo "Health : ${HTTP_CODE}"
echo "Nginx  : ${NGINX_ROOT}"
