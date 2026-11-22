import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { se3Arbitrary } from "../arbitraries/se3";
import { createBaseline, GEARBOX_KIT, newTally, verifyInvariant2 } from "../helpers/invariants";
import { yieldToEventLoop } from "../helpers/yieldToEventLoop";
/**
 * Invariant 2 on the 3-Stage Planetary Gearbox (Req 27.1 to 27.8). A fresh kit with a rigid motion from the shared
 * SE3_Arbitrary composed onto its root, and an untransformed fresh kit, are solved with the same
 * Solver_Config. The status must match; a solved transformed plan has the same step count and
 * Part_ID set and is clash-free; and Candidate_Axes 26 to 31 of every Part equal `R` times the
 * untransformed ones within 1e-6.
 *
 * The Solver_Config seed is fixed for the property, so the untransformed solve is the same in
 * every run and is computed once.
 */
const SEED = 0x35b2ea2b;
const CONFIG_SEED = 0x5eedea2b;
const NUM_RUNS = 100;
const TEST_TIMEOUT = 600_000;
const untransformed = createBaseline(GEARBOX_KIT, CONFIG_SEED);
describe("Invariant 2: 3-Stage Planetary Gearbox", () => {
  it(
    `solving is invariant under rigid motion (seed ${SEED}, ${NUM_RUNS} runs)`,
    async () => {
      // Feature: unbolt-core-engine, Property 35: Invariant 2, solving is invariant under rigid motion
      const tally = newTally();
      await fc.assert(
        fc.asyncProperty(se3Arbitrary, fc.context(), async (transform, ctx) => {
          verifyInvariant2(GEARBOX_KIT, untransformed(), transform, CONFIG_SEED, ctx, tally);
          await yieldToEventLoop();
        }),
        { seed: SEED, numRuns: 100 },
      );
      // Guard against a vacuous pass: every run compared the axes of every Part.
      expect(tally.runs).toBe(NUM_RUNS);
      expect(tally.itemsChecked).toBeGreaterThanOrEqual(2 * NUM_RUNS);
    },
    TEST_TIMEOUT,
  );
});
