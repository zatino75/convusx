# CORVUS X Hotfix — StatusHistoryBlock 완전 숨기기 + 시스템프롬프트 강화 + ToolCallTimeline 클릭
# Red box 1: 응답 완료 후 StatusHistoryBlock 완전 제거
# Red box 2: 시스템 프롬프트 — 코드블록/테이블 과도 사용 금지 강화
# Red box 3: ToolCallTimeline 클릭 시 전체 내용 펼치기
# Run: powershell -ExecutionPolicy Bypass -File "C:\Users\User\Desktop\CONVUS X\deploy\hotfix.ps1"
Set-Location "C:\Users\User\Desktop\CONVUS X"
$SERVER = "root@1.201.125.92"

Write-Host "[1] scp backend file (agentLoop.ts)..." -ForegroundColor Cyan
scp "server/src/agent/agentLoop.ts" "${SERVER}:/opt/corvusx/server/src/agent/"
if ($LASTEXITCODE -ne 0) { Write-Host "scp backend failed" -ForegroundColor Red; exit 1 }
Write-Host "    agentLoop.ts uploaded" -ForegroundColor Green

Write-Host "[2] server build + restart..." -ForegroundColor Cyan
ssh $SERVER "bash /opt/corvusx/deploy/server-build.sh"
if ($LASTEXITCODE -ne 0) { Write-Host "server build failed" -ForegroundColor Red; exit 1 }
Write-Host "    server build done" -ForegroundColor Green

Write-Host "[3] scp frontend files..." -ForegroundColor Cyan
scp "frontend/src/components/chat/MessageBubble.tsx"      "${SERVER}:/opt/corvusx/frontend/src/components/chat/"
scp "frontend/src/components/chat/ToolCallTimeline.tsx"   "${SERVER}:/opt/corvusx/frontend/src/components/chat/"
if ($LASTEXITCODE -ne 0) { Write-Host "scp frontend failed" -ForegroundColor Red; exit 1 }
Write-Host "    frontend files uploaded" -ForegroundColor Green

Write-Host "[4] frontend build + deploy..." -ForegroundColor Cyan
ssh $SERVER "cd /opt/corvusx/frontend && npm run build && rsync -a --delete dist/ /var/www/corvusx/"
if ($LASTEXITCODE -ne 0) { Write-Host "frontend build failed" -ForegroundColor Red; exit 1 }
Write-Host "    frontend build done" -ForegroundColor Green

Write-Host ""
Write-Host "Hotfix done!  https://app.cloudcookie.co.kr" -ForegroundColor Green
