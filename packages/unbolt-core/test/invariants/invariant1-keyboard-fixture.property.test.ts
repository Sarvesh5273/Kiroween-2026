import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { se3Arbitrary } from "../arbitraries/se3";
import { configSeedArbitrary, KEYBOARD_FIXTURE_KIT, newTally, verifyInvariant1 } from "../helpers/invariants";
import { yieldToEventLoop } from "../helpers/yieldToEventLoop";
/**
 * Invariant 1 on the Keyboard_Fixture (2 rows by 3 columns) (Req 26.1 to 26.4). A fresh kit under a rigid motion from the shared
 * SE3_Arbitrary and a generated Solver_Config seed must solve with one Plan_Step per Part, and
 * every step must report 0 Opposing_Normal_Collisions against exactly the Parts of the later steps.
 */
const SEED = 0x34a1f1d7;
const NUM_RUNS = 100;
const TEST_TIMEOUT = 600_000;
describe("Invariant 1: Keyboard_Fixture (2 rows by 3 columns)", () => {
  it(
    `every step of a solved plan is clash-free (seed ${SEED}, ${NUM_RUNS} runs)`,
    async () => {
      // Feature: unbolt-core-engine, Property 34: Invariant 1, every step of a solved Invariant_Kit plan is clash-free
      const tally = newTally();
      await fc.assert(
        fc.asyncProperty(se3Arbitrary, configSeedArbitrary, fc.context(), async (transform, configSeed, ctx) => {
          verifyInvariant1(KEYBOARD_FIXTURE_KIT, transform, configSeed, ctx, tally);
          await yieldToEventLoop();
        }),
        { seed: SEED, numRuns: 100 },
      );
      // Guard against a vacuous pass: every run solved the kit and checked at least 2 steps.
      expect(tally.runs).toBe(NUM_RUNS);
      expect(tally.stepsChecked).toBeGreaterThanOrEqual(2 * NUM_RUNS);
    },
    TEST_TIMEOUT,
  );
});
