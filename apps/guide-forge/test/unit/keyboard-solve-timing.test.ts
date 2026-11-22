/**
 * Task 15.1: measures one real-pipeline solve of `mechanical-keyboard-65`.
 *
 * Uses the real `performance.now` clock and the real Core `checkClashes` (the pipeline defaults).
 * The elapsed milliseconds are printed with `console.info` so task 15.2 can size `testTimeout`.
 *
 * Requirements: 17.6
 */
import { describe, expect, it } from "vitest";
import { checkClashes } from "@unboltkit/core";
import type { SolveRequestMessage } from "../../src/protocol";
import { runSolve } from "../../src/worker/solvePipeline";

describe("mechanical-keyboard-65 real-pipeline solve", () => {
  it("solves with a trajectory and an oracle that agree with the plan, and reports the elapsed time", () => {
    const request: SolveRequestMessage = {
      type: "solve",
      requestId: 1,
      source: { kind: "kit", kitName: "mechanical-keyboard-65" },
    };

    const start = performance.now();
    const result = runSolve(request, { now: () => performance.now(), checkClashes });
    const elapsedMs = performance.now() - start;

    console.info(`[keyboard-solve-timing] mechanical-keyboard-65 elapsed=${Math.round(elapsedMs)}ms`);

    const plan = result.plan;
    expect(plan.status).toBe("solved");
    if (plan.status !== "solved") return;

    expect(result.trajectory).not.toBeNull();
    expect(result.trajectory?.length).toBe(plan.steps.length);

    expect(result.oracle).not.toBeNull();
    const oracle = result.oracle;
    if (oracle === null) return;
    const perStepSum = oracle.perStep.reduce((acc, step) => acc + step.clashCount, 0);
    expect(oracle.totalClashes).toBe(perStepSum);
  });
});
