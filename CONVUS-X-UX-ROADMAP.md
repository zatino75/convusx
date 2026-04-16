# CONVUS X UI/UX + Product Roadmap

## 1) Sidebar IA (Implemented)
- `HQ COMMAND`: 새 채팅, AI 워크포스, 통합 대시보드, 매출 대시보드
- `RETAIL OPS`: 스토어 운영, POS 터미널
- `INSIGHT LAB`: 채팅 검색, 이미지, 벤치마크
- `PROJECT OPS`: 프로젝트 HUD + 플레이북 + 템플릿 프로젝트 생성
- `EXECUTIVE FEED`: 상무 보고 스레드 수, 최근 6시간 루프 수, 활성 프로젝트 수

## 2) Sidebar Menu Usage Guide (Operational)
- 매장 프로젝트: 점포별 KPI/POS 이슈/재고 리스크를 하나의 프로젝트로 유지
- 캠페인 프로젝트: 기간형 실행안과 성과를 스레드 단위로 누적
- 전사 프로젝트: 상무 승인 보고 스레드를 즉시 실행 큐로 전환

## 3) Workforce Game UX (Implemented)
- 단계 트랙: 지시 하달 → 부서 분석 → 미팅룸 집결 → 상무 보고 → 대표 승인
- 부서 아바타 상태: 대기/작업/미팅/완료/오류
- 미팅룸 참석 보드: 부서별 착석/이동/오류 상태
- 승인 후 실행 카드: 상무 권고안 상위 항목을 즉시 액션으로 표시

## 4) Sales + POS Integration (Implemented)
- 매출 대시보드에서 POS 오프라인 지표(매장별 매출/결제수단 비중/최근 결제) 시각화
- POS API 응답 확장: `paymentSummary`, `daily7d` 포함
- Workforce 최신 상무 지시를 SalesView 상단에 연결

## 5) Next Build Queue (Recommended)
1. POS 고급 기능
- 바코드 스캐너 장치 입력모드(키보드 웨지) 전용 UX
- 할인/쿠폰/반품/부분취소 플로우
- 다중 결제수단 분할결제

2. StoreOps 자동화
- 매장별 임계치 룰 엔진(재고/결제 실패율/객단가)
- 임계치 초과 시 프로젝트 자동 생성 + 담당 부서 자동 라우팅

3. Workforce 시뮬레이션 고도화
- 아바타 경로 애니메이션(복도/미팅룸 좌석 지정)
- 미팅룸 회의록 자동 생성 후 프로젝트 스레드 자동 첨부

4. Executive Control
- 승인/반려/재지시 액션 버튼
- 반려 시 부서별 재작업 루프 자동 실행

5. 데이터 신뢰성
- POS/매출/상무 보고를 JSONL -> SQLite 스키마로 통합
- 지표 집계 캐시 + 일/주/월 리포트 스케줄러

## 6) Progress Update (2026-04-14)
- POS 고급 기능 1차 구현 완료
  - 13자리 자동 스캔 모드
  - 정률/정액 할인
  - 분할결제(2차 수단 + 금액)
  - 결제 환불 API 및 UI
  - 부분취소(라인 단위 반품) API 및 UI
- POS 프로모션 엔진 구현
  - 서버 프로모션 코드/조건 검증
  - POS 프로모션 적용/해제 및 결제 반영
  - 매출 대시보드 프로모션 성과 지표 연동
- StoreOps 임계치 기반 자동 조치 큐 1차 구현 완료
  - 재고/매출/작업큐 기준 경보 생성
  - 우선순위(High/Medium/Low) 정렬
  - 조치 완료 처리 로그 반영
  - 조치 카드에서 프로젝트 스레드 즉시 생성
- Workforce 시뮬레이션 고도화 1차 완료
  - 아바타 이동을 `데스크 → 복도 → 미팅룸 좌석`으로 단계화
  - 미팅룸 결재 상태 배지(대기/승인/반려/재지시) 추가
  - 자동 회의록 생성(`meetingMinutes`) 및 프로젝트 스레드 첨부 연동
- Executive Control 구현 완료
  - 승인 / 반려 후 재지시 / 추가 지시 실행 버튼
  - 반려 시 재작업 루프 자동 재시작
  - 승인 시 보고 아카이브 자동 저장 + 프로젝트 스레드 자동 생성
- StoreOps 자동 라우팅 강화
  - 경보별 담당 부서 자동 배정(전략실/물류·재고/마케팅/운영 PMO)
  - 프로젝트 생성 시 부서/매장 키워드 기반 프로젝트 우선 라우팅
- 데이터 신뢰성 1차 선행 적용
  - POS 집계 캐시(20초 TTL) 도입
  - POS `periodKpi` 확장(오늘/주간누적/월간누적)
  - POS `daily30d` 추이 추가 및 대시보드 연동
- 데이터 신뢰성 2차 (SQLite 통합) 적용
  - `sales_entries` / `pos_transactions` / `executive_reports` SQLite 테이블 통합
  - JSONL → SQLite 자동 마이그레이션 + JSONL 미러링 호환
  - Retail Snapshot API 추가(`/api/retail/reports`, `/latest`, `/refresh`)
  - 스케줄러 `retail_snapshot` 작업 추가(1시간 주기 + 수동 트리거)
  - SalesView / DashboardView에 Retail Snapshot 요약 표시 연동
