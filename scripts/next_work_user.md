=== 완료된 항목 (2026-04-16) ===

✅ Phase 1: 잔존 파일 삭제 + Gemini 모델 문자열 통일
✅ Phase 2: wrappers .answer 버그 수정 (Director 앙상블 복구)
✅ Phase 3: agentLoop ↔ Director 모드 토글 UI
✅ Phase 4: MessageBubble 컴포넌트 분해
✅ Phase 5: 부서 XP/레벨 타이쿤 레이어
✅ Phase 6: EnsembleRunner 무음 fallback 가시화
✅ Batch 1: 코드 품질 정리 (MessageBubble 400줄, Gemini 통일, text 필드 제거)
✅ Batch 2: 기능 완성 (비용 산출, Thread Memory, Project Memory)
✅ Batch 4: AI 타이쿤 고도화 (레벨업 WS, CEO 대시보드, 픽셀 오피스)
✅ Batch 5: DevOps (CI/CD, Vitest 68개 테스트, Docker)
✅ Batch 6: 배포 자동화 (git 기반 배포, auto-deploy.sh, 프로덕션 반영)

=== 남은 항목 ===

⏳ Batch 3 — 미디어 API 키 연동 (API 키 확보 후 진행)
- Midjourney: MIDJOURNEY_API_KEY + DISCORD_TOKEN + CHANNEL_ID 필요
- Runway Gen4: RUNWAY_API_KEY 필요
- Veo 3.1: VEO_MODEL 최신 모델명 확인 필요 (GEMINI_API_KEY는 있음)

⏳ 실사용 검증
- 모드 토글 pill 동작 확인 (브라우저)
- DeptStatsCard 30s 폴링 확인
- Director 미션 실행 후 dept_xp SQLite 기록 확인
- 앙상블 ensemble_voice 실제 draft 표시 확인

⏳ 장기 과제
- MessageBubble 나머지 내부 컴포넌트 분해
- i18n (ko/en) 완성
- 법률/재무 특화 에이전트 추가
