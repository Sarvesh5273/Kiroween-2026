import {
  buildDeadlockCageDumbbellRing,
  buildDeadlockCageShipInBottle,
  buildHauntedClockworkLockbox,
  buildMechanicalKeyboard65,
  buildPlanetaryGearbox3Stage,
  KEYBOARD_FIXTURE_LAYOUT,
} from "@unboltkit/sample-kits";
import fc from "fast-check";
import { Quaternion, Vector3, type Group } from "three";
import { DEFAULT_SOLVER_CONFIG } from "../../src/config";
import { checkClashes } from "../../src/oracle/clashChecker";
import type { NormalizedPart, Vec3 } from "../../src/types";
import type { Se3Transform } from "../arbitraries/se3";
import { applySe3 } from "./applySe3";
import { describeDomain, failWith, type DomainContext } from "./failWith";
import { findFirstStepClash, solveStaged, type StagedSolve } from "./stagedSolve";
/**
 * Shared bodies of the Invariant 1, 2 and 3 properties (Properties 34 to 36). Each property file
 * keeps its own `fc.assert`, literal seed and run count, and calls one function from here, so the
 * 14 invariant files differ only in the kit, the seed and the run count.
 *
 * Solver errors are never caught here: a thrown error reaches `fast-check`, which reports it
 * with the seed and the counterexample (Req 25.7, 27.6).
 */
export interface InvariantKit {
  /** Label used in failure reports. */
  readonly name: string;
  /** Builds a fresh instance with the kit's parameters. */
  readonly build: () => Group;
}
export const LOCKBOX_KIT: InvariantKit = { name: "haunted-clockwork-lockbox", build: () => buildHauntedClockworkLockbox() };
export const GEARBOX_KIT: InvariantKit = { name: "planetary-gearbox-3-stage", build: () => buildPlanetaryGearbox3Stage() };
export const KEYBOARD_FIXTURE_KIT: InvariantKit = {
  name: "keyboard-fixture",
  build: () => buildMechanicalKeyboard65({ layout: KEYBOARD_FIXTURE_LAYOUT }),
};
export const FULL_KEYBOARD_KIT: InvariantKit = { name: "mechanical-keyboard-65", build: () => buildMechanicalKeyboard65() };
export const DUMBBELL_RING_KIT: InvariantKit = { name: "deadlock-cage-dumbbell-ring", build: () => buildDeadlockCageDumbbellRing() };
export const SHIP_IN_BOTTLE_KIT: InvariantKit = { name: "deadlock-cage-ship-in-bottle", build: () => buildDeadlockCageShipInBottle() };
/** A generated Solver_Config seed: any integer in `[0, 4294967295]` (Req 26.2, 28.1). */
export const configSeedArbitrary: fc.Arbitrary<number> = fc.integer({ min: 0, max: 4294967295 });
/** Counters that a property file asserts on after `fc.assert`, to rule out a vacuous pass. */
export interface InvariantTally {
  runs: number;
  /** Plan_Steps that were checked against the Clash_Checker. */
  stepsChecked: number;
  /** Parts or witness edges that were compared. */
  itemsChecked: number;
}
export function newTally(): InvariantTally {
  return { runs: 0, stepsChecked: 0, itemsChecked: 0 };
}
function transformDomain(kit: InvariantKit, transform: Se3Transform, configSeed: number): DomainContext {
  return { kit: kit.name, configSeed, quaternion: transform.quaternion, translation: transform.translation };
}
function describeError(solve: Extract<StagedSolve, { status: "error" }>): DomainContext {
  return { status: "error", errorKind: solve.plan.error.kind, errorMessage: solve.plan.error.message };
}
function rotationOf(transform: Se3Transform): Quaternion {
  const [x, y, z, w] = transform.quaternion;
  return new Quaternion(x, y, z, w);
}
// ---------------------------------------------------------------------------
// Invariant 1 (Property 34)
// ---------------------------------------------------------------------------
/**
 * Req 26.1 to 26.4. Solves a fresh `kit` under `transform` with a Solver_Config whose seed is
 * `configSeed` and every other field at its default. The plan must be `solved` with one step per
 * Part, and every step must be clash-free against exactly the Parts of the later steps.
 */
export function verifyInvariant1(kit: InvariantKit, transform: Se3Transform, configSeed: number, ctx: fc.ContextValue, tally: InvariantTally): void {
  const domain = transformDomain(kit, transform, configSeed);
  const root = kit.build();
  applySe3(root, transform);
  const solve = solveStaged(root, { seed: configSeed });
  if (solve.status === "error") {
    failWith(ctx, { ...domain, ...describeError(solve) }, "Invariant 1: the solve returned an error result");
  }
  const { stage1, plan } = solve;
  if (plan.status !== "solved") {
    failWith(ctx, { ...domain, status: plan.status }, "Invariant 1: the plan is not solved");
  }
  const resolved: Record<string, number> = { ...stage1.config };
  const usesDefaults = Object.entries(DEFAULT_SOLVER_CONFIG).every(([key, value]) => resolved[key] === (key === "seed" ? configSeed : value));
  if (!usesDefaults) {
    failWith(ctx, { ...domain, resolvedConfig: stage1.config }, "Invariant 1: the solve did not use the generated seed with every other field at its default");
  }
  const stepIds = plan.steps.map((step) => step.partId);
  const partIds = stage1.parts.map((part) => part.partId);
  if (stepIds.length !== partIds.length || new Set(stepIds).size !== stepIds.length) {
    failWith(ctx, { ...domain, stepCount: stepIds.length, partCount: partIds.length }, "Invariant 1: expected exactly one Plan_Step per Part");
  }
  const known = new Set(partIds);
  const unknown = stepIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    failWith(ctx, { ...domain, unknownPartIds: unknown }, "Invariant 1: a Plan_Step names a Part that is not in the Assembly");
  }
  const clash = findFirstStepClash(stage1, plan.steps);
  if (clash !== null) {
    failWith(
      ctx,
      {
        ...domain,
        stepIndex: clash.stepIndex,
        partId: clash.partId,
        dir: clash.dir,
        clashCount: clash.count,
        movingTriangles: clash.movingTriangles,
        staticTriangles: clash.staticTriangles,
      },
      "Invariant 1: a Plan_Step is not clash-free against the Parts of the later steps",
    );
  }
  tally.runs += 1;
  tally.stepsChecked += plan.steps.length;
  tally.itemsChecked += partIds.length;
}
// ---------------------------------------------------------------------------
// Invariant 2 (Property 35)
// ---------------------------------------------------------------------------
/** The untransformed solve of a kit, shared by every run of one Invariant 2 property. */
export type Baseline = Extract<StagedSolve, { status: "ok" }>;
/**
 * Memoizes the untransformed solve of `kit` for `configSeed`. The property fixes the config seed
 * and draws only the SE3_Transform, so this solve is the same in every run (Req 3.3, design
 * mitigation 6). It is computed on first use.
 */
export function createBaseline(kit: InvariantKit, configSeed: number): () => Baseline {
  let cached: Baseline | null = null;
  return () => {
    if (cached === null) {
      const solve = solveStaged(kit.build(), { seed: configSeed });
      if (solve.status === "error") {
        throw new Error(`Invariant 2: the untransformed solve returned an error result\n${describeDomain({ kit: kit.name, configSeed, ...describeError(solve) })}`);
      }
      cached = solve;
    }
    return cached;
  };
}
/** Largest per-component difference allowed between `R·a` and a transformed axis (Req 27.8). */
export const AXIS_TOLERANCE = 1e-6;
/** Candidate_Axes 26 to 31: the signed PCA_Axes. The other 26 are fixed world directions. */
const FIRST_PCA_AXIS = 26;
const AXIS_COUNT = 32;
/**
 * Req 27.2 to 27.8. A fresh instance with `transform` composed onto its root is solved with the
 * same Solver_Config as the memoized untransformed instance. Status must match. When the
 * untransformed plan is solved, the transformed plan has the same step count and Part_ID set and
 * is clash-free against the Parts not yet removed. For every Part, Candidate_Axes 26 to 31 equal
 * `R` times those of the same Part_ID in the untransformed solve within `1e-6`.
 */
export function verifyInvariant2(
  kit: InvariantKit,
  baseline: Baseline,
  transform: Se3Transform,
  configSeed: number,
  ctx: fc.ContextValue,
  tally: InvariantTally,
): void {
  const domain = transformDomain(kit, transform, configSeed);
  const root = kit.build();
  applySe3(root, transform);
  const solve = solveStaged(root, { seed: configSeed });
  if (solve.status === "error") {
    failWith(ctx, { ...domain, ...describeError(solve) }, "Invariant 2: the transformed solve returned an error result");
  }
  const { stage1, plan } = solve;
  if (plan.status !== baseline.plan.status) {
    failWith(ctx, { ...domain, transformedStatus: plan.status, untransformedStatus: baseline.plan.status }, "Invariant 2: the status changed under a rigid motion");
  }
  const baselineIds = baseline.stage1.parts.map((part) => part.partId);
  const transformedIds = stage1.parts.map((part) => part.partId);
  if (JSON.stringify(baselineIds) !== JSON.stringify(transformedIds)) {
    failWith(ctx, { ...domain, untransformedPartIds: baselineIds, transformedPartIds: transformedIds }, "Invariant 2: the Part_IDs changed under a rigid motion");
  }
  if (baseline.plan.status === "solved" && plan.status === "solved") {
    const stepIds = plan.steps.map((step) => step.partId);
    const expectedIds = baseline.plan.steps.map((step) => step.partId);
    if (stepIds.length !== expectedIds.length) {
      failWith(ctx, { ...domain, transformedSteps: stepIds.length, untransformedSteps: expectedIds.length }, "Invariant 2: the step count changed under a rigid motion");
    }
    const counts = new Map<string, number>();
    for (const id of stepIds) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const wrong = expectedIds.filter((id) => counts.get(id) !== 1);
    if (wrong.length > 0) {
      failWith(ctx, { ...domain, partIdsNotExactlyOnce: wrong }, "Invariant 2: a Part_ID of the untransformed plan is not in the transformed plan exactly once");
    }
    const clash = findFirstStepClash(stage1, plan.steps);
    if (clash !== null) {
      failWith(
        ctx,
        {
          ...domain,
          stepIndex: clash.stepIndex,
          partId: clash.partId,
          dir: clash.dir,
          clashCount: clash.count,
          movingTriangles: clash.movingTriangles,
          staticTriangles: clash.staticTriangles,
        },
        "Invariant 2: a transformed Plan_Step is not clash-free against the Parts not yet removed",
      );
    }
    tally.stepsChecked += plan.steps.length;
  }
  const rotation = rotationOf(transform);
  const baselineById = new Map(baseline.stage1.parts.map((part) => [part.partId, part]));
  for (const part of stage1.parts) {
    const source = baselineById.get(part.partId);
    if (source === undefined) {
      failWith(ctx, { ...domain, partId: part.partId }, "Invariant 2: a transformed Part has no untransformed counterpart");
    }
    expectEquivariantAxes(part, source, rotation, ctx, domain);
    tally.itemsChecked += 1;
  }
  tally.runs += 1;
}
function expectEquivariantAxes(transformed: NormalizedPart, untransformed: NormalizedPart, rotation: Quaternion, ctx: fc.ContextValue, domain: DomainContext): void {
  if (transformed.candidateAxes.length !== AXIS_COUNT || untransformed.candidateAxes.length !== AXIS_COUNT) {
    failWith(ctx, { ...domain, partId: transformed.partId, axisCount: transformed.candidateAxes.length }, "Invariant 2: a Part does not have 32 Candidate_Axes");
  }
  for (let index = FIRST_PCA_AXIS; index < AXIS_COUNT; index++) {
    const axis = untransformed.candidateAxes[index] as Vec3;
    const expected = new Vector3(axis[0], axis[1], axis[2]).applyQuaternion(rotation);
    const actual = transformed.candidateAxes[index] as Vec3;
    const error = Math.max(Math.abs(actual[0] - expected.x), Math.abs(actual[1] - expected.y), Math.abs(actual[2] - expected.z));
    if (!(error <= AXIS_TOLERANCE)) {
      failWith(
        ctx,
        { ...domain, partId: transformed.partId, axisIndex: index, expected: [expected.x, expected.y, expected.z], actual, maxComponentError: error },
        "Invariant 2: a signed PCA axis is not R times the untransformed axis",
      );
    }
  }
}
// ---------------------------------------------------------------------------
// Invariant 3 (Property 36)
// ---------------------------------------------------------------------------
/** Largest per-component difference between a witness `dir` and a Candidate_Axis (Req 28.6). */
export const WITNESS_DIRECTION_TOLERANCE = 1e-9;
/**
 * Req 28.1 to 28.6. A cage under `transform` and a generated config seed must be `deadlocked`
 * with 0 steps. The witness has an SCC of at least 2 Assembly Parts, and each witness edge
 * `(A, B, d)` lies inside one SCC, uses one of A's Candidate_Axes, lists non-empty, ascending,
 * duplicate-free, in-range triangles, and clashes when A moves along `d` against B alone.
 */
export function verifyInvariant3(kit: InvariantKit, transform: Se3Transform, configSeed: number, ctx: fc.ContextValue, tally: InvariantTally): void {
  const domain = transformDomain(kit, transform, configSeed);
  const root = kit.build();
  applySe3(root, transform);
  const solve = solveStaged(root, { seed: configSeed });
  if (solve.status === "error") {
    failWith(ctx, { ...domain, ...describeError(solve) }, "Invariant 3: the solve returned an error result");
  }
  const { stage1, plan } = solve;
  if (plan.status !== "deadlocked") {
    failWith(ctx, { ...domain, status: plan.status, steps: plan.steps.length }, "Invariant 3: the cage is not reported as deadlocked");
  }
  if (plan.steps.length !== 0) {
    failWith(ctx, { ...domain, steps: plan.steps.length }, "Invariant 3: a deadlocked plan has Plan_Steps");
  }
  const partById = new Map(stage1.parts.map((part) => [part.partId, part]));
  const { sccs } = plan.witness;
  if (!sccs.some((scc) => new Set(scc.partIds).size >= 2)) {
    failWith(ctx, { ...domain, sccs: sccs.map((scc) => scc.partIds) }, "Invariant 3: the witness has no SCC of at least 2 distinct Parts");
  }
  for (const scc of sccs) {
    const members = new Set(scc.partIds);
    const foreign = scc.partIds.filter((id) => !partById.has(id));
    if (foreign.length > 0) {
      failWith(ctx, { ...domain, foreignPartIds: foreign }, "Invariant 3: an SCC lists a Part_ID that is not in the Assembly");
    }
    for (const edge of scc.edges) {
      const edgeDomain = { ...domain, from: edge.from, to: edge.to, dir: edge.dir, dirIndex: edge.dirIndex };
      const from = partById.get(edge.from);
      const to = partById.get(edge.to);
      if (from === undefined || to === undefined || !members.has(edge.from) || !members.has(edge.to)) {
        failWith(ctx, { ...edgeDomain, sccPartIds: scc.partIds }, "Invariant 3: a witness edge has an endpoint outside its SCC");
      }
      const matchesAxis = from.candidateAxes.some((axis) => axis.every((component, k) => Math.abs(component - (edge.dir[k] as number)) <= WITNESS_DIRECTION_TOLERANCE));
      if (!matchesAxis) {
        failWith(ctx, edgeDomain, "Invariant 3: a witness direction is not one of the Candidate_Axes of its source Part");
      }
      expectTriangleList(edge.fromTriangles, from.triangles.length / 3, "fromTriangles", ctx, edgeDomain);
      expectTriangleList(edge.toTriangles, to.triangles.length / 3, "toTriangles", ctx, edgeDomain);
      const result = checkClashes(from, edge.dir, [to], stage1.config);
      if (result.count < 1) {
        failWith(ctx, { ...edgeDomain, clashCount: result.count }, "Invariant 3: the Clash_Checker reports no collision for a witness edge");
      }
      tally.itemsChecked += 1;
    }
  }
  tally.runs += 1;
}
function expectTriangleList(list: readonly number[], triangleCount: number, label: string, ctx: fc.ContextValue, domain: DomainContext): void {
  if (list.length === 0) {
    failWith(ctx, { ...domain, label }, "Invariant 3: a witness triangle list is empty");
  }
  for (let i = 0; i < list.length; i++) {
    const value = list[i] as number;
    const inRange = Number.isInteger(value) && value >= 0 && value < triangleCount;
    const ascending = i === 0 || value > (list[i - 1] as number);
    if (!inRange || !ascending) {
      failWith(ctx, { ...domain, label, triangleCount, list }, "Invariant 3: a witness triangle list is not ascending, duplicate-free and in range");
    }
  }
}
