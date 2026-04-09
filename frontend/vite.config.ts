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
      "/api": {
        target: `http://localhost:${process.env.VITE_API_PORT ?? 8000}`,
        changeOrigin: true
      },
      "/health": {
        target: `http://localhost:${process.env.VITE_API_PORT ?? 8000}`,
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
}));
