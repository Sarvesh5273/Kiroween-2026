import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { configSeedArbitrary, LOCKBOX_KIT, newTally } from "../helpers/invariants";
import { bakeKitOf, isAccepted, subsetArbitrary, subsetOf, verifyInvariant4 } from "../helpers/mergedKit";
import { yieldToEventLoop } from "../helpers/yieldToEventLoop";
/**
 * Invariant 4 on the Haunted Clockwork Lockbox (Req 29.1 to 29.7). A generated subset of 2 or more of the kit's
 * Parts is baked into one indexed or non-indexed `BufferGeometry` in one identity-transform Mesh.
 * Subsets with vertices of different Parts closer than the default Weld_Tolerance are rejected
 * with `fc.pre`, and only accepted subsets count toward the run count, so `fast-check` fails the
 * property when it cannot find enough of them (Req 29.3). The Island_Splitter must give back the
 * source Parts one-to-one, return no MonolithicMeshError, and, when the unmerged subset solves,
 * the merged input must solve with one clash-free step per Part.
 */
const SEED = 0x37c40c0b;
const NUM_RUNS = 100;
const TEST_TIMEOUT = 600_000;
/** The kit baked once: every run takes subsets of the same world-space geometries. */
const PARTS = bakeKitOf(LOCKBOX_KIT);
describe("Invariant 4: Haunted Clockwork Lockbox", () => {
  it(
    `merged meshes split back into their source Parts (seed ${SEED}, ${NUM_RUNS} accepted subsets)`,
    async () => {
      // Feature: unbolt-core-engine, Property 37: Invariant 4, merged meshes split back into their source Parts
      const tally = newTally();
      await fc.assert(
        fc.asyncProperty(subsetArbitrary(PARTS.length), fc.boolean(), configSeedArbitrary, fc.context(), async (indices, indexed, configSeed, ctx) => {
          fc.pre(isAccepted(subsetOf(PARTS, indices)));
          verifyInvariant4(LOCKBOX_KIT, PARTS, indices, indexed, configSeed, ctx, tally);
          await yieldToEventLoop();
        }),
        { seed: SEED, numRuns: 100 },
      );
      // Guard against a vacuous pass: every counted run was an accepted subset of 2 or more Parts
      // whose Islands were matched to source Parts.
      expect(tally.runs).toBe(NUM_RUNS);
      expect(tally.itemsChecked).toBeGreaterThanOrEqual(2 * NUM_RUNS);
    },
    TEST_TIMEOUT,
  );
});
