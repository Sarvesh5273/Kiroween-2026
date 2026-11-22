import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FULL_KB_RUNS } from "../helpers/fullKeyboardRuns";
import { configSeedArbitrary, FULL_KEYBOARD_KIT, newTally } from "../helpers/invariants";
import { bakeKitOf, isAccepted, subsetArbitrary, subsetOf, verifyInvariant4 } from "../helpers/mergedKit";
import { yieldToEventLoop } from "../helpers/yieldToEventLoop";
/**
 * Invariant 4 on the Full_Keyboard (default 65% layout) (Req 29.1 to 29.7). A generated subset of 2 or more of the kit's
 * Parts is baked into one indexed or non-indexed `BufferGeometry` in one identity-transform Mesh.
 * Subsets with vertices of different Parts closer than the default Weld_Tolerance are rejected
 * with `fc.pre`, and only accepted subsets count toward the run count, so `fast-check` fails the
 * property when it cannot find enough of them (Req 29.3). The Island_Splitter must give back the
 * source Parts one-to-one, return no MonolithicMeshError, and, when the unmerged subset solves,
 * the merged input must solve with one clash-free step per Part.
 *
 * This is the one documented exception to the 100-run rule (Req 25.2): the run count is
 * Full_Keyboard_Run_Count accepted subsets, 10 unless `UNBOLT_FULL_KB_RUNS` says otherwise
 * (Req 25.10 to 25.12).
 */
const SEED = 0x37c4fb65;
const TEST_TIMEOUT = 1_800_000;
/** The kit baked once: every run takes subsets of the same world-space geometries. */
const PARTS = bakeKitOf(FULL_KEYBOARD_KIT);
describe("Invariant 4: Full_Keyboard (default 65% layout)", () => {
  it(
    `merged meshes split back into their source Parts (seed ${SEED}, ${FULL_KB_RUNS} accepted subsets)`,
    async () => {
      // Feature: unbolt-core-engine, Property 37: Invariant 4, merged meshes split back into their source Parts
      const tally = newTally();
      await fc.assert(
        fc.asyncProperty(subsetArbitrary(PARTS.length), fc.boolean(), configSeedArbitrary, fc.context(), async (indices, indexed, configSeed, ctx) => {
          fc.pre(isAccepted(subsetOf(PARTS, indices)));
          verifyInvariant4(FULL_KEYBOARD_KIT, PARTS, indices, indexed, configSeed, ctx, tally);
          await yieldToEventLoop();
        }),
        { seed: SEED, numRuns: FULL_KB_RUNS },
      );
      // Guard against a vacuous pass: every counted run was an accepted subset of 2 or more Parts
      // whose Islands were matched to source Parts.
      expect(tally.runs).toBe(FULL_KB_RUNS);
      expect(tally.itemsChecked).toBeGreaterThanOrEqual(2 * FULL_KB_RUNS);
    },
    TEST_TIMEOUT,
  );
});
