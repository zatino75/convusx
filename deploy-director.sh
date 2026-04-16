#\!/bin/bash
# CORVUS X — Director Agent 배포 스크립트
# 실행: bash deploy-director.sh
# 서버: root@1.201.125.92

SERVER="root@1.201.125.92"
REMOTE="/opt/corvusx/server"
LOCAL_SRC="$(dirname "$0")/server/src"

echo "======================================"
echo "  CORVUS X Director Agent 배포"
echo "======================================"
echo ""

# 1. 새 파일들 서버로 업로드
echo "[1/4] 새 파일 업로드 중..."
rsync -avz --progress \
  "$LOCAL_SRC/director/" "$SERVER:$REMOTE/src/director/" \
  "$LOCAL_SRC/departments/" "$SERVER:$REMOTE/src/departments/" \
  "$LOCAL_SRC/connectors/" "$SERVER:$REMOTE/src/connectors/" \
  "$LOCAL_SRC/plugins/PluginManager.ts" "$SERVER:$REMOTE/src/plugins/" \
  "$LOCAL_SRC/adapters/wrappers.ts" "$SERVER:$REMOTE/src/adapters/" \
  "$LOCAL_SRC/routes/director.ts" "$SERVER:$REMOTE/src/routes/" \
  "$LOCAL_SRC/http/websocket.ts" "$SERVER:$REMOTE/src/http/" \
  "$LOCAL_SRC/index.ts" "$SERVER:$REMOTE/src/" \
  2>&1 || { echo "rsync 실패. scp로 개별 파일 전송 시도..."; }

# rsync가 없으면 scp로 개별 파일 전송
if \! command -v rsync &>/dev/null; then
  echo "  scp로 전송 중..."
  FILES=(
    "src/director/TaskDecomposer.ts"
    "src/director/ProjectSession.ts"
    "src/director/DirectorAgent.ts"
    "src/departments/DepartmentRegistry.ts"
    "src/departments/DepartmentAgent.ts"
    "src/departments/depts/market.ts"
    "src/departments/depts/compete.ts"
    "src/departments/depts/legal.ts"
    "src/departments/depts/finance.ts"
    "src/departments/depts/marketing.ts"
    "src/departments/depts/rnd.ts"
    "src/departments/depts/data.ts"
    "src/departments/depts/content.ts"
    "src/departments/depts/sns.ts"
    "src/connectors/tavily.ts"
    "src/connectors/posthog.ts"
    "src/connectors/pubmed.ts"
    "src/connectors/supabase.ts"
    "src/adapters/wrappers.ts"
    "src/plugins/PluginManager.ts"
    "src/routes/director.ts"
    "src/http/websocket.ts"
    "src/index.ts"
  )
  for f in "${FILES[@]}"; do
    dir=$(dirname "$f")
    ssh "$SERVER" "mkdir -p $REMOTE/$dir"
    scp "$(dirname "$0")/server/$f" "$SERVER:$REMOTE/$f"
    echo "  ✓ $f"
  done
fi

echo ""
echo "[2/4] 서버에서 TypeScript 빌드 중..."
ssh "$SERVER" "cd $REMOTE && rm -rf dist && ./node_modules/.bin/tsc 2>&1 | tail -30" || {
  echo "빌드 오류 발생. 아래 에러를 확인하세요."
  ssh "$SERVER" "cd $REMOTE && ./node_modules/.bin/tsc 2>&1"
  exit 1
}

echo ""
echo "[3/4] 서버 재시작 중..."
ssh "$SERVER" "systemctl restart corvusx-backend && sleep 2 && systemctl is-active corvusx-backend"

echo ""
echo "[4/4] API 정상 동작 확인..."
ssh "$SERVER" "curl -s https://app.cloudcookie.co.kr/api/auth/me | python3 -c 'import sys,json; d=json.load(sys.stdin); print(\"✓ 서버 응답 정상:\", d)' 2>/dev/null || curl -s http://localhost:8000/api/auth/me"

echo ""
echo "======================================"
echo "  배포 완료\!"
echo "  새 엔드포인트:"
echo "  POST /api/director/start"
echo "  GET  /api/director/session"
echo "  GET  /api/director/connectors"
echo "======================================"
