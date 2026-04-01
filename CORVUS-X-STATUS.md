# CORVUS X — 개발 현황 정리
> 최종 업데이트: 2026-04-01
> 저장소: https://github.com/zatino75/ai-orchestra
> 로컬: C:\Users\User\Desktop\AI-ORCHESTRA
> 포트: backend 8000 · frontend 5173

---

## ✅ 이번 대화에서 해결한 것

### 1. CORVUS X 리브랜딩 (전체 적용 완료)
| 파일 | 변경 내용 |
|------|-----------|
| `frontend/index.html` | `<title>CORVUS X</title>` |
| `frontend/package.json` | name → `corvus-x-frontend` |
| `frontend/src/components/layout/Sidebar.tsx` | LogoIcon() → `<img src="/corvus-logo.png">` + "CORVUS X" 텍스트 |
| `frontend/src/components/layout/Topbar.tsx` | "AI Orchestra" → "CORVUS X" |
| `frontend/src/components/chat/ChatView.tsx` | footer 문구 "CORVUS X는" (2곳) |
| `frontend/src/components/chat/HomeView.tsx` | 로고+브랜드 블록 추가 (52px 이미지 + SEE·CHOOSE·GO 태그라인) |
| `frontend/src/store/workspaceStore.ts` | storage key v14→v15, prefix corvus-x, seed project "CORVUS X", LEGACY_BRAND_NAMES 자동 마이그레이션 |
| `frontend/src/components/ops/OrchestrationPanel.tsx` | 헤더 "오케스트레이션" 유지 (CORVUS X 넣지 않음 — 유저 요청) |

### 2. localStorage 자동 마이그레이션
- 기존 "AI ORCHESTRA" / "AI Orchestra" 프로젝트 제목 → 앱 로드 시 자동으로 "CORVUS X"로 변경
- 스레드 탑바 구버전 데이터 잔존 문제 해결

### 3. dynamic_scoreboard_router_v4 개선
- `fallback_rate` 하드코딩(0.1) → 실측값 `1 - recent_wins/recent_uses` 반영
- `structured_output` 신호: planner 감지 → runtime → adaptiveRouter 전달 완성
- optional 3번째 provider 활성 조건에 `structured_output` 추가

### 4. 한국어 planner 트리거 확장
- `deep_analysis` 6개 → 20개 (분석해줘, 다각도로, 종합적으로, 철저하게 등)
- `deep_research` 6개 → 19개 (조사해줘, 시장 조사, 최신 동향, 트렌드 조사 등)

### 5. benchmark pairwise 데이터 픽스
- `getWinnerProvider()` null 반환 문제 → `raw_result.final_answer.provider` 우선 읽기 + mode 기반 fallback
- `orchestra_provider_chain` 항상 빈 배열 → `internal_rationale.executed_providers[].provider` 로 수정
- `runner_up_snapshot`, `judge_trace`, `decision_rationale`, `scoreboard_summary` 필드 모두 실제 데이터 연결

### 6. avg_claims / avg_decisions 필드
- modelScoreboard.ts에 필드 추가 + `normalizeBoard()` → `recalcNode()` 자동 채움 구조
- 기존 19개 노드는 다음 실행 시 자동으로 0으로 초기화 후 누적

---

## ❌ 이번 대화에서 하지 못한 것

### 1. 로고 파일 배치 (유저 직접 처리 필요)
- **작업**: 두 번째 로고(채워진 까마귀+X 흉터 이미지) → `frontend/public/corvus-logo.png` 저장
- **이유**: 이미지는 대화창 인라인으로만 전달됨 — 파일 첨부가 아니라 코드로 저장 불가
- **해결**: 해당 이미지를 `corvus-logo.png`로 저장 후 `frontend/public/` 폴더에 직접 넣기

### 2. git 커밋 (유저 직접 처리 필요)
```powershell
git add frontend/index.html frontend/package.json `
  frontend/src/components/chat/ChatView.tsx `
  frontend/src/components/chat/HomeView.tsx `
  frontend/src/components/layout/Sidebar.tsx `
  frontend/src/components/layout/Topbar.tsx `
  frontend/src/store/workspaceStore.ts `
  server/src/orchestra/adaptiveRouter.ts `
  server/src/orchestra/planner.ts `
  server/src/orchestra/runtime.ts `
  server/src/benchmark/scoreboard.ts
git commit -m "feat: CORVUS X rebrand + fix benchmark pairwise + dynamic router improvements"
```

### 3. Perplexity 실제 연동
- adapter 코드 완성, routing 로직 준비됨
- `.env`에 `PERPLEXITY_API_KEY` 없어서 실제 호출 불가 (API 키 필요)
- research 태스크 perplexity primary 배정은 이미 완성 — 키만 넣으면 작동

---

## 📋 새 대화창에서 바로 할 일 (우선순위 순)

```
1순위  scoreboard 실 데이터 축적 검증
       → 대화 몇 번 해보고 /api/dashboard 또는 OrchestrationPanel에서
         dynamic_scores 제대로 찍히는지 확인

2순위  benchmark 단일 모델 vs 오케스트라 비교 실행
       → "benchmark 돌려줘" or /benchmark 탭에서 실행
       → pairwise 결과가 제대로 나오는지 확인

3순위  Perplexity API 키 연동
       → .env에 PERPLEXITY_API_KEY 추가 후 research 태스크 테스트

4순위  thread memory 품질 개선
       → 현재: entity 매칭 + 유사도 기반 fusion 구현됨
       → 개선 필요: retrieval 정확도, 주입 텍스트 길이 최적화

5순위  scoring 데이터 기반 routing 정확도 검증
       → bandit_score + dynamic_score 혼합 routing이 실제로
         단일 모델보다 우수한 결과를 내는지 scoreboard로 증명
```

---

## 🏗 CORVUS X 전체 작업 현황

### 인프라 / 아키텍처

| 항목 | 상태 | 점수 |
|------|------|------|
| 백엔드 서버 (Node/Express, port 8000) | ✅ 완료 | 100 |
| 프론트엔드 (React/Vite, port 5173) | ✅ 완료 | 100 |
| TypeScript 전체 타입 안전성 | ✅ 완료 | 95 |
| Response Contract 단일화 | ✅ 완료 | 100 |
| SSE 스트리밍 | ✅ 완료 | 100 |
| 에러 핸들링 / fallback 구조 | ✅ 완료 | 85 |

### Adapter 레이어

| 항목 | 상태 | 점수 |
|------|------|------|
| OpenAI adapter (GPT-5.4) | ✅ 완료 | 100 |
| Claude adapter (Sonnet 4.6) | ✅ 완료 | 100 |
| Gemini adapter (2.0 Flash) | ✅ 완료 | 100 |
| Perplexity adapter | ✅ 코드 완료 / API 키 대기 | 70 |
| Midjourney adapter | ❌ 미구현 | 0 |
| Gemini Imagen 4 adapter | ❌ 미구현 | 0 |
| Gemini Veo 3.1 adapter | ❌ 미구현 | 0 |
| Runway Gen4 Turbo adapter | ❌ 미구현 | 0 |
| Slides Creator adapter | ⚠️ 라우팅만 구현 | 20 |

### 오케스트레이션 엔진

| 항목 | 상태 | 점수 |
|------|------|------|
| Planner (task 분류, 신호 추출) | ✅ 완료 | 90 |
| Execution Engine | ✅ 완료 | 90 |
| Adaptive Router (task-aware) | ✅ 완료 | 90 |
| dynamic_scoreboard_router_v4 (12지표) | ✅ 완료 | 90 |
| Parallel Router | ✅ 완료 | 85 |
| Claims Engine | ✅ 완료 | 85 |
| Conflict Detector | ✅ 완료 | 85 |
| Judge (scoring + rationale) | ✅ 완료 | 85 |
| Final Answer 합성 | ✅ 완료 | 85 |
| Verifier / synthesis 레이어 | ✅ 완료 | 80 |
| fallback_rate 실측값 반영 | ✅ 완료 | 100 |
| structured_output 신호 전달 | ✅ 완료 | 100 |
| 한국어 planner 트리거 (deep_analysis/research) | ✅ 완료 | 100 |

### 메모리 / 지식 융합

| 항목 | 상태 | 점수 |
|------|------|------|
| Thread Memory 저장/로드 | ✅ 완료 | 90 |
| Thread Fusion (자동 스레드 간 검색·주입) | ✅ 완료 | 75 |
| Entity 기반 매칭 | ✅ 완료 | 75 |
| Source Promote (스레드 → 프로젝트 소스 승격) | ✅ 완료 | 85 |
| Project-level structured memory | ⚠️ 기초 구현 | 50 |
| 수동 참조 UI 제거 | ❌ 미완료 | 0 |
| 소스 업로드 + 스레드 + 프로젝트 통합 retrieval | ⚠️ 부분 구현 | 60 |

### 벤치마크 / 검증

| 항목 | 상태 | 점수 |
|------|------|------|
| Benchmark Runner | ✅ 완료 | 85 |
| Scoreboard (단일 vs 오케스트라 비교) | ✅ 완료 | 80 |
| Pairwise 결과 데이터 (winner, chain, snapshot) | ✅ 픽스 완료 | 85 |
| avg_claims / avg_decisions 필드 | ✅ 완료 | 90 |
| Benchmark UI (프론트엔드 탭) | ✅ 완료 | 80 |
| 실제 누적 데이터 (runs > 0) | ⚠️ 초기화 상태 | 10 |
| 단일 모델 vs 오케스트라 정량 증명 | ⚠️ 구조 완성 / 데이터 대기 | 30 |

### UI / 프론트엔드

| 항목 | 상태 | 점수 |
|------|------|------|
| 채팅 인터페이스 | ✅ 완료 | 90 |
| 프로젝트 / 스레드 관리 사이드바 | ✅ 완료 | 85 |
| 오케스트레이션 패널 (Judge 점수, Dynamic Router Score, 선택 근거) | ✅ 완료 | 85 |
| Dynamic Router Score 바 (v4 12지표) | ✅ 완료 | 85 |
| Benchmark 탭 | ✅ 완료 | 80 |
| Routing 탭 | ✅ 완료 | 80 |
| CORVUS X 리브랜딩 (로고, 타이틀, 탑바, 사이드바) | ✅ 완료 | 95 |
| localStorage 구버전 자동 마이그레이션 | ✅ 완료 | 100 |
| 로고 파일 (`corvus-logo.png`) | ⚠️ 유저 직접 배치 필요 | 0 |
| 사용량 대시보드 | ✅ 완료 | 80 |
| 코드 아티팩트 뷰어 | ✅ 완료 | 80 |

### 미구현 영역 (장기 로드맵)

| 항목 | 상태 | 비고 |
|------|------|------|
| 이미지 생성 (Midjourney / Imagen 4) | ❌ | adapter 설계 필요 |
| 영상 생성 (Veo 3.1 / Runway Gen4) | ❌ | adapter 설계 필요 |
| 슬라이드 자동 생성 (Slides Creator) | ⚠️ 라우팅만 | 실제 생성 로직 미구현 |
| Claude agent 다층화 (code implementer / reviewer / debug 분리) | ❌ | dynamic router 안정화 후 |
| Gemini 확장 (diff analyzer / multimodal UI analyzer) | ❌ | scoreboard 데이터 축적 후 |
| 수동 참조 UI 완전 제거 | ❌ | 자동 fusion 검증 후 |
| 법률 검토 / 재무정보 특화 에이전트 | ❌ | 미설계 |
| 데이터 분석 특화 레이어 | ❌ | 미설계 |

---

## 🔧 현재 커밋 미완료 파일 목록

아래 파일들이 워킹트리에 반영되어 있으나 아직 git commit 전:

```
frontend/index.html
frontend/package.json
frontend/src/components/chat/ChatView.tsx
frontend/src/components/chat/HomeView.tsx
frontend/src/components/layout/Sidebar.tsx
frontend/src/components/layout/Topbar.tsx
frontend/src/store/workspaceStore.ts
server/src/orchestra/adaptiveRouter.ts
server/src/orchestra/planner.ts
server/src/orchestra/runtime.ts
server/src/benchmark/scoreboard.ts
```

커밋 메시지: `feat: CORVUS X rebrand + fix benchmark pairwise + dynamic router improvements`

---

## 📌 개발 운영 원칙 (고정)

- PowerShell 7 기준 / 파일 단위 전체 덮어쓰기 / 부분 패치 금지
- TypeScript 코드 직접 제공 금지 → PS1 스크립트 형태로만
- 백업/스냅샷/dist 폴더 생성 금지
- 서버 재기동 스크립트 기본 포함 금지
- 수정 전 GitHub 저장소 원문 먼저 확인 (https://github.com/zatino75/ai-orchestra)
- backend 8000 / frontend 5173 고정
- Write-Host 금지 / Write-AtomicUtf8 사용 금지
- 설명 최소화
