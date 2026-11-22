import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { se3Arbitrary } from "../arbitraries/se3";
import { configSeedArbitrary, DUMBBELL_RING_KIT, newTally, verifyInvariant3 } from "../helpers/invariants";
import { yieldToEventLoop } from "../helpers/yieldToEventLoop";
/**
 * Invariant 3 on the dumbbell-and-ring cage (Req 28.1 to 28.7). Whatever rigid motion and
 * Solver_Config seed are drawn, the plan is `deadlocked` with 0 steps, and every witness edge is
 * a real blocking contact of the Clash_Checker.
 */
const SEED = 0x36d0b001;
const NUM_RUNS = 100;
const TEST_TIMEOUT = 600_000;
describe("Invariant 3: dumbbell and captive ring", () => {
  it(
    `is always reported as deadlocked (seed ${SEED}, ${NUM_RUNS} runs)`,
    async () => {
      // Feature: unbolt-core-engine, Property 36: Invariant 3, deadlock cages are always reported as deadlocked
      const tally = newTally();
      await fc.assert(
        fc.asyncProperty(se3Arbitrary, configSeedArbitrary, fc.context(), async (transform, configSeed, ctx) => {
          verifyInvariant3(DUMBBELL_RING_KIT, transform, configSeed, ctx, tally);
          await yieldToEventLoop();
        }),
        { seed: SEED, numRuns: 100 },
      );
      // Guard against a vacuous pass: every run solved a cage and checked witness edges.
      expect(tally.runs).toBe(NUM_RUNS);
      expect(tally.itemsChecked).toBeGreaterThanOrEqual(NUM_RUNS);
    },
    TEST_TIMEOUT,
  );
});
