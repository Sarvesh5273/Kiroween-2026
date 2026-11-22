import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Each audit runs Stage 2 raycasting, which takes a few seconds per sample kit.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
