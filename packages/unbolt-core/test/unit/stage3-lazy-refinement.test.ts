import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkClashes } from "../../src/oracle/clashChecker";
import { stage2BuildDbg } from "../../src/stage2/dbgBuilder";
import { runPeel, stage3Peel, type PeelInput } from "../../src/stage3/peelSolver";
import { createStepVerifier, type StepVerifier } from "../../src/stage3/stepVerifier";
import type { BlockingEdge, Stage1Result } from "../../src/types";
import { se3Arbitrary, type Se3Transform } from "../arbitraries/se3";
import { applySe3 } from "../helpers/applySe3";
import { GEARBOX_KIT } from "../helpers/invariants";
import { findFirstStepClash, solveStaged } from "../helpers/stagedSolve";
import { yieldToEventLoop } from "../helpers/yieldToEventLoop";
/**
 * Lazy exact step verification in Stage 3 (Req 14.11), on the 3-Stage Planetary Gearbox.
 *
 * The first Invariant 2 counterexample of the gearbox: a half-turn about (-1, 1, -1) turns the
 * gear axes 19.5 degrees away from the canonical directions. Stage 2's 2 x 48 Sample_Rays then
 * miss a thin tooth-flank contact between ring gear 3 and two planet gears, so without step
 * verification the peel moves the ring along a direction that drives its teeth into them.
 */
const CONFIG_SEED = 0x5eedea2b;
const HALF_TURN_POSE: Se3Transform = {
  quaternion: [-0.5773502691896276, 0.5773502691896241, -0.5773502691896257, 2.517129356772198e-184],
  translation: [5.695056833526591e-206, 5e-323, 3.4217308976458216e-96],
};
const SWEEP_SEED = 0x14b11e7a;
const SWEEP_POSES = 200;
const TEST_TIMEOUT = 120_000;
const SWEEP_TIMEOUT = 900_000;
function solvePose(pose: Se3Transform): Extract<ReturnType<typeof solveStaged>, { status: "ok" }> {
  const root = GEARBOX_KIT.build();
  applySe3(root, pose);
  const solve = solveStaged(root, { seed: CONFIG_SEED });
  if (solve.status === "error") {
    throw new Error(`the gearbox solve returned ${solve.plan.error.kind}: ${solve.plan.error.message}`);
  }
  return solve;
}
/** The same `PeelInput` that `stage3Peel` builds, so `runPeel` can run with and without verification. */
function peelInputOf(stage1: Stage1Result): PeelInput {
  const graph = stage2BuildDbg(stage1, stage1.config);
  return {
    parts: stage1.parts.map((part) => ({
      partId: part.partId,
      aabb: part.aabb,
      obbCenter: part.frame.obb.center,
      obbHalfExtents: part.frame.obb.halfExtents,
      candidateAxes: part.candidateAxes,
    })),
    edges: graph.edges,
    normalization: stage1.normalization,
    sampling: stage1.sampling,
    diagnostics: stage1.diagnostics,
  };
}
describe("Stage 3 lazy exact step verification on the gearbox (Req 14.11)", () => {
  it(
    "the half-turn about (-1, 1, -1) collides without verification and is clash-free with it",
    () => {
      const { stage1, plan } = solvePose(HALF_TURN_POSE);
      const input = peelInputOf(stage1);

      // Without verification the peel trusts the sampled graph and one step clashes.
      const unverified = runPeel(input, stage1.config).plan;
      expect(unverified.status).toBe("solved");
      const missed = findFirstStepClash(stage1, unverified.steps);
      expect(missed, "the sampled graph alone should miss the tooth contact").not.toBeNull();
      expect(missed?.count ?? 0).toBeGreaterThan(0);

      // With verification, every refined edge is a real collision of A along d against B alone.
      const verifier = createStepVerifier(stage1.parts, stage1.config);
      const refined: BlockingEdge[] = [];
      const recording: StepVerifier = (request) => {
        const edges = verifier.verify(request);
        refined.push(...edges);
        return edges;
      };
      const verified = runPeel(input, stage1.config, { verifyStep: recording }).plan;
      expect(verified).toEqual(plan);
      expect(refined.length).toBeGreaterThan(0);
      const partById = new Map(stage1.parts.map((part) => [part.partId, part]));
      for (const edge of refined) {
        const from = partById.get(edge.from);
        const to = partById.get(edge.to);
        if (from === undefined || to === undefined) {
          throw new Error(`refined edge ${edge.from} -> ${edge.to} names an unknown Part`);
        }
        expect(checkClashes(from, edge.dir, [to], stage1.config).count, `${edge.from} -> ${edge.to} along axis ${edge.dirIndex}`).toBeGreaterThan(0);
        for (const [list, triangleCount] of [
          [edge.fromTriangles, from.triangles.length / 3],
          [edge.toTriangles, to.triangles.length / 3],
        ] as const) {
          expect(list.length).toBeGreaterThan(0);
          list.forEach((triangle, i) => {
            expect(Number.isInteger(triangle) && triangle >= 0 && triangle < triangleCount).toBe(true);
            if (i > 0) expect(triangle).toBeGreaterThan(list[i - 1] as number);
          });
        }
      }
      // The refined edges are new: none of them is in the Stage 2 graph.
      const sampled = new Set(input.edges.map((edge) => `${edge.from}\u0000${edge.to}\u0000${edge.dirIndex}`));
      expect(refined.filter((edge) => sampled.has(`${edge.from}\u0000${edge.to}\u0000${edge.dirIndex}`))).toEqual([]);

      // The verified plan removes every Part once and every step is clash-free.
      expect(plan.status).toBe("solved");
      expect(new Set(plan.steps.map((step) => step.partId))).toEqual(new Set(stage1.parts.map((part) => part.partId)));
      expect(plan.steps).toHaveLength(stage1.parts.length);
      expect(findFirstStepClash(stage1, plan.steps)).toBeNull();
      // Stage 3 is deterministic with verification on.
      expect(stage3Peel(stage1, stage2BuildDbg(stage1, stage1.config), stage1.config)).toEqual(plan);
    },
    TEST_TIMEOUT,
  );

  it(
    `every one of ${SWEEP_POSES} seeded rigid motions gives a solved, clash-free plan`,
    async () => {
      const poses = fc.sample(se3Arbitrary, { seed: SWEEP_SEED, numRuns: SWEEP_POSES });
      expect(poses).toHaveLength(SWEEP_POSES);
      const failures: string[] = [];
      let stepsChecked = 0;
      for (const [index, pose] of poses.entries()) {
        // Lets the Vitest worker answer its RPC calls during the long sweep.
        await yieldToEventLoop();
        const { stage1, plan } = solvePose(pose);
        const label = `pose ${index} q=${JSON.stringify(pose.quaternion)} t=${JSON.stringify(pose.translation)}`;
        if (plan.status !== "solved") {
          failures.push(`${label}: ${plan.status}`);
          continue;
        }
        if (plan.steps.length !== stage1.parts.length || new Set(plan.steps.map((step) => step.partId)).size !== stage1.parts.length) {
          failures.push(`${label}: ${plan.steps.length} steps for ${stage1.parts.length} Parts`);
          continue;
        }
        const clash = findFirstStepClash(stage1, plan.steps);
        if (clash !== null) {
          failures.push(`${label}: step ${clash.stepIndex} (${clash.partId}) has ${clash.count} collisions`);
        }
        stepsChecked += plan.steps.length;
      }
      expect(failures).toEqual([]);
      expect(stepsChecked).toBeGreaterThanOrEqual(2 * SWEEP_POSES);
    },
    SWEEP_TIMEOUT,
  );
});
