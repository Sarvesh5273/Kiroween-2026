import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { se3Arbitrary } from "../arbitraries/se3";
import { FULL_KB_RUNS } from "../helpers/fullKeyboardRuns";
import { configSeedArbitrary, FULL_KEYBOARD_KIT, newTally, verifyInvariant1 } from "../helpers/invariants";
import { yieldToEventLoop } from "../helpers/yieldToEventLoop";
/**
 * Invariant 1 on the Full_Keyboard (default 65% layout) (Req 26.1 to 26.4). A fresh kit under a rigid motion from the shared
 * SE3_Arbitrary and a generated Solver_Config seed must solve with one Plan_Step per Part, and
 * every step must report 0 Opposing_Normal_Collisions against exactly the Parts of the later steps.
 *
 * This is the one documented exception to the 100-run rule (Req 25.2): the run count is
 * Full_Keyboard_Run_Count, 10 unless `UNBOLT_FULL_KB_RUNS` says otherwise (Req 25.10 to 25.12).
 */
const SEED = 0x34a1fb65;
const TEST_TIMEOUT = 1_800_000;
describe("Invariant 1: Full_Keyboard (default 65% layout)", () => {
  it(
    `every step of a solved plan is clash-free (seed ${SEED}, ${FULL_KB_RUNS} runs)`,
    async () => {
      // Feature: unbolt-core-engine, Property 34: Invariant 1, every step of a solved Invariant_Kit plan is clash-free
      const tally = newTally();
      await fc.assert(
        fc.asyncProperty(se3Arbitrary, configSeedArbitrary, fc.context(), async (transform, configSeed, ctx) => {
          verifyInvariant1(FULL_KEYBOARD_KIT, transform, configSeed, ctx, tally);
          await yieldToEventLoop();
        }),
        { seed: SEED, numRuns: FULL_KB_RUNS },
      );
      // Guard against a vacuous pass: every run solved the kit and checked at least 2 steps.
      expect(tally.runs).toBe(FULL_KB_RUNS);
      expect(tally.stepsChecked).toBeGreaterThanOrEqual(2 * FULL_KB_RUNS);
    },
    TEST_TIMEOUT,
  );
});
