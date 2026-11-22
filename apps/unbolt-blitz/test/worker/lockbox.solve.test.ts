import { describe, expect, it } from "vitest";
import type { Mesh, Object3D } from "three";
import {
  stage0ParseScene,
  stage1Prepare,
  stage2BuildDbg,
  stage3Peel,
  stage4Compile,
} from "@unboltkit/core";
import type { StageName, SolveResult } from "../../src/protocol";
import { solveRoot } from "../../src/worker/runBlitzSolve";
import type { BlitzSolveDeps } from "../../src/worker/runBlitzSolve";
import { mulberry32, shuffle } from "../helpers/prng";
import { SEEDS } from "../helpers/seeds";
import {
  MAX_GEAR_COUNT,
  MIN_GEAR_COUNT,
  buildLockboxRoot,
  requireSolveResult,
  solvedDefaultLockboxViaRunner,
  solvedLockbox,
} from "../helpers/solved";

/**
 * Property 23: Solved kits yield consistent, normalized, playable results.
 *
 * Every expectation below is derived from the builder's scene graph, from the returned
 * Render_Data, or from an independent walk over the returned edge list. No part id, step order
 * or edge is hardcoded. The only literal count is the 13 parts that Requirement 2.4 names for
 * the default Lockbox.
 *
 * **Validates: Requirements 2.1, 2.4, 2.5, 2.7, 17.6, 17.7**
 */

const DEFAULT_GEAR_COUNT = 3;
const DEFAULT_LOCKBOX_PART_COUNT = 13;
const AXIS_COUNT = 32;
const EXTENT_TOLERANCE = 1e-9;
const STAGE_ORDER: readonly StageName[] = ["stage0", "stage1", "stage2", "stage3", "stage4"];

function countMeshNodes(root: Object3D): number {
  let count = 0;
  root.traverse((node) => {
    if ((node as Mesh).isMesh === true) count += 1;
  });
  return count;
}

/** Largest side of the union of every part's AABB. */
function unionMaxExtent(parts: SolveResult["parts"]): number {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    for (let c = 0; c < 3; c += 1) {
      min[c] = Math.min(min[c] as number, part.aabb.min[c] as number);
      max[c] = Math.max(max[c] as number, part.aabb.max[c] as number);
    }
  }
  return Math.max(...[0, 1, 2].map((c) => (max[c] as number) - (min[c] as number)));
}

/**
 * Independent dependency check. It reads only the edge list and the ordered steps. Replaying the
 * steps in order, each step's part must have a candidate axis whose every blocker (the `to` end of
 * an edge `from = part, dirIndex = axis`) is already in the removed set. It returns a list of
 * violations, empty when the order is valid.
 */
function dependencyViolations(
  edges: SolveResult["edges"],
  steps: readonly { partId: string; dirIndex: number }[],
): string[] {
  const blockers = new Map<string, Set<string>>();
  for (const edge of edges) {
    const key = `${edge.from}\u0000${edge.dirIndex}`;
    const set = blockers.get(key) ?? new Set<string>();
    set.add(edge.to);
    blockers.set(key, set);
  }
  const unremovedOn = (partId: string, axis: number, removed: ReadonlySet<string>): string[] =>
    [...(blockers.get(`${partId}\u0000${axis}`) ?? [])].filter((other) => !removed.has(other));

  const violations: string[] = [];
  const removed = new Set<string>();
  steps.forEach((step, index) => {
    if (unremovedOn(step.partId, step.dirIndex, removed).length > 0) {
      violations.push(`step ${index} (${step.partId}) is blocked along its own axis ${step.dirIndex}`);
    }
    let someAxisClear = false;
    for (let axis = 0; axis < AXIS_COUNT && !someAxisClear; axis += 1) {
      someAxisClear = unremovedOn(step.partId, axis, removed).length === 0;
    }
    if (!someAxisClear) violations.push(`step ${index} (${step.partId}) has no clear axis`);
    removed.add(step.partId);
  });
  return violations;
}

/** Runs the real five stages through `solveRoot`, recording the order in which they are called. */
function solveWithSpies(root: Object3D) {
  const calls: number[] = [];
  const events: string[] = [];
  const overrides: Partial<BlitzSolveDeps> = {
    stage0ParseScene: (...args: Parameters<typeof stage0ParseScene>) => {
      calls.push(0);
      return stage0ParseScene(...args);
    },
    stage1Prepare: (...args: Parameters<typeof stage1Prepare>) => {
      calls.push(1);
      return stage1Prepare(...args);
    },
    stage2BuildDbg: ((...args: Parameters<typeof stage2BuildDbg>) => {
      calls.push(2);
      return stage2BuildDbg(...args);
    }) as typeof stage2BuildDbg,
    stage3Peel: ((...args: Parameters<typeof stage3Peel>) => {
      calls.push(3);
      return stage3Peel(...args);
    }) as typeof stage3Peel,
    stage4Compile: (...args: Parameters<typeof stage4Compile>) => {
      calls.push(4);
      return stage4Compile(...args);
    },
    onStage: (stage, state) => {
      events.push(`${stage}:${state}`);
    },
  };
  const outcome = solveRoot(root, overrides);
  return { outcome, calls, events };
}

/** Every Property 23 assertion for one solved kit. */
function expectConsistentSolve(result: SolveResult, builderMeshCount: number): void {
  const { parts, edges, plan, trajectories } = result;

  expect(plan.status).toBe("solved");
  expect(trajectories).not.toBeNull();

  // One part per builder mesh node, with unique ids in ascending order.
  expect(parts).toHaveLength(builderMeshCount);
  const partIds = parts.map((part) => part.partId);
  expect(new Set(partIds).size).toBe(partIds.length);
  expect(partIds).toEqual([...partIds].sort());
  for (const part of parts) {
    expect(part.candidateAxes).toHaveLength(AXIS_COUNT);
  }

  // Normalized to maxExtent 1.0.
  expect(Math.abs(unionMaxExtent(parts) - 1)).toBeLessThanOrEqual(EXTENT_TOLERANCE);

  // Edges name known parts and a dirIndex in 0..31.
  const known = new Set(partIds);
  for (const edge of edges) {
    expect(known.has(edge.from)).toBe(true);
    expect(known.has(edge.to)).toBe(true);
    expect(edge.from).not.toBe(edge.to);
    expect(Number.isInteger(edge.dirIndex)).toBe(true);
    expect(edge.dirIndex).toBeGreaterThanOrEqual(0);
    expect(edge.dirIndex).toBeLessThanOrEqual(AXIS_COUNT - 1);
  }

  // Plan steps and trajectory steps each name every part exactly once.
  const planIds = plan.steps.map((step) => step.partId);
  const trajectoryIds = (trajectories ?? []).map((step) => step.partId);
  expect([...planIds].sort()).toEqual(partIds);
  expect([...trajectoryIds].sort()).toEqual(partIds);

  // Trajectories follow the plan order, and each plan direction is the part's candidate axis.
  expect(trajectoryIds).toEqual(planIds);
  const partById = new Map(parts.map((part) => [part.partId, part]));
  for (const step of plan.steps) {
    const axis = partById.get(step.partId)?.candidateAxes[step.dirIndex];
    expect(axis).toBeDefined();
    for (let c = 0; c < 3; c += 1) {
      const delta = ((axis as number[])[c] as number) - (step.dir[c] as number);
      expect(Math.abs(delta)).toBeLessThanOrEqual(1e-9);
    }
  }

  // The plan order is a valid dependency order under the returned edges.
  expect(dependencyViolations(edges, plan.steps)).toEqual([]);
}

describe("Property 23: solved Lockbox kits are consistent, normalized and playable", () => {
  it("solves every gearCount from 2 to 5 with the stages called in order 0..4", () => {
    const gearCounts: number[] = [];
    for (let g = MIN_GEAR_COUNT; g <= MAX_GEAR_COUNT; g += 1) gearCounts.push(g);
    const order = shuffle(mulberry32(SEEDS[23]), gearCounts);
    expect(new Set(order).size).toBe(gearCounts.length);

    for (const gearCount of order) {
      const root = buildLockboxRoot(gearCount);
      const meshCount = countMeshNodes(root);
      expect(meshCount).toBeGreaterThan(1);

      const { outcome, calls, events } = solveWithSpies(root);
      expect(calls).toEqual([0, 1, 2, 3, 4]);
      expect(events).toEqual(STAGE_ORDER.flatMap((stage) => [`${stage}:started`, `${stage}:completed`]));

      expectConsistentSolve(requireSolveResult(outcome), meshCount);
    }
  });

  it("returns 13 parts for the default Lockbox", () => {
    const result = requireSolveResult(solvedLockbox(DEFAULT_GEAR_COUNT));
    expect(result.parts).toHaveLength(DEFAULT_LOCKBOX_PART_COUNT);
    expect(countMeshNodes(buildLockboxRoot(DEFAULT_GEAR_COUNT))).toBe(DEFAULT_LOCKBOX_PART_COUNT);
    expectConsistentSolve(result, DEFAULT_LOCKBOX_PART_COUNT);
  });

  it("solves the bundled `lockbox` request through runBlitzSolve to the same result as solveRoot", () => {
    const viaRunner = requireSolveResult(solvedDefaultLockboxViaRunner());
    expect(viaRunner.parts).toHaveLength(DEFAULT_LOCKBOX_PART_COUNT);
    expectConsistentSolve(viaRunner, DEFAULT_LOCKBOX_PART_COUNT);

    const direct = requireSolveResult(solvedLockbox(DEFAULT_GEAR_COUNT));
    expect(viaRunner.parts.map((part) => part.partId)).toEqual(direct.parts.map((part) => part.partId));
    expect(viaRunner.edges).toEqual(direct.edges);
    expect(viaRunner.plan.steps.map((step) => [step.partId, step.dirIndex])).toEqual(
      direct.plan.steps.map((step) => [step.partId, step.dirIndex]),
    );
  });

  it("flags a reordered plan under the independent dependency check", () => {
    // Guards the checker itself: reversing a plan that has any blocking edge must be rejected.
    const result = requireSolveResult(solvedLockbox(DEFAULT_GEAR_COUNT));
    const steps = result.plan.steps.map((step) => ({ partId: step.partId, dirIndex: step.dirIndex }));
    // Some step's chosen axis has a blocker in the graph, so the plan order is not arbitrary.
    const constrainedSteps = steps.filter((step) =>
      result.edges.some((edge) => edge.from === step.partId && edge.dirIndex === step.dirIndex),
    );
    expect(constrainedSteps.length).toBeGreaterThan(0);
    expect(dependencyViolations(result.edges, steps)).toEqual([]);
    expect(dependencyViolations(result.edges, [...steps].reverse()).length).toBeGreaterThan(0);
  });
});
