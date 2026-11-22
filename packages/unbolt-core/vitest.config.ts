import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    include: ["test/**/*.test.ts"],
    // Validates UNBOLT_FULL_KB_RUNS before any test file runs (Req 25.12). Defines no globals.
    globalSetup: ["test/helpers/fullKeyboardRuns.global.ts"],
  },
});
