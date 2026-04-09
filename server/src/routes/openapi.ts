/**
 * CORVUS X — OpenAPI Documentation
 *
 * 전 엔드포인트의 API 문서를 JSON 스키마로 자동 제공.
 * GET /api/docs → OpenAPI 3.0 JSON
 */

import type { ParsedRequest } from "../http/router.js"
import type { ExpressLikeResponse } from "../http/response.js"

const OPENAPI_SPEC = {
  openapi: "3.0.3",
  info: {
    title: "CORVUS X API",
    version: "1.0.0",
    description: "Multi-AI Orchestration Platform — Claude, OpenAI, Gemini, Perplexity를 통합 운용하는 AI 오케스트라 API"
  },
  servers: [
    { url: "http://localhost:8000", description: "Local development" }
  ],
  paths: {
    "/api/health": {
      get: {
        summary: "Health check",
        tags: ["System"],
        responses: { "200": { description: "서버 상태 정상", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, service: { type: "string" }, timestamp: { type: "string" } } } } } } }
      }
    },
    "/api/chat": {
      post: {
        summary: "채팅 (비스트리밍)",
        tags: ["Chat"],
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { message: { type: "string", maxLength: 50000 }, messages: { type: "array", items: { type: "object" } }, thread_id: { type: "string" }, project_id: { type: "string" }, mode: { type: "string" }, task: { type: "string" } } } } } },
        responses: { "200": { description: "오케스트라 응답" }, "429": { description: "Rate limit 초과" } }
      }
    },
    "/api/chat/stream": {
      post: {
        summary: "채팅 (SSE 스트리밍)",
        tags: ["Chat"],
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { message: { type: "string" }, messages: { type: "array" }, thread_id: { type: "string" }, project_id: { type: "string" }, stream: { type: "boolean", default: true } } } } } },
        responses: { "200": { description: "SSE 스트림 (text/event-stream)" } }
      }
    },
    "/api/benchmark": {
      post: {
        summary: "벤치마크 실행 (간단)",
        tags: ["Benchmark"],
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["cases"], properties: { cases: { type: "array" }, reset_scoreboard: { type: "boolean" } } } } } },
        responses: { "200": { description: "벤치마크 결과" } }
      }
    },
    "/api/benchmark/run": {
      post: {
        summary: "벤치마크 전체 실행 (Orchestra vs 단일 비교)",
        tags: ["Benchmark"],
        security: [{ bearerAuth: [] }],
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { cases: { type: "array" }, single_providers: { type: "array", items: { type: "string" } }, max_cases: { type: "number" } } } } } },
        responses: { "200": { description: "비교 결과 + 스코어보드 업데이트" } }
      }
    },
    "/api/benchmark/history": {
      get: { summary: "벤치마크 히스토리", tags: ["Benchmark"], security: [{ bearerAuth: [] }], responses: { "200": { description: "최근 30회 벤치마크 기록" } } }
    },
    "/api/feedback": {
      post: {
        summary: "사용자 피드백 (thumbs up/down)",
        tags: ["Feedback"],
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["feedback", "provider"], properties: { feedback: { type: "string", enum: ["up", "down"] }, provider: { type: "string" }, task: { type: "string" }, message_id: { type: "string" }, runner_up: { type: "string" } } } } } },
        responses: { "200": { description: "피드백 저장 완료" } }
      }
    },
    "/api/usage": { get: { summary: "사용량 통계", tags: ["Dashboard"], security: [{ bearerAuth: [] }], responses: { "200": { description: "Provider별 사용량" } } } },
    "/api/scoreboard": { get: { summary: "스코어보드", tags: ["Dashboard"], security: [{ bearerAuth: [] }], responses: { "200": { description: "Provider 점수 랭킹" } } } },
    "/api/dashboard": { get: { summary: "대시보드 데이터", tags: ["Dashboard"], security: [{ bearerAuth: [] }], responses: { "200": { description: "통합 대시보드 데이터" } } } },
    "/api/settings/keys": {
      get: { summary: "API 키 조회 (마스킹)", tags: ["Settings"], security: [{ bearerAuth: [] }], responses: { "200": { description: "마스킹된 키 목록" } } },
      post: {
        summary: "API 키 저장",
        tags: ["Settings"],
        security: [{ bearerAuth: [] }],
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { openai: { type: "string" }, anthropic: { type: "string" }, gemini: { type: "string" }, perplexity: { type: "string" } } } } } },
        responses: { "200": { description: "키 저장 완료" } }
      }
    },
    "/api/settings/validate-key": {
      post: {
        summary: "API 키 유효성 검증",
        tags: ["Settings"],
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["provider"], properties: { provider: { type: "string", enum: ["openai", "anthropic", "gemini", "perplexity"] } } } } } },
        responses: { "200": { description: "유효성 결과" } }
      }
    },
    "/api/settings/reset": {
      post: {
        summary: "데이터 초기화",
        tags: ["Settings"],
        security: [{ bearerAuth: [] }],
        parameters: [{ in: "header", name: "X-Confirm-Reset", required: true, schema: { type: "string", enum: ["true"] } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["target"], properties: { target: { type: "string", enum: ["thread-memory", "project-memory", "scoreboard", "all"] } } } } } },
        responses: { "200": { description: "초기화 완료" } }
      }
    },
    "/api/workspace": { get: { summary: "전체 워크스페이스 스냅샷", tags: ["Workspace"], security: [{ bearerAuth: [] }], responses: { "200": { description: "프로젝트 + 스레드 + 메시지 + 설정" } } } },
    "/api/workspace/projects": {
      get: { summary: "프로젝트 목록", tags: ["Workspace"], security: [{ bearerAuth: [] }], responses: { "200": { description: "프로젝트 배열" } } },
      post: { summary: "프로젝트 생성/수정", tags: ["Workspace"], security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["id", "title"], properties: { id: { type: "string" }, title: { type: "string" } } } } } }, responses: { "200": { description: "성공" } } }
    },
    "/api/workspace/threads": {
      get: { summary: "스레드 목록", tags: ["Workspace"], security: [{ bearerAuth: [] }], parameters: [{ in: "query", name: "projectId", schema: { type: "string" } }], responses: { "200": { description: "스레드 배열" } } },
      post: { summary: "스레드 생성/수정", tags: ["Workspace"], security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["id", "projectId"], properties: { id: { type: "string" }, projectId: { type: "string" }, title: { type: "string" } } } } } }, responses: { "200": { description: "성공" } } }
    },
    "/api/workspace/messages": {
      post: { summary: "메시지 저장", tags: ["Workspace"], security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["threadId", "messages"], properties: { threadId: { type: "string" }, messages: { type: "array" } } } } } }, responses: { "200": { description: "성공" } } },
      delete: { summary: "메시지 삭제", tags: ["Workspace"], security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["threadId", "messageId"], properties: { threadId: { type: "string" }, messageId: { type: "string" } } } } } }, responses: { "200": { description: "성공" } } }
    },
    "/api/export": {
      post: { summary: "스레드 내보내기 (Markdown/Text)", tags: ["Export"], security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["threadId", "format"], properties: { threadId: { type: "string" }, format: { type: "string", enum: ["markdown", "text"] } } } } } }, responses: { "200": { description: "파일 다운로드" } } }
    },
    "/api/backup/export": {
      post: { summary: "전체 워크스페이스 백업 (JSON)", tags: ["Backup"], security: [{ bearerAuth: [] }], responses: { "200": { description: "백업 데이터" } } }
    },
    "/api/backup/download": {
      post: { summary: "백업 파일 다운로드", tags: ["Backup"], security: [{ bearerAuth: [] }], responses: { "200": { description: "JSON 파일 다운로드" } } }
    },
    "/api/backup/restore": {
      post: {
        summary: "백업에서 복원",
        tags: ["Backup"],
        security: [{ bearerAuth: [] }],
        parameters: [{ in: "header", name: "X-Confirm-Reset", required: true, schema: { type: "string", enum: ["true"] } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { backup: { type: "object" } } } } } },
        responses: { "200": { description: "복원 완료" } }
      }
    },
    "/api/scheduler/status": {
      get: {
        summary: "백그라운드 스케줄러 상태",
        tags: ["Scheduler"],
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "스케줄러 실행 상태, Provider 헬스체크 결과, 로그 파일 현황" } }
      }
    },
    "/api/scheduler/trigger": {
      post: {
        summary: "스케줄러 작업 수동 실행",
        tags: ["Scheduler"],
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["task"], properties: { task: { type: "string", enum: ["log_rotation", "health_check"], description: "실행할 작업 종류" } } } } } },
        responses: { "200": { description: "작업 실행 결과" } }
      }
    },
    "/api/apm": {
      get: {
        summary: "APM 성능 모니터링 스냅샷",
        tags: ["APM"],
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "시스템 메트릭, 요청 통계(p50/p95/p99), Provider 성능, 최근 에러" } }
      }
    },
    "/api/ws/status": {
      get: {
        summary: "WebSocket 연결 상태",
        tags: ["WebSocket"],
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "현재 연결된 WebSocket 클라이언트 수" } }
      }
    },
    "/api/ws/broadcast": {
      post: {
        summary: "WebSocket 브로드캐스트",
        tags: ["WebSocket"],
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { event: { type: "string", enum: ["provider:health", "benchmark:done", "scheduler:status", "system:info"] }, data: { type: "object" } } } } } },
        responses: { "200": { description: "브로드캐스트 완료" } }
      }
    },
    "/api/plugins": {
      get: {
        summary: "등록된 플러그인 목록",
        tags: ["Plugin"],
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "플러그인 배열 (id, name, version, active, hooks)" } }
      }
    },
    "/api/plugins/register": {
      post: {
        summary: "플러그인 등록",
        tags: ["Plugin"],
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["manifest"], properties: { manifest: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, version: { type: "string" }, description: { type: "string" }, hooks: { type: "array", items: { type: "string" } } } } } } } } },
        responses: { "200": { description: "등록 결과" } }
      }
    },
    "/api/plugins/activate": {
      post: {
        summary: "플러그인 활성화",
        tags: ["Plugin"],
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["id"], properties: { id: { type: "string" } } } } } },
        responses: { "200": { description: "활성화 결과" } }
      }
    },
    "/api/plugins/deactivate": {
      post: {
        summary: "플러그인 비활성화",
        tags: ["Plugin"],
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["id"], properties: { id: { type: "string" } } } } } },
        responses: { "200": { description: "비활성화 결과" } }
      }
    },
    "/api/plugins/unregister": {
      post: {
        summary: "플러그인 제거",
        tags: ["Plugin"],
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["id"], properties: { id: { type: "string" } } } } } },
        responses: { "200": { description: "제거 결과" } }
      }
    }
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http" as const,
        scheme: "bearer",
        description: "ADMIN_API_TOKEN 값을 Bearer 토큰으로 전달. localhost에서는 생략 가능."
      }
    }
  },
  tags: [
    { name: "System", description: "서버 상태" },
    { name: "Chat", description: "AI 오케스트라 채팅" },
    { name: "Benchmark", description: "Provider 성능 비교" },
    { name: "Feedback", description: "사용자 피드백" },
    { name: "Dashboard", description: "사용량 & 스코어보드" },
    { name: "Settings", description: "설정 & API 키" },
    { name: "Workspace", description: "프로젝트/스레드/메시지 관리" },
    { name: "Export", description: "데이터 내보내기" },
    { name: "Backup", description: "워크스페이스 백업/복원" },
    { name: "Scheduler", description: "백그라운드 스케줄러 관리" },
    { name: "APM", description: "Application Performance Monitoring" },
    { name: "WebSocket", description: "실시간 WebSocket 알림" },
    { name: "Plugin", description: "플러그인/확장 시스템" }
  ]
}

export function docsRoute(_req: ParsedRequest, res: ExpressLikeResponse) {
  res.json(OPENAPI_SPEC)
}
