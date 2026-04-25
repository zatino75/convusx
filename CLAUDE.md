# CORVUS X — CLAUDE.md
> 최종 업데이트: 2026-04-25 (Session 6 — 비용 차단 / 6 프로바이더 크레딧 / SQLite 영구 저장 / 신규 커넥터)
> 이 파일이 유일한 기술 소스 오브 트루스입니다.

## Session 6 (2026-04-25) 핵심 변경
- **DEFAULT_MODEL**: `claude-opus-4-6` → `claude-sonnet-4-6` (영구). 자동 Opus 호출 차단으로 일일 비용 $25 누수 종결 (Opus 점유율 98.4% → 0%).
- **`startBenchmarkScheduler`**: 영구 no-op. setTimeout/setInterval 자동 트리거 제거. `/api/benchmark/run` 수동만 허용.
- **`backgroundScheduler`**: LLM API 호출 전부 제거. `checkProviderHealth` 는 env key 존재 검사만 (HTTP 200 등가). billing/잔액 endpoint(LLM 아님) 호출은 허용 → `creditFetcher.backgroundRefresh` 5분 주기.
- **6 프로바이더 크레딧 시스템**: Anthropic / OpenAI / Google / DeepSeek / Perplexity / fal. 카드 6 + 충전 모달 + 충전하러가기 새 탭. DeepSeek 만 자동 잔액 조회 (`/user/balance`), 나머지 5개는 수동 관리.
- **SQLite 영구 저장**: `server/data/corvusx.db` (WAL). `cost_entries` + `credit_entries`. 서버 재시작해도 today/이번 달 통계 보존. `costStore`/`creditStore` 모두 SQLite 백엔드.
- **대시보드 우측 패널 분리**: `dashboard`/`gallery` 뷰에서 `aside.panel` 강제 숨김 (CSS `.app[data-view] .panel` + JS `_setRightPanelVisible` 이중 보강).
- **신규 커넥터**: 식약처 RSS / Notion / 네이버 뉴스 / Google.
- **Planner 신규**: `director/Planner.ts`.
- **금지패턴 #19~23 추가**: 자동 LLM 호출 영구 차단 + SQLite 회귀 금지 + 우측 패널 토글.

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
- 프론트엔드: corvusx-office.html (독립 HTML, 117KB — 2026-04-21 dead code 삭제 후)
- 백엔드: Node.js + TypeScript (Express)
- DB: SQLite (서버 내장)
- ~~오피스 UI~~: 2026-04-21 완전 삭제 (TPH/Phaser/SVG 2200줄). 채팅 전용 UI만 잔존
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

## 아키텍처 — 의도 분류 + 게이트키퍼 (2026-04-24 Session 5)
유저 메시지 (20자 이상)
  → Classifier (Gemini Flash, 5초, $0.001)
    → simple_qa: Sonnet 단독 처리 ($0.05)
    → research/strategic: ExecutiveGate (Sonnet, 15초)
        → 부서 2단계: Flash 초안(15초) → Primary 심화 → CEO 브리핑

## Director 플로우 (속도 + 비용 우선, 2026-04-20~24)
1. **Classifier (Gemini Flash)** — intent + maxDepts 결정. simple_qa 면 Planner 우회.
2. ExecutiveGate Planner (Sonnet → GPT → Gemini 3단계 폴백) — 부서 선별 + 맞춤 지시. intent 기반 maxDepts cap 적용.
3. 부서 병렬 실행 (선별된 ≤ intent_maxDepts 부서)
   - **1단계**: Gemini Flash 초안 (15s, ~$0.003/부서, non-fatal)
   - **2단계**: 부서 Primary 심화 (초안을 보강·심화·근거 보완)
4. ~~CriticReview~~ — **`if (false)` bypass 상태. 기본 verdict (includeAll, score=7) 항상 통과**
5. ~~보강 루프~~ — Critic bypass 로 rework 경로 비활성
6. CeoBriefing (Haiku) — 5섹션 구조

## intent → maxDepts (Classifier 결정)
| intent | maxDepts | 라우팅 |
|---|---|---|
| simple_qa | 0 | single_agent (Sonnet) |
| operational | 2 | director |
| research | 3 | director |
| strategic | 4 | director |

> 모든 intent maxDepts ≤ 4 — CLAUDE.md 규칙 #6 (MAX_DEPTS=4) 유지.

> MAX_DEPTS=4 / Critic bypass 는 응답속도(앙상블 420s 내) 확보를 위한 의도적 정책. 재활성화 금지.

## 팀별 응답 형식 (2026-04-21 전환)
JSON 스키마 강제 폐지 → 마크다운 자유 출력.
- 출력 구조: `### 핵심 요약` / `### 주요 발견` / `### 리스크` (🔴/🟡/🟢) / `### 추가 확인 필요`
- 꼬리 1줄: `confidence: 0.XX` (regex 로만 추출)
- 본문은 마크다운 그대로 UI 에 표시. 표/인용/이모지 자유 사용
- 파서: `parseMarkdownSections` (헤딩 기반) + `tryParseJson` (confidence regex)
- `citations` 필드 제거 — 본문 내 링크로 통합

## 부서 구성 (10개)
| 부서 | Primary | Fallback | 커넥터 | 도구 |
|------|---------|----------|--------|------|
| market | Gemini 2.5 Pro | Claude Sonnet | serper→perplexity | market_analyze |
| compete | GPT-5.4-pro | Claude Sonnet | serper→perplexity* | competitor_scan |
| legal | Claude Sonnet 4.6 | GPT-5.4-pro → Gemini 2.5 Pro | serper→perplexity* | regulation_check |
| finance | GPT-5.4-pro | Gemini 2.5 Pro | supabase→serper | finance_analyze |
| marketing | Claude Sonnet | GPT-5.4-pro | serper→perplexity | brand_positioning |
| rnd | Gemini 2.5 Pro | Claude Sonnet | pubmed→perplexity→serper | recipe_design |
| data | Gemini 2.5 Pro | GPT-5.4-pro | posthog→supabase→serper | sentiment_analyze |
| content | GPT-5.4-pro | Claude Sonnet | serper→perplexity | content_pillar |
| sns | Gemini 2.5 Pro | Claude Sonnet | serper→perplexity* | channel_strategy |
| design | Claude Sonnet | Gemini 2.5 Pro | fal→nano_banana→canva | design_create |

## 내부 프로세스
| 프로세스 | Primary | Fallback | 비고 |
|----------|---------|----------|------|
| ExecutiveGate | Claude Sonnet | GPT-5.4-pro → Gemini 2.5 Pro | 3단계 폴백 (2026-04-23 SPOF 제거) |
| CriticReview | DeepSeek V3.2 | Claude Haiku → Gemini Flash | 3단계 폴백 (현재 bypass 중) |
| CeoBriefing | Claude Haiku | Claude Sonnet → Gemini Pro | 3단계 폴백 |

- 모델 분포 (Primary 기준, 2026-04-24 Session 5): **Opus 0** / Sonnet 4 (single_agent + legal/marketing/design) / Haiku 1 / GPT-5.4 3 / Gemini 4 (Pro) + Flash (Classifier+부서 1단계) / DeepSeek 1(Critic)
- Anthropic ~30% / Google ~40% (+Flash 보조) / OpenAI ~30%
- **Opus 완전 제거** — 2026-04-24 검증: 일일 $25 중 $24.78 (98.4%) 가 Opus. Classifier 완성 후 strategic 2단계에만 선택적 복귀 예정.
- Fallback: Cross-provider (다른 회사 모델)
- 비주얼 에셋(이미지/영상/3D/로고/배너/인테리어)은 design 전담 — marketing/content/sns 는 전략·기획만
- DeepSeek 는 CriticReview Primary 에만 사용 (JSON 평가 전용)
- fal.ai 는 design 부서 이미지/영상/3D 생성 Primary 커넥터 — 키 미설정 시 nano_banana 로 폴백
- `*` 표시된 compete/legal/sns 의 커넥터 순서는 Perplexity quota 고갈로 임시 강등 (serper 우선). 충전 후 `perplexity→serper` 로 원복 예정 (2026-04-19)
- 고가치 앙상블 (3-AI): legal, finance 2개만 (design 은 비주얼 단일 모델이 우수)

## 실제 모델 ID
| 모델 | API 호출 ID | 비고 |
|------|-------------|------|
| Claude Opus | claude-opus-4-6 | **현재 미사용** (2026-04-24 전 사용처 제거) |
| Claude Sonnet | claude-sonnet-4-6 | single_agent primary, ExecutiveGate Planner, legal/marketing/design 부서 |
| Claude Haiku | claude-haiku-4-5-20251001 | Critic, CEO Briefing, Classifier fallback |
| GPT | gpt-5.4-pro | compete, finance, content |
| Gemini Flash | gemini-2.5-flash | Classifier primary, 부서 1단계 초안, TaskDecomposer, CriticReview fallback |
| GPT 앙상블 | gpt-5.4 | 3-AI 앙상블 |
| Gemini | gemini-2.5-pro | data 부서, PDF |
| Gemini 표시 | Gemini 2.5 Pro | GEMINI_DISPLAY_LABEL |
| Perplexity | sonar-pro | 웹 검색 |
| Serper | Google Search API | Tavily 대체 |

## 타임아웃 체인 (2026-04-21, 변경 금지)
프론트 SSE(540s) ⊃ nginx SSE stream(3600s) ⊃ 앙상블 전체(420s) ⊃ 모델당(180s).
하나라도 줄이면 중간에서 타임아웃 → 부분 응답 손실.

| 레이어 | 항목 | 초 |
|--------|------|-----|
| 프론트 | SSE 총 상한 | **540** |
| 프론트 | SSE 경고 표시 | **360** |
| 앙상블 | 전체 | **420** |
| 앙상블 | 모델당 | **180** |
| 앙상블 | Synthesis | **150** |
| 어댑터 | 상한 (모든 provider) | **180** |
| 모델 | Claude Opus | **180** |
| 모델 | Claude Sonnet | **120** |
| 모델 | GPT-5.4 | **60** (2026-04-21: 120→60, fallback 빠르게) |
| 모델 | Claude Haiku | **60** |
| 모델 | Gemini | 45 |
| 프로세스 | CriticReview (bypass 중) | 30 |
| 프로세스 | CeoBriefing | 40 |
| 프로세스 | 커넥터 | 15 |
| nginx | /api/ proxy_read | **600** |
| nginx | SSE stream | **3600** |

## SSE 이벤트
executive_gate_start / done / redirect
dept_start / progress / done / error / rework_start / done
critic_start / done / rework
ensemble_start / ensemble_voice / ensemble_done
ceo_briefing / all_done

## corvusx-office.html 현재 기능 (117KB, 2307줄)

> **2026-04-21: 오피스 dead code 완전 삭제**. TPH/Phaser/SVG 오피스 코드 2200줄 삭제.
> Phaser CDN, `.tph-*` CSS 457줄, `.office-wrap` HTML 99줄, tph* JS 1080줄, Phaser Scene 570줄 제거.
> 오피스 UI 재도입 시 처음부터 새로 작성해야 함.

### 레이아웃 (채팅 전용)
- 사이드바 (좌): 토글 + 드래그 너비 (200~400px)
- 채팅 패널 (중앙, 전체 폭): 마크다운 렌더링 + 메시지 액션 + LOGOUT 버튼 (chat-header 우측)
- 우측 패널: 부서현황/매출/POS/보고 탭 + 드래그 리사이즈 (240~520px)

### 멀티 채팅 SSE (구현 완료)
- `state.threadRuns[threadId]` — 스레드별 독립 EventSource + 부서 상태
- `ensureRun(threadId)` — 스레드별 run 객체 관리
- `sessionId=threadId` 파라미터로 백엔드 sseRegistry 연결
- 540s 총 상한 / 360s 경고 / 5s 재연결 (2회 한정)

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
4. 오피스 UI 재도입 — 2026-04-21 TPH/Phaser 코드 완전 삭제됨. 재도입 시 처음부터 새로 작성 필요
5. CriticReview 재활성화 — `if (false)` bypass 유지. 속도 우선 정책 (2026-04-20)
6. MAX_DEPTS 증가 / ExecutiveGate slice(0,4) 해제 — 부서 최대 4개 상한 유지
7. 팀 응답 JSON 스키마 복귀 — 마크다운 자유 출력만 허용. `parseMarkdownSections` 기반 파서 유지
8. 타임아웃 체인 축소 — 540s(프론트) > 420s(앙상블) > 180s(모델) 체인 깨지 말 것
9. `/etc/nginx/sites-enabled/corvusx` 를 symlink 로 변환 — **일반 파일**로 유지 (symlink 전환 시 envsubst/배포 깨짐)
10. nginx 백업 파일을 `sites-enabled/` 내 `.bak` 으로 저장 — nginx 가 로드 시도. **항상 `/root/nginx-backups/` 로 이동**
11. Notion/Drive에서 지침 문서 참조 — 이 CLAUDE.md가 유일한 소스
12. EnsembleRunner Promise.allSettled — Promise.all 유지
13. CriticReview needs_followup인데 targetDeptId 비움 — CRITIC walk 멈춤 (bypass 해제 시 재발 주의)
14. fusion/threadFusion.buildFusionSystemBlock 재활성화 금지 — 2026-04-23 bypass. 스레드 간 자동 공유 경로 폐기. 동일 기능은 fusion/unifiedRetrieval 로 대체됨
15. fusion/sourcePromoter.promoteThreadToSource 재활성화 금지 — 2026-04-23 bypass. 스레드→프로젝트 자산 자동 승격 차단. projectFusion 은 프로젝트 내부 로직이므로 유지
16. recordProviderMetric 의 ctx.model/ctx.usage 인자 제거 금지 — 2026-04-23 비용 관측 인프라 전제. 제거 시 cost_usd 로그 사라짐
17. 로컬 PC 에 `ANTHROPIC_API_KEY` 환경변수 설정 금지 — Claude Code 가 Max 구독 대신 API 크레딧 소비. 2026-04-23 인시던트: $200 소진. 서버 키는 `/etc/corvusx/.env` 에만, 로컬에는 절대 설정하지 말 것
18. **Claude Opus 를 single_agent / 부서 / ExecutiveGate Primary 로 사용 금지** — 2026-04-24 검증: 일일 $25 중 Opus 가 $24.78 (98.4%). Classifier 가 strategic 으로 라우팅한 2단계 심화에서만 선택적 escalation 예정 (현재 미구현). 우회 도입 금지.
19. **`startBenchmarkScheduler` 자동 실행 재활성화 금지** — 2026-04-25 인시던트: 1시간 후 자동 발동 → 12 케이스 × 5 호출 = 60 LLM 호출, 분당 Opus 호출 ~$0.30~$0.65 누수. `routes/benchmark.ts::startBenchmarkScheduler` 는 영구 no-op 유지. 수동 트리거 (`/api/benchmark/run`) 만 허용. setTimeout/setInterval 추가 금지.
20. **`agent/agentLoop.ts::DEFAULT_MODEL` 을 claude-opus-* 로 설정 금지** — 2026-04-25 인시던트의 근본 원인. `claude-sonnet-4-6` 고정. Opus 가 필요한 호출은 명시적 `model_override` 로만 활성화. 어떤 환경변수/조건문으로도 DEFAULT_MODEL 자체를 Opus 로 분기 금지 (규칙 #18 보강).
21. **백그라운드 스케줄러에서 LLM API 직접 호출 금지** — health check / snapshot / cron 류 자동 실행 코드는 anthropic/openai/gemini/perplexity 호출 절대 금지. 헬스 검증은 env key 존재 확인만 (HTTP 200 등가). 진짜 가용성은 실제 채팅 호출 시점에 검증된다. 위반 사례: 2026-04-25 이전 `checkProviderHealth` 가 30분마다 Anthropic/Perplexity POST 호출 → 누적 비용 발생.
22. **`costStore` / `creditStore` 를 in-memory / JSON 파일 전용으로 회귀 금지** — 2026-04-25 Phase 8 부터 `server/data/corvusx.db` (SQLite) 가 진실 소스. 서버 재시작 시 today/이번 달 통계가 0으로 초기화되는 버그 재발 방지. 두 모듈은 반드시 `db/corvusxDb.ts` 의 `corvusxDb` 인스턴스를 사용해야 한다. 휘발성 캐시(Map/배열)를 module-level state 로 두지 말 것 — prepared statement 만 캐시 허용. 마이그레이션 자동 import (credits.json → SQLite) 는 idempotent (`stmtCount > 0` 가드).
23. **우측 부서 패널을 `dashboard` / `gallery` 뷰에서 표시 금지** — `aside.panel` 은 채팅 전용 위젯(부서/매출/POS/보고). `state.activeView !== 'chat'` 이면 `display:none` + `.app` grid 우측 컬럼 0. CSS(`.app[data-view="dashboard"] .panel`) 와 JS(`_setRightPanelVisible`) 양쪽 모두 유지 — 한쪽만 두면 사이드바 토글/캐시 케이스에서 드러남. 사이드바 토글 핸들러도 dashboard 뷰에서 inline grid 재적용 필요.

## 알려진 이슈
- GPT-5.4-pro 60s 타임아웃 → fallback 빈번할 수 있음 (의도적 — 느린 GPT 보다 빠른 fallback 선호)
- ~~TPH HUD 미션 텍스트~~ — 삭제됨 (dead code 정리)
- ~~멀티 채팅 SSE: 백엔드 인프라 완성, 프론트(office.html) 미연결~~ — 연결 완료 (2026-04-21)
- ExecutiveGate 단일에이전트 과분류: "간단히"/"요약" 수식어에 분석 요청도 single_agent로 빠짐 → Gate 프롬프트 개선 필요
- 2026-04-23: Phaser dead code 삭제 시 잔해(dispatchEvent 괄호, scene 참조) 11곳 → SyntaxError로 전체 JS 실행 불가 → 수정 완료
- 2026-04-23: startSingleAgentStreamInto에서 스트리밍 완료 후 renderMarkdown 미적용 → raw 마크다운 표시 → 수정 완료
- 2026-04-23 Session 3: Perplexity `insufficient_quota` 확인. `* 표시` 부서(compete/legal/sns) 의 serper→perplexity 강등은 결제 충전 전까지 유지. Claude Code 처리 불가 (결제 이슈)
- 2026-04-24 Session 4 Phase 1: single_agent SPOF 제거 — agent loop 가 Claude Opus 4.6 → Sonnet 4.6 → GPT-5.4-pro → Gemini 2.5 Pro 체인으로 자동 폴백. Opus/Sonnet 은 tool use 유지, GPT/Gemini 는 emergency 텍스트 전용. SSE 이벤트 `single_agent_fallback` 발행. `agentLoopBridge.ts` 구현 — 2026-04-23 Anthropic 크레딧 소진 시 single_agent 전체 실패 재발 방지
- 2026-04-24 비용 critical: 검증 결과 Opus 가 일일 비용의 98.4% 점유 → 두 가지 후속 조치
  1. **legal 부서**: primary `claude-opus-4-6` → `claude-sonnet-4-6`, fallback chain `[gpt-5.4-pro, gemini-2.5-pro]` (DepartmentRegistry/Agent 에 fallbackChain 옵셔널 필드 도입)
  2. **single_agent**: agentLoopBridge 의 Opus 슬롯 완전 제거. 신 체인 = Sonnet (primary, 180s, tool use) → GPT-5.4-pro (60s, emergency) → Gemini 2.5 Pro (45s, emergency). Opus 는 추후 Classifier 완성 후 strategic 질문에만 선택적 사용 예정
- 2026-04-24 Session 5: 의도 기반 라우팅 도입
  1. **Classifier (`director/Classifier.ts`)**: Gemini 2.5 Flash → Haiku fallback. intent ∈ {simple_qa, operational, research, strategic} + maxDepts 결정. ExecutiveGate 진입 첫 단계로 호출. simple_qa 면 Planner 우회하고 즉시 single_agent 라우팅 → Sonnet 1회로 처리 (~$0.05).
  2. **부서 2단계 처리 (`DepartmentAgent.ts`)**: 사전조사 다음에 Gemini Flash 초안 (15s, ~$0.003), 그 다음 Primary 가 초안을 보강·심화. 1단계 실패는 non-fatal (2단계 단독 진행).
  3. **GEMINI_FLASH_MODEL_ID**: `gemini-2.0-flash` → `gemini-2.5-flash` 업그레이드 (CriticReview/TaskDecomposer 도 자동 적용).
  4. ExecutiveGate Planner 가 intent.maxDepts 기반 동적 cap 적용 (operational=2, research=3, strategic=4). 기존 hardcoded `slice(0,4)` 제거 (모두 ≤ MAX_DEPTS=4 유지).
- 2026-04-25 미해결 (Session 5 후속):
  - Classifier `max_tokens=200` 부족 → 400 으로 수정 예정
  - Classifier Haiku fallback timeout 8s → 15s 수정 예정
  - Test B director 미진입 → 위 수정 후 재확인 예정
  - Gemini `cost_usd` 0 표시 → round 이슈 또는 가격 키 매핑 디버그 필요
  - regulationCache `mkdir EACCES` → chown 수정 필요

## 비용 관측 (2026-04-23 추가)
- 모든 provider 어댑터 성공 호출 시 `[adapter:usage]` 구조화 로그 emit
- `server/src/adapters/shared.ts` 의 `recordProviderMetric` 이 옵션 ctx {model, usage} 를 받아 `estimateCostUsd` 로 비용 계산 후 logger.info
- `server/src/cost/costCalc.ts` + `MODEL_PRICING_USD_PER_1K_TOKENS` (config/defaults.ts) 기반 가격 테이블
  - 2026-04-23 추가: `claude-haiku-4-5-20251001`, `deepseek-chat`
- 로그 필드: `provider`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `latency_ms`
- 조회: `journalctl -u corvusx-backend | grep 'adapter:usage' | grep cost_usd`
- DeepSeek 는 ModelAdapter 인터페이스 밖이라 deepseek.ts 내부에서 inline 로깅
- 2026-04-24 Session 4 Phase 2: `server/src/creditGuard.ts` — 경량 in-memory 트래커 추가 (한도/차단 없음). `recordProviderMetric` 옆에서 `recordCost()` 병행 호출로 당일 provider 별 누적만 유지. 장기 집계 진실 소스는 여전히 journalctl.
- 2026-04-24 Session 4 Phase 3: `GET /api/usage/summary` — 오늘(creditGuard) + 이번 달(journalctl 파싱) 반환. 💰 탭에서 소비. ※ 서버 process 가 `corvusx` 유저로 실행 → journalctl 권한 필요. `usermod -a -G systemd-journal corvusx && systemctl restart corvusx-backend` 적용 필요 (선택).
- 2026-04-24 Session 5 Phase 5 (비용 추적 결함 수정):
  1. **Gemini cost_usd 누락 수정**: `shared.ts::recordProviderMetric` 의 토큰 추출에 Gemini 키(`promptTokenCount`/`candidatesTokenCount`) 추가. 이전엔 `input_tokens`/`prompt_tokens` 만 인식해서 Gemini 호출이 항상 0 토큰 → early return → cost 로그 미발생. 이제 모든 Gemini 부서/Flash 호출이 추적됨.
  2. **agentLoop $0 수정**: `agentLoop.ts` 가 Anthropic API 를 직접 fetch 해서 ModelAdapter 우회 → cost 로그 미발생. 루프 종료 후 `recordProviderMetric("claude", latency, true, {model, usage})` 호출 추가. single_agent 호출의 비용도 이제 정확히 추적.

## 새 스레드 시작 프로토콜 (Phase 0 필수)

### ⚠️ Phase 0 — 크레딧 안전 점검 (생략 금지)
> 2026-04-23 인시던트: 환경변수 방치로 Claude Code 가 Max 구독 대신 API 크레딧 $200 소진.

1. PowerShell 에서 환경변수 확인: `echo $env:ANTHROPIC_API_KEY`
   → 값 있으면 작업 **중단**. 환경변수 제거 후 세션 재시작.
2. Claude Code `/status` 확인
   → `Login method: Claude Max account` 확인 후 진행
   → `API` 나오면 작업 **중단** + 사용자 보고
3. 주간 한도 80% 이상이면 중대 작업 자제 권고
4. provider 크레딧 상태 확인 (Anthropic / Perplexity / fal.ai 소진 여부 보고)

### Phase 0 통과 후 작업 시작
1. Claude.ai: "Notion 에서 CORVUS X 개발 현황 불러와서 이어서 작업해줘"
2. Notion 에서 잔여 작업 확인
3. 코드 세부사항은 서버에서 직접 cat/grep
4. Drive 문서는 절대 조회하지 않음

## 작업 완료 프로토콜
1. Claude Code에서 git commit + push
2. 서버 배포 (tsc + systemctl restart)
3. Claude.ai에서 Notion 잔여 작업 업데이트
4. Drive는 건드리지 않음
