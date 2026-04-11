# CORVUS X 서버 배포 가이드

가비아 클라우드 서버(`1.201.125.92`, Ubuntu 22.04) 에 CORVUS X 를 배포하고
`https://app.cloudcookie.co.kr` 에서 비밀번호 로그인으로만 접속 가능하게 만드는 전체 절차입니다.

> **도메인 구조**
> - `cloudcookie.co.kr` / `www.cloudcookie.co.kr` → `https://app.cloudcookie.co.kr` 로 **301 redirect**
> - `app.cloudcookie.co.kr` → CORVUS X 본체 (비밀번호 로그인 필수)
>
> **DNS 상태 (2026-04-10 기준 확인 완료)**
> 가비아 DNS 관리에 A 레코드 3개 (`@`, `www`, `app`) 모두 `1.201.125.92` 로 이미 등록됨. 추가 작업 불필요.

---

## 0. 사전 준비

로컬(Windows) 에서 확인할 것:

1. 가비아 클라우드 서버 SSH 접속 정보 (root 비밀번호 또는 키)
2. 설정하고 싶은 **CORVUS X 로그인 비밀번호** (8자 이상 권장)
3. 각 AI 공급자 API 키 (OpenAI / Anthropic / Google / Perplexity 등 — 쓰는 것만)

---

## 1. 서버 접속

```bash
ssh root@1.201.125.92
```

---

## 2. 코드 업로드

### 방법 A — git clone (원격 저장소가 있는 경우)

```bash
mkdir -p /opt/corvusx
cd /opt/corvusx
git clone <your-repo-url> .
```

### 방법 B — rsync (로컬에서 바로 올릴 때)

로컬 Windows PowerShell 에서 WSL 또는 rsync 가 설치된 환경:

```bash
rsync -avz --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .git \
  --exclude "CONVUS X/server/.env" \
  "/mnt/c/Users/User/Desktop/CONVUS X/" \
  root@1.201.125.92:/opt/corvusx/
```

---

## 3. 환경 변수 (.env) 구성

### 3-1. 디렉토리 생성 및 템플릿 복사

```bash
sudo mkdir -p /etc/corvusx
sudo cp /opt/corvusx/.env.production.example /etc/corvusx/.env
```

### 3-2. 비밀번호 해시 생성

```bash
cd /opt/corvusx
sudo node deploy/scripts/generate-password-hash.mjs '원하는비밀번호'
```

출력되는 2줄을 복사해 둡니다:

```
CORVUS_ACCESS_PASSWORD_HASH=scrypt$16384$...
CORVUS_SESSION_SECRET=...
```

> 셸 history 에 비밀번호가 남는 게 싫으면 `HISTCONTROL=ignorespace` 를 먼저 export 하고
> 명령어 앞에 공백 한 칸을 두고 실행하세요.

### 3-3. .env 편집

```bash
sudo nano /etc/corvusx/.env
```

최소한 아래 값들을 채웁니다:

```ini
NODE_ENV=production
PORT=8000

# 로그인
CORVUS_ACCESS_PASSWORD_HASH=scrypt$16384$...   # 위에서 생성한 값
CORVUS_SESSION_SECRET=...                       # 위에서 생성한 값
CORVUS_COOKIE_SECURE=true
CORVUS_COOKIE_DOMAIN=app.cloudcookie.co.kr

# CORS
CORS_ORIGINS=https://app.cloudcookie.co.kr

# DB
DB_PATH=/var/lib/corvusx/corvus.db

# AI 공급자 (쓰는 것만)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
PERPLEXITY_API_KEY=...
```

저장: `Ctrl+O` → `Enter` → `Ctrl+X`

---

## 4. 배포 스크립트 실행

```bash
cd /opt/corvusx
sudo bash deploy/scripts/deploy.sh
```

이 스크립트 1번에 처리되는 항목:

1. Node.js 20, nginx, certbot, ufw 설치
2. `corvusx` 시스템 사용자 생성
3. `server` / `frontend` 빌드 (`npm ci && npm run build`)
4. 프론트 `dist` → `/var/www/corvusx` 복사
5. `corvusx-backend.service` systemd 등록 & 시작
6. nginx 설정(`cloudcookie.conf`) 배치 & reload
7. ufw 방화벽: OpenSSH + Nginx Full 허용
8. Let's Encrypt 인증서 발급 (3개 도메인 전체 HTTPS 자동 전환)

> 스크립트는 **idempotent** 합니다. 문제 있으면 같은 명령어를 그냥 다시 실행해도 됩니다.
> 두 번째 실행부터는 SSL 발급을 건너뛰고 `git pull → 빌드 → 재시작` 만 수행합니다.

---

## 5. 동작 확인

### 5-1. 서비스 상태

```bash
sudo systemctl status corvusx-backend --no-pager -l
sudo journalctl -u corvusx-backend -f
```

### 5-2. 로그

```bash
sudo tail -f /var/log/corvusx/backend.log
sudo tail -f /var/log/corvusx/backend.err
```

### 5-3. 브라우저 접속

1. `https://app.cloudcookie.co.kr` → 로그인 화면이 떠야 함
2. `https://cloudcookie.co.kr` → `https://app.cloudcookie.co.kr` 로 자동 redirect
3. `https://www.cloudcookie.co.kr` → 동일하게 redirect
4. 3-2 에서 설정한 비밀번호 입력 → CORVUS X 메인 화면 진입

---

## 6. 업데이트 (코드 수정 후 재배포)

로컬에서 rsync 로 덮어쓰거나 서버에서 `git pull` 후:

```bash
cd /opt/corvusx
sudo bash deploy/scripts/deploy.sh
```

동일 스크립트가 빌드 + 재시작까지 알아서 수행합니다.

---

## 7. 비밀번호 변경

```bash
cd /opt/corvusx
sudo node deploy/scripts/generate-password-hash.mjs '새비밀번호'
sudo nano /etc/corvusx/.env         # CORVUS_ACCESS_PASSWORD_HASH 줄 교체
sudo systemctl restart corvusx-backend
```

세션 쿠키도 전부 무효화하고 싶으면 `CORVUS_SESSION_SECRET` 도 새로 바꾸면 됩니다.

---

## 8. 트러블슈팅

| 증상 | 원인 / 조치 |
|---|---|
| `systemctl status` 가 `failed` | `/var/log/corvusx/backend.err` 확인. 대부분 `/etc/corvusx/.env` 값 누락 |
| 로그인 화면에서 "비밀번호 로그인이 비활성화됨" | `CORVUS_ACCESS_PASSWORD_HASH` 가 .env 에 없거나 형식이 깨짐 |
| `502 Bad Gateway` | 백엔드가 죽었거나 포트가 `8000` 이 아님. `systemctl status corvusx-backend` 확인 |
| SSL 발급 실패 | 가비아 DNS A 레코드 확인 (`dig app.cloudcookie.co.kr`), `ufw status` 에 `Nginx Full` 허용 확인 |
| "Too many attempts" | 같은 IP 에서 15분 내 10회 실패. 15분 기다리거나 서버 재시작 |
| 로그인 후 바로 로그아웃됨 | `CORVUS_COOKIE_SECURE=true` + HTTPS 필수. HTTP 로 접속하면 쿠키가 안 저장됨 |

---

## 9. 파일 위치 요약

| 역할 | 경로 |
|---|---|
| 코드 | `/opt/corvusx` |
| 환경 변수 | `/etc/corvusx/.env` |
| DB | `/var/lib/corvusx/corvus.db` |
| 로그 | `/var/log/corvusx/backend.log` / `backend.err` |
| 프론트 정적 파일 | `/var/www/corvusx` |
| nginx 설정 | `/etc/nginx/sites-available/cloudcookie.conf` |
| systemd 유닛 | `/etc/systemd/system/corvusx-backend.service` |
| SSL 인증서 | `/etc/letsencrypt/live/app.cloudcookie.co.kr/` |

---

## 10. 보안 체크리스트

- [x] `CORVUS_COOKIE_SECURE=true` (HTTPS 전용 쿠키)
- [x] `CORVUS_COOKIE_DOMAIN=app.cloudcookie.co.kr` (쿠키 스코프 고정)
- [x] `CORS_ORIGINS=https://app.cloudcookie.co.kr` (단일 origin)
- [x] scrypt 해시 저장 (평문 비밀번호 파일에 저장 금지)
- [x] 세션 시크릿은 서버에만 존재 (`/etc/corvusx/.env`, mode 640)
- [x] systemd 하드닝 (`NoNewPrivileges`, `ProtectSystem=strict`)
- [x] ufw 방화벽 (80/443/22 외 차단)
- [x] nginx 보안 헤더 (`X-Frame-Options: DENY`, `X-Robots-Tag: noindex`)
- [x] rate limiting (IP 당 15분 10회)

---

끝. 문제 생기면 `/var/log/corvusx/backend.err` 가 1순위 확인 지점입니다.
