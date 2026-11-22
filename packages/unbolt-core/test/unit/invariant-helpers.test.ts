import { describe, expect, it } from "vitest";
import type { PlanStep } from "../../src/types";
import { applySe3 } from "../helpers/applySe3";
import { LOCKBOX_KIT } from "../helpers/invariants";
import {
  bakeKitOf,
  buildMerged,
  buildUnmerged,
  hasCloseCrossPartVertices,
  isAccepted,
  matchIslands,
  subsetOf,
  weldDistanceOf,
} from "../helpers/mergedKit";
import { findFirstStepClash, solveStaged } from "../helpers/stagedSolve";
/**
 * The invariant harness checks itself, so a defect in a helper cannot make an invariant pass
 * vacuously: the step-clash helper must flag a plan that really clashes, the proximity check must
 * reject Parts that really touch, and the Island matcher must reject a wrong source Part.
 */
const TEST_TIMEOUT = 120_000;
function solvedLockbox() {
  const solve = solveStaged(LOCKBOX_KIT.build());
  if (solve.status !== "ok" || solve.plan.status !== "solved") {
    throw new Error("the lockbox must solve at defaults");
  }
  return { stage0: solve.stage0, stage1: solve.stage1, steps: solve.plan.steps };
}
describe("findFirstStepClash", () => {
  it(
    "accepts the solver's own plan and flags the same plan with its steps in reverse order",
    () => {
      const { stage1, steps } = solvedLockbox();
      expect(steps.length).toBeGreaterThanOrEqual(8);
      expect(findFirstStepClash(stage1, steps)).toBeNull();
      // Removing the Parts in the opposite order drags each one through the Parts that the
      // solver removed first, so at least one step must clash.
      const reversed: PlanStep[] = steps.slice().reverse();
      const clash = findFirstStepClash(stage1, reversed);
      expect(clash).not.toBeNull();
      expect(clash?.count).toBeGreaterThan(0);
      expect(clash?.movingTriangles.length).toBeGreaterThan(0);
    },
    TEST_TIMEOUT,
  );
  it(
    "flags a step that moves a Part along a direction the solver did not choose, and rejects an unknown Part_ID",
    () => {
      const { stage1, steps } = solvedLockbox();
      const first = steps[0] as PlanStep;
      const flipped: PlanStep = { ...first, dir: [0 - first.dir[0], 0 - first.dir[1], 0 - first.dir[2]] };
      const modified = [flipped, ...steps.slice(1)];
      const original = findFirstStepClash(stage1, steps);
      const changed = findFirstStepClash(stage1, modified);
      expect(original).toBeNull();
      expect(changed?.stepIndex).toBe(0);
      expect(() => findFirstStepClash(stage1, [{ ...first, partId: "/missing#0" }])).toThrow(RangeError);
    },
    TEST_TIMEOUT,
  );
});
describe("merged-mesh helpers", () => {
  const parts = bakeKitOf(LOCKBOX_KIT);
  it("bake one geometry per kit mesh, matching the Parts that Stage 0 finds", () => {
    const { stage0 } = solvedLockbox();
    expect(parts.length).toBe(stage0.parts.length);
    expect(parts.map((part) => part.name).sort()).toEqual(stage0.parts.map((part) => part.sourceNodeName).sort());
  });
  it("accepts the whole kit and rejects a subset that contains the same Part twice", () => {
    const all = subsetOf(parts, parts.map((_, i) => i));
    expect(weldDistanceOf(all)).toBeGreaterThan(0);
    expect(isAccepted(all)).toBe(true);
    const doubled = subsetOf(parts, [0, 1, 0]);
    expect(hasCloseCrossPartVertices(doubled, weldDistanceOf(doubled))).toBe(true);
    expect(isAccepted(doubled)).toBe(false);
    expect(hasCloseCrossPartVertices(all, 0)).toBe(false);
  });
  it("split a merged mesh back into the unmerged Parts, indexed or not, and reject a wrong match", () => {
    const subset = subsetOf(parts, [3, 0, 5, 1]);
    const tolerance = weldDistanceOf(subset);
    for (const indexed of [true, false]) {
      const unmerged = solveStaged(buildUnmerged(subset, indexed));
      const merged = solveStaged(buildMerged(subset, indexed));
      if (unmerged.status !== "ok" || merged.status !== "ok") {
        throw new Error(`indexed=${indexed}: expected both inputs to reach Stage 3`);
      }
      expect(merged.stage0.parts).toHaveLength(subset.length);
      const matched = matchIslands(merged.stage0.parts, unmerged.stage0.parts, tolerance);
      if (!("mapping" in matched)) {
        throw new Error(`indexed=${indexed}: ${matched.problem}`);
      }
      expect([...matched.mapping].sort()).toEqual([0, 1, 2, 3]);
      // Dropping one source Part leaves an Island with no match.
      const fewer = matchIslands(merged.stage0.parts, unmerged.stage0.parts.slice(1), tolerance);
      expect("problem" in fewer).toBe(true);
      // Merged and unmerged inputs hold the same baked float32 positions, so even a tolerance of
      // 0 must match every Island.
      expect("mapping" in matchIslands(merged.stage0.parts, unmerged.stage0.parts, 0)).toBe(true);
    }
  });
  it("bake world transforms: a transformed kit gives different vertex positions", () => {
    const moved = LOCKBOX_KIT.build();
    applySe3(moved, { quaternion: [0, 0, 0, 1], translation: [10, 0, 0] });
    const shifted = bakeKitOf({ name: "moved", build: () => moved });
    const here = parts[0]?.geometry.getAttribute("position").getX(0) as number;
    const there = shifted[0]?.geometry.getAttribute("position").getX(0) as number;
    expect(there - here).toBeCloseTo(10, 4);
  });
});
