import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(function (_a) {
    var _b, _c;
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
                "/api": {
                    target: "http://localhost:".concat((_b = process.env.VITE_API_PORT) !== null && _b !== void 0 ? _b : 8000),
                    changeOrigin: true
                },
                "/health": {
                    target: "http://localhost:".concat((_c = process.env.VITE_API_PORT) !== null && _c !== void 0 ? _c : 8000),
                    changeOrigin: true
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
