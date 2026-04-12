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

# 2) git rm — orchestra dead code (0 importer) + chatSpecialPipelines
Write-Host "[2] git rm dead files..." -ForegroundColor Cyan
$deadFiles = @(
  "server/src/orchestra/runtime.ts",
  "server/src/orchestra/runtimeHelpers.ts",
  "server/src/orchestra/adaptiveRouter.ts",
  "server/src/orchestra/adapterDispatcher.ts",
  "server/src/orchestra/scoreboard.ts",
  "server/src/orchestra/judge.ts",
  "server/src/orchestra/planner.ts",
  "server/src/orchestra/claims.ts",
  "server/src/orchestra/conflicts.ts",
  "server/src/orchestra/evaluationPipeline.ts",
  "server/src/orchestra/runtimePipeline.ts",
  "server/src/orchestra/orchestrationHandler.ts",
  "server/src/orchestra/fileHandlers.ts",
  "server/src/orchestra/llmRouter.ts",
  "server/src/orchestra/usage.ts",
  "server/src/orchestra/visionHandlers.ts",
  "server/src/routes/chatSpecialPipelines.ts"
)
foreach ($f in $deadFiles) {
    if (Test-Path $f) {
        git rm --force $f 2>$null
        Write-Host "    rm $f" -ForegroundColor DarkGray
    } else {
        # already deleted from disk — just untrack if still in index
        git rm --cached --force $f 2>$null
        Write-Host "    untrack $f" -ForegroundColor DarkGray
    }
}
Write-Host "    git rm done" -ForegroundColor Green

# 3) git add
Write-Host "[3] git add..." -ForegroundColor Cyan
git add `
  "server/src/routes/chat.ts" `
  "server/src/agent/agentLoop.ts" `
  "server/src/adapters/claude.ts" `
  "server/src/agent/toolBootstrap.ts" `
  "server/src/agent/tools/generateImage.ts" `
  "server/src/agent/tools/generateVideo.ts" `
  "server/src/agent/tools/generateSlides.ts" `
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
  "deploy/server-build.sh" `
  "deploy/deploy.ps1"
if ($LASTEXITCODE -ne 0) { Write-Host "git add failed" -ForegroundColor Red; exit 1 }
Write-Host "    Staged OK" -ForegroundColor Green

# 4) git commit
Write-Host "[4] git commit..." -ForegroundColor Cyan
git commit -m "feat: advisor-tool-2026-03-01 적용 — Sonnet executor + Opus advisor (max_uses:5)"
if ($LASTEXITCODE -ne 0) { Write-Host "    Nothing new to commit" -ForegroundColor Yellow; git status }

# 5) git push
Write-Host "[5] git push..." -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -ne 0) { Write-Host "    Push failed" -ForegroundColor Yellow }

# 6) scp to server
Write-Host "[6] scp to server..." -ForegroundColor Cyan
# 백엔드
scp "server/src/routes/chat.ts"                                              "${SERVER}:/opt/corvusx/server/src/routes/"
scp "server/src/agent/agentLoop.ts"                                          "${SERVER}:/opt/corvusx/server/src/agent/"
scp "server/src/adapters/claude.ts"                                          "${SERVER}:/opt/corvusx/server/src/adapters/"
scp "server/src/agent/toolBootstrap.ts"                                      "${SERVER}:/opt/corvusx/server/src/agent/"
scp "server/src/agent/tools/generateImage.ts"                                "${SERVER}:/opt/corvusx/server/src/agent/tools/"
scp "server/src/agent/tools/generateVideo.ts"                                "${SERVER}:/opt/corvusx/server/src/agent/tools/"
scp "server/src/agent/tools/generateSlides.ts"                               "${SERVER}:/opt/corvusx/server/src/agent/tools/"
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
# 배포 스크립트
scp "deploy/server-build.sh"                                                 "${SERVER}:/opt/corvusx/deploy/"
Write-Host "    scp done" -ForegroundColor Green

# 7) server-side: orchestra dead code 삭제
Write-Host "[7] orchestra dead code cleanup on server..." -ForegroundColor Cyan
$deadOrchestra = @(
  "runtime.ts", "runtimeHelpers.ts", "adaptiveRouter.ts", "adapterDispatcher.ts",
  "scoreboard.ts", "judge.ts", "planner.ts", "claims.ts", "conflicts.ts",
  "evaluationPipeline.ts", "runtimePipeline.ts", "orchestrationHandler.ts",
  "fileHandlers.ts", "llmRouter.ts", "usage.ts", "visionHandlers.ts"
)
$rmCmd = ($deadOrchestra | ForEach-Object { "rm -f /opt/corvusx/server/src/orchestra/$_" }) -join " && "
ssh $SERVER $rmCmd
# chatSpecialPipelines.ts 도 삭제
ssh $SERVER "rm -f /opt/corvusx/server/src/routes/chatSpecialPipelines.ts"
Write-Host "    orchestra cleanup done" -ForegroundColor Green

# 8) server build
Write-Host "[8] server build + restart..." -ForegroundColor Cyan
ssh $SERVER "bash /opt/corvusx/deploy/server-build.sh"

Write-Host ""
Write-Host "Deploy complete!  https://app.cloudcookie.co.kr" -ForegroundColor Green
