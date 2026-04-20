# CORVUS X — CLAUDE.md
> 최종 업데이트: 2026-04-20 (평면 2D top-down 오피스 전환 — 아이소메트릭 포기)
> 이 파일이 유일한 기술 소스 오브 트루스입니다.

## 프로젝트 개요
CORVUS X는 10개 부서 기반 Director Multi-Agent 시스템.
Claude Opus / GPT-5.4 / Gemini 2.5 Pro / Perplexity를 연결해
AI 분석 / 법률 검토 / 상품 개발 / 시장 조사 / 재무 분석을 수행.

진입점: corvusx-office.html 단일 (AI CHAT 폐기됨)
URL: https://app.cloudcookie.co.kr (로그인 필수)

## 접속 및 인증
- 로그인 페이지: `/login` (공개) — `login.html` 단일 비밀번호 입력
- 루트 `/`: corvus_session 쿠키 없으면 nginx 가 `/login` 으로 302 → 있으면 `/corvusx-office.html` 서빙
- 쿠키: `corvus_session` (httpOnly, Secure, SameSite=Strict, Max-Age 7일)
- 백엔드 인증: scrypt 비밀번호 해시 + HMAC-SHA256 세션 서명
  - `server/src/http/auth.ts` — 인증 primitive (scrypt, HMAC, 쿠키 파싱)
  - `server/src/routes/auth.ts` — `/api/auth/login` (`POST { password }`) / `/logout` / `/me`
  - `server/src/index.ts` — `/api/*` 전체 보호, 화이트리스트(/api/health, /api/auth/*) 만 공개
- 환경변수 (서버 `/etc/corvusx/.env`):
  - `CORVUS_ACCESS_PASSWORD_HASH` — `scrypt$N$saltHex$hashHex` 형식
  - `CORVUS_SESSION_SECRET` — 32자+ hex (HMAC 서명 키)
- 로그아웃: 오피스 HUD 우측 `LOGOUT` 버튼 → `POST /api/auth/logout` → `/login` 이동
- 자동 리다이렉트: 오피스 로드 시 `GET /api/auth/me` 호출, `authenticated:false` 면 `/login` 이동 (탭 방치 중 세션 만료 방어)
- 절대 금지:
  - `/etc/nginx/.htpasswd` + `auth_basic` — 내부 로그인 UI 와 충돌
  - `isLocalRequest()` localhost 자동 통과 — nginx 리버스 프록시에서 인증 전체 무력화 (`http/auth.ts` 는 항상 false 반환)

## 4가지 도구 운영 원칙
| 도구 | 역할 | 금지 |
|------|------|------|
| GitHub CLAUDE.md | 코드+지침 유일한 소스 | 다른 곳에 지침 중복 |
| Notion | 완료 이력+잔여 작업만 | 코드/아키텍처 상세 |
| Google Drive | 대용량 파일만 | 문서/지침 보관 |
| Karpathy Plugin | user scope 전역 자동 적용 | 별도 파일 관리 |

## 서버 정보
- 서버: Gabia Ubuntu 22.04 / IP: 1.201.125.92 / RAM 4GB
- 앱 루트: /opt/corvusx/
- nginx 서빙: /var/www/corvusx/
- 환경변수: /etc/corvusx/.env (systemd EnvironmentFile)
- 서비스: systemctl status corvusx-backend
- 로그: journalctl -u corvusx-backend -f
- API 키: ANTHROPIC / OPENAI / GEMINI / SERPER (등록완료)
- 추가 키 (선택): DEEPSEEK_API_KEY (CriticReview Primary), FAL_API_KEY (design 이미지/영상 생성)
  미설정 시 각각 Haiku / nano_banana 로 자동 폴백

## 로컬 개발 환경
- OS: Windows 11
- 로컬 저장소: C:\Users\User\Desktop\CONVUSX
- Claude Code: cd C:\Users\User\Desktop\CONVUSX && claude --dangerously-skip-permissions
- SSH 키: C:\Users\User\.ssh\id_deploy
- 운영 스크립트: .\convusx-ops.ps1 [작업시작|작업완료|상태확인|드라이브정리]

## 기술 스택
- 프론트엔드: corvusx-office.html (독립 HTML, 181KB)
- 백엔드: Node.js + TypeScript (Express)
- DB: SQLite (서버 내장)
- 오피스 UI: SVG + CSS 기반 Middle Management 스타일 (파스텔 2.5D, 블롭 캐릭터, 복도 이동)
- 배포: nginx + systemd
- CI/CD: GitHub → auto-deploy.sh (수동 트리거)

## 배포 절차
```bash
# 백엔드
cd /opt/corvusx/server
tsc --noEmit
rm -rf dist && ./node_modules/.bin/tsc
systemctl restart corvusx-backend

# office.html은 /var/www/corvusx/ 직접 수정, 빌드 불필요

# 검증
curl -s https://app.cloudcookie.co.kr/api/health

# Git
git add -A && git commit -m "feat: 내용" && git push origin main
```

## 아키텍처 — 상무 게이트키퍼
유저 메시지 (20자 이상)
  → ExecutiveGate (Claude Sonnet, 20초)
    → single_agent: Opus 단독 처리
    → director: 부서 선별 + 맞춤 지시 → 병렬 실행 → 취합 → CEO 브리핑

## Director 플로우
1. ExecutiveGate (Sonnet) — 부서 선별 + 맞춤 지시 생성
2. 부서 병렬 실행 (10개 중 선별된 부서만)
3. CriticReview (Haiku) — include/exclude/rework + 1~10점 품질 점수
4. 보강 루프 1회 (rework 부서만 재실행, 구체적 개선 요청 포함)
5. CeoBriefing (Haiku) — 5섹션 구조

## 부서 구성 (10개)
| 부서 | Primary | Fallback | 커넥터 | 도구 |
|------|---------|----------|--------|------|
| market | Gemini 2.5 Pro | Claude Sonnet | serper→perplexity | market_analyze |
| compete | GPT-5.4-pro | Claude Sonnet | serper→perplexity* | competitor_scan |
| legal | Claude Opus 4.6 | GPT-5.4-pro | serper→perplexity* | regulation_check |
| finance | GPT-5.4-pro | Gemini 2.5 Pro | supabase→serper | finance_analyze |
| marketing | Claude Sonnet | GPT-5.4-pro | serper→perplexity | brand_positioning |
| rnd | Claude Sonnet | Gemini 2.5 Pro | pubmed→perplexity→serper | recipe_design |
| data | Gemini 2.5 Pro | GPT-5.4-pro | posthog→supabase→serper | sentiment_analyze |
| content | Claude Sonnet | GPT-5.4-pro | serper→perplexity | content_pillar |
| sns | Gemini 2.5 Pro | Claude Sonnet | serper→perplexity* | channel_strategy |
| design | Claude Sonnet | Gemini 2.5 Pro | fal→nano_banana→canva | design_create |

## 내부 프로세스
| 프로세스 | Primary | Fallback | 비고 |
|----------|---------|----------|------|
| ExecutiveGate | Claude Sonnet | — | 부서 선별 + 맞춤 지시 |
| CriticReview | DeepSeek V3.2 | Claude Haiku → Gemini Flash | 3단계 폴백 |
| CeoBriefing | Claude Haiku | Claude Sonnet → Gemini Pro | 3단계 폴백 |

- 모델 분포: Opus 1 / Sonnet 4 / Haiku 1(CeoBriefing) / GPT-5.4 2 / Gemini 3 / DeepSeek 1(Critic)
- Fallback: Cross-provider (다른 회사 모델)
- 비주얼 에셋(이미지/영상/3D/로고/배너/인테리어)은 design 전담 — marketing/content/sns 는 전략·기획만
- DeepSeek 는 CriticReview Primary 에만 사용 (JSON 평가 전용)
- fal.ai 는 design 부서 이미지/영상/3D 생성 Primary 커넥터 — 키 미설정 시 nano_banana 로 폴백
- `*` 표시된 compete/legal/sns 의 커넥터 순서는 Perplexity quota 고갈로 임시 강등 (serper 우선). 충전 후 `perplexity→serper` 로 원복 예정 (2026-04-19)
- 고가치 앙상블 (3-AI): legal, finance 2개만 (design 은 비주얼 단일 모델이 우수)

## 실제 모델 ID
| 모델 | API 호출 ID | 비고 |
|------|-------------|------|
| Claude Opus | claude-opus-4-6 | 에이전트 루프, legal |
| Claude Sonnet | claude-sonnet-4-6 | 6개 부서, ExecutiveGate |
| Claude Haiku | claude-haiku-4-5-20251001 | Critic, CEO Briefing |
| GPT | gpt-5.4-pro | compete, finance |
| GPT 앙상블 | gpt-5.4 | 3-AI 앙상블 |
| Gemini | gemini-2.5-pro | data 부서, PDF |
| Gemini 표시 | Gemini 2.5 Pro | GEMINI_DISPLAY_LABEL |
| Perplexity | sonar-pro | 웹 검색 |
| Serper | Google Search API | Tavily 대체 |

## 타임아웃
| 항목 | 초 |
|------|-----|
| Claude Opus | 90 |
| Claude Sonnet / GPT | 60 |
| GPT-5.4-pro (앙상블) | 120 |
| Gemini | 45 |
| Fallback | 45 |
| CriticReview | 30 |
| CeoBriefing | 40 |
| 앙상블 전체 | 90 |
| synthesis | 110 |
| 커넥터 | 15 |
| nginx proxy_read | 600 |
| SSE 연결 | 360 |

## SSE 이벤트
executive_gate_start / done / redirect
dept_start / progress / done / error / rework_start / done
critic_start / done / rework
ensemble_start / ensemble_voice / ensemble_done
ceo_briefing / all_done

## corvusx-office.html 현재 기능

### 레이아웃
- 사이드바 (좌): 토글 + 드래그 너비 (200~400px)
- 오피스 (중앙): Middle Management 스타일 10개 방 + 복도 + 상무실 + 휴게실
- 채팅 패널 (중앙 하단): 마크다운 렌더링 + 메시지 액션
- 우측 패널: 부서현황/매출/POS/보고 탭 + 드래그 리사이즈 (240~520px)

### 사이드바
- 새 채팅 / 이미지 / 대시보드
- 프로젝트 + 스레드 카드 (고정/해제/삭제 + 📌 배지)
- 최근 채팅 (general 스레드)

### 입력창
- 자동 높이 24~160px / 한글 IME 가드
- 파일 첨부 (드래그/선택/붙여넣기) / 최대 10개 20MB
- 슬래시 커맨드 13개

### 대화창
- marked.js + DOMPurify + highlight.js
- CEO 메시지 골드 border (#C9A84C) + ★ prefix
- 메시지 액션 (복사/편집/재생성/👍👎) / 버전 관리

### 오피스 (평면 2D top-down) — SimCity 스타일 (2026-04-20 전환)
- 아이소메트릭 완전 포기 → 순수 top-down 평면도 (가구 겹침 0건, 명확한 구획)
- viewBox 800×440
- 팔레트: 바닥 #E8EAF0, 타일 그리드 #D8DCE2, 가구 #6B7380/#8B929C/#2A2E38, 골드 #C9A84C/#E4C773, 액센트 #E24B4A
- 외벽: #4A5260 stroke 8px 두꺼운 테두리 + 내부 점선 구분선(x=540)으로 왼쪽 작업공간/오른쪽 부대시설 분리
- 바닥: 은색펄 + 40×40 타일 그리드 (은은한 #D8DCE2 0.5px 라인)
- 북쪽 벽: 창문 5개 (70×16 파스텔 블루 + 중앙 mullion) + CORVUS X 골드 로고 박스
- 10개 팀 책상 (2D 평면 `drawDesk2D`, 80×40 상판 + 모니터 24×14 + 키보드 + 마우스 + 원형 의자):
  - 행1(북쪽 창가): market / marketing / finance / legal
  - 행2(중앙): compete / rnd / content / sns
  - 행3(남쪽, 간격 넓게): data / design
- 3개 부대시설 (오른쪽 세로, 각 구역 점선 테두리):
  ★ 상무 테이블 (560,50 – 220×90) — 원형 골드 테이블 + 의자 6개 + 상무 캐릭터(상석 고정)
  💼 미팅룸 (560,170 – 220×110) — 긴 직사각형 테이블 + 3×2 의자 6석 + 노트북 2대 + 커피컵
  ☕ 휴게실 (560,300 – 220×120) — U자 소파 + 쿠션 3개 + 유리 커피테이블 + TV(cyan + 뉴스틱커) + 6색 자판기 + 화분
- 왼쪽 하단 공터: 정수기(28×36 + 빨/파 꼭지) + 화분 2개
- 블롭 캐릭터는 SVG 위에 HTML overlay (기존 구조 유지). 캐릭터 디자인은 옵션 A(기존 블롭) 유지 — 정체성 보존
- 모니터 상태 컬러: working→cyan #4AD9F5 / done→green #22C55E / error→red #EF4444 / rework→amber #F59E0B / briefing→gold / collab→purple
- 이동 로직:
  - executive_gate_done (≥3 부서) → tphRunCollab: 미팅룸 집결 ("협업 중 🤝") 후 흩어짐
  - executive_gate_done (≤2 부서) → 바로 dept_start
  - dept_start → tphWalkToSanmoo ("미팅 중 💬") → working (분석/검색/작성/정리 회전)
  - dept_done → tphWalkToSanmoo ("보고 중 📋") → done
  - idle wander → 15초 간격 25% 확률로 휴게실 방문

## 서버 파일 구조
server/src/
├── agent/           agentLoop, toolRegistry, toolBootstrap
├── agent/tools/     perplexitySearch, webFetch, gptDraft, geminiDraft, claudeDraftAlt
│                    parallelEnsemble, adversarialCritique, readAttachment
├── agent/tools/domain/
│   ├── food/        marketAnalyze, equipmentSearch, regulationCheck, recipeDesign, brandRetail
│   ├── ecig/        marketAnalyze, competitorScan, regulationCheck, brandRetail
│   ├── cosmetic/    marketAnalyze, competitorScan, recipeDesign, manufacturingCheck
│   └── general/     marketAnalyze, businessAnalyze, financeAnalyze
├── director/        DirectorAgent, EnsembleRunner, CriticReview, PmoCoordinator, CeoBriefing, TaskDecomposer, ProjectSession
├── departments/     DepartmentAgent, DepartmentRegistry
│   └── depts/       compete, content, data, finance, legal, market, marketing, rnd, sns
├── regulation/      regulationWatcher, regulationCache, regulationSources
├── fusion/          threadFusion, projectFusion, sourcePromoter
├── adapters/        openai, claude, gemini, perplexity, midjourney, runway, veo, nanoBanana
├── memory/          threadMemory, attachmentCache, projectMemory, sqliteMemory, sourceStore
├── connectors/      tavily, pubmed, posthog, supabase
├── routes/          chat, director, directorStream, dashboard, usage, feedback, settings
├── http/            auth.ts (scrypt + HMAC-SHA256)
├── config/          defaults.ts
├── scheduler/       backgroundScheduler
├── reports/         retailSnapshot
└── sseRegistry.ts   threadId 기반 SSE 연결 관리

## 절대 금지 패턴
1. toolRegistry.ts에서 tools/*.js 직접 import — ESM 순환 import TDZ. toolBootstrap.ts로 분리
2. auth에서 isLocalRequest localhost 자동 통과 — nginx 리버스 프록시에서 인증 무력화
3. /etc/nginx/.htpasswd + auth_basic — 내부 로그인 UI 충돌
4. (수정 2026-04-20) 채팅 전용 모드로 전환 — `.office-wrap` CSS `display:none` 으로 숨김. 오피스 SVG / TPH_* JS 함수 / `.tph-*` CSS 는 dead code 로 남아 있음. 향후 완전 제거 시 SSE 핸들러(`tphSetRoomState` 등) 호출처도 함께 정리 필요
5. Notion/Drive에서 지침 문서 참조 — 이 CLAUDE.md가 유일한 소스
6. EnsembleRunner Promise.allSettled — Promise.all 유지
7. CriticReview needs_followup인데 targetDeptId 비움 — CRITIC walk 멈춤

## 알려진 이슈
- GPT-5.4-pro 120s 타임아웃 내 응답 못할 때 → ensemble verdict split
- TPH HUD 미션 텍스트: mission_start topic 미연결 ("대기 중" 고정)
- 멀티 채팅 SSE: 백엔드 인프라 완성, 프론트(office.html) 미연결

## 새 스레드 시작 프로토콜
1. Claude.ai: "Notion에서 CONVUS X 개발 현황 불러와서 이어서 작업해줘"
2. Notion에서 잔여 작업 확인
3. 코드 세부사항은 서버에서 직접 cat/grep
4. Drive 문서는 절대 조회하지 않음

## 작업 완료 프로토콜
1. Claude Code에서 git commit + push
2. 서버 배포 (tsc + systemctl restart)
3. Claude.ai에서 Notion 잔여 작업 업데이트
4. Drive는 건드리지 않음
