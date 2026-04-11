# ============================================================
# [LOCAL] CORVUS X — 로컬에서 실행: 서버로 소스 파일 전송
# PowerShell에서 실행: powershell -ExecutionPolicy Bypass -File ".\deploy\local-sync.ps1"
# ============================================================

Set-Location "C:\Users\User\Desktop\CONVUS X"
$SERVER = "root@1.201.125.92"

Write-Host "=== [1/4] 백엔드 agent 소스 전송 ===" -ForegroundColor Cyan
scp server/src/agent/agentLoopBridge.ts  "${SERVER}:/opt/corvusx/server/src/agent/"
scp server/src/agent/toolBootstrap.ts    "${SERVER}:/opt/corvusx/server/src/agent/"
scp server/src/agent/triggerDetection.ts "${SERVER}:/opt/corvusx/server/src/agent/"
scp server/src/agent/tools/webFetch.ts   "${SERVER}:/opt/corvusx/server/src/agent/tools/"
Write-Host "백엔드 agent 전송 완료" -ForegroundColor Green

Write-Host "=== [2/4] 백엔드 routes 소스 전송 ===" -ForegroundColor Cyan
scp server/src/routes/dashboard.ts   "${SERVER}:/opt/corvusx/server/src/routes/"
scp server/src/routes/feedback.ts    "${SERVER}:/opt/corvusx/server/src/routes/"
scp server/src/routes/usage.ts       "${SERVER}:/opt/corvusx/server/src/routes/"
scp server/src/routes/settings.ts    "${SERVER}:/opt/corvusx/server/src/routes/"
scp server/src/routes/benchmark.ts   "${SERVER}:/opt/corvusx/server/src/routes/"
scp server/src/routes/chatSupport.ts "${SERVER}:/opt/corvusx/server/src/routes/"
Write-Host "백엔드 routes 전송 완료" -ForegroundColor Green

Write-Host "=== [3/4] 프론트엔드 소스 전송 ===" -ForegroundColor Cyan
scp frontend/src/components/settings/SettingsModal.tsx "${SERVER}:/opt/corvusx/frontend/src/components/settings/"
scp frontend/src/hooks/useSendChat.ts                  "${SERVER}:/opt/corvusx/frontend/src/hooks/"
Write-Host "프론트엔드 전송 완료" -ForegroundColor Green

Write-Host "=== [4/4] 서버에서 빌드 + 재시작 (server-build.sh 실행) ===" -ForegroundColor Cyan
Write-Host "이제 서버에서 server-build.sh 를 실행하세요." -ForegroundColor Yellow
Write-Host "  ssh root@1.201.125.92" -ForegroundColor White
Write-Host "  bash /opt/corvusx/deploy/server-build.sh" -ForegroundColor White
