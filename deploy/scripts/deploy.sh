#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# CORVUS X — 서버 배포 스크립트 (Ubuntu 22.04)
#
# 가비아 클라우드 서버(1.201.125.92) 에 직접 SSH 접속한 후
# /opt/corvusx 에서 실행하세요.
#
#   sudo bash deploy/scripts/deploy.sh
#
# 이 스크립트는 idempotent — 여러 번 실행해도 안전함.
# 처음 한 번은 사전 설치 + 빌드 + systemd 등록 + nginx 설정 + SSL 발급.
# 이후에는 git pull + 빌드 + 재시작만 수행.
# ═══════════════════════════════════════════════════════════

set -euo pipefail

APP_DIR="/opt/corvusx"
WEB_ROOT="/var/www/corvusx"
BLANK_ROOT="/var/www/blank"
ENV_DIR="/etc/corvusx"
ENV_FILE="$ENV_DIR/.env"
DB_DIR="/var/lib/corvusx"
LOG_DIR="/var/log/corvusx"
APP_USER="corvusx"
NODE_VER="20"

log()  { echo -e "\033[1;34m[deploy]\033[0m $*"; }
warn() { echo -e "\033[1;33m[warn]\033[0m $*"; }
err()  { echo -e "\033[1;31m[err]\033[0m $*" >&2; }

if [[ $EUID -ne 0 ]]; then
  err "이 스크립트는 sudo 로 실행해야 합니다."
  exit 1
fi

# ── 1) 시스템 패키지 설치 ──────────────────────────────────────────────────
log "시스템 패키지 확인/설치"
apt-get update -y
apt-get install -y curl ca-certificates gnupg git nginx certbot python3-certbot-nginx ufw

if ! command -v node >/dev/null 2>&1; then
  log "Node.js ${NODE_VER} 설치"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VER}.x" | bash -
  apt-get install -y nodejs
fi

log "Node 버전: $(node -v)"

# ── 2) 사용자/디렉토리 준비 ─────────────────────────────────────────────────
log "corvusx 시스템 사용자 준비"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR" --shell /bin/bash "$APP_USER"
fi

mkdir -p "$APP_DIR" "$WEB_ROOT" "$BLANK_ROOT" "$ENV_DIR" "$DB_DIR" "$LOG_DIR"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR" "$DB_DIR" "$LOG_DIR"
chmod 750 "$ENV_DIR"

# 빈 HTML (www / apex 용) — CORVUS X 흔적 남기지 않음
if [[ ! -f "$BLANK_ROOT/index.html" ]]; then
  log "$BLANK_ROOT/index.html 생성"
  cat > "$BLANK_ROOT/index.html" <<'HTMLEOF'
<html lang="ko"><head><meta charset="UTF-8"><meta name="robots" content="noindex, nofollow"><title></title></head><body></body></html>
HTMLEOF
  chown -R www-data:www-data "$BLANK_ROOT"
fi

# ── 3) 코드 배포 ──────────────────────────────────────────────────────────
if [[ ! -d "$APP_DIR/.git" && ! -f "$APP_DIR/server/package.json" ]]; then
  warn "코드가 아직 없음 — git clone 또는 rsync 로 $APP_DIR 에 먼저 올려주세요."
  warn "예: rsync -avz --exclude node_modules --exclude dist ./ root@1.201.125.92:$APP_DIR/"
  warn "코드 배치 후 이 스크립트를 다시 실행하세요."
  exit 0
fi

if [[ -d "$APP_DIR/.git" ]]; then
  log "git pull"
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only || warn "git pull 실패 (skip)"
fi

# ── 4) 빌드 ───────────────────────────────────────────────────────────────
log "server 빌드 (tsc → dist/)"
sudo -u "$APP_USER" bash -c "cd $APP_DIR/server && npm ci --no-audit --no-fund && npx tsc"

if [[ ! -f "$APP_DIR/server/dist/index.js" ]]; then
  err "server/dist/index.js 생성 실패 — tsconfig.json 의 noEmit/outDir 확인 필요"
  exit 1
fi
log "server/dist/index.js 확인 완료"

log "frontend 빌드 (vite)"
sudo -u "$APP_USER" bash -c "cd $APP_DIR/frontend && npm ci --no-audit --no-fund && npx vite build"

log "frontend dist → $WEB_ROOT 복사"
rm -rf "$WEB_ROOT"/*
cp -r "$APP_DIR/frontend/dist/"* "$WEB_ROOT/"
chown -R www-data:www-data "$WEB_ROOT"

# ── 5) .env 확인 ──────────────────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  warn "$ENV_FILE 이 없습니다."
  warn "아래 명령으로 템플릿을 복사한 뒤 값을 채우고 다시 실행하세요:"
  warn "  sudo cp $APP_DIR/.env.production.example $ENV_FILE"
  warn "  sudo node $APP_DIR/deploy/scripts/generate-password-hash.mjs '원하는비밀번호'"
  warn "  sudo nano $ENV_FILE"
  exit 0
fi

# 필수 env 검증
missing=0
for key in CORVUS_ACCESS_PASSWORD_HASH CORVUS_SESSION_SECRET; do
  if ! grep -qE "^${key}=.+" "$ENV_FILE"; then
    warn "$ENV_FILE 에 $key 가 없거나 비어있음"
    missing=1
  fi
done
if [[ $missing -eq 1 ]]; then
  warn "필수 환경변수가 누락되어 백엔드를 재시작하지 않습니다."
  exit 0
fi

chmod 640 "$ENV_FILE"
chown root:"$APP_USER" "$ENV_FILE"

# ── 6) systemd 서비스 ───────────────────────────────────────────────────────
log "systemd 서비스 등록"
cp "$APP_DIR/deploy/systemd/corvusx-backend.service" /etc/systemd/system/corvusx-backend.service
systemctl daemon-reload
systemctl enable corvusx-backend
systemctl restart corvusx-backend
sleep 2
systemctl status corvusx-backend --no-pager -l | head -20 || true

# ── 7) nginx 설정 ─────────────────────────────────────────────────────────
log "nginx 설정 배치 (기존 분리 conf 정리 포함)"

# 이전 단계에서 남아있던 분리형 conf 제거 — 병합 conf 1개로 일원화
for f in cloudcookie.co.kr cloudcookie-redirect www.cloudcookie.co.kr app.cloudcookie.co.kr; do
  rm -f "/etc/nginx/sites-enabled/$f.conf" "/etc/nginx/sites-enabled/$f"
  rm -f "/etc/nginx/sites-available/$f.conf" "/etc/nginx/sites-available/$f"
done

cp "$APP_DIR/deploy/nginx/cloudcookie.conf" /etc/nginx/sites-available/cloudcookie.conf
ln -sf /etc/nginx/sites-available/cloudcookie.conf /etc/nginx/sites-enabled/cloudcookie.conf
rm -f /etc/nginx/sites-enabled/default

# basic auth 파일이 남아있다면 삭제 (더 이상 사용 안 함)
rm -f /etc/nginx/.htpasswd

mkdir -p /var/www/html
nginx -t
systemctl reload nginx

# ── 8) 방화벽 ────────────────────────────────────────────────────────────
log "ufw 방화벽 규칙"
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
echo "y" | ufw enable || true

# ── 9) SSL (첫 실행 시만) ────────────────────────────────────────────────
if [[ ! -d /etc/letsencrypt/live/app.cloudcookie.co.kr ]]; then
  log "Let's Encrypt 인증서 발급"
  certbot --nginx \
    -d cloudcookie.co.kr \
    -d www.cloudcookie.co.kr \
    -d app.cloudcookie.co.kr \
    --email zatino75@gmail.com \
    --agree-tos \
    --non-interactive \
    --redirect
  systemctl reload nginx
else
  log "SSL 인증서 이미 존재 — 발급 스킵 (갱신은 certbot.timer 가 자동)"
fi

log "배포 완료"
log "접속: https://app.cloudcookie.co.kr"
