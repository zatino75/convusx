@echo off
chcp 65001 >nul
echo ============================================
echo  CORVUS X - Commit + Deploy Script
echo  2026-04-11 Phase 5 triggerDetection + webFetch + domain_profile
echo ============================================
echo.

cd /d "C:\Users\User\Desktop\CONVUS X"

:: 1. 스테일 git 락 파일 제거
if exist ".git\index.lock" (
    echo [1/6] Removing stale git lock file...
    del /f ".git\index.lock"
    echo     Done.
) else (
    echo [1/6] No stale lock file found.
)

:: 2. git add
echo [2/6] Staging changes...
git add ^
  server/src/agent/agentLoopBridge.ts ^
  server/src/agent/toolBootstrap.ts ^
  server/src/agent/triggerDetection.ts ^
  server/src/agent/tools/webFetch.ts ^
  frontend/src/hooks/useSendChat.ts ^
  deploy/local-sync.ps1 ^
  deploy/corvus-commit-deploy.bat
if %errorlevel% neq 0 (
    echo [ERROR] git add failed
    pause
    exit /b 1
)
echo     Done.

:: 3. git commit
echo [3/6] Committing...
git commit -m "feat: Phase 5 - triggerDetection + webFetch + domain_profile injection"
if %errorlevel% neq 0 (
    echo [ERROR] git commit failed (nothing to commit?)
    git status
    pause
    exit /b 1
)
echo     Done.

:: 4. git push
echo [4/6] Pushing to remote...
git push origin main
if %errorlevel% neq 0 (
    echo [WARN] git push failed - check remote manually
) else (
    echo     Done.
)

:: 5. 서버 rsync
echo.
echo [5/6] Syncing to server (root@1.201.125.92)...
echo.

ssh root@1.201.125.92 "mkdir -p /opt/corvusx/server/src/agent/tools"

rsync -avz ^
  server/src/agent/agentLoopBridge.ts ^
  server/src/agent/toolBootstrap.ts ^
  server/src/agent/triggerDetection.ts ^
  "root@1.201.125.92:/opt/corvusx/server/src/agent/"

rsync -avz ^
  server/src/agent/tools/webFetch.ts ^
  "root@1.201.125.92:/opt/corvusx/server/src/agent/tools/"

rsync -avz ^
  frontend/src/hooks/useSendChat.ts ^
  "root@1.201.125.92:/opt/corvusx/frontend/src/hooks/"

:: 6. 서버에서 빌드 + 재시작
echo.
echo [6/6] Building and restarting on server...
ssh root@1.201.125.92 "^
  echo '=== Backend build ===' && ^
  cd /opt/corvusx/server && ^
  rm -rf dist && ^
  ./node_modules/.bin/tsc 2>&1 | tail -20 && ^
  systemctl restart corvusx-backend && ^
  sleep 2 && ^
  systemctl is-active corvusx-backend && ^
  echo '=== Frontend build ===' && ^
  cd /opt/corvusx/frontend && ^
  npm run build 2>&1 | tail -20 && ^
  rsync -a --delete dist/ /var/www/corvusx/ && ^
  echo '=== Deploy complete ==='"

echo.
echo ============================================
echo  Done! Check https://app.cloudcookie.co.kr
echo ============================================
pause
