# CORVUS X — Director Agent 서버 배포
# PowerShell 7에서 실행: pwsh -File "배포실행.ps1"

$SERVER = "root@1.201.125.92"
$REMOTE = "/opt/corvusx/server"
$LOCAL  = Split-Path -Parent $MyInvocation.MyCommand.Path
$SRC    = "$LOCAL\server\src"

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  CORVUS X Director Agent 배포" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan

# 새로 추가된 파일 목록
$FILES = @(
    "director\TaskDecomposer.ts",
    "director\ProjectSession.ts",
    "director\DirectorAgent.ts",
    "departments\DepartmentRegistry.ts",
    "departments\DepartmentAgent.ts",
    "departments\depts\market.ts",
    "departments\depts\compete.ts",
    "departments\depts\legal.ts",
    "departments\depts\finance.ts",
    "departments\depts\marketing.ts",
    "departments\depts\rnd.ts",
    "departments\depts\data.ts",
    "departments\depts\content.ts",
    "departments\depts\sns.ts",
    "connectors\tavily.ts",
    "connectors\posthog.ts",
    "connectors\pubmed.ts",
    "connectors\supabase.ts",
    "adapters\wrappers.ts",
    "plugins\PluginManager.ts",
    "routes\director.ts",
    "http\websocket.ts",
    "index.ts"
)

Write-Host ""
Write-Host "[1/4] 파일 업로드 중..." -ForegroundColor Yellow
foreach ($f in $FILES) {
    $localPath  = "$SRC\$f"
    $remotePath = "$REMOTE/src/" + $f.Replace('\','/')
    $remoteDir  = ($remotePath -split '/')[0..($remotePath.Split('/').Count-2)] -join '/'

    # 원격 디렉토리 생성
    ssh $SERVER "mkdir -p $remoteDir" 2>$null

    # 파일 전송
    scp $localPath "${SERVER}:${remotePath}" 2>&1 | Out-Null
    Write-Host "  ✓ $f" -ForegroundColor Green
}

# 프론트엔드 게임 UI도 업로드
Write-Host "  ✓ corvusx-game.html (프론트엔드)" -ForegroundColor Green
scp "$LOCAL\corvusx-game.html" "${SERVER}:/var/www/corvusx/corvusx-game.html"

Write-Host ""
Write-Host "[2/4] 서버에서 TypeScript 빌드 중..." -ForegroundColor Yellow
$buildResult = ssh $SERVER "cd $REMOTE && rm -rf dist && ./node_modules/.bin/tsc 2>&1; echo EXIT:$?"
Write-Host $buildResult
if ($buildResult -match "error TS") {
    Write-Host "빌드 오류 발생\!" -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ 빌드 완료" -ForegroundColor Green

Write-Host ""
Write-Host "[3/4] 서비스 재시작 중..." -ForegroundColor Yellow
ssh $SERVER "systemctl restart corvusx-backend && sleep 2 && systemctl is-active corvusx-backend"

Write-Host ""
Write-Host "[4/4] 서버 상태 확인 중..." -ForegroundColor Yellow
$status = ssh $SERVER "curl -s http://localhost:8000/api/auth/me"
Write-Host "  응답: $status" -ForegroundColor Cyan

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  배포 완료\!" -ForegroundColor Green
Write-Host ""
Write-Host "  새 API 엔드포인트:" -ForegroundColor White
Write-Host "  POST /api/director/start     — 미션 실행" -ForegroundColor Gray
Write-Host "  GET  /api/director/session   — 세션 상태" -ForegroundColor Gray
Write-Host "  GET  /api/director/connectors — 커넥터 목록" -ForegroundColor Gray
Write-Host ""
Write-Host "  게임 UI: https://app.cloudcookie.co.kr/corvusx-game.html" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
