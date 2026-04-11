#!/bin/bash
# ============================================================
# [SERVER] CORVUS X — 서버에서 실행: 빌드 + 재시작
# 사용법: bash /opt/corvusx/deploy/server-build.sh
# ============================================================

set -e

echo "============================================"
echo " CORVUS X Server Build — $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================"

# ── 백엔드 빌드 ──────────────────────────────
echo ""
echo "[1/4] Backend tsc build..."
cd /opt/corvusx/server
rm -rf dist
./node_modules/.bin/tsc 2>&1
echo "tsc done"

# ── 백엔드 재시작 ────────────────────────────
echo ""
echo "[2/4] Restart backend service..."
systemctl restart corvusx-backend
sleep 2
STATUS=$(systemctl is-active corvusx-backend)
echo "corvusx-backend: $STATUS"
if [ "$STATUS" != "active" ]; then
  echo "[ERROR] Backend failed to start. Last 20 lines of log:"
  journalctl -u corvusx-backend -n 20 --no-pager
  exit 1
fi

# ── 프론트엔드 빌드 ──────────────────────────
echo ""
echo "[3/4] Frontend build..."
cd /opt/corvusx/frontend
npm run build

# ── 프론트엔드 배포 ──────────────────────────
echo ""
echo "[4/4] Deploy frontend dist..."
rsync -a --delete dist/ /var/www/corvusx/
echo "rsync done"

echo ""
echo "============================================"
echo " Done! https://app.cloudcookie.co.kr"
echo "============================================"
