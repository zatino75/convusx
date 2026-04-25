import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(function (_a) {
    var mode = _a.mode;
    return ({
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
                "/api": {
                    target: "https://app.cloudcookie.co.kr",
                    changeOrigin: true,
                    secure: true,
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
    });
});
