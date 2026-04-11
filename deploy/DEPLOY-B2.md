# CORVUS X — B-2 재배포 절차 (nginx basic auth → 내부 인증 전환)

## 전제
- 로컬: Windows 10+, `C:\Users\User\Desktop\CONVUS X` 에 최신 코드
- 서버: gabia 클라우드 1.201.125.92, Ubuntu 22.04, root SSH 접근 가능
- 도메인: `cloudcookie.co.kr`, `www.cloudcookie.co.kr`, `app.cloudcookie.co.kr` (Let's Encrypt 인증서 기존 존재)
- 현재 상태: www = 빈 페이지, app = nginx basic auth 401

## 단계 요약
1. 로컬에서 코드 tar.gz 생성 + scp 로 서버 업로드
2. 서버에서 압축 해제 → `/opt/corvusx` 에 배치
3. 비밀번호 해시 + 세션 시크릿 생성 후 `/etc/corvusx/.env` 작성
4. `deploy.sh` 실행 → 빌드 + systemd 등록 + nginx 교체 + basic auth 제거
5. 검증 curl

---

## Block A — 로컬 PowerShell (Windows)

```powershell
# 1) 코드 폴더로 이동
cd "C:\Users\User\Desktop\CONVUS X"

# 2) 빌드 산출물·의존성 제외하고 tar.gz 생성 (Windows 10+ 내장 tar)
tar -czf corvusx-deploy.tar.gz `
  --exclude="node_modules" `
  --exclude="dist" `
  --exclude=".git" `
  --exclude="*.log" `
  --exclude=".env" `
  --exclude="server/.env" `
  server frontend deploy .env.production.example tsconfig.json package.json CLAUDE.md 2>$null

# 3) 서버로 업로드 (비밀번호 입력 프롬프트 뜸)
scp corvusx-deploy.tar.gz root@1.201.125.92:/tmp/corvusx-deploy.tar.gz
```

---

## Block B — 서버 SSH (root@1.201.125.92)

**먼저 SSH 접속:**
```bash
ssh root@1.201.125.92
```

접속 후 **아래 블록을 통째로 복사해서 붙여넣으세요.** 중간에 비밀번호를 두 번 입력하게 됩니다 (CORVUS X 로그인 비밀번호 → 확인).

```bash
set -e
set +H

# ── 1) 디렉토리 준비 ────────────────────────────────────
mkdir -p /opt/corvusx /etc/corvusx /var/www/corvusx /var/www/blank /var/lib/corvusx /var/log/corvusx

# ── 2) 기존 코드 백업 후 새 코드 전개 ────────────────────
if [ -d /opt/corvusx/server ]; then
  TS=$(date +%Y%m%d-%H%M%S)
  mv /opt/corvusx /opt/corvusx.bak.$TS
  mkdir -p /opt/corvusx
  echo "[info] 기존 /opt/corvusx 는 /opt/corvusx.bak.$TS 로 이동됨"
fi
tar -xzf /tmp/corvusx-deploy.tar.gz -C /opt/corvusx
ls /opt/corvusx/server/package.json /opt/corvusx/frontend/package.json /opt/corvusx/deploy/scripts/deploy.sh

# ── 3) 시스템 사용자 생성 (없으면) ───────────────────────
if ! id -u corvusx >/dev/null 2>&1; then
  useradd --system --home-dir /opt/corvusx --shell /bin/bash corvusx
fi
chown -R corvusx:corvusx /opt/corvusx /var/lib/corvusx /var/log/corvusx
chmod 750 /etc/corvusx

# ── 4) Node.js 20 확인/설치 ──────────────────────────────
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -qE "^v20"; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v

# ── 5) 비밀번호 해시 + 세션 시크릿 생성 ──────────────────
echo ""
echo "▶ CORVUS X 로그인 비밀번호를 입력하세요 (화면에 표시 안 됨, 8자 이상):"
read -s CORVUS_PW
echo ""
echo "▶ 같은 비밀번호를 한 번 더 입력하세요:"
read -s CORVUS_PW2
echo ""
if [ "$CORVUS_PW" != "$CORVUS_PW2" ]; then
  echo "[err] 비밀번호가 일치하지 않습니다. 중단."
  exit 1
fi
if [ ${#CORVUS_PW} -lt 8 ]; then
  echo "[err] 비밀번호는 8자 이상이어야 합니다. 중단."
  exit 1
fi

HASH_OUT=$(cd /opt/corvusx && node deploy/scripts/generate-password-hash.mjs "$CORVUS_PW" 2>&1)
PW_HASH=$(echo "$HASH_OUT" | grep -oE 'scrypt\$[0-9]+\$[a-f0-9]+\$[a-f0-9]+' | head -1)
SESSION_SECRET=$(openssl rand -hex 48)
unset CORVUS_PW CORVUS_PW2

if [ -z "$PW_HASH" ]; then
  echo "[err] 해시 생성 실패"
  echo "$HASH_OUT"
  exit 1
fi
echo "[ok] 비밀번호 해시 생성 완료"

# ── 6) /etc/corvusx/.env 작성 ────────────────────────────
cp /opt/corvusx/.env.production.example /etc/corvusx/.env

# API 키는 기존 .env 에서 가져오거나 (백업 폴더에서) 이후 nano 로 보강
if [ -f /opt/corvusx.bak.*/server/.env ]; then
  OLD_ENV=$(ls -1t /opt/corvusx.bak.*/server/.env 2>/dev/null | head -1)
  if [ -n "$OLD_ENV" ]; then
    echo "[info] 이전 .env 발견: $OLD_ENV — API 키 복사"
    for k in OPENAI_API_KEY ANTHROPIC_API_KEY GEMINI_API_KEY PERPLEXITY_API_KEY MIDJOURNEY_API_KEY MIDJOURNEY_DISCORD_TOKEN MIDJOURNEY_CHANNEL_ID RUNWAY_API_KEY; do
      V=$(grep -E "^${k}=" "$OLD_ENV" | head -1 | cut -d= -f2-)
      if [ -n "$V" ]; then
        sed -i "s|^${k}=.*|${k}=${V}|" /etc/corvusx/.env
      fi
    done
  fi
fi

# 필수값 주입
sed -i "s|^CORVUS_ACCESS_PASSWORD_HASH=.*|CORVUS_ACCESS_PASSWORD_HASH=${PW_HASH}|" /etc/corvusx/.env
sed -i "s|^CORVUS_SESSION_SECRET=.*|CORVUS_SESSION_SECRET=${SESSION_SECRET}|" /etc/corvusx/.env

chmod 640 /etc/corvusx/.env
chown root:corvusx /etc/corvusx/.env
unset PW_HASH SESSION_SECRET

echo "[ok] /etc/corvusx/.env 작성 완료"
grep -E "^(CORVUS_ACCESS_PASSWORD_HASH|CORVUS_SESSION_SECRET|CORVUS_COOKIE_|CORS_ORIGINS)=" /etc/corvusx/.env | sed 's/=.*/=<set>/'

# ── 7) deploy.sh 실행 (빌드 + systemd + nginx 전환) ──────
cd /opt/corvusx
bash deploy/scripts/deploy.sh

# ── 8) 검증 ──────────────────────────────────────────────
echo ""
echo "=== 검증 ==="
sleep 2
systemctl status corvusx-backend --no-pager -l | head -15 || true
echo ""
echo "--- www 빈 페이지 ---"
curl -skI https://www.cloudcookie.co.kr/ | head -8
echo ""
echo "--- app 로그인 상태 (401 또는 200 + 로그인 페이지) ---"
curl -skI https://app.cloudcookie.co.kr/ | head -8
echo ""
echo "--- /api/auth/me (로그인 안 된 상태, ok:true + authenticated:false 기대) ---"
curl -sk https://app.cloudcookie.co.kr/api/auth/me
echo ""
```

---

## 검증 기준

### www (빈 페이지 + Clear-Site-Data)
```
HTTP/2 200
clear-site-data: "cache", "cookies", "storage", "executionContexts"
cache-control: no-store, no-cache, must-revalidate, max-age=0
```
본문은 `<html lang="ko">...<body></body></html>` 형태.

### app (CORVUS X 프론트 + 내부 로그인)
```
HTTP/2 200
```
브라우저로 `https://app.cloudcookie.co.kr` 접속 시 CORVUS X 로그인 화면이 뜨면 성공. basic auth 팝업 (❌) 이 아니라 CORVUS X UI 안의 비밀번호 입력 폼 (✓) 이어야 합니다.

### /api/auth/me
```json
{"ok":true,"authenticated":false,"login_enabled":true,"uid":null}
```
`login_enabled:true` 이면 scrypt 해시가 정상 로드된 것.

---

## 실패 시 롤백

```bash
# systemd 중단
systemctl stop corvusx-backend
systemctl disable corvusx-backend

# 이전 코드 복원
TS=$(ls -1 /opt/corvusx.bak.* 2>/dev/null | sort | tail -1 | sed 's|.*/corvusx\.bak\.||')
rm -rf /opt/corvusx
mv /opt/corvusx.bak.$TS /opt/corvusx

# 이전 nginx 분리 conf 복원 (백업이 있다면)
ls /etc/nginx/sites-available/*.bak.* 2>/dev/null

# basic auth 로 되돌리려면:
# /etc/nginx/sites-available/app.cloudcookie.co.kr 에 auth_basic 추가
```

---

## 이후 비밀번호 변경 방법

```bash
ssh root@1.201.125.92
cd /opt/corvusx
node deploy/scripts/generate-password-hash.mjs '새비밀번호'
# 출력된 scrypt$... 줄 복사
sudo nano /etc/corvusx/.env
# CORVUS_ACCESS_PASSWORD_HASH=<붙여넣기>
sudo systemctl restart corvusx-backend
```
