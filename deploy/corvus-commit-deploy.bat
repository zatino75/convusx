@echo off
chcp 65001 >nul
echo ============================================
echo  CORVUS X — Commit + Deploy Script
echo  2026-04-11 Phase 4 Agent Loop
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
  frontend/src/components/settings/SettingsModal.tsx ^
  frontend/src/App.tsx ^
  frontend/src/api/url.ts ^
  frontend/src/components/chat/ChatComposer.tsx ^
  frontend/src/components/chat/ChatView.tsx ^
  frontend/src/components/chat/MessageBubble.tsx ^
  frontend/src/hooks/useSendChat.ts ^
  frontend/src/i18n/en.json ^
  frontend/src/i18n/ko.json ^
  frontend/src/main.tsx ^
  frontend/src/types/workspace.ts ^
  frontend/src/auth/ ^
  frontend/src/components/chat/EnsembleCompareView.tsx ^
  frontend/src/components/chat/ToolCallTimeline.tsx ^
  server/src/http/auth.ts ^
  server/src/http/middleware.ts ^
  server/src/index.ts ^
  server/src/routes/chat.ts ^
  server/src/routes/chatSpecialPipelines.ts ^
  server/src/routes/dashboard.ts ^
  server/src/routes/usage.ts ^
  server/src/routes/settings.ts ^
  server/src/routes/feedback.ts ^
  server/src/routes/benchmark.ts ^
  server/src/routes/chatSupport.ts ^
  server/src/routes/auth.ts ^
  server/src/agent/ ^
  server/src/fusion/ ^
  server/src/memory/attachmentCache.ts ^
  server/src/regulation/ ^
  server/src/orchestra/ ^
  server/tsconfig.json ^
  server/tests/ ^
  server/vitest.config.js ^
  CLAUDE.md ^
  deploy/
if %errorlevel% neq 0 (
    echo [ERROR] git add failed
    pause
    exit /b 1
)
echo     Done.

:: 3. git commit
echo [3/6] Committing...
git commit -m "refactor: Phase 4 agent loop — orchestra 폐기 + domain settings UI + feedback log

- orchestra/runtime, runtimeHelpers, adaptiveRouter, adapterDispatcher,
  scoreboard, judge, planner, claims, conflicts → DEPRECATED stubs
- benchmark.ts: executeOrchestra → runAgentLoop (disable_tools / high_value)
- dashboard.ts: scoreboard import → readFeedbackLog (JSONL 기반)
- usage.ts: scoreboard/adaptiveRouter import 전면 제거, stub 반환
- settings.ts: resetModelScoreboardAll 제거
- SettingsModal.tsx: 도메인 탭 추가 (식품/액상전자담배/화장품/범용 프로파일 + 법규 갱신 주기)
- feedback: tool_call_log 패턴으로 전환 (JSONL append)"
if %errorlevel% neq 0 (
    echo [ERROR] git commit failed (nothing to commit?)
    git status
    pause
    exit /b 1
)
echo     Done.

:: 4. git push (선택적)
echo [4/6] Pushing to remote...
git push origin main
if %errorlevel% neq 0 (
    echo [WARN] git push failed — local commit is OK, check remote manually
) else (
    echo     Done.
)

:: 5. 서버 배포 — rsync + tsc + restart
echo.
echo [5/6] Deploying to server (root@1.201.125.92)...
echo.

:: 백엔드 소스 rsync
ssh root@1.201.125.92 "mkdir -p /opt/corvusx/server/src"
rsync -avz --delete ^
  --exclude="node_modules" ^
  --exclude="dist" ^
  "server/src/" ^
  "root@1.201.125.92:/opt/corvusx/server/src/"
rsync -avz "server/tsconfig.json" "root@1.201.125.92:/opt/corvusx/server/"
rsync -avz "server/package.json" "root@1.201.125.92:/opt/corvusx/server/" 2>nul

:: 프론트엔드 소스 rsync
rsync -avz --delete ^
  --exclude="node_modules" ^
  --exclude="dist" ^
  "frontend/src/" ^
  "root@1.201.125.92:/opt/corvusx/frontend/src/"
rsync -avz "frontend/index.html" "root@1.201.125.92:/opt/corvusx/frontend/" 2>nul
rsync -avz "frontend/vite.config.ts" "root@1.201.125.92:/opt/corvusx/frontend/" 2>nul
rsync -avz "frontend/tsconfig.json" "root@1.201.125.92:/opt/corvusx/frontend/" 2>nul

:: 서버에서 빌드 + 재시작
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
