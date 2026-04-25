# CORVUS X — 02_다음작업 (Batch 6 이후)

작성일: 2026-04-16 · 기준 커밋: main @ f7770a4

## 방금 완료 (Batch 6 — 배포 자동화)

### 1. main 머지 + 푸시
- codex/convus-x (12 phase7 commits) → main fast-forward
- origin/main 이 48ede38 → f7770a4 (deploy 스크립트 추가 포함)

### 2. 프로덕션 배포 (gabia 서버 /opt/corvusx)
- 백업: /opt/corvusx_backup_20260416_214639 (380MB)
- git archive HEAD → 서버에 스트림 tar 전송 (private repo 로 fetch 불가 우회)
- 폐기 orphan 제거: server/src/orchestra/, server/src/claims/, server/tests/planner.test.*, index.ts.tmp
- git init + SSH alias remote (git at github.com-convusx:zatino75/convusx.git) + bootstrap commit be8d661
- data/ 보존: attachment-cache.json, corvus.db, corvusx-memory.db 그대로
- /etc/corvusx/.env 보존: 외부 경로라 영향 없음

### 3. 빌드 + 재시작 검증
- /opt/corvusx 루트에서 npm install (135 packages, tsc/tsx 확보)
- /opt/corvusx/server 에서 rm -rf dist then tsc then dist/index.js 생성
- systemctl restart corvusx-backend → active
- curl /api/health → HTTP 200, ok:true, service CORVUS X, gemini_api_key LOADED

### 4. 배포 스크립트
- deploy/auto-deploy.sh: git fetch+reset+npm install+tsc+restart+curl health 원클릭
- deploy/setup-git-remote.sh: SSH deploy key 생성 + github.com-convusx alias 세팅
- 둘 다 executable 로 커밋 (f7770a4)

## 사용자 수동 작업 1건 (블로킹은 아님)

GitHub 에 서버 deploy key 등록:
- URL: https://github.com/zatino75/convusx/settings/keys
- 공개키 (서버 /root/.ssh/convusx_deploy.pub):
  ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIObXVms0BB6KphkXJIlu8CqGozgpvR8wm/3G4cqcGCdX convusx-server-deploy
- Access: Read-only 로 충분 (서버는 pull 만)
- 등록 후 /opt/corvusx/deploy/auto-deploy.sh 로 git 기반 배포 자동화 완성

## 남은 개발 항목 (우선순위 순)

### 1. 미디어 API 키 연동 (주요 미완)
- MIDJOURNEY_API_KEY (or 구글 Imagen 경로) — adapters/midjourney.ts + generateImage.ts 이미 구현
- RUNWAY_API_KEY — adapters/runway.ts 구현 완료
- GOOGLE_CLOUD_PROJECT + Veo 3.1 접근 — adapters/veo.ts 구현 완료
- SLIDES_CREATOR_API_KEY 또는 내부 /api/slides/generate endpoint
- 현재 /api/health 의 Anthropic 키 401: ANTHROPIC_API_KEY 갱신 필요 가능성

### 2. Director / agentLoop 모드 전환 UI 관측 데이터
- 실사용자 Director 호출 후 dept_xp.total_cost_usd 실측 누적 확인
- WS dept:levelup 이벤트가 DeptStatsCard / 픽셀 오피스에서 실제 트리거되는지 live 검증

### 3. Benchmark 경로 의사결정
- /api/benchmark + frontend BenchmarkView 전면 폐지 vs 유지
- 현재: scoreboard/judge 폐기 방침과 상충되지만 /api/benchmark 가 evaluator.ts 로 살아있음

### 4. ESLint CI 차단 모드 전환
- .github/workflows/ci.yml 의 lint job 이 현재 비차단 (|| true)
- eslint 를 devDependencies 에 추가 + 규칙 안정화 후 || true 제거

### 5. Drive Claude-Context 동기화 자동화
- MCP create_file 만 있고 update 없음 → 매 세션마다 새 파일 생성
- 장기적으로는 decision log 를 GitHub repo docs/ 에 두고 drive 는 요약만 동기화

## 관측 포인트

프로덕션 기동 직후 journal 경고:
- anthropic status_401 — Anthropic API 키 만료/무효 가능성. 콘솔에서 갱신 권장
- dotenv injecting env 0 from ../.env — systemd EnvironmentFile /etc/corvusx/.env
  경로로 실제 env 주입되므로 dotenv 0 건은 정상

## 다음 세션 킥오프 체크리스트

- [ ] GitHub deploy key 등록 완료 확인 (위 공개키)
- [ ] ssh root@1.201.125.92 → /opt/corvusx/deploy/auto-deploy.sh 테스트 실행
- [ ] Anthropic API 키 갱신 필요 여부 판정
- [ ] app.cloudcookie.co.kr 접속 → Director 모드 실행 → dept:levelup 실측
- [ ] 필요 시 미디어 API 키 적재 + /etc/corvusx/.env 갱신 후 restart
