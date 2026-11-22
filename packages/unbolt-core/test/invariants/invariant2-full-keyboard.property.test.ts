import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { se3Arbitrary } from "../arbitraries/se3";
import { FULL_KB_RUNS } from "../helpers/fullKeyboardRuns";
import { createBaseline, FULL_KEYBOARD_KIT, newTally, verifyInvariant2 } from "../helpers/invariants";
import { yieldToEventLoop } from "../helpers/yieldToEventLoop";
/**
 * Invariant 2 on the Full_Keyboard (default 65% layout) (Req 27.1 to 27.8). A fresh kit with a rigid motion from the shared
 * SE3_Arbitrary composed onto its root, and an untransformed fresh kit, are solved with the same
 * Solver_Config. The status must match; a solved transformed plan has the same step count and
 * Part_ID set and is clash-free; and Candidate_Axes 26 to 31 of every Part equal `R` times the
 * untransformed ones within 1e-6.
 *
 * The Solver_Config seed is fixed for the property, so the untransformed solve is the same in
 * every run and is computed once.
 *
 * This is the one documented exception to the 100-run rule (Req 25.2): the run count is
 * Full_Keyboard_Run_Count, 10 unless `UNBOLT_FULL_KB_RUNS` says otherwise (Req 25.10 to 25.12).
 */
const SEED = 0x35b2fb65;
const CONFIG_SEED = 0x5eedfb65;
const TEST_TIMEOUT = 1_800_000;
const untransformed = createBaseline(FULL_KEYBOARD_KIT, CONFIG_SEED);
describe("Invariant 2: Full_Keyboard (default 65% layout)", () => {
  it(
    `solving is invariant under rigid motion (seed ${SEED}, ${FULL_KB_RUNS} runs)`,
    async () => {
      // Feature: unbolt-core-engine, Property 35: Invariant 2, solving is invariant under rigid motion
      const tally = newTally();
      await fc.assert(
        fc.asyncProperty(se3Arbitrary, fc.context(), async (transform, ctx) => {
          verifyInvariant2(FULL_KEYBOARD_KIT, untransformed(), transform, CONFIG_SEED, ctx, tally);
          await yieldToEventLoop();
        }),
        { seed: SEED, numRuns: FULL_KB_RUNS },
      );
      // Guard against a vacuous pass: every run compared the axes of every Part.
      expect(tally.runs).toBe(FULL_KB_RUNS);
      expect(tally.itemsChecked).toBeGreaterThanOrEqual(2 * FULL_KB_RUNS);
    },
    TEST_TIMEOUT,
  );
});
