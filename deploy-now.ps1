# CORVUS X 배포 스크립트 — 2026-04-19
# PowerShell에서 실행: cd C:\Users\User\Desktop\CONVUSX && .\deploy-now.ps1

$ErrorActionPreference = "Stop"
$SSH_KEY = "$env:USERPROFILE\.ssh\id_deploy"
$SERVER = "root@1.201.125.92"

Write-Host "`n=== [1/5] Git lock 제거 ===" -ForegroundColor Cyan
if (Test-Path ".git\index.lock") {
    Remove-Item ".git\index.lock" -Force
    Write-Host "index.lock 삭제 완료"
} else {
    Write-Host "index.lock 없음 — OK"
}

Write-Host "`n=== [2/5] Git commit + push ===" -ForegroundColor Cyan
git add -A
git commit -m "fix: 세션 자동생성, 메시지 호환, Phaser 중복방지, CSS/HUD 수정

- ProjectSession: getOrCreateSession() 추가
- DirectorAgent: 세션 없음 throw 제거
- office.html: addMsg() 구포맷 호환 레이어
- office.html: Phaser 4중 초기화 방지
- office.html: 부서명/탭 CSS 개선
- office.html: HUD 미션 텍스트 연동"
git push origin main
Write-Host "Git push 완료" -ForegroundColor Green

Write-Host "`n=== [3/5] 서버: git pull ===" -ForegroundColor Cyan
ssh -i $SSH_KEY $SERVER "cd /opt/corvusx && git pull origin main"

Write-Host "`n=== [4/5] 서버: TypeScript 빌드 + 서비스 재시작 ===" -ForegroundColor Cyan
ssh -i $SSH_KEY $SERVER "cd /opt/corvusx/server && rm -rf dist && ./node_modules/.bin/tsc && systemctl restart corvusx-backend"

Write-Host "`n=== [5/5] 서버: office.html 복사 + health 체크 ===" -ForegroundColor Cyan
ssh -i $SSH_KEY $SERVER "cp /opt/corvusx/corvusx-office.html /var/www/corvusx/corvusx-office.html"
$health = ssh -i $SSH_KEY $SERVER "curl -s https://app.cloudcookie.co.kr/api/health"
Write-Host "Health: $health" -ForegroundColor Green

Write-Host "`n=== 배포 완료 ===" -ForegroundColor Green
Write-Host "https://app.cloudcookie.co.kr/corvusx-office.html 에서 확인하세요"
