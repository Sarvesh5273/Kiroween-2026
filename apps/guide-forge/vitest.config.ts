import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["test/setup.ts"],
    // Measured in task 15.1: the slowest real-pipeline test is the keyboard
    // grid 5x15 case in worker-pipeline-fidelity.test.ts at 5605 ms (the
    // keyboard solve alone takes 2251 ms). Factor 3 gives 16 815 ms, rounded up
    // to the next 5 000 ms is 20 000 ms, which is below the 30 000 ms minimum.
    testTimeout: 30_000,
  },
});
