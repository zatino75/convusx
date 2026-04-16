#!/usr/bin/env bash
# setup-git-remote.sh — 서버에 SSH deploy key + github.com-convusx 호스트 alias 를
# 1회 세팅. auto-deploy.sh 의 전제 조건을 만들어 준다.
#
# 실행 후:
#   1) 출력되는 공개키를 GitHub repo zatino75/convusx 의
#      Settings → Deploy keys → Add deploy key 에 등록 (Write access 불필요)
#   2) /opt/corvusx/deploy/auto-deploy.sh 실행

set -euo pipefail

CORVUS_ROOT="${CORVUS_ROOT:-/opt/corvusx}"
KEY_PATH="/root/.ssh/convusx_deploy"

mkdir -p /root/.ssh && chmod 700 /root/.ssh

if [[ ! -f "${KEY_PATH}" ]]; then
  ssh-keygen -t ed25519 -N "" -C "convusx-server-deploy" -f "${KEY_PATH}" -q
  echo "[생성] ${KEY_PATH}"
else
  echo "[재사용] ${KEY_PATH}"
fi
chmod 600 "${KEY_PATH}"

# SSH config — github.com 접속 시 이 키만 사용하는 alias
if ! grep -q "Host github.com-convusx" /root/.ssh/config 2>/dev/null; then
  cat >> /root/.ssh/config <<'EOF'

Host github.com-convusx
  HostName github.com
  User git
  IdentityFile /root/.ssh/convusx_deploy
  IdentitiesOnly yes
EOF
  chmod 600 /root/.ssh/config
  echo "[추가] SSH config → github.com-convusx alias"
fi

# github.com 호스트 키 캐싱
ssh-keyscan -H github.com >> /root/.ssh/known_hosts 2>/dev/null
sort -u /root/.ssh/known_hosts -o /root/.ssh/known_hosts

# git remote (alias URL 사용)
git config --global --add safe.directory "${CORVUS_ROOT}" 2>/dev/null || true
cd "${CORVUS_ROOT}"
if [[ ! -d .git ]]; then
  git init -b main
  git config user.email "deploy@corvusx.internal"
  git config user.name "Corvus X Deploy"
fi

git remote remove origin 2>/dev/null || true
git remote add origin git@github.com-convusx:zatino75/convusx.git
echo "[원격] origin → git@github.com-convusx:zatino75/convusx.git"

echo ""
echo "=== GitHub 에 등록할 공개키 (Deploy key, Read-only 권장) ==="
cat "${KEY_PATH}.pub"
echo ""
echo "=== fingerprint ==="
ssh-keygen -lf "${KEY_PATH}.pub"
echo ""
echo "위 공개키를 zatino75/convusx 의 Settings → Deploy keys 에 등록한 뒤"
echo "  /opt/corvusx/deploy/auto-deploy.sh 를 실행하세요."
