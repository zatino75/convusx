# CORVUS X Hotfix v3.5 — Ensemble + Critic + Pixel Office + Domain Tools 통합 배포
# 작업 폴더: C:\Users\User\Desktop\CONVUS_V2
#
# v3.5 변경:
#   - systemctl is-active 2초 대기 → 최대 20초 폴링 (activating → active 전이 대기)
#   - 실패 시 journalctl -n 40 자동 덤프
#   - 로컬 curl HTTP sanity check 추가
# v3.4:
#   - manifest 부분 배포 폐기 → server/src 전체를 rsync (의존성 불일치 38건 해결)
#   - 정적 파일은 별도 manifest 유지
# v3.3:
#   - cmd /c "ssh ... < tmpfile" stdin redirect (PowerShell 파이프의 CRLF 재삽입 회피)
#   - 백엔드 빌드 시 tsc 없으면 npm install 자동 실행
# v3.2:
#   - PowerShell here-string CRLF → LF 변환 후 ssh 전달
#   - tar.gz 일괄 업로드 + 원격 추출
#
# 실행: powershell -ExecutionPolicy Bypass -File "C:\Users\User\Desktop\CONVUS_V2\deploy\hotfix-ensemble-v3.ps1"

$ErrorActionPreference = "Stop"
Set-Location "C:\Users\User\Desktop\CONVUS_V2"
$SERVER = "root@1.201.125.92"
$STAGE_DIR = "$env:TEMP\corvusx-hotfix-v3"
$TARBALL = "$env:TEMP\corvusx-hotfix-v3.tar.gz"

# ─ Helper: ssh 로 bash 스크립트 전달 (CRLF → LF 변환 + cmd stdin redirect) ──
# PowerShell 파이프(`Get-Content | ssh`)는 텍스트 처리 시 LF 를 CRLF 로 재변환한다.
# 이를 회피하려면 cmd /c 를 거쳐 stdin 을 파일에서 직접 redirect 해야 한다.
function Invoke-SshBash {
    param([string]$Script)
    $lf = $Script -replace "`r`n", "`n"
    $tmpScript = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllText($tmpScript, $lf, (New-Object System.Text.UTF8Encoding $false))
    try {
        # cmd 로 ssh 실행 + stdin 을 파일에서 redirect → PowerShell 파이프 우회
        & cmd /c "ssh $SERVER `"bash -s`" < `"$tmpScript`""
    } finally {
        Remove-Item -Force $tmpScript -ErrorAction SilentlyContinue
    }
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " CORVUS X Hotfix v3.5 — service-state polling" -ForegroundColor Cyan
Write-Host " (CONVUS_V2 workspace, 2026-04-15)" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# ─ Step 0: 로컬 staging 디렉토리 + tarball ────────────────────────────────
Write-Host ""
Write-Host "[0/5] Build local tarball from staging dir..." -ForegroundColor Cyan

if (Test-Path $STAGE_DIR) { Remove-Item -Recurse -Force $STAGE_DIR }
New-Item -ItemType Directory -Path $STAGE_DIR | Out-Null
New-Item -ItemType Directory -Path "$STAGE_DIR/server" -Force | Out-Null
New-Item -ItemType Directory -Path "$STAGE_DIR/static" -Force | Out-Null

# server/src 전체 트리 복사 (node_modules 제외)
Write-Host "    Copying server/src tree..." -ForegroundColor Gray
robocopy "server\src" "$STAGE_DIR\server\src" /E /NFL /NDL /NJH /NJS /NP /XD node_modules dist | Out-Null
if ($LASTEXITCODE -gt 7) { Write-Host "    [ERROR] robocopy server/src 실패 (code $LASTEXITCODE)" -ForegroundColor Red; exit 1 }
$LASTEXITCODE = 0

# tsconfig.json / package.json 같은 루트 설정
foreach ($f in @("server/tsconfig.json", "server/package.json", "server/package-lock.json")) {
    if (Test-Path $f) {
        Copy-Item $f "$STAGE_DIR/$f" -Force
    }
}

# 정적 파일
$staticManifest = @(
    @("corvusx-office.html", "static/corvusx-office.html"),
    @("corvusx-game.html", "static/corvusx-game.html")
)
foreach ($entry in $staticManifest) {
    $src = $entry[0]; $dst = "$STAGE_DIR/$($entry[1])"
    if (Test-Path $src) {
        Copy-Item $src $dst -Force
    }
}

$tsCount = (Get-ChildItem -Recurse -Path "$STAGE_DIR/server/src" -Filter *.ts | Measure-Object).Count
Write-Host "    Staged: $tsCount .ts files under server/src/" -ForegroundColor Green

if (Test-Path $TARBALL) { Remove-Item -Force $TARBALL }
Push-Location $STAGE_DIR
tar -czf $TARBALL .
Pop-Location
$tarSize = (Get-Item $TARBALL).Length
Write-Host "    Tarball: $TARBALL ($tarSize bytes)" -ForegroundColor Green

# ─ Step 1: tarball 업로드 ──────────────────────────────────────────────
Write-Host ""
Write-Host "[1/5] Upload tarball (single scp)..." -ForegroundColor Cyan
scp -O $TARBALL "${SERVER}:/tmp/corvusx-hotfix-v3.tar.gz"
if ($LASTEXITCODE -ne 0) {
    scp $TARBALL "${SERVER}:/tmp/corvusx-hotfix-v3.tar.gz"
}
if ($LASTEXITCODE -ne 0) { Write-Host "    [ERROR] tarball 업로드 실패" -ForegroundColor Red; exit 1 }
Write-Host "    Tarball upload OK" -ForegroundColor Green

# ─ Step 2: 원격 추출 + 빌드 + 재시작 ─────────────────────────────────────
Write-Host ""
Write-Host "[2/5] Remote extract + build + restart..." -ForegroundColor Cyan
$bashScript = @'
set -e
echo '--- backup current server/src ---'
BACKUP_DIR="/root/corvusx-src-bak.$(date +%Y%m%d-%H%M%S)"
if [ -d /opt/corvusx/server/src ]; then
  cp -a /opt/corvusx/server/src "$BACKUP_DIR"
  echo "backup: $BACKUP_DIR"
fi

echo '--- extract tarball ---'
cd /tmp
rm -rf corvusx-extract
mkdir -p corvusx-extract
tar -xzf corvusx-hotfix-v3.tar.gz -C corvusx-extract

echo '--- rsync server/src (overwrite) ---'
rsync -a --delete corvusx-extract/server/src/ /opt/corvusx/server/src/

echo '--- rsync server config files (tsconfig/package*) ---'
for f in tsconfig.json package.json package-lock.json; do
  if [ -f "corvusx-extract/server/$f" ]; then
    cp -f "corvusx-extract/server/$f" "/opt/corvusx/server/$f"
    echo "  updated: $f"
  fi
done

echo '--- rsync static/ to /var/www/corvusx/ ---'
mkdir -p /var/www/corvusx
if [ -d corvusx-extract/static ]; then
  rsync -a corvusx-extract/static/ /var/www/corvusx/
fi
rm -rf corvusx-extract corvusx-hotfix-v3.tar.gz

echo '--- backend build ---'
cd /opt/corvusx/server
if [ ! -x ./node_modules/.bin/tsc ]; then
  echo '[INFO] tsc not found — running npm install (devDependencies included)'
  npm install --no-audit --no-fund --include=dev 2>&1 | tail -20
fi
rm -rf dist
./node_modules/.bin/tsc 2>&1 | tail -60
TSC_EXIT=${PIPESTATUS[0]}
if [ "$TSC_EXIT" != "0" ]; then
  echo "[ERROR] tsc 컴파일 실패 (exit $TSC_EXIT) — src 원복"
  rm -rf /opt/corvusx/server/src
  cp -a "$BACKUP_DIR" /opt/corvusx/server/src
  exit 1
fi

echo '--- restart corvusx-backend ---'
systemctl restart corvusx-backend

# is-active 가 activating 이면 최대 20초 대기
set +e
STATE=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 2
  STATE=$(systemctl is-active corvusx-backend 2>/dev/null || true)
  echo "  [${i}] state=$STATE"
  if [ "$STATE" = "active" ]; then break; fi
  if [ "$STATE" = "failed" ]; then break; fi
done
set -e

echo "--- final state: $STATE ---"
if [ "$STATE" != "active" ]; then
  echo '--- journalctl -u corvusx-backend (last 40) ---'
  journalctl -u corvusx-backend -n 40 --no-pager
  echo "[ERROR] 서비스가 active 상태가 아님 (현재: $STATE)"
  exit 1
fi

echo '--- HTTP sanity check (localhost:8000) ---'
curl -s -o /dev/null -w 'local /api/auth/me: %{http_code}\n' http://127.0.0.1:8000/api/auth/me || true
'@
Invoke-SshBash $bashScript
if ($LASTEXITCODE -ne 0) { Write-Host "    [ERROR] 원격 배포 실패" -ForegroundColor Red; exit 1 }
Write-Host "    Remote deploy + build OK" -ForegroundColor Green

# ─ Step 3: HTTP 검증 ───────────────────────────────────────────────────
Write-Host ""
Write-Host "[3/5] HTTP route verification..." -ForegroundColor Cyan
$verifyScript = @'
echo '--- HTTP routes ---'
curl -s -o /dev/null -w 'auth/me:                      %{http_code}\n' https://app.cloudcookie.co.kr/api/auth/me
curl -s -o /dev/null -w 'office.html:                  %{http_code}\n' https://app.cloudcookie.co.kr/corvusx-office.html
curl -s -o /dev/null -w 'game.html:                    %{http_code}\n' https://app.cloudcookie.co.kr/corvusx-game.html
curl -s -o /dev/null -w 'director/stream OPTIONS:      %{http_code}\n' -X OPTIONS https://app.cloudcookie.co.kr/api/director/stream
curl -s -o /dev/null -w 'director/sessions OPTIONS:    %{http_code}\n' -X OPTIONS https://app.cloudcookie.co.kr/api/director/sessions
'@
Invoke-SshBash $verifyScript

# ─ Step 4: dist 트리 + 심볼 검증 ──────────────────────────────────────
Write-Host ""
Write-Host "[4/5] dist tree + symbol verification..." -ForegroundColor Cyan
$distScript = @'
echo '--- director dist ---'
ls -la /opt/corvusx/server/dist/director/ 2>/dev/null | head -15
echo ''
echo '--- regulation dist ---'
ls -la /opt/corvusx/server/dist/regulation/ 2>/dev/null | head -10
echo ''
echo '--- fusion dist ---'
ls -la /opt/corvusx/server/dist/fusion/ 2>/dev/null | head -10
echo ''
echo '--- domain food/ecig dist ---'
ls -la /opt/corvusx/server/dist/agent/tools/domain/food/ 2>/dev/null
ls -la /opt/corvusx/server/dist/agent/tools/domain/ecig/ 2>/dev/null
echo ''
echo '--- key symbols ---'
grep -l 'runEnsemble' /opt/corvusx/server/dist/director/*.js 2>/dev/null
grep -l 'targetDeptId' /opt/corvusx/server/dist/director/CriticReview.js 2>/dev/null
echo ''
echo '--- recent backend log ---'
journalctl -u corvusx-backend -n 12 --no-pager | tail -12
'@
Invoke-SshBash $distScript

# ─ Step 5: cleanup ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "[5/5] Local cleanup..." -ForegroundColor Cyan
Remove-Item -Recurse -Force $STAGE_DIR -ErrorAction SilentlyContinue
Remove-Item -Force $TARBALL -ErrorAction SilentlyContinue
Write-Host "    Local staging cleaned" -ForegroundColor Green

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " Hotfix v3.3 완료!" -ForegroundColor Green
Write-Host " https://app.cloudcookie.co.kr" -ForegroundColor Green
Write-Host " https://app.cloudcookie.co.kr/corvusx-office.html  (Director Multi-Agent)" -ForegroundColor Green
Write-Host " https://app.cloudcookie.co.kr/corvusx-game.html    (Game UI)" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
