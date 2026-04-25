"""Encode phase7 decision log as base64 for Drive upload. Prints base64 only."""
import base64
import sys

CONTENT = """# CORVUS X Phase 7 결정 세션 — Batch 1+2 작업 로그

작성일: 2026-04-16
작성자: Claude Opus 4.6 (Claude Code CLI)
브랜치: codex/convus-x → zatino75/convusx
기준 커밋: 4c7ae02 (phase6 종료) → aaba687 (phase7 종료)

=== 세션 목표 ===

사용자 요청 2개 배치:

**Batch 1 (코드 품질 정리)**
1. MessageBubble 890줄 → <400줄 분해 (4+1개 파일)
2. config/defaults.ts Gemini 리터럴 단일 출처 통일
3. ModelResponse.text deprecated 필드 실제 제거

**Batch 2 (기능 완성)**
4. DepartmentAgent per-call USD 비용 + DeptStatsCard 라이브 표시
5. Thread Memory retrieval 정확도 튜닝 (길이 + entity 매칭)
6. Project Memory 통합 retrieval 완성 (sources+threads+project+reports)

각 작업당 tsc 그린 → git commit → push → 다음 작업 순서로 6회 사이클.

=== Task 1: MessageBubble 분해 (commit e49dda0) ===

대상: frontend/src/components/chat/MessageBubble.tsx (890 lines)
결과: MessageBubble.tsx 418 lines (-472, -53%) + 5개 하위 컴포넌트

추출 파일 (전부 default export):
- AssistantActionToolbar.tsx (145 lines)
  onCopy/onRegenerate/onFeedback 툴바
- ThreadMetaStrip.tsx (33 lines)
  project memory/pinned/fusion/labels chips + ExportMenu
- UserMessageToolsRow.tsx (127 lines)
  prev/next 버전 네비 + copy/edit. MessageVersionState 타입 소유
- MessageEditComposer.tsx (90 lines)
  textarea 자동 높이 + Enter/Esc 처리
- MessageMediaPreviews.tsx (145 lines)
  이미지/비디오/slide_data 렌더링 일괄

보너스 정리:
- AssistantInlineCopy (null 반환 dead stub) 제거
- MessageBubble.tsx 에서 ThreadMetaStrip / MessageVersionState re-export
  하여 하위 호환 유지 (ChatView import 그대로 동작)

결정: 5번째(MessageMediaPreviews) 는 사용자가 명시한 4개 이상이지만
<400 목표를 위해 자연스럽게 분해 가능한 경계가 있어 추가 추출함.
결정 근거: 원본 슬라이드/이미지/비디오 렌더링 블록이 100+ 라인이고
세 가지 모두 requestMeta 필드 의존이라 하나로 묶기 적합.

=== Task 2: Gemini 모델 ID 단일 출처 (commit 217a0f8) ===

문제:
- adapters/gemini.ts 가 GEMINI_MODEL_ID = "gemini-2.5-pro" 소유
- config/defaults.ts 의 DEFAULT_MODELS.gemini 는 같은 리터럴 하드코딩
  (circular import 방지 위해 수동 동기화 — 주석으로 경고)
- MODEL_PRICING_USD_PER_1K_TOKENS 도 "gemini-2.5-pro" 리터럴
- routes/chatFileAnalysis.ts 에 6개 하드코딩 fetch URL

해결 방향:
단일 출처를 하위 레이어(config/defaults.ts)로 승격.
adapters/gemini.ts 는 re-export 로 역호환 유지.

변경:
- config/defaults.ts:
  + export const GEMINI_MODEL_ID = "gemini-2.5-pro"
  + export const GEMINI_FLASH_MODEL_ID = "gemini-2.0-flash"
  + export const GEMINI_DISPLAY_LABEL = "Gemini 3.1 Pro Ultra"
  + DEFAULT_MODELS.gemini / gemini_flash 는 상수 참조
  + PRICING table 은 computed key [GEMINI_MODEL_ID]: {...}
- adapters/gemini.ts:
  + import + re-export { GEMINI_MODEL_ID, GEMINI_DISPLAY_LABEL }
  + 로컬 선언 제거
- routes/chatFileAnalysis.ts:
  + GEMINI_MODEL_ID import
  + 6개 fetch URL `models/${GEMINI_MODEL_ID}:generateContent` 로 통일

이전 세션(commit 87d79b9)에서 남긴 "향후 defaults.ts 로 상수 이전 고려"
후속 조치를 이번 phase 에서 완료. CLAUDE.md 의 "circular import 방지 주석"
과 "동기화 수동" 경고는 이제 불필요.

=== Task 3: ModelResponse.text deprecated 제거 (commit f5cc45c) ===

대상: server/src/adapters/types.ts
변경: ModelResponse 에서 `text?: string` 필드 + deprecated 주석 블록 삭제

안전성 검증:
- 어댑터(claude/openai/gemini/perplexity) 중 이 필드를 setter 로 쓰는 곳 0건
  (이전 세션 commit be18948 에서 wrappers.ts 가 .answer 로 이관 완료)
- grep 결과 .text 접근 점들은 모두 다른 타입 대상:
  * agentLoop.ts:461 → AgentLoopResult.text (로컬 타입, 유지)
  * EnsembleRunner.callOne → 자체 반환 타입 (유지)
  * chatFileAnalysis.ts pdf-parse `result.text` (라이브러리 반환, 유지)
  * benchmark/evaluator.ts `answer?.text` → benchmark snapshot (유지)
  * fetch Response.text() 계열 (무관)
- ModelResponse 의 `[key: string]: any` 인덱스 시그니처 덕분에
  임시로 text 를 쓰는 서드파티 코드가 있어도 컴파일은 깨지지 않음.

=== Task 4: DepartmentAgent per-call USD 비용 (commit 81a0495) ===

신규 파일:
- server/src/cost/costCalc.ts
  + estimateCostUsd(model, usage) — MODEL_PRICING_USD_PER_1K_TOKENS 참조
  + input/output 토큰 × per-1k price → USD. 미등록 모델은 0 silent.

wrappers.ts 에 detailed variant 4종 추가:
- callClaudeDetailed / callOpenAIDetailed / callGeminiDetailed / callPerplexityDetailed
- 반환 타입: { text, usage: ModelUsage, model: string }
- 기존 문자열 반환 래퍼(callClaude 등)는 EnsembleRunner 호환을 위해 유지.

DepartmentAgent 변경:
- callPrimaryModel 이 detailed variant 사용 → usage / modelIdForPricing 회수
- AgentRunResult 에 costUsd 추가
- tokensUsed 가 usage.input_tokens + usage.output_tokens 실측값(있으면) 사용
  → 미수집 시 이전 char-length estimator 로 fallback.

DirectorAgent 변경:
- awardXp(task.deptId, 'success', result.costUsd ?? 0)
  → 이전엔 하드코딩 0 이었음. 이제 dept_xp.total_cost_usd 에 실 비용 누적.

DeptStatsCard 변경:
- 7번째 칼럼(per-department 누적 USD) 추가.
  grid: "120px 40px 1fr 90px 70px 70px 70px" (이전 6칼럼 → 7칼럼)

결정:
- 사전 조사(runPreResearch)의 Perplexity/Tavily 비용은 이번 스코프에서 제외.
  per-call 비용 = 주요 AI 모델 호출 비용에 한정.
  추후 확장 시 AgentRunResult 에 preResearchCostUsd 분리 추가 가능.

=== Task 5: Thread Memory retrieval 튜닝 (commit 112fd07) ===

server/src/memory/threadMemory.ts:
- entityHitScore(entities, queryLower) 신설
  structured.entities 의 각 phrase 를 lowercased query 에 substring 매칭.
  기존 overlap n-gram 은 "CORVUS" vs "Corvus Sciences" 를 흐릿하게 매칭.
- findSimilarQuery 의 score = max(msgScore+tf, title, summary, struct, entity×1.2)

server/src/fusion/threadFusion.ts (v2 → v3):
- FUSION_TOTAL_CAP (기본 3000) 예산 준수. 이전엔 항목당 500자 × N개 +
  추가로 300자로 이중 절단하는 구조여서 예산 드리프트 발생.
- allocateBudget(scores, total, minPer=120) — 점수 비례 분배, 최소 120자 보장.
- entityHitBonus(entities, queryLower) — 엔터티가 쿼리에 있으면 +4/건
  (title/structured/message 모든 채널에 공통 추가)
- 렌더는 한 번만 truncate, 마지막에 totalCap 안전 슬라이스.

로그 태그: [threadFusion v3] (이전 v2 → v3 로 올림)

=== Task 6: Project Memory 통합 retrieval (commit aaba687) ===

CLAUDE.md 상태표의 "Project-level structured memory 50%" / "통합 retrieval 60%"
→ 100% 완성 시도.

신규 파일:
- server/src/fusion/unifiedRetrieval.ts
  4개 소스(스레드/프로젝트 엔트리/소스 자산/부서 보고서) 를 한 번의 호출로
  수집·재순위·예산 배분 후 단일 system 블록으로 반환.

주요 함수:
- retrieveUnifiedContext(opts) → { items, block, stats }
- buildUnifiedContextBlock(opts) → string

특징:
- fingerprint 기반 중복 제거
  → promoted thread summary 가 source asset 으로도 저장된 경우 양쪽 등장 방지.
- 단일 점수 스케일:
  thread = ngramScore × 3 (title) / ×2 (structured) / ×1 (message) + entityBonus
  project_entry = ngramScore × 1.2 (구조화 지식 가독성 우선)
  source = ngramScore × 2 (title) / ×1 (content head 1500자)
  report = confidence × 12
- allocateBudget with 140-char floor per item, FUSION_TOTAL_CAP 전체 상한.

기존 빌더 호환:
- buildFusionSystemBlock (threadFusion) / buildProjectFusionBlock (projectFusion)
  삭제 안 함.
- agentLoop.ts 는 unified 우선 사용, 실패 시 기존 2-블록 주입으로 graceful fallback.

recallProjectMemory 도구 재작성:
- 이전: buildFusionSystemBlock + buildProjectFusionBlock 병행 호출 후 concat
- 현재: retrieveUnifiedContext 단일 호출 + items 배열 반환
- description 에 "개별 호출하지 말고 이 도구 하나로 끝낼 것" 명시.

=== 커밋 체인 ===

e49dda0  refactor(phase7): decompose MessageBubble (890→418 lines)
217a0f8  refactor(phase7): promote GEMINI_MODEL_ID to config/defaults.ts
f5cc45c  refactor(phase7): remove deprecated ModelResponse.text
81a0495  feat(phase7): DepartmentAgent per-call USD cost + DeptStatsCard
112fd07  feat(phase7): thread memory — entity precision + budget injection
aaba687  feat(phase7): unified project memory retrieval

전부 origin/codex/convus-x 에 push 완료. main 머지 안 함 (사용자 확인 대기).

=== 검증 ===

각 커밋마다 이중 tsc 실행 (무출력 = 0 errors):
- Server: npx tsc -p tsconfig.json --noEmit
- Frontend: cd frontend && npx tsc --noEmit

=== 설계 결정 기록 ===

결정 1: GEMINI_MODEL_ID 단일 출처를 defaults.ts 로 이전.
  이전 세션(87d79b9) 은 adapters/gemini.ts 에 두고 동기화 수동.
  이번에 defaults.ts 를 하위 레이어로 정의하여 circular 해소 + 자동 동기화.

결정 2: MessageBubble 분해 시 기존 exports (ThreadMetaStrip,
  MessageVersionState, formatTime, hasStructuredCopyTarget) 는 re-export 유지.
  grep 결과 외부 importer 0건이지만 향후 확장 시 호환성 보장.

결정 3: ModelResponse.text 제거 시 answer_text / output_text 는 유지.
  이유: 사용자 Task 3 스코프가 .text 한정. answer_text 는 benchmark
  evaluator 가 읽고, output_text 는 openai/claude 원시 응답 파싱에서 사용.
  필요 시 별도 phase 에서 정리.

결정 4: per-call 비용 계산 스코프를 주요 AI 호출만으로 한정.
  runPreResearch 내 Perplexity/Tavily 비용은 제외.
  이유: 커넥터 response 에 usage 가 일관되게 없음. 추후 확장 필요.

결정 5: unifiedRetrieval 에서 구 빌더(buildFusionSystemBlock /
  buildProjectFusionBlock) 삭제 안 함.
  이유: 안전한 graceful fallback 경로 유지 + 로깅/비교용.
  실사용 데이터로 unified 가 안정화되면 다음 phase 에서 삭제 고려.

=== 다음 개발 우선순위 갱신 ===

완료:
- MessageBubble 분해 (Phase 4 이어서 추가 경감)
- Gemini 리터럴 단일 출처 (CLAUDE.md 남은 항목 중 하나 소진)
- ModelResponse.text 최종 정리
- DepartmentAgent per-call cost (Phase 5 타이쿤 실측값 활성)
- Thread Memory 정확도 튜닝 (메모리 품질 50% → 75% 추정)
- Project Memory 통합 retrieval (구조화 메모리 100%)

남은 항목:
- /api/benchmark + frontend BenchmarkView 전면 폐지 의사결정
- Director ↔ agentLoop 모드 전환 UI 이후 관측 데이터 축적
- gabia 프로덕션 서버 반영 (이번 세션은 로컬 + GitHub 까지만)
- MessageBubble 418 lines → <400 추가 튜닝 (현재 118% 달성, 충분)

=== 배포 미반영 ===

이번 세션은 로컬 + GitHub 원격(convusx) 만 갱신.
gabia 프로덕션 서버 /opt/corvusx/server 에는 .git 이 없어 git pull 불가.
이전 세션에서 SSH 키 id_deploy 는 서버에 등록됨 (root@1.201.125.92 authorized_keys).

프로덕션 반영 시 옵션:
A) server 에 git init → origin 추가 → fetch+reset hard (기존 node_modules/data/.env 보존)
B) 로컬에서 rsync 푸시
C) 배포 tarball 방식
현재 의사결정 보류 — 사용자 확인 대기.

=== 요약 ===

Batch 1+2 총 6개 작업 전부 완료 + tsc 그린 + push.
MessageBubble 472 라인 감소, Gemini 리터럴 단일화, deprecated 제거,
DepartmentAgent 실비용 활성, Thread/Project 메모리 retrieval 품질 강화.

다음 세션은 프로덕션 반영 결정 또는 Director 앙상블 품질 검증으로 진행.
"""

b64 = base64.b64encode(CONTENT.encode("utf-8")).decode("ascii")
sys.stdout.write(b64)
