# CORVUS X Deploy Script - PowerShell
Set-Location "C:\Users\User\Desktop\CONVUS X"

Write-Host "=== [1/5] Remove stale git lock ===" -ForegroundColor Cyan
if (Test-Path ".git\index.lock") {
    Remove-Item -Force ".git\index.lock"
    Write-Host "Removed .git\index.lock" -ForegroundColor Green
} else {
    Write-Host "No lock file found" -ForegroundColor Green
}

Write-Host "=== [2/5] git add ===" -ForegroundColor Cyan
git add `
  "frontend/src/components/settings/SettingsModal.tsx" `
  "frontend/src/App.tsx" `
  "frontend/src/api/url.ts" `
  "frontend/src/components/chat/ChatComposer.tsx" `
  "frontend/src/components/chat/ChatView.tsx" `
  "frontend/src/components/chat/MessageBubble.tsx" `
  "frontend/src/components/chat/EnsembleCompareView.tsx" `
  "frontend/src/components/chat/ToolCallTimeline.tsx" `
  "frontend/src/hooks/useSendChat.ts" `
  "frontend/src/i18n/en.json" `
  "frontend/src/i18n/ko.json" `
  "frontend/src/main.tsx" `
  "frontend/src/types/workspace.ts" `
  "server/src/http/auth.ts" `
  "server/src/http/middleware.ts" `
  "server/src/index.ts" `
  "server/src/routes/chat.ts" `
  "server/src/routes/chatSpecialPipelines.ts" `
  "server/src/routes/dashboard.ts" `
  "server/src/routes/usage.ts" `
  "server/src/routes/settings.ts" `
  "server/src/routes/feedback.ts" `
  "server/src/routes/benchmark.ts" `
  "server/src/orchestra/" `
  "server/tsconfig.json" `
  "CLAUDE.md" `
  "deploy/"
if ($LASTEXITCODE -ne 0) { Write-Host "git add failed" -ForegroundColor Red; exit 1 }
Write-Host "Staged OK" -ForegroundColor Green

Write-Host "=== [3/5] git commit ===" -ForegroundColor Cyan
$msg = "refactor: Phase 4 agent loop - orchestra deprecated + domain settings UI + feedback log"
git commit -m $msg
if ($LASTEXITCODE -ne 0) { Write-Host "Nothing to commit or commit failed" -ForegroundColor Yellow; git status }

Write-Host "=== [4/5] git push ===" -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -ne 0) { Write-Host "Push failed - check remote" -ForegroundColor Yellow }

Write-Host "=== [5/5] Server deploy ===" -ForegroundColor Cyan
ssh root@1.201.125.92 @"
echo '--- Backend rsync done, building ---'
cd /opt/corvusx/server
rm -rf dist
./node_modules/.bin/tsc 2>&1 | tail -5
systemctl restart corvusx-backend
sleep 2
systemctl is-active corvusx-backend
echo '--- Frontend build ---'
cd /opt/corvusx/frontend
npm run build 2>&1 | tail -5
rsync -a --delete dist/ /var/www/corvusx/
echo '--- DONE ---'
"@

Write-Host "=== Deploy complete! ===" -ForegroundColor Green
Write-Host "Check: https://app.cloudcookie.co.kr" -ForegroundColor Cyan
