CORVUS X는 OpenAI GPT-5.4-pro / Claude Opus 4.6 / Gemini 3.1 Pro Ultra / Perplexity sonar-pro / Midjourney v7 / Gemini Imagen 4 / Gemini Veo 3.1 / Runway Gen-4 Turbo / Slides Creator 를 연결해 AI 채팅 / AI문서 / AI리서치 / AI코딩 / AI개발 / AI디자인 / AI이미지 / AI콘텐츠 / 데이터 분석 / 법률 검토 / 상품 개발 / 기업 재무정보 / 심층 연구 / 식품·화장품·액상전자담배 도메인 특화 분석을 수행하는 True Multi-AI 워크스페이스를 만든다. 직렬 파이프라인(Planner → Router → Primary → Verifier → Judge)을 폐기하고 에이전트 루프 + 병렬 앙상블 + 적대적 비평 + 도메인 특화 도구 + 자동 법규 갱신 + 스레드 자동 융합 구조로 전면 재설계한다.
[확정 핵심 구조]
User
│
Continuation Detector (연속 턴·첨부파일 자동 복원)
│
Agent Loop (agentLoop.ts — Claude Opus 4.6 primary + native tool use + extended thinking)
│
Tool Registry (toolRegistry.ts)
│
├ 탐색: perplexity_search / web_fetch
├ 생성(draft): gpt_draft / gemini_draft / claude_draft_alt (원본 파일 직접 전달)
├ 앙상블: parallel_ensemble (3-AI 동시 + 공통/상충/고유 통찰 분석)
├ 비평: adversarial_critique (draft 모델과 다른 모델이 반드시 반박)
├ 도메인 — 식품: food_market_analyze / food_equipment_search / food_regulation_check / food_recipe_design / food_brand_retail
├ 도메인 — 액상전자담배: ecig_market_analyze / ecig_competitor_scan / ecig_regulation_check / ecig_brand_retail
├ 도메인 — 화장품: cosmetic_market_analyze / cosmetic_competitor_scan / cosmetic_recipe_design / cosmetic_manufacturing_check
├ 도메인 — 범용: market_analyze / business_analyze / finance_analyze
├ 기억: read_attachment / recall_thread_history / recall_project_memory / promote_to_source
│
Regulation Watcher (regulationWatcher.ts — 주기적 자동 법규 갱신)
│
Thread Fusion Engine (threadFusion.ts — 프로젝트 내 스레드 자동 교차 검색/주입)
│
Final Answer (SSE 스트림 + 도구 호출 타임라인 가시화 + 병렬 비교 4탭)
[의무 사전 조사·비평 원칙]
모든 task별 특화 AI 호출에는 반드시 사전 조사(도메인 도구로 최신 데이터 확보) 또는 적대적 비평(독립 critic 호출) 중 하나 이상이 자동 삽입된다. 사용자가 명시적으로 끄지 않는 한 생략 불가. 고위험 task(legal_review / finance / regulation / product)는 이중(사전 조사 + 비평) 강제.
📁 전면 재개발 파일 구조
서버:
server/src/agent/
agentLoop.ts / toolRegistry.ts / triggerDetection.ts
server/src/agent/tools/
perplexitySearch.ts / webFetch.ts
gptDraft.ts / geminiDraft.ts / claudeDraftAlt.ts
parallelEnsemble.ts / adversarialCritique.ts
readAttachment.ts / recallThreadHistory.ts / recallProjectMemory.ts / promoteToSource.ts
server/src/agent/tools/domain/
food/marketAnalyze.ts / equipmentSearch.ts / regulationCheck.ts / recipeDesign.ts / brandRetail.ts
ecig/marketAnalyze.ts / competitorScan.ts / regulationCheck.ts / brandRetail.ts
cosmetic/marketAnalyze.ts / competitorScan.ts / recipeDesign.ts / manufacturingCheck.ts
general/marketAnalyze.ts / businessAnalyze.ts / financeAnalyze.ts
server/src/regulation/
regulationWatcher.ts / regulationSources.ts / regulationCache.ts
server/src/fusion/
threadFusion.ts / projectFusion.ts / sourcePromoter.ts
server/src/routes/
chat.ts (에이전트 루프 단일 진입점)
dashboard.ts / usage.ts / feedback.ts / settings.ts
server/src/adapters/
openai.ts / claude.ts / gemini.ts / perplexity.ts (모델 버전 최신화)
server/src/memory/
threadMemory.ts (+ attachments_cache) / projectMemory.ts / sourceStore.ts
폐기(삭제):
server/src/orchestra/runtime.ts / runtimeHelpers.ts / adaptiveRouter.ts
server/src/orchestra/adapterDispatcher.ts / scoreboard.ts / judge.ts
server/src/orchestra/planner.ts / claims.ts / conflicts.ts
server/src/routes/chatSpecialPipelines.ts
프론트:
frontend/src/
App.tsx / appMessageUtils.ts
frontend/src/components/chat/
ChatView.tsx / HomeView.tsx / MessageRenderer.tsx
AppViews.tsx / ProjectCreateModal.tsx
EnsembleCompareView.tsx (병렬 앙상블 4탭 비교)
ToolCallTimeline.tsx (도구 호출 실시간 타임라인)
frontend/src/components/project/
ProjectHomeView.tsx
frontend/src/components/settings/
SettingsModal.tsx (+ 도메인 프로파일 + 자동 법규 갱신 주기)
frontend/src/store/
workspaceStore.ts / agentStore.ts
frontend/src/types/
workspace.ts / agent.ts
Agent 전략 — 전면 전환 기준 (2026.04.10)
기본 원칙

상시 에이전트 루프 가동 — 모든 요청은 Claude Opus 4.6 에이전트 루프를 통과한다. Planner/Judge/Scoreboard 층 전면 폐기
task별 특화 AI 사전 조사·비평 의무화 — 도메인 도구 사전 조사 또는 적대적 비평 중 하나 이상 강제, 고위험 task는 둘 다 강제
기본 경로 vs 고가치 경로 분기 — 일상 대화는 단일 에이전트 루프, 고가치 작업(답변서·계약서·사업계획·리스크 분석·상품 개발·법규 검토)은 병렬 앙상블 + 적대적 비평 자동 발동
병렬 앙상블은 원본 파일을 각 모델에 직접 전달 — Claude가 요약해서 넘기지 않는다. 정보 손실 금지
적대적 비평자는 draft 모델과 반드시 다른 모델 — 같은 모델은 같은 실수를 반복한다
모델 버전은 항상 각 공급자의 최상위 버전 고정


OpenAI GPT-5.4-pro (최상위 버전 고정)
역할 재배치:
Task | 역할
reasoning | Ensemble draft
writing_business | Ensemble draft
code_debug | Ensemble draft
finance_analysis | Ensemble draft + finance 도메인 도구 호출
data_analysis | Ensemble draft + 도메인 도구 호출
research | Ensemble draft
legal_review | Adversarial critic (Claude draft 반박)
word / excel / ppt | Ensemble draft

도입 조건: 모든 draft 호출은 원본 첨부파일 base64를 직접 수신. reasoning_effort는 고가치 경로에서 high 고정.

Claude Opus 4.6 (최상위 버전 고정)
역할 재배치:
Task | 역할
전체 | Agent loop orchestrator (primary)
code_implement | Ensemble draft
code_refactor_review | Ensemble draft
writing_creative | Ensemble draft
legal_review | Ensemble draft (계약·소송)
dialogue | 단독 에이전트 루프 처리
long_doc | Ensemble draft
code_debug | Adversarial critic
product_development | Ensemble draft
전 도메인 | 도메인 도구 호출 주체

도입 조건: extended thinking(thinking: { type: "enabled", budget_tokens: 16000 }) 고가치 경로 상시 활성. native tool use로 도메인 도구 직접 호출.

Gemini 3.1 Pro Ultra (최상위 버전 고정)
역할 재배치:
Task | 역할
long_doc | Ensemble draft (장문 초안)
pdf | Ensemble draft (대용량 PDF)
vision | Ensemble draft (이미지 분석)
excel / ppt | Ensemble draft (대안 관점)
legal_review | Adversarial critic

도입 조건: 2M context window를 활용해 프로젝트 전체 스레드 + 첨부파일을 한 번에 주입하는 유일한 draft 라인으로 활용.

Perplexity sonar-pro
역할 재배치:
Task | 역할
research | 에이전트 도구 (tool call)
deep_research | 병렬 분할 검색 (쟁점별 동시 호출)
fact-check | 에이전트 도구
regulation_update | 자동 법규 갱신 소스

도입 조건: tool call 형태로만 호출. 별도 pipeline 제거. 도메인 도구가 내부적으로 Perplexity를 호출.

외부 생성 AI (에이전트 도구로 편입)
모델 | Task | 버전 | 상태
Midjourney v7 | 이미지 생성 | 최상위 | 도구화 완료 목표
Gemini Imagen 4 | 이미지 생성 | 최상위 | 도구화 완료 목표
Runway Gen-4 Turbo | 영상 생성 | 최상위 | 도구화 완료 목표
Gemini Veo 3.1 | 영상 생성 | 최상위 | 도구화 완료 목표
Slides Creator | 슬라이드 생성 | 최상위 | 도구화 완료 목표

모두 에이전트 루프에서 tool call로 호출. 별도 분기 코드 삭제.
Task별 전면 재구성표
Task | Default (단일 에이전트 루프) | High-value (병렬 앙상블 + 비평) | 필수 사전 조사·비평
dialogue | Claude Opus 4.6 | (발동 안 함) | 없음
reasoning | Claude + thinking | 3-AI + 교차 critic | 적대적 비평
research | Claude + perplexity | 3-AI + perplexity 분할 | 사전 조사
deep_research | Claude + perplexity 분할 | 3-AI + 상호 critic | 이중
code_implement | Claude | 3-AI + 교차 critic | 비평
code_debug | Claude + GPT critic | 3-AI + 교차 critic | 비평
code_refactor_review | Claude | 3-AI + 교차 critic | 비평
writing_creative | Claude | 3-AI + 교차 critic | 비평
writing_business | Claude + GPT critic | 3-AI + 교차 critic | 비평
long_doc | Gemini | 3-AI + Claude critic | 비평
word | GPT + Claude critic | 3-AI + Claude critic | 비평
excel | GPT + Gemini critic | 3-AI + Claude critic | 비평
ppt | GPT + Gemini critic | 3-AI + Claude critic | 비평
pdf | Gemini + Claude critic | 3-AI + Claude critic | 비평
legal_review | Claude + regulation_check | 3-AI + 교차 critic + 자동 법규 | 이중
data_analysis | GPT + Claude critic | 3-AI + 도메인 도구 | 비평
finance_analysis | GPT + finance_analyze | 3-AI + finance 도구 | 이중
product_development | Claude + 도메인 도구 | 3-AI + 도메인 도구 | 이중
food_* | Claude + 식품 도메인 도구 | 3-AI + 식품 도메인 도구 | 사전 조사 (규제 task는 이중)
ecig_* | Claude + 전자담배 도메인 도구 | 3-AI + 전자담배 도메인 도구 + 자동 법규 | 이중
cosmetic_* | Claude + 화장품 도메인 도구 | 3-AI + 화장품 도메인 도구 | 사전 조사 (제조 task는 이중)
market_analyze | Claude + market 도구 | 3-AI + market 도구 | 사전 조사
business_analyze | Claude + business 도구 | 3-AI + business 도구 | 이중
도구 호출 로그 기반 품질 관리 (scoreboard 대체)

TASK_PRIOR_WIN_RATE / scoreboard / judge 전면 폐기
대체: tool_call_log (어떤 도구가, 언제, 어떤 인자로 호출됐는지 자동 기록)
사용자 피드백(👍/👎) → 에이전트 루프 system prompt 힌트로 반영
"어느 도구가 자주 유용했는가"만 데이터로 누적

에이전트 루프 안정화 기준
현재 → 1단계 연속 턴 버그 수정(attachments_cache) → 2단계 에이전트 루프 + 최소 도구 → 3단계 병렬 앙상블 + 적대적 비평 + UI → 4단계 도메인 도구 + 자동 법규 갱신 + 스레드 융합
핵심 목표 — 전면 재개발 기준 (2026.04.10)

단일 모델보다 명확히 우수한 결과
GPT-5.4-pro / Claude Opus 4.6 / Gemini 3.1 Pro Ultra / Perplexity Pro 단독 사용 대비 병렬 앙상블 + 적대적 비평 + 도메인 도구 사전 조사 구조가 품질 면에서 구조적으로 우수해야 한다. 원본 파일을 각 모델에 직접 전달하는 것이 결정적 차별점.

목표 상태:

병렬 앙상블 3-AI 가동 (원본 파일 직접 전달)
적대적 비평 의무화 (교차 모델 critic)
단일 모델 vs 앙상블 품질 비교 UI (4탭)
도메인 도구 사전 조사로 단독 모델이 접근 못하는 정보 주입
모델 버전 최상위 고정 (GPT-5.4-pro / Opus 4.6 / 3.1 Pro Ultra)


단순 병렬 호출 금지 — 의도 기반 발동
병렬 앙상블은 고가치 경로에서만 발동. 일상 대화는 단일 에이전트 루프. 토글 + 자동 감지 + 비용 확인 이중 게이트.

목표 상태:

에이전트 루프가 task 의도를 스스로 판단
"3-AI 병렬 모드" UI 토글
자동 감지 패턴 (답변서·계약서·사업계획·리스크·전략·최종 검토·규제)
실행 전 비용·지연 안내 → 확인 → 실행
의무 사전 조사·비평은 기본 경로에서도 강제


왜 이 답이 선택됐는지 추적 가능
도구 호출 타임라인 + 병렬 draft 4탭 + 비평 리포트로 사용자가 선택 근거를 시각적으로 추적.

목표 상태:

ToolCallTimeline — 어떤 도구가 언제, 어떤 인자로 호출됐는지 실시간 표시
EnsembleCompareView — Claude/GPT/Gemini 원본 + 통합본 + 비평 리포트 4탭
"이 모델 결과를 최종본으로 선택" 버튼
비용·지연·토큰 배지
도메인 도구 호출 내역 표시 (어떤 법규·시장 데이터가 주입됐는지)


대화 / 구조화 지식 / 정보 / 결과물 4가지 동시 만족
목표 | 수단
대화 중심 | Claude Opus 4.6 에이전트 루프 단독 처리
구조화 지식 | threadMemory + projectMemory 자동 저장 + 자동 융합
정보 중심 | 도메인 도구 + perplexity_search + regulationWatcher 자동 갱신
결과물 중심 | 외부 생성 AI 도구화 (Midjourney v7 / Imagen 4 / Veo 3.1 / Runway Gen-4 Turbo / Slides Creator)
지식 자산 자동 융합 (스레드간 정보 공유 유지)
프로젝트 내 모든 스레드의 대화 / 결과물 / 결론 / 표 / 코드 / 리서치가 자동으로 상호 교환·융합된다. 수동 참조 UI 없음.

목표 상태:

threadMemory — attachments_cache 포함, 연속 턴 첨부파일 완전 복원
projectMemory — 프로젝트 구조화 메모리 유지
sourceStore — 소스 자산 업로드/관리
threadFusion.ts — 같은 프로젝트 내 모든 스레드 자동 교차 검색/주입 (스레드간 정보 공유 상시 유지)
promoteToSource 도구 — "소스로 넘겨줘" 감지 시 스레드 내용 구조화 후 프로젝트 소스로 승격
recallProjectMemory 도구 — 에이전트가 스스로 과거 스레드 호출
유저가 "OOO 스레드 참고"라고 말해도 자동 처리, 수동 지정 절대 불가


응답 품질 강화
단순 텍스트 출력을 넘어 표 / 차트 / 강조 / 콜아웃 / 코드 하이라이팅 + 도구 호출 타임라인 + 병렬 비교 뷰로 정보를 시각적으로 전달.

목표 상태:

차트 렌더링 (막대/선/파이 SVG) 유지
콜아웃 박스 (NOTE/WARNING/TIP/CAUTION/ERROR) 유지
코드 하이라이팅 (JS/TS/Python/CSS/JSON) 유지
텍스트 강조 유지
자동 압축 / 파일 변환 유지
ToolCallTimeline 추가
EnsembleCompareView 추가


지침 시스템
전체 지침 + 프로젝트별 지침 + 도메인 프로파일을 통해 에이전트 루프 system prompt를 사용자가 직접 제어.

목표 상태:

설정 → 전체 지침 (모든 에이전트 루프 system 주입)
프로젝트 → 지침 탭
도메인 프로파일 선택 (식품 / 액상전자담배 / 화장품 / 범용) — 해당 프로파일의 도구가 기본 활성화
자동 법규 갱신 주기 설정 (일/주/수동)
localStorage 자동 저장


구조 검증 원칙
원칙 | 목표 상태
에이전트 루프 단일 진입점 | agentLoop.ts 단일 구조
도구는 Tool Registry에만 등록 | toolRegistry.ts 단일 관리
Response Contract 단일화 | tool_call + final_text 이원 구조
Claims/Conflicts/Judge 폐기 | 에이전트 루프가 자체 판단
병렬 앙상블 결과 전체 보존 | 4탭 비교 UI
도구 호출 로그 필수 | tool_call_log 자동 기록
비평자 독립성 보장 | 교차 모델 critic 강제
사전 조사·비평 의무화 | 도메인 도구 또는 critic 중 하나 이상 강제

[자동 법규 갱신]

식품: 식약처 고시·훈령, 식품위생법, 수입식품법, HACCP 고시, 식품첨가물 공전
액상전자담배: 담배사업법, 기재부 고시, 전자담배 안전관리, FDA PMTA, EU TPD
화장품: 화장품법, 화장품 안전기준, 화장품 성분 사전, 식약처 화장품 고시
일반: 공정거래법, 표시광고법, 개인정보보호법, 전자상거래법

동작:

regulationWatcher.ts가 주기적(기본 일 1회, 설정 가능) 자동 크롤링
변경 감지 시 regulationCache 업데이트 + 사용자 알림
legal_review / *_regulation_check 도구 호출 시 캐시 우선 조회, 최신이 아니면 실시간 재조회
사용자에게 "마지막 갱신: YYYY-MM-DD / 최근 변경: X건" 표시
변경된 조항은 에이전트 루프에 자동 주입

[스레드 융합 — 전면 자동화]

프로젝트 내 여러 스레드의 대화 / 결과물 / 결론 / 표 / 코드 / 리서치 자동 상호 교환·융합
유저가 "OOO 스레드 참고"라고 말해도 시스템이 자동 처리
수동 지정 절대 불가 (수동 참조 UI 전면 삭제)
지식융합 / 자산 버튼 삭제 확정
thread-level memory 유지 + attachments_cache 추가 (연속 턴 첨부파일 복원)
project-level structured memory 유지 + 자동 교차 검색
수동 참조 UI 완전 삭제, 자동 스레드 융합 로직 가동
프로젝트 소스 + 스레드 메모리 + 프로젝트 구조화 메모리가 모두 retrieval 대상
"내용 정리해서 소스로 넘겨줘" → promoteToSource 도구가 현재 스레드 내용 구조화 후 프로젝트 소스로 승격 저장
소스 업로드 자산 + 스레드 메모리 + 프로젝트 구조화 메모리 통합 retrieval 가동
스레드간 정보 공유는 기본값, 끌 수 없음

[현재 실제 검증 초점]

dialogue (단일 에이전트 루프 품질)
reasoning (병렬 앙상블 + 적대적 비평 품질)
research (도메인 도구 + perplexity 분할 품질)
code (교차 모델 비평 품질)
legal_review (자동 법규 갱신 + 비평 이중 품질)
food / ecig / cosmetic (도메인 도구 정확도)
market / business / finance (사전 조사 + 비평 품질)

[Task별 라우팅 방향]
기본 원칙

Planner 폐기. Claude 에이전트 루프가 task를 스스로 판단
Adaptive Router 폐기. 도구 설명(description)이 판단 기준
scoreboard 폐기. 도구 호출 로그로 대체
단순 병렬 호출 금지 — 기본 경로 / 고가치 경로 분기 + 의무 사전 조사·비평
모델 버전은 항상 최상위 고정

Task별 라우팅 현황 (재설계)
Task | Default | High-value | 필수 사전 조사·비평
dialogue | Claude 에이전트 루프 | - | 없음
reasoning | Claude + thinking | 3-AI + 교차 critic | 적대적 비평
research | Claude + perplexity | 3-AI + perplexity 분할 | 사전 조사
deep_research | Claude + perplexity 분할 | 3-AI + 상호 critic | 이중
code_implement | Claude | 3-AI + 교차 critic | 비평
code_debug | Claude + GPT critic | 3-AI + 교차 critic | 비평
code_refactor_review | Claude | 3-AI + 교차 critic | 비평
writing_creative | Claude | 3-AI + 교차 critic | 비평
writing_business | Claude + GPT critic | 3-AI + 교차 critic | 비평
long_doc | Gemini | 3-AI + Claude critic | 비평
word | GPT + Claude critic | 3-AI + Claude critic | 비평
excel | GPT + Gemini critic | 3-AI + Claude critic | 비평
ppt | GPT + Gemini critic | 3-AI + Claude critic | 비평
pdf | Gemini + Claude critic | 3-AI + Claude critic | 비평
legal_review | Claude + regulation_check | 3-AI + 교차 critic + 자동 법규 | 이중
data_analysis | GPT + Claude critic | 3-AI + 도메인 도구 | 비평
finance_analysis | GPT + finance_analyze | 3-AI + finance 도구 | 이중
product_development | Claude + 도메인 도구 | 3-AI + 도메인 도구 | 이중
food_market_analyze | Claude + food_market | 3-AI + food 도구 | 사전 조사
food_equipment_search | Claude + food_equipment | 3-AI + food 도구 | 사전 조사
food_regulation_check | Claude + food_regulation + 자동 법규 | 3-AI + 법규 | 이중
food_recipe_design | Claude + food_recipe | 3-AI + food 도구 | 사전 조사
food_brand_retail | Claude + food_brand_retail | 3-AI + 도메인 도구 | 사전 조사
ecig_market_analyze | Claude + ecig_market | 3-AI + ecig 도구 | 사전 조사
ecig_competitor_scan | Claude + ecig_competitor | 3-AI + ecig 도구 | 사전 조사
ecig_regulation_check | Claude + ecig_regulation + 자동 법규 | 3-AI + 법규 | 이중
ecig_brand_retail | Claude + ecig_brand_retail | 3-AI + 도메인 도구 | 사전 조사
cosmetic_market_analyze | Claude + cosmetic_market | 3-AI + cosmetic 도구 | 사전 조사
cosmetic_competitor_scan | Claude + cosmetic_competitor | 3-AI + cosmetic 도구 | 사전 조사
cosmetic_recipe_design | Claude + cosmetic_recipe | 3-AI + cosmetic 도구 | 사전 조사
cosmetic_manufacturing_check | Claude + cosmetic_manufacturing + 자동 법규 | 3-AI + 법규 | 이중
market_analyze | Claude + market_analyze | 3-AI + market 도구 | 사전 조사
business_analyze | Claude + business_analyze | 3-AI + business 도구 | 이중
조건부 호출 Task (에이전트 도구로 편입)
Task | 담당 | 조건
image_generate | Midjourney v7 / Imagen 4 | 에이전트 루프 tool call
video_generate | Runway Gen-4 Turbo / Veo 3.1 | 에이전트 루프 tool call
slide_generate | Slides Creator | 에이전트 루프 tool call
vision_analyze | Claude + Gemini 병렬 | 이미지 첨부 시 자동 도구 호출
pdf_analyze | Gemini + Claude critic | PDF 첨부 시 자동 도구 호출
web_search | Perplexity sonar-pro | 에이전트 루프 tool call
handoff_summary | Claude | 세션 요약 요청 시
source_promote | promoteToSource | "소스로 넘겨줘" 등 패턴 감지
Task 판단 기준 (에이전트 자체 판단)

Planner/키워드 매칭 폐기
Claude가 tool description을 보고 스스로 어떤 도구를 호출할지 결정
사용자가 명시적으로 "3-AI 병렬 모드" 토글을 켜거나 고가치 키워드 감지 시 앙상블 발동
도메인 프로파일이 설정돼 있으면 해당 도메인 도구가 우선 고려 대상에 포함

품질 개선 구조
실사용
│
├ 피드백 버튼(👍/👎) → 에이전트 루프 system prompt 힌트 반영
├ 도구 호출 로그 → 자주 유용한 도구가 가시적으로 드러남
├ 병렬 앙상블 결과 4탭 비교 → 사용자가 최종본 선택
├ 도메인 도구 사용 빈도 → 도메인 프로파일 자동 추천
├ 자동 법규 갱신 → 법률·규제 task 정확도 지속 향상
└ 스레드 자동 융합 → 프로젝트 지식 누적이 다음 요청 품질에 즉시 반영

[프로덕션 배포 — gabia Ubuntu 22.04 (root@1.201.125.92)]
2026-04-11 배포 완료. cloudcookie.co.kr 도메인 3분기 (apex/www 블랭크 + app 서브도메인 CORVUS X) 운영 중.

도메인 / 역할 분리
도메인 | 역할
cloudcookie.co.kr | 블랭크 HTML + Clear-Site-Data 헤더 (캐시/쿠키/스토리지 강제 초기화)
www.cloudcookie.co.kr | 동일 (apex 와 같은 server 블록)
app.cloudcookie.co.kr | CORVUS X 프론트엔드 + 백엔드 리버스 프록시

로그인 방식
네이티브 브라우저 Basic Auth 가 아닌 CORVUS X 내부 로그인 UI (scrypt + HMAC-SHA256 세션 쿠키). 환경변수 CORVUS_ACCESS_PASSWORD_HASH (형식 scrypt$N$saltHex$hashHex) + CORVUS_SESSION_SECRET (48 byte hex) 을 /etc/corvusx/.env 에 설정. 과거 /etc/nginx/.htpasswd + auth_basic 은 전면 제거됨.

중요 경로
경로 | 용도
/opt/corvusx/server | 백엔드 소스 + dist (tsc 빌드 산출물)
/opt/corvusx/frontend | 프론트 소스 (빌드 시에만 사용)
/var/www/corvusx | 프론트 dist 배포 위치 (nginx root)
/var/www/blank | apex 블랭크 페이지 (nginx root)
/etc/corvusx/.env | API 키 4종 + 비밀번호 해시 + 세션 시크릿 (chmod 640, root:corvusx)
/etc/systemd/system/corvusx-backend.service | systemd unit (User=corvusx, ExecStart node dist/index.js)
/etc/nginx/sites-available/corvusx | nginx 설정 (4 server 블록) → sites-enabled symlink
/etc/letsencrypt/live/cloudcookie.co.kr/ | apex+www 인증서
/etc/letsencrypt/live/app.cloudcookie.co.kr/ | app 서브도메인 인증서
/root/corvus-x.bak.20260411-082838 | 이전 버전 백업 (원복용)

재빌드 / 재시작 절차
백엔드:
cd /opt/corvusx/server && rm -rf dist && ./node_modules/.bin/tsc && systemctl restart corvusx-backend && systemctl is-active corvusx-backend
프론트엔드:
cd /opt/corvusx/frontend && npm run build && rsync -a --delete dist/ /var/www/corvusx/
nginx 설정 변경:
nginx -t && systemctl reload nginx

비밀번호 재설정
deploy/scripts/generate-password-hash.mjs 실행 → 출력된 scrypt$... 해시를 /etc/corvusx/.env 의 CORVUS_ACCESS_PASSWORD_HASH 에 붙여넣기 → systemctl restart corvusx-backend

관측 / 로그
journalctl -u corvusx-backend -n 100 --no-pager — 백엔드 로그
journalctl -u nginx -n 50 --no-pager — nginx 에러/재시작 로그
ss -tlnp | grep -E ':(80|443|8000)' — 포트 LISTEN 확인
curl -s https://app.cloudcookie.co.kr/api/auth/me — 쿠키 없이 호출 시 authenticated:false 가 정상

절대 재도입 금지 패턴
1. toolRegistry.ts 에서 tools/*.js 를 직접 import 하는 패턴 — ESM 순환 import TDZ 유발. 반드시 toolBootstrap.ts 로 분리하고 src/index.ts 최상단에서만 import.
2. auth 미들웨어에서 isLocalRequest / 127.0.0.1 / localhost 자동 통과 분기 — nginx 리버스 프록시 환경에서는 모든 요청이 127.0.0.1 에서 오므로 인증 자체가 무력화된다. src/http/auth.ts 의 isLocalRequest() 는 항상 false 를 반환해야 한다.
3. /etc/nginx/.htpasswd + auth_basic — CORVUS X 내부 로그인 UI 와 충돌하고 브라우저 네이티브 팝업을 띄워 UX 망친다.