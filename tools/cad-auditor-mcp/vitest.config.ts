import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Stage 2 raycasting on the sample kits takes a few seconds per audit.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
