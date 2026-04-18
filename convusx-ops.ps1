# ============================================================
# CONVUS X — 4가지 도구 통합 운영 스크립트
# 파일명: convusx-ops.ps1
# 위치: C:\Users\User\Desktop\CONVUSX\
# 사용법: .\convusx-ops.ps1 [작업시작|작업완료|상태확인|드라이브정리]
# ============================================================

param(
    [Parameter(Position=0)]
    [ValidateSet("작업시작", "작업완료", "상태확인", "드라이브정리")]
    [string]$Mode = "상태확인"
)

$REPO_PATH = "C:\Users\User\Desktop\CONVUSX"
$SSH_KEY   = "C:\Users\User\.ssh\id_deploy"
$SERVER    = "root@1.201.125.92"

# ────────────────────────────────────────
# 공통 함수
# ────────────────────────────────────────
function Write-Title($text) {
    Write-Host "`n══════════════════════════════════════" -ForegroundColor Cyan
    Write-Host " $text" -ForegroundColor Cyan
    Write-Host "══════════════════════════════════════" -ForegroundColor Cyan
}

function Write-Ok($text)   { Write-Host "  ✅ $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "  ⚠️  $text" -ForegroundColor Yellow }
function Write-Err($text)  { Write-Host "  ❌ $text" -ForegroundColor Red }
function Write-Info($text) { Write-Host "  → $text" -ForegroundColor White }

# ────────────────────────────────────────
# 모드 1: 작업시작
# 새 Claude 스레드 시작 전 실행
# ────────────────────────────────────────
if ($Mode -eq "작업시작") {
    Write-Title "작업 시작 체크"

    # 1. Git 상태
    Write-Host "`n[GitHub]" -ForegroundColor Cyan
    cd $REPO_PATH
    $status = git status --short
    if ($status) {
        Write-Warn "미커밋 변경사항 있음:"
        git status --short
    } else {
        Write-Ok "워킹트리 클린"
    }
    $head = git log --oneline -1
    Write-Info "최신 커밋: $head"

    # 2. Karpathy 플러그인 확인
    Write-Host "`n[Karpathy Plugin]" -ForegroundColor Cyan
    $claudeConfig = "$env:APPDATA\Claude\claude_code_config.json"
    if (Test-Path $claudeConfig) {
        $config = Get-Content $claudeConfig | ConvertFrom-Json
        Write-Ok "Claude Code 설정 파일 존재"
    }
    Write-Info "플러그인 확인: Claude Code에서 /plugin list 로 확인"

    # 3. 서버 상태
    Write-Host "`n[서버]" -ForegroundColor Cyan
    $health = ssh -i $SSH_KEY -o ConnectTimeout=5 $SERVER `
        "curl -s https://app.cloudcookie.co.kr/api/health" 2>$null
    if ($health -match "ok") {
        Write-Ok "서버 정상 ($health)"
    } else {
        Write-Err "서버 응답 없음 — 확인 필요"
    }

    # 4. Claude에 넘길 컨텍스트 로드 명령어 출력
    Write-Host "`n[Notion 로드 명령어]" -ForegroundColor Cyan
    Write-Host ""
    Write-Host '  Claude.ai에 입력:' -ForegroundColor Yellow
    Write-Host '  "Notion에서 CONVUS X 개발 현황 불러와서 이어서 작업해줘"' -ForegroundColor White
    Write-Host ""
    Write-Warn "Drive 문서는 조회하지 않음 (구버전, 혼선 유발)"
}

# ────────────────────────────────────────
# 모드 2: 작업완료
# Claude Code 작업 끝난 후 실행
# ────────────────────────────────────────
elseif ($Mode -eq "작업완료") {
    Write-Title "작업 완료 처리"

    cd $REPO_PATH

    # 1. Git 상태 확인
    Write-Host "`n[GitHub 상태]" -ForegroundColor Cyan
    $status = git status --short
    if ($status) {
        Write-Warn "미커밋 변경사항 있음 — Claude Code가 커밋 안 했을 수 있음"
        git status --short
        Write-Info "Claude Code에서 직접 커밋했는지 확인하세요"
    } else {
        $head = git log --oneline -1
        Write-Ok "최신 커밋: $head"
    }

    # 2. 서버 배포 상태 확인
    Write-Host "`n[서버 배포 확인]" -ForegroundColor Cyan
    # PowerShell 5.1 호환: && 대신 ; 사용 (원격 bash 에서 실행)
    $health = ssh -i $SSH_KEY -o ConnectTimeout=5 $SERVER `
        "systemctl is-active corvusx-backend; curl -s https://app.cloudcookie.co.kr/api/health" 2>$null
    if ($health -match "active") {
        Write-Ok "corvusx-backend 활성"
    } else {
        Write-Err "서버 상태 이상 — journalctl -u corvusx-backend -n 50 확인"
    }

    # 3. Notion 업데이트 안내
    Write-Host "`n[Notion 업데이트]" -ForegroundColor Cyan
    Write-Info "Claude.ai에서 작업 완료 후 자동 업데이트 여부 확인"
    Write-Info "안 됐으면: '방금 완료된 작업 Notion에 저장해줘' 입력"

    # 4. Drive는 건드리지 않음
    Write-Host "`n[Google Drive]" -ForegroundColor Cyan
    Write-Ok "Drive는 건드리지 않음 (대용량 파일 창고 전용)"
}

# ────────────────────────────────────────
# 모드 3: 상태확인
# 언제든 현재 상태 점검
# ────────────────────────────────────────
elseif ($Mode -eq "상태확인") {
    Write-Title "전체 상태 확인"

    # GitHub
    Write-Host "`n[GitHub]" -ForegroundColor Cyan
    cd $REPO_PATH
    $head = git log --oneline -1
    $branch = git branch --show-current
    Write-Ok "브랜치: $branch"
    Write-Ok "최신 커밋: $head"
    $unpushed = git log origin/main..HEAD --oneline
    if ($unpushed) {
        Write-Warn "미푸시 커밋 있음: $unpushed"
    }

    # CLAUDE.md 확인
    Write-Host "`n[CLAUDE.md]" -ForegroundColor Cyan
    if (Test-Path "$REPO_PATH\CLAUDE.md") {
        $lines = (Get-Content "$REPO_PATH\CLAUDE.md").Count
        Write-Ok "CLAUDE.md 존재 ($lines lines)"
    } else {
        Write-Err "CLAUDE.md 없음"
    }

    # Karpathy
    Write-Host "`n[Karpathy Plugin]" -ForegroundColor Cyan
    Write-Ok "설치 완료 (user scope — 전역 적용)"
    Write-Info "확인: Claude Code → /plugin list"

    # 서버
    Write-Host "`n[서버]" -ForegroundColor Cyan
    $active = ssh -i $SSH_KEY -o ConnectTimeout=5 $SERVER `
        "systemctl is-active corvusx-backend" 2>$null
    if ($active -eq "active") {
        Write-Ok "corvusx-backend: active"
    } else {
        Write-Err "corvusx-backend: $active"
    }
    $head_server = ssh -i $SSH_KEY -o ConnectTimeout=5 $SERVER `
        "cd /opt/corvusx && git log --oneline -1" 2>$null
    Write-Info "서버 HEAD: $head_server"

    # 로컬 vs 서버 커밋 비교
    $local_head = git rev-parse --short HEAD
    if ($head_server -match $local_head) {
        Write-Ok "로컬 = 서버 (동기화 완료)"
    } else {
        Write-Warn "로컬($local_head) ≠ 서버($head_server) — 배포 필요할 수 있음"
    }

    # Notion
    Write-Host "`n[Notion]" -ForegroundColor Cyan
    Write-Ok "역할: 완료 이력 + 잔여 작업 체크리스트"
    Write-Info "로드: Claude.ai → 'Notion에서 CONVUS X 개발 현황 불러와서 이어서 작업해줘'"

    # Drive
    Write-Host "`n[Google Drive]" -ForegroundColor Cyan
    Write-Warn "삭제 대상 문서 아직 남아있을 수 있음:"
    Write-Err "  CLAUDE.md / CONVUS-X-PLAN.md / CORVUS-X-STATUS.md"
    Write-Err "  CONVUS-X-UX-ROADMAP.md / README.md"
    Write-Info "Drive에서 직접 삭제하세요 (휴지통 이동)"
}

# ────────────────────────────────────────
# 모드 4: 드라이브정리
# Drive 삭제 대상 목록 + 안내
# ────────────────────────────────────────
elseif ($Mode -eq "드라이브정리") {
    Write-Title "Google Drive 정리 안내"

    Write-Host "`n삭제할 파일 (Drive에서 직접):" -ForegroundColor Red
    Write-Err "CLAUDE.md           → GitHub에 최신본 있음"
    Write-Err "CONVUS-X-PLAN.md    → 폐기된 Phase 계획"
    Write-Err "CORVUS-X-STATUS.md  → 2026-04-01 기준 구버전"
    Write-Err "CONVUS-X-UX-ROADMAP.md → 혼선 유발"
    Write-Err "README.md           → 구버전 아키텍처"

    Write-Host "`n보존할 파일:" -ForegroundColor Green
    Write-Ok "corvusx-office.html (백업)"
    Write-Ok "deploy/ 폴더 (배포 스크립트)"
    Write-Ok "이미지 / 영상 / PDF"

    Write-Host "`nDrive 링크:" -ForegroundColor Cyan
    Write-Info "https://drive.google.com/drive/folders/1rrycm-gCd7xamhrVFmg9TAGWGEMSxaQv"

    Write-Host "`n삭제 후:" -ForegroundColor Yellow
    Write-Info "새 스레드에서 Drive 문서 조회 안 함"
    Write-Info "코드 세부사항 필요 시 → 서버에서 직접 cat/grep"
}

# ────────────────────────────────────────
# 사용법 출력
# ────────────────────────────────────────
Write-Host "`n──────────────────────────────────────" -ForegroundColor DarkGray
Write-Host " 사용법:" -ForegroundColor DarkGray
Write-Host "  .\convusx-ops.ps1 작업시작    ← 새 Claude 스레드 열기 전" -ForegroundColor DarkGray
Write-Host "  .\convusx-ops.ps1 작업완료    ← Claude Code 작업 끝난 후" -ForegroundColor DarkGray
Write-Host "  .\convusx-ops.ps1 상태확인    ← 언제든 현재 상태 점검" -ForegroundColor DarkGray
Write-Host "  .\convusx-ops.ps1 드라이브정리 ← Drive 삭제 대상 안내" -ForegroundColor DarkGray
Write-Host "──────────────────────────────────────`n" -ForegroundColor DarkGray
