import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    include: ["test/e2e/**/*.test.ts"],
    environment: "node",
    testTimeout: 120_000,
  },
});
