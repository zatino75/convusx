import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["server/tests/**/*.test.ts", "frontend/tests/**/*.test.ts"],
    coverage: {
      reporter: ["text", "json-summary"],
      include: ["server/src/**/*.ts", "frontend/src/**/*.ts"],
      exclude: ["**/node_modules/**", "**/dist/**", "**/*.d.ts"]
    }
  }
})
