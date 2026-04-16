# CORVUS X Hotfix — Critic + PMO + 픽셀 오피스 전체 배포 (v2)
# 작업 폴더: C:\Users\User\Desktop\CONVUS_V2
#
# 변경 파일:
#   server/src/director/*.ts (6개 — 디렉토리 신규)
#   server/src/routes/director.ts
#   server/src/routes/directorStream.ts (SSE GET/POST/OPTIONS)
#   server/src/index.ts (라우트 등록 + import)
#   corvusx-game.html
#   corvusx-office.html
#
# 실행: powershell -ExecutionPolicy Bypass -File "C:\Users\User\Desktop\CONVUS_V2\deploy\hotfix-critic-pmo.ps1"

Set-Location "C:\Users\User\Desktop\CONVUS_V2"
$SERVER = "root@1.201.125.92"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " CORVUS X Hotfix v2 — Director + Office Deploy" -ForegroundColor Cyan
Write-Host " (CONVUS_V2 workspace)" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# ─ Step 0: 서버에 director/ 디렉토리 생성 (없으면) ────────────────────────────
Write-Host ""
Write-Host "[0/7] Ensure /opt/corvusx/server/src/director/ exists..." -ForegroundColor Cyan
ssh $SERVER "mkdir -p /opt/corvusx/server/src/director && echo OK"
if ($LASTEXITCODE -ne 0) { Write-Host "    [ERROR] mkdir 실패" -ForegroundColor Red; exit 1 }
Write-Host "    director/ 디렉토리 OK" -ForegroundColor Green

# ─ Step 1: director TS 6개 업로드 ──────────────────────────────────────────
Write-Host ""
Write-Host "[1/7] scp director files (6) to server..." -ForegroundColor Cyan

$directorFiles = @(
    "CeoBriefing.ts",
    "CriticReview.ts",
    "DirectorAgent.ts",
    "PmoCoordinator.ts",
    "ProjectSession.ts",
    "TaskDecomposer.ts"
)
foreach ($f in $directorFiles) {
    scp "server/src/director/$f" "${SERVER}:/opt/corvusx/server/src/director/"
    if ($LASTEXITCODE -ne 0) { Write-Host "    [ERROR] $f 업로드 실패" -ForegroundColor Red; exit 1 }
    Write-Host "    $f OK" -ForegroundColor Green
}

# ─ Step 2: director routes 2개 업로드 ──────────────────────────────────────
Write-Host ""
Write-Host "[2/7] scp director route files..." -ForegroundColor Cyan
scp "server/src/routes/director.ts"        "${SERVER}:/opt/corvusx/server/src/routes/"
if ($LASTEXITCODE -ne 0) { Write-Host "    [ERROR] director.ts 업로드 실패" -ForegroundColor Red; exit 1 }
Write-Host "    director.ts OK" -ForegroundColor Green

scp "server/src/routes/directorStream.ts"  "${SERVER}:/opt/corvusx/server/src/routes/"
if ($LASTEXITCODE -ne 0) { Write-Host "    [ERROR] directorStream.ts 업로드 실패" -ForegroundColor Red; exit 1 }
Write-Host "    directorStream.ts OK" -ForegroundColor Green

# ─ Step 3: index.ts 업로드 (라우트 등록 반영) ──────────────────────────────
Write-Host ""
Write-Host "[3/7] scp index.ts (route registration)..." -ForegroundColor Cyan
scp "server/src/index.ts" "${SERVER}:/opt/corvusx/server/src/"
if ($LASTEXITCODE -ne 0) { Write-Host "    [ERROR] index.ts 업로드 실패" -ForegroundColor Red; exit 1 }
Write-Host "    index.ts OK" -ForegroundColor Green

# ─ Step 4: 백엔드 빌드 + 재시작 ────────────────────────────────────────────
Write-Host ""
Write-Host "[4/7] Server build + restart..." -ForegroundColor Cyan
ssh $SERVER "cd /opt/corvusx/server && rm -rf dist && ./node_modules/.bin/tsc 2>&1 | tail -30 && systemctl restart corvusx-backend && sleep 2 && systemctl is-active corvusx-backend"
if ($LASTEXITCODE -ne 0) { Write-Host "    [ERROR] 빌드/재시작 실패" -ForegroundColor Red; exit 1 }
Write-Host "    Backend build + restart OK" -ForegroundColor Green

# ─ Step 5: corvusx-game.html 정적 배포 ─────────────────────────────────────
Write-Host ""
Write-Host "[5/7] Deploy corvusx-game.html..." -ForegroundColor Cyan
if (Test-Path "corvusx-game.html") {
    scp "corvusx-game.html" "${SERVER}:/var/www/corvusx/"
    if ($LASTEXITCODE -ne 0) { Write-Host "    [ERROR] corvusx-game.html 업로드 실패" -ForegroundColor Red; exit 1 }
    Write-Host "    corvusx-game.html OK" -ForegroundColor Green
} else {
    Write-Host "    corvusx-game.html 없음 (건너뜀)" -ForegroundColor Yellow
}

# ─ Step 6: corvusx-office.html 픽셀 오피스 UI 배포 ─────────────────────────
Write-Host ""
Write-Host "[6/7] Deploy corvusx-office.html..." -ForegroundColor Cyan
if (Test-Path "corvusx-office.html") {
    scp "corvusx-office.html" "${SERVER}:/var/www/corvusx/"
    if ($LASTEXITCODE -ne 0) { Write-Host "    [ERROR] corvusx-office.html 업로드 실패" -ForegroundColor Red; exit 1 }
    Write-Host "    corvusx-office.html OK" -ForegroundColor Green
} else {
    Write-Host "    corvusx-office.html 없음 (건너뜀)" -ForegroundColor Yellow
}

# ─ Step 7: 배포 확인 ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[7/7] Verify deployment..." -ForegroundColor Cyan
ssh $SERVER @"
systemctl is-active corvusx-backend
echo '--- routes ---'
curl -s -o /dev/null -w 'auth/me:    %{http_code}\n' https://app.cloudcookie.co.kr/api/auth/me
curl -s -o /dev/null -w 'office.html: %{http_code}\n' https://app.cloudcookie.co.kr/corvusx-office.html
curl -s -o /dev/null -w 'game.html:   %{http_code}\n' https://app.cloudcookie.co.kr/corvusx-game.html
curl -s -o /dev/null -w 'director/stream OPTIONS: %{http_code}\n' -X OPTIONS https://app.cloudcookie.co.kr/api/director/stream
echo '--- dist ---'
ls -la /opt/corvusx/server/dist/director/ 2>/dev/null | head -10
ls -la /opt/corvusx/server/dist/routes/director*.js 2>/dev/null
"@
Write-Host ""

Write-Host "============================================" -ForegroundColor Green
Write-Host " Hotfix v2 완료!" -ForegroundColor Green
Write-Host " https://app.cloudcookie.co.kr" -ForegroundColor Green
Write-Host " https://app.cloudcookie.co.kr/corvusx-game.html" -ForegroundColor Green
Write-Host " https://app.cloudcookie.co.kr/corvusx-office.html" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
