# CONVUS X 2차 개발 플랜 — Phase 1 완료 상태에서 프로덕션 수준으로

## 플랜 비교 및 권장안

3개 모델(Claude, GPT, Gemini)의 플랜을 비교 분석한 결과:

| 영역 | Claude (Plan 1) | GPT (Plan 2) | Gemini (Plan 3) | 채택 |
|------|----------------|--------------|-----------------|------|
| **서버 프레임워크** | Fastify 전환 | Raw HTTP 유지 + 내부 구조화 | Express/Fastify 전환 | **Plan 2 채택** — 현재 구조 유지하며 점진적 구조화 |
| **영속성** | better-sqlite3 | Repository 인터페이스 → 추후 DB | PostgreSQL + Prisma | **Plan 2 채택** — 추상화 먼저, DB 전환은 후순위 |
| **타입 시스템** | discriminated union + DTO 분리 | 약타입 제거 + 동기화 | 약타입 제거 | **Plan 1 채택** — 가장 철저한 타입 설계 |
| **테스트** | Vitest, 커버리지 50%+ | 자동 검증 체계 | Vitest + Supertest, 80% | **Plan 1+3 혼합** — Vitest + Supertest, 목표 50% |
| **i18n** | 자체 hook + JSON | i18next + 템플릿화 | i18next | **Plan 2 채택** — i18next가 표준적 |
| **Tailwind** | 제거 권장 | CSS variable 유지 | 본격 도입 | **Plan 2 채택** — 현재 CSS 자산 유지 |

**핵심 원칙**: 오케스트레이션 아키텍처(Planner → Router → Claims/Conflicts → Judge)는 모든 Phase에서 절대 변경 불가

---

## Phase 2: 아키텍처 안정화

### Step 2.1 — Phase 1 미완료 사항 보완
- 각 어댑터에 남아있는 로컬 `env()`, `sleep()`, `now()`, `normalizeContent()` 제거 → `shared.ts` import로 교체
- `chat.ts`와 `chatSupport.ts`의 중복 유틸 → `common.ts` import로 교체
- `SOURCE_PROMOTE_PATTERNS` 3곳 중복 → `config/defaults.ts` 단일 소스로 통합
- 검증: `grep -r "function env(" server/src/adapters/` → 0건

### Step 2.2 — 서버 라우팅 구조화
- 신규: `server/src/http/router.ts`, `middleware.ts`, `response.ts`
- `index.ts` 48개 if/else → 라우트 레지스트리 기반 디스패치
- 원칙: Raw HTTP 유지, 프레임워크 미도입

### Step 2.3 — 타입 시스템 강화
- `adapters/types.ts`: `ProviderName | string` → strict union, `[key: string]: any` 제거
- 신규: `server/src/types/tasks.ts` — `CanonicalTask` 단일 정의

### Step 2.4 — 인증 시스템
- 신규: `server/src/http/auth.ts` — API 토큰 기반 인증
- `.env.example` — `ADMIN_API_TOKEN` 추가

### Step 2.5 — 영속성 추상화
- 신규: `server/src/db/interfaces.ts`, `fileStore.ts`
- Repository 인터페이스로 감싸서 추후 DB 전환 준비

### Step 2.6 — 린팅/포맷팅
- 신규: `.eslintrc.json`, `.prettierrc`

---

## Phase 3: 코드 품질 & 테스트

### Step 3.1 — 라우트 중복 완전 해소
- `chat.ts` 1606줄 → 800줄 이하 목표

### Step 3.2-3.3 — God Component 분해
- `App.tsx` → `useChat.ts`, `useStream.ts`, `useWorkspace.ts`
- `ChatView.tsx` → `Composer.tsx`, `MessageBubble.tsx`, `MessageList.tsx`

### Step 3.4 — 스트리밍 중복 제거
- `App.tsx` 인라인 `sendChatStream` → `api/stream.ts` 통합

### Step 3.5 — SVG 아이콘 중앙화
- 신규: `components/shared/Icons.tsx` (16개 아이콘)

### Step 3.6 — 테스트 체계 구축
- 신규: `vitest.config.ts`, `server/tests/common.test.ts`, `planner.test.ts`
- 목표: 유닛 테스트 커버리지 50%+

---

## Phase 4: 기능 완성 & i18n

### Step 4.1 — Thread Fusion 완성
### Step 4.2 — Source Promote 완성
### Step 4.3 — i18n 시스템 (ko/en JSON + t() 함수)

---

## Phase 5: UX 고도화

### Step 5.1 — 반응형 3단 (480/860/1440px)
### Step 5.2 — 다크모드 (CSS custom property + data-theme)
### Step 5.3 — 접근성 (aria, keyboard nav, Lighthouse 80+)
### Step 5.4 — Tailwind 완전 제거

---

## Phase 6: 인프라 & DevOps

### Step 6.1 — 구조화 로거 (observability/logger.ts)
### Step 6.2 — CI/CD (.github/workflows/ci.yml)
### Step 6.3 — Docker (Dockerfile, docker-compose.yml)
### Step 6.4 — HTTPS & 프로세스 관리
### Step 6.5 — 모니터링

---

## 3개 모델 상세 비교

### 서버 프레임워크
- **Plan 1 (Claude):** Fastify 전환, index.ts 354줄 → ~60줄
- **Plan 2 (GPT-5):** Raw HTTP 유지 + route registry 구조화
- **Plan 3 (Gemini):** Express/Fastify + DB 도입 동시 진행

### 영속성
- **Plan 1:** better-sqlite3
- **Plan 2:** Repository interface 먼저 → 추후 DB
- **Plan 3:** PostgreSQL + Prisma 직접 이관

### 타입 시스템
- **Plan 1:** discriminated union + DTO 분리 + CanonicalTask 3곳 중복 추출
- **Plan 2:** 약타입 제거 + 프론트-서버 타입 동기화
- **Plan 3:** 약타입 제거만

### i18n
- **Plan 1:** 자체 hook + JSON + VITE_LANG 환경변수
- **Plan 2:** i18next + 프롬프트 템플릿화
- **Plan 3:** i18next + 전체 포함

### Tailwind
- **Plan 1:** 완전 제거 권장
- **Plan 2:** CSS variable 유지
- **Plan 3:** 본격 도입 + 마이그레이션

### 고유 항목
- **Plan 1만:** shared.ts 실제 미사용 지적, REUSE threshold 999 비활성화 확인, buildDerived 이중 정의
- **Plan 2만:** Observability 모듈화, write queue/lock 전략, requestContext, 부하 테스트
- **Plan 3만:** PostgreSQL 직접 도입, Supertest, 소스 승격 확인 모달, 배포 문서화

---

## Step → 검증 매핑

| Step | 검증 기준 |
|------|-----------|
| 2.1 | `grep "function env(" adapters/` → 0건 |
| 2.2 | 모든 API 엔드포인트 기능 회귀 없음 |
| 2.3 | `tsc --noEmit` 에러 0건 |
| 2.4 | 미인증 요청 → 403 반환 |
| 2.5 | 기존 메모리/스코어보드 기능 회귀 없음 |
| 2.6 | `npm run lint` 에러 0건 |
| 3.1 | chat.ts 800줄 이하 |
| 3.2-3.3 | App.tsx 800줄, ChatView.tsx 600줄 이하 |
| 3.6 | `npm test` 통과, 커버리지 50%+ |
| 4.1 | 스레드 자동 교차 검색 동작 |
| 4.2 | "소스로 넘겨줘" → 소스 등록 확인 |
| 4.3 | `VITE_LANG=en` → 영어 UI |
| 5.1 | 3단 반응형 동작 |
| 5.2 | 다크모드 토글 동작 |
| 5.4 | Tailwind 의존성 0건 |
| 6.2 | PR 시 자동 lint+test+build |
| 6.3 | `docker compose up` 정상 기동 |
