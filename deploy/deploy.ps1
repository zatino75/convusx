# CORVUS X Deploy Script - PowerShell
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
  "server/src/routes/chat.ts" `
  "server/src/agent/agentLoop.ts" `
  "server/src/agent/toolBootstrap.ts" `
  "server/src/agent/tools/generateImage.ts" `
  "server/src/agent/tools/generateVideo.ts" `
  "server/src/orchestra/benchmark.ts" `
  "server/src/index.ts" `
  "server/src/routes/sales.ts" `
  "frontend/src/App.tsx" `
  "frontend/src/hooks/useSendChat.ts" `
  "frontend/src/components/chat/AppViews.tsx" `
  "frontend/src/components/chat/SalesView.tsx" `
  "frontend/src/components/chat/ToolCallTimeline.tsx" `
  "frontend/src/components/layout/Sidebar.tsx" `
  "frontend/src/components/layout/SidebarIcons.tsx" `
  "frontend/src/components/settings/SettingsModal.tsx" `
  "frontend/src/i18n/ko.json" `
  "deploy/deploy.ps1"
if ($LASTEXITCODE -ne 0) { Write-Host "git add failed" -ForegroundColor Red; exit 1 }
Write-Host "    Staged OK" -ForegroundColor Green

# 3) git commit
Write-Host "[3] git commit..." -ForegroundColor Cyan
git commit -m "fix: ToolResult output → output_text 필드명 수정 (generateImage/generateVideo)"
if ($LASTEXITCODE -ne 0) { Write-Host "    Nothing new to commit" -ForegroundColor Yellow; git status }

# 4) git push
Write-Host "[4] git push..." -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -ne 0) { Write-Host "    Push failed" -ForegroundColor Yellow }

# 5) scp to server
Write-Host "[5] scp to server..." -ForegroundColor Cyan
# 백엔드
scp "server/src/routes/chat.ts"                                              "${SERVER}:/opt/corvusx/server/src/routes/"
scp "server/src/agent/agentLoop.ts"                                          "${SERVER}:/opt/corvusx/server/src/agent/"
scp "server/src/agent/toolBootstrap.ts"                                      "${SERVER}:/opt/corvusx/server/src/agent/"
scp "server/src/agent/tools/generateImage.ts"                                "${SERVER}:/opt/corvusx/server/src/agent/tools/"
scp "server/src/agent/tools/generateVideo.ts"                                "${SERVER}:/opt/corvusx/server/src/agent/tools/"
scp "server/src/orchestra/benchmark.ts"                                      "${SERVER}:/opt/corvusx/server/src/orchestra/"
scp "server/src/index.ts"                                                    "${SERVER}:/opt/corvusx/server/src/"
scp "server/src/routes/sales.ts"                                             "${SERVER}:/opt/corvusx/server/src/routes/"
# 프론트엔드
scp "frontend/src/App.tsx"                                                   "${SERVER}:/opt/corvusx/frontend/src/"
scp "frontend/src/hooks/useSendChat.ts"                                      "${SERVER}:/opt/corvusx/frontend/src/hooks/"
scp "frontend/src/components/chat/AppViews.tsx"                              "${SERVER}:/opt/corvusx/frontend/src/components/chat/"
scp "frontend/src/components/chat/SalesView.tsx"                             "${SERVER}:/opt/corvusx/frontend/src/components/chat/"
scp "frontend/src/components/chat/ToolCallTimeline.tsx"                      "${SERVER}:/opt/corvusx/frontend/src/components/chat/"
scp "frontend/src/components/layout/Sidebar.tsx"                             "${SERVER}:/opt/corvusx/frontend/src/components/layout/"
scp "frontend/src/components/layout/SidebarIcons.tsx"                        "${SERVER}:/opt/corvusx/frontend/src/components/layout/"
scp "frontend/src/components/settings/SettingsModal.tsx"                     "${SERVER}:/opt/corvusx/frontend/src/components/settings/"
scp "frontend/src/i18n/ko.json"                                              "${SERVER}:/opt/corvusx/frontend/src/i18n/"
Write-Host "    scp done" -ForegroundColor Green

# 6) server-side: orchestra dead code 삭제 (0 importer 확인 완료)
Write-Host "[6] orchestra dead code cleanup..." -ForegroundColor Cyan
$deadOrchestra = @(
  "runtime.ts", "runtimeHelpers.ts", "adaptiveRouter.ts", "adapterDispatcher.ts",
  "scoreboard.ts", "judge.ts", "planner.ts", "claims.ts", "conflicts.ts",
  "evaluationPipeline.ts", "runtimePipeline.ts", "orchestrationHandler.ts"
)
$rmCmd = ($deadOrchestra | ForEach-Object { "rm -f /opt/corvusx/server/src/orchestra/$_" }) -join " && "
ssh $SERVER $rmCmd
Write-Host "    orchestra cleanup done" -ForegroundColor Green

# 7) server build
Write-Host "[7] server build + restart..." -ForegroundColor Cyan
ssh $SERVER "bash /opt/corvusx/deploy/server-build.sh"

Write-Host ""
Write-Host "Deploy complete!  https://app.cloudcookie.co.kr" -ForegroundColor Green
