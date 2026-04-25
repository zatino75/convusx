import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/setup.ts"],
  },
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
    proxy: {
      // [TEMP] 로컬 dev → production 백엔드 (SSE/cookie 검증용)
      // 검증 끝나면 원래 localhost:8000 프록시로 원복할 것
      "/api": {
        target: "https://app.cloudcookie.co.kr",
        changeOrigin: true,
        secure: true,
        // production cookie domain (cloudcookie.co.kr) 을 localhost 로 재작성하여
        // 브라우저가 5173 origin 에 corvus_session 쿠키를 저장하도록 함
        cookieDomainRewrite: "localhost"
      },
      "/health": {
        target: "https://app.cloudcookie.co.kr",
        changeOrigin: true,
        secure: true
      }
    }
  },
  preview: {
    host: "localhost",
    port: 5173,
    strictPort: true
  },
  build: {
    sourcemap: mode !== "production",
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
        }
      }
    }
  }
}));
