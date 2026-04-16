#\!/bin/bash
# 서버에서 직접 실행: ssh root@1.201.125.92 "bash /opt/corvusx/build-and-restart.sh"
cd /opt/corvusx/server
echo "[1] TypeScript 빌드..."
rm -rf dist
./node_modules/.bin/tsc 2>&1 | tail -20
if [ $? -ne 0 ]; then
  echo "빌드 실패\!"
  exit 1
fi
echo "[2] 서비스 재시작..."
systemctl restart corvusx-backend
sleep 2
echo "[3] 상태 확인..."
systemctl is-active corvusx-backend
curl -s http://localhost:8000/api/auth/me
echo ""
echo "완료\!"
