# CORVUS X Deploy Script (Phase 5) - PowerShell
# Run: powershell -ExecutionPolicy Bypass -File ".\deploy\deploy.ps1"
Set-Location "C:\Users\User\Desktop\CONVUS X"
$SERVER = "root@1.201.125.92"

# 1) git lock
Write-Host "[1] Remove stale git lock..." -ForegroundColor Cyan
if (Test-Path ".git\index.lock") {
    Remove-Item -Force ".git\index.lock"
    Write-Host "    Removed" -ForegroundColor Green
} else {
    Write-Host "    No lock file" -ForegroundColor Gray
}

# 2) git add
Write-Host "[2] git add..." -ForegroundColor Cyan
git add `
  "server/src/agent/agentLoopBridge.ts" `
  "server/src/agent/toolBootstrap.ts" `
  "server/src/agent/triggerDetection.ts" `
  "server/src/agent/tools/webFetch.ts" `
  "frontend/src/hooks/useSendChat.ts" `
  "deploy/deploy.ps1" `
  "deploy/local-sync.ps1"
if ($LASTEXITCODE -ne 0) { Write-Host "git add failed" -ForegroundColor Red; exit 1 }
Write-Host "    Staged OK" -ForegroundColor Green

# 3) git commit
Write-Host "[3] git commit..." -ForegroundColor Cyan
git commit -m "feat: Phase 5 - triggerDetection + webFetch + domain_profile injection"
if ($LASTEXITCODE -ne 0) { Write-Host "    Nothing new to commit" -ForegroundColor Yellow; git status }

# 4) git push
Write-Host "[4] git push..." -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -ne 0) { Write-Host "    Push failed" -ForegroundColor Yellow }

# 5) scp to server
Write-Host "[5] scp to server..." -ForegroundColor Cyan
scp "server/src/agent/agentLoopBridge.ts"  "${SERVER}:/opt/corvusx/server/src/agent/"
scp "server/src/agent/toolBootstrap.ts"    "${SERVER}:/opt/corvusx/server/src/agent/"
scp "server/src/agent/triggerDetection.ts" "${SERVER}:/opt/corvusx/server/src/agent/"
scp "server/src/agent/tools/webFetch.ts"   "${SERVER}:/opt/corvusx/server/src/agent/tools/"
scp "frontend/src/hooks/useSendChat.ts"    "${SERVER}:/opt/corvusx/frontend/src/hooks/"
Write-Host "    scp done" -ForegroundColor Green

# 6) server build
Write-Host "[6] server build + restart..." -ForegroundColor Cyan
ssh $SERVER "set -e; echo '=== tsc ==='; cd /opt/corvusx/server; rm -rf dist; ./node_modules/.bin/tsc 2>&1 | tail -20; systemctl restart corvusx-backend; sleep 2; systemctl is-active corvusx-backend; echo '=== frontend ==='; cd /opt/corvusx/frontend; npm run build 2>&1 | tail -20; rsync -a --delete dist/ /var/www/corvusx/; echo '=== DONE ==='"

Write-Host ""
Write-Host "Deploy complete!  https://app.cloudcookie.co.kr" -ForegroundColor Green
