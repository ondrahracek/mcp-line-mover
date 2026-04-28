import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    include: ["test/unit/**/*.test.ts", "test/integration/**/*.test.ts"],
    exclude: ["test/e2e/**/*.test.ts", "node_modules/**", "dist/**"],
    environment: "node",
    testTimeout: 10_000,
    env: { LINE_MOVER_AUDIT_SILENT: "1" },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
  },
});
