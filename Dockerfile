# ── Stage 1: 프론트엔드 빌드 ────────────────────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: 서버 TS 컴파일 ─────────────────────────────────────────────────
# dev deps(tsc, tsx, @types/*)가 필요하므로 별도 스테이지에서 ci (omit 없이)
FROM node:20-alpine AS server-build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY server/ ./server/
RUN npx tsc -p tsconfig.json

# ── Stage 3: 최종 런타임 이미지 (prod deps만) ───────────────────────────────
FROM node:20-alpine AS server
RUN apk add --no-cache curl
WORKDIR /app

# 런타임은 컴파일된 JS 를 직접 실행하므로 prod deps만 가져온다.
# better-sqlite3 는 native binding 이 있어 npm ci 시 musl 변형이 자동 설치된다.
COPY package*.json ./
RUN npm ci --omit=dev

# 컴파일 산출물 + 프론트엔드 dist
COPY --from=server-build /app/dist ./dist
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

EXPOSE 8000
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8000/api/health || exit 1

# tsconfig rootDir="." + outDir="dist" 이므로 컴파일 결과는 dist/server/src/ 에 위치
CMD ["node", "dist/server/src/index.js"]
