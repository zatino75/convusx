CORVUS X는 OpenAI GPT-5.4 / Claude Sonnet 4.6 / Gemini 3.1 Pro / Perplexity Pro / Midjourney / Gemini Imagen 4 / Gemini Veo 3.1 / Runway Gen4 Turbo / Slides Creator 를 연결해 AI 채팅 / AI문서 / AI리서치 / AI코딩 / AI개발 / AI디자인 / AI이미지 / AI콘텐츠 / 데이터 분석 / 법률 검토 / 상품 개발 / 기업 재무정보 / 심층 연구를 수행하는 역할 기반 멀티-AI 워크스페이스를 만든다. 
[확정 핵심 구조] 
User
│
Planner (task 분류 / 키워드 라우팅)
│
Execution Engine (runtime.ts + runtimeHelpers.ts)
│
Adaptive Router (adaptiveRouter.ts)
│
Parallel Router / Provider Selection
│
├ OpenAI GPT-5.2 / GPT-5.4-pro
├ Claude Sonnet 4.6
├ Gemini 3.1 Pro / Flash
├ Perplexity sonar-pro
│
Claims Engine (claims.ts) ← 한국어 수치 강화 완료
Conflict Detector (conflicts.ts) ← 한국어 숫자 단위 강화 완료
Judge (judge.ts) ← writing_creative rubric 7항목 강화 완료
│
Final Answer (SSE 스트림)


📁 현재 파일 구조
서버:
server/src/orchestra/
  runtime.ts / runtimeHelpers.ts / adaptiveRouter.ts
  adapterDispatcher.ts / scoreboard.ts / judge.ts
  planner.ts / claims.ts / conflicts.ts / usage.ts

server/src/routes/
  chat.ts / chatSupport.ts / chatCommands.ts / chatAnalysis.ts
  dashboard.ts / usage.ts / feedback.ts / settings.ts

server/src/adapters/
  openai.ts / claude.ts / gemini.ts / perplexity.ts

server/src/memory/
  threadMemory.ts / projectMemory.ts
프론트:
frontend/src/
  App.tsx / appMessageUtils.ts

frontend/src/components/chat/
  ChatView.tsx / HomeView.tsx / MessageRenderer.tsx
  AppViews.tsx / ProjectCreateModal.tsx

frontend/src/components/project/
  ProjectHomeView.tsx

frontend/src/components/settings/
  SettingsModal.tsx

frontend/src/store/
  workspaceStore.ts

frontend/src/types/
  workspace.ts


 Agent 전략 — 현재 상태 기준 (2026.04.04)

기본 원칙

상시 Agent 최소화 — 현재는 라우팅 인텔리전스 + 스코어보드 반영 우선
조건부 Agent 호출 구조 유지
Agent 다층화는 dynamic router 안정 + scoreboard 데이터 충분 후 진행


1. OpenAI GPT-5.2 / GPT-5.4-pro
현재 배치 (완료):
Task역할reasoningPrimarywriting_businessPrimarycode_debugPrimaryfinance_analysisPrimarydata_analysisPrimary (분석층)researchVerifier + final synthesislegal_reviewVerifierword / excel / pptPrimary
현재 상태: 라우팅 완료, scoreboard 학습 중
향후 (보류): final review 성격 정리층 강화 — dynamic router 안정 후 진행

2. Claude Sonnet 4.6
현재 배치 (완료):
Task역할code_implementPrimarycode_refactor_reviewPrimarywriting_creativePrimarylegal_reviewPrimary (계약 분석)dialoguePrimarylong_docVerifiercode_debugVerifier
현재 상태: code primary 역할 확립, vision 병렬 호출 완료
향후 Agent 후보 (보류 — dynamic router 안정 후):

code implementer
code reviewer
debug investigator
refactor architect
frontend ui guardian


3. Gemini 3.1 Pro / Flash
현재 배치 (완료):
Task역할long_docPrimary (장문 처리)pdfPrimaryppt / excelOptionalvision (이미지 분석)병렬 호출 참여
현재 상태: long_doc/PDF 보조 역할 유효, 핵심축 확장은 보류
향후 (보류 — scoreboard 데이터 충분 후):

diff analyzer
long-context summarizer
multimodal ui analyzer


4. Perplexity sonar-pro
현재 배치 (완료):
Task역할researchPrimary (웹 검색 + 최신 정보)deep_researchScout (1차 검색)fact-check보조
현재 상태: research 축 유효, adaptive routing 조건 정리 완료
향후 (보류): 정식 adaptive routing 조건 세분화 후 본격 결합

5. 외부 생성 AI (조건부 호출)
모델Task현재 상태Midjourney이미지 생성✅ 연결 완료Gemini Imagen 4이미지 생성✅ 연결 완료Runway Gen4 Turbo영상 생성✅ 연결 완료Gemini Veo 3.1영상 생성✅ 연결 완료Slides Creator슬라이드 생성✅ 연결 완료

Task별 현재 Provider 배치 확정표
TaskPrimaryVerifierJudgedialogueClaudeOpenAIClaudereasoningOpenAIClaudeOpenAIresearchPerplexityClaudeOpenAIcode_implementClaudeOpenAIClaudecode_debugOpenAIClaudeClaudecode_refactor_reviewClaudeOpenAIClaudewriting_creativeClaudeOpenAIClaudewriting_businessOpenAIClaudeOpenAIlong_docGeminiClaudeOpenAIexcel / pptOpenAIGeminiClaudewordOpenAIClaudeOpenAIpdfGeminiOpenAIClaudelegal_reviewClaudeOpenAIOpenAIdata_analysisOpenAIClaudeClaudefinance_analysisOpenAIClaudeOpenAIproduct_developmentOpenAIClaudeClaude

현재 scoreboard 학습 상태

TASK_PRIOR_WIN_RATE 전체 task 세분화 완료
피드백 버튼(👍/👎) → scoreboard 즉시 반영 연결 완료
실사용 데이터 누적 중 — 라우팅 자동 개선 진행 중


Agent 다층화 진행 기준
현재 → 실사용 데이터 누적 + scoreboard 안정 → Claude Agent 다층화 → Gemini 핵심축 확장 → MCP 커넥터 (GitHub 등) → Tool Call / Agent 루프

핵심 목표 — 현재 상태 기준 (2026.04.04)

1. 단일 모델보다 명확히 우수한 결과
ChatGPT 5.2 / Claude 4.6 / Gemini 3.1 Pro / Perplexity Pro 단독 사용 대비 오케스트라 구조가 품질 면에서 명확히 우수해야 합니다.
현재 상태:

Primary + Verifier + Judge 3단계 구조 가동 중
task별 provider 배치 확정 완료
단일 모델 vs 오케스트라 비교 탭 UI 구현 완료
scoreboard 학습 데이터 누적 중


2. 단순 병렬 호출 금지 — 구조 기반 선택
Planner → Adaptive Router → Claims/Conflicts/Judge 기반 구조 유지. 무조건 병렬 호출이 아니라 task에 따라 provider를 선별해서 호출합니다.
현재 상태:

Planner task 분류 완료 (16개 task + code subtask 3개)
Adaptive Router task별 가중치 확정 완료
Claims Engine 한국어 수치 패턴 강화 완료
Conflict Detector 한국어 숫자 단위(억/조/만) 감지 완료
Judge rubric task별 세분화 완료


3. 왜 이 답이 선택됐는지 추적 가능
winner selection / evidence / conflict / verifier / final synthesis 분리. 모든 응답에 대해 선택 근거를 구조적으로 추적할 수 있어야 합니다.
현재 상태:

OrchestrationPanel — winner 이유 / conflict 내역 / provider별 점수 표시
selection_trace / winner_reason 구조 완성
judge_confidence / conflict_count / scoreboard_before/after 로깅
피드백 버튼(👍/👎) → scoreboard 즉시 반영


4. 대화 / 구조화 지식 / 정보 / 결과물 4가지 동시 만족
목표현재 상태대화 중심✅ dialogue task Claude primary 가동구조화 지식✅ threadMemory + projectMemory 자동 저장정보 중심✅ Perplexity research scout 가동결과물 중심✅ 슬라이드/이미지/영상/코드 생성 연결 완료

5. 지식 자산 자동 융합
프로젝트 내 여러 스레드의 대화 / 결과물 / 결론을 자동으로 검색·선별·주입합니다. 수동 지정 없이 시스템이 자동 처리합니다.
현재 상태:

threadMemory — post-eval 자동 저장 완료
projectMemory — 프로젝트 구조화 메모리 가동
sourceStore — 소스 자산 업로드/관리 완료
retrieval context — threadMemory + projectMemory + sourceStore 통합 retrieval 가동

미완료 (진행 예정):

같은 프로젝트 내 스레드 자동 교차 검색/주입
"소스로 넘겨줘" 명령 → 스레드 내용 구조화 → 프로젝트 소스 승격


6. 응답 품질 강화
단순 텍스트 출력을 넘어 표 / 차트 / 강조 / 콜아웃 / 코드 하이라이팅으로 정보를 시각적으로 전달합니다.
현재 상태:

차트 렌더링 (막대/선/파이 SVG) 완료
콜아웃 박스 (NOTE/WARNING/TIP/CAUTION/ERROR) 완료
코드 하이라이팅 (JS/TS/Python/CSS/JSON) 완료
텍스트 강조 (하이라이트/빨간강조/취소선/이탤릭) 완료
대화 자동 압축 (30개 초과 시 요약, 최근 10개 유지) 완료
긴 글 붙여넣기 자동 파일 변환 완료


7. 지침 시스템
전체 지침과 프로젝트별 지침을 통해 AI 동작 방식을 사용자가 직접 제어합니다.
현재 상태:

설정 → 전체 지침 — 모든 대화에 system 메시지로 주입 완료
프로젝트 → 지침 탭 — 프로젝트별 지침 입력 및 주입 완료
localStorage 자동 저장 완료


8. 구조 검증 원칙
원칙현재 상태모델 차이는 Adapter에서만 처리
✅ adapterDispatcher.ts 분리 완료Response Contract 단일화
✅ makeDonePayload 단일 구조 유지Claims / Conflicts / Decisions / Derived 구조 유지
✅ 가동 중benchmark 결과 — rubric/strength/provider chain/conflict/scoreboard 통합
✅ OrchestrationPanel 표시 중final answer — user-facing text / internal rationale 분리
✅ buildChatPayload 분리 완료task별 라우팅 — adaptive scoring + claims/conflict 기반 selection
✅ scoreboard 학습 중


[스레드 융합] 
- 프로젝트 내 여러 스레드의 대화 / 결과물 / 결론 / 표 / 코드 / 리서치 자동 상호 교환·융합 
- 유저가 “OOOO 스레드 참고”라고 말해도 시스템이 자동 처리 
- 수동 지정 절대 불가 
- 지식융합 / 자산 버튼 삭제 예정 
- thread
- level memory 
- project-level structured memory 필요 
- 수동 참조 UI가 아니라 자동 스레드 융합 로직이 들어가야 함 
- 프로젝트 소스만 참고하는 것이 아니라 같은 프로젝트의 여러 스레드도 자동 검색/선별/주입되어야 함 
- “내용 정리해서 소스로 넘겨줘” 같은 명령을 하면 현재 스레드 내용을 구조화해서 프로젝트 소스로 승격 저장하는 기능이 필요함 
- 소스 업로드 자산 + 스레드 메모리 + 프로젝트 구조화 메모리가 함께 retrieval 되어야 함 

[현재 실제 검증 초점] 
- dialogue 
- reasoning 
- research 
- code 

[Task별 라우팅 방향] 
기본 원칙

Planner가 task 분류 → Adaptive Router가 provider 선택 → scoreboard 누적 학습으로 자동 개선
단순 병렬 호출 금지 — task별 primary/verifier/judge 역할 분리
scoreboard 학습 데이터 누적 중 — 실사용할수록 라우팅 정확도 향상


Task별 라우팅 현황
TaskPrimaryVerifierJudge특이사항dialogueClaudeOpenAIClaude일상 대화, 질문답변reasoningOpenAIClaudeOpenAI논리 추론, 수학, 복잡한 판단researchPerplexityClaudeOpenAI웹 검색 + 최신 정보deep_researchPerplexityClaudeOpenAI심층 리서치 — 검색 6000자 컨텍스트code_implementClaudeOpenAIClaude코드 구현/작성code_debugOpenAIClaudeClaude디버깅/에러 분석code_refactor_reviewClaudeOpenAIClaude리팩토링/코드 리뷰writing_creativeClaudeOpenAIClaude창작, 스토리, 카피라이팅writing_businessOpenAIClaudeOpenAI이메일, 보고서, 기획서long_docGeminiClaudeOpenAI장문 문서 처리wordOpenAIClaudeOpenAIWord 문서 생성excelOpenAIGeminiClaude스프레드시트 분석pptOpenAIGeminiClaude프레젠테이션 생성pdfGeminiOpenAIClaudePDF 분석/추출legal_reviewClaudeOpenAIOpenAI계약서/법률 검토 — 5000자 컨텍스트data_analysisOpenAIClaudeClaude데이터 분석/시각화finance_analysisOpenAIClaudeOpenAI재무 분석/리포트product_developmentOpenAIClaudeClaude상품 기획/개발 전략

조건부 호출 Task (오케스트라 외)
Task담당조건image_generateMidjourney / Gemini Imagen 4이미지 생성 키워드 감지 시video_generateRunway Gen4 / Gemini Veo 3.1영상 생성 키워드 감지 시slide_generateSlides Creator슬라이드/PPT 생성 키워드 감지 시vision_analyzeOpenAI + Claude 병렬이미지 첨부 시 — 더 긴 응답 선택pdf_analyzeGemini → OpenAI fallbackPDF 첨부 시web_searchPerplexity웹 검색 키워드 감지 시handoff_summaryOpenAI세션 요약 요청 시source_promoteClaude"소스로 넘겨줘" 등 18개 패턴 감지 시

Planner 분류 기준
키워드 유형분류 Task디버그/에러/fixcode_debug구현/만들어/작성해 + 코드code_implement리팩토링/개선/리뷰 + 코드code_refactor_review이메일/메일/공문/보고서/기획서writing_business소설/스토리/카피/창작writing_creative검색/최신/뉴스/찾아줘research심층/분석 리포트/deepdeep_research계약서/법률/조항/검토legal_review데이터/CSV/분석해줘data_analysis재무/매출/손익/투자finance_analysis상품/기획/개발 전략product_development그 외 일반 대화dialogue

현재 라우팅 품질 개선 구조
실사용
│
├ 피드백 버튼(👍/👎) → scoreboard 즉시 반영
├ Judge 선택 결과 → scoreboard 누적
├ TASK_PRIOR_WIN_RATE — 16개 task 전체 세분화 완료
└ 시간이 갈수록 라우팅 자동 최적화

**절대 중요 : 코드 수정 할 때 구조나 기본에 만들어진 형태를 바꾸지 말고, 필요 부분만 수정해서 전체 코드로 제공해.
