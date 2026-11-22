/**
 * Property 17: Worker pipeline fidelity on real kits.
 *
 * Feature: guide-forge-part-1, Property 17.
 * **Validates: Requirements 5.1, 5.2, 5.5, 5.7, 5.8, 9.3, 17.6**
 *
 * The domain is finite, so it is enumerated and not sampled. Part A runs the five bundled kits by
 * name, the way the app does. Part B runs every other parameter value of the parameterised
 * builders (gearbox 3..6, lockbox 2..5, ship-in-bottle 1..3, and the corner grids of the keyboard
 * layout range) through the `scene` source, because `buildKit(name)` only builds default
 * parameters. There is no randomness anywhere in this file.
 *
 * Every assertion reads a property of the real result: plan equality with Core, event order,
 * oracle sums, graph structure of the witness, unit-length directions and the normalized bound.
 * Nothing names a part id, a bounding box or a step order.
 */
import { describe, expect, it } from "vitest";
import { solveDisassembly, type DisassemblyPlan } from "@unboltkit/core";
import {
  buildDeadlockCageDumbbellRing,
  buildDeadlockCageShipInBottle,
  buildHauntedClockworkLockbox,
  buildMechanicalKeyboard65,
  buildPlanetaryGearbox3Stage,
} from "@unboltkit/sample-kits";
import type { Group } from "three";
import { DEADLOCK_CAGE_NAMES, KIT_NAMES, SHOWCASE_KIT_NAMES } from "../../src/kits";
import type { SolveRequestMessage, SolveResult, StageName, StageProgressEvent } from "../../src/protocol";
import { objectToPayload, payloadToObject } from "../../src/scene/scenePayload";
import { buildKit } from "../../src/worker/buildKit";
import { runSolve } from "../../src/worker/solvePipeline";

/** Float32 render positions of a unit-extent assembly. */
const EPSILON = 1e-5;

const SOLVED_STAGE_ORDER: readonly StageName[] = ["stage0", "stage1", "stage2", "stage3", "stage4", "oracle", "naive"];
const DEADLOCKED_STAGE_ORDER: readonly StageName[] = ["stage0", "stage1", "stage2", "stage3", "naive"];

interface SolveRun {
  result: SolveResult;
  events: StageProgressEvent[];
  elapsedMs: number;
}

function solveWithRecording(request: SolveRequestMessage): SolveRun {
  const events: StageProgressEvent[] = [];
  const start = performance.now();
  const result = runSolve(request, {
    onProgress: (event) => {
      events.push({ ...event });
    },
  });
  return { result, events, elapsedMs: performance.now() - start };
}

function sameIds(a: Iterable<string>, b: Iterable<string>): boolean {
  const left = [...a].sort();
  const right = [...b].sort();
  return left.length === right.length && left.every((id, i) => id === right[i]);
}

function normOf(v: readonly number[]): number {
  return Math.hypot(v[0] ?? Number.NaN, v[1] ?? Number.NaN, v[2] ?? Number.NaN);
}

/** Requirement 5.5 and 5.7: events pair up per executed stage, in pipeline order. */
function expectEventOrder(events: readonly StageProgressEvent[], plan: DisassemblyPlan): void {
  const order = plan.status === "solved" ? SOLVED_STAGE_ORDER : DEADLOCKED_STAGE_ORDER;
  expect(events.map((e) => `${e.stage}:${e.state}`)).toEqual(
    order.flatMap((stage) => [`${stage}:started`, `${stage}:completed`]),
  );

  let previousElapsed = -Infinity;
  for (let i = 0; i < events.length; i += 2) {
    const started = events[i];
    const completed = events[i + 1];
    expect(started).toBeDefined();
    expect(completed).toBeDefined();
    if (started === undefined || completed === undefined) return;
    expect(started.durationMs).toBeNull();
    expect(completed.durationMs).not.toBeNull();
    expect(completed.durationMs ?? -1).toBeGreaterThanOrEqual(0);
    expect(started.elapsedMs).toBeGreaterThanOrEqual(previousElapsed);
    expect(completed.elapsedMs).toBeGreaterThanOrEqual(started.elapsedMs);
    previousElapsed = completed.elapsedMs;
  }
}

/** The render parts lie in the normalized frame (D3): union extent <= 1, every coordinate within +-0.5. */
function expectNormalizedRenderParts(result: SolveResult): void {
  expect(result.parts.length).toBeGreaterThan(0);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const part of result.parts) {
    expect(part.positions.length % 3).toBe(0);
    expect(part.positions.length).toBeGreaterThan(0);
    for (let i = 0; i < part.positions.length; i++) {
      const value = part.positions[i] ?? Number.NaN;
      expect(Number.isFinite(value)).toBe(true);
      const axis = i % 3;
      min[axis] = Math.min(min[axis] ?? Infinity, value);
      max[axis] = Math.max(max[axis] ?? -Infinity, value);
    }
  }
  const extents = [0, 1, 2].map((k) => (max[k] ?? 0) - (min[k] ?? 0));
  const maxExtent = Math.max(...extents);
  expect(maxExtent).toBeLessThanOrEqual(1 + EPSILON);
  // Normalization sets maxExtent to 1, so the render parts must realise it (not shrink to nothing).
  expect(Math.abs(maxExtent - 1)).toBeLessThanOrEqual(EPSILON);
  for (let k = 0; k < 3; k++) {
    expect(Math.abs(min[k] ?? Infinity)).toBeLessThanOrEqual(0.5 + EPSILON);
    expect(Math.abs(max[k] ?? Infinity)).toBeLessThanOrEqual(0.5 + EPSILON);
  }
}

/** Naive report covers exactly the plan's parts, with unit directions. */
function expectNaive(result: SolveResult, partIds: readonly string[]): void {
  const naive = result.naive;
  expect(naive).not.toBeNull();
  if (naive === null) return;
  const covered = naive.perPart.map((p) => p.partId);
  expect(new Set(covered).size).toBe(covered.length);
  expect(sameIds(covered, partIds)).toBe(true);
  let sum = 0;
  for (const entry of naive.perPart) {
    expect(Math.abs(normOf(entry.direction) - 1)).toBeLessThanOrEqual(1e-9);
    expect(Number.isInteger(entry.clashCount)).toBe(true);
    expect(entry.clashCount).toBeGreaterThanOrEqual(0);
    for (const clash of entry.clashes) {
      expect(clash.obstructingPartId).not.toBe(entry.partId);
      expect(partIds).toContain(clash.obstructingPartId);
    }
    sum += entry.clashCount;
  }
  expect(naive.totalClashes).toBe(sum);
}

function expectSolved(run: SolveRun, expectedPlan: DisassemblyPlan): void {
  const { result, events } = run;
  const plan = result.plan;
  expect(plan.status).toBe("solved");
  if (plan.status !== "solved") return;

  expect(plan).toEqual(expectedPlan);
  expectEventOrder(events, plan);

  const renderIds = result.parts.map((p) => p.partId);
  const stepIds = plan.steps.map((s) => s.partId);
  expect(new Set(stepIds).size).toBe(stepIds.length);
  // A solved plan removes every part exactly once.
  expect(sameIds(stepIds, renderIds)).toBe(true);
  for (const step of plan.steps) {
    expect(Math.abs(normOf(step.dir) - 1)).toBeLessThanOrEqual(1e-9);
    expect(Number.isFinite(step.escapeDistance)).toBe(true);
    // The last step has no later part to clear, so its distance may be 0.
    expect(step.escapeDistance).toBeGreaterThanOrEqual(0);
  }

  // Requirement 5.2 and 9.3: trajectory and oracle line up with the steps.
  expect(result.trajectory).not.toBeNull();
  expect(result.trajectory?.length).toBe(plan.steps.length);
  expect(result.trajectory?.map((t) => t.partId)).toEqual(stepIds);

  expect(result.oracle).not.toBeNull();
  const oracle = result.oracle;
  if (oracle !== null) {
    expect(oracle.perStep.map((s) => s.partId)).toEqual(stepIds);
    const sum = oracle.perStep.reduce((acc, s) => acc + s.clashCount, 0);
    expect(oracle.totalClashes).toBe(sum);
    // A real geometric property: the independent oracle finds no clash along any step.
    expect(oracle.totalClashes).toBe(0);
  }

  expectNaive(result, stepIds);
  expectNormalizedRenderParts(result);

  // Stage timings exist exactly for the executed stages.
  expect(Object.keys(result.timings.stageMs).sort()).toEqual([...SOLVED_STAGE_ORDER].sort());
}

function expectDeadlocked(run: SolveRun, expectedPlan: DisassemblyPlan): void {
  const { result, events } = run;
  const plan = result.plan;
  expect(plan.status).toBe("deadlocked");
  if (plan.status !== "deadlocked") return;

  expect(plan).toEqual(expectedPlan);
  expectEventOrder(events, plan);
  expect(events.some((e) => e.stage === "stage4" || e.stage === "oracle")).toBe(false);
  expect(result.trajectory).toBeNull();
  expect(result.oracle).toBeNull();

  const renderIds = result.parts.map((p) => p.partId);
  const renderSet = new Set(renderIds);
  expect(renderSet.size).toBe(renderIds.length);

  // Peeled steps: distinct parts of the assembly.
  const peeled = plan.steps.map((s) => s.partId);
  expect(new Set(peeled).size).toBe(peeled.length);
  for (const id of peeled) expect(renderSet.has(id)).toBe(true);

  // `unassignedPartIds` are the unremoved parts that are in no witness SCC (Core sccAnalyzer).
  const unassigned = plan.witness.unassignedPartIds;
  expect(new Set(unassigned).size).toBe(unassigned.length);
  for (const id of unassigned) {
    expect(renderSet.has(id)).toBe(true);
    expect(peeled).not.toContain(id);
  }

  // SCC structure.
  const sccs = plan.witness.sccs;
  expect(sccs.length).toBeGreaterThan(0);
  const seen = new Set<string>();
  for (const scc of sccs) {
    expect(scc.partIds.length).toBeGreaterThanOrEqual(2);
    const members = new Set(scc.partIds);
    expect(members.size).toBe(scc.partIds.length);
    for (const id of scc.partIds) {
      expect(renderSet.has(id)).toBe(true);
      expect(peeled).not.toContain(id);
      expect(unassigned).not.toContain(id);
      // Pairwise disjoint: no part belongs to two SCCs.
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(scc.edges.length).toBeGreaterThan(0);
    for (const edge of scc.edges) {
      expect(members.has(edge.from)).toBe(true);
      expect(members.has(edge.to)).toBe(true);
      expect(edge.from).not.toBe(edge.to);
      expect(Math.abs(normOf(edge.dir) - 1)).toBeLessThanOrEqual(1e-9);
    }
  }

  // Peeled parts, SCC members and the other unassigned parts partition the assembly.
  expect(sameIds([...peeled, ...seen, ...unassigned], renderIds)).toBe(true);

  expectNaive(result, renderIds);
  expectNormalizedRenderParts(result);
  expect(Object.keys(result.timings.stageMs).sort()).toEqual([...DEADLOCKED_STAGE_ORDER].sort());
}

function verify(run: SolveRun, expected: DisassemblyPlan, expectStatus: "solved" | "deadlocked" | null): void {
  if (expectStatus !== null) expect(run.result.plan.status).toBe(expectStatus);
  expect(run.result.plan.status).not.toBe("error");
  if (run.result.plan.status === "solved") expectSolved(run, expected);
  else expectDeadlocked(run, expected);
}

describe("Property 17: worker pipeline fidelity on real kits", () => {
  describe("bundled kits, solved through the kit-name source", () => {
    for (const kitName of KIT_NAMES) {
      it(`${kitName}`, () => {
        const request: SolveRequestMessage = { type: "solve", requestId: 1, source: { kind: "kit", kitName } };
        const run = solveWithRecording(request);
        const expectedPlan = solveDisassembly(buildKit(kitName));
        const group = (SHOWCASE_KIT_NAMES as readonly string[]).includes(kitName) ? "solved" : "deadlocked";
        expect((DEADLOCK_CAGE_NAMES as readonly string[]).includes(kitName)).toBe(group === "deadlocked");
        verify(run, expectedPlan, group);
        console.info(
          `[worker-pipeline-fidelity] ${kitName}: status=${run.result.plan.status} steps=${run.result.plan.status === "error" ? 0 : run.result.plan.steps.length} parts=${run.result.parts.length} elapsed=${Math.round(run.elapsedMs)}ms stages=${JSON.stringify(
            Object.fromEntries(Object.entries(run.result.timings.stageMs).map(([k, v]) => [k, Math.round(v)])),
          )}`,
        );
      });
    }
  });

  describe("kit parameter domain, solved through the scene source", () => {
    interface Variant {
      label: string;
      build: () => Group;
    }
    const variants: Variant[] = [];
    // The default value of each parameter is the bundled kit of the block above, so it is skipped.
    for (let planetsPerStage = 4; planetsPerStage <= 6; planetsPerStage++) {
      variants.push({ label: `gearbox planetsPerStage=${planetsPerStage}`, build: () => buildPlanetaryGearbox3Stage({ planetsPerStage }) });
    }
    for (const gearCount of [2, 4, 5]) {
      variants.push({ label: `lockbox gearCount=${gearCount}`, build: () => buildHauntedClockworkLockbox({ gearCount }) });
    }
    for (const ballCount of [1, 3]) {
      variants.push({ label: `ship-in-bottle ballCount=${ballCount}`, build: () => buildDeadlockCageShipInBottle({ ballCount }) });
    }
    for (const rows of [1, 5]) {
      for (const columns of [1, 15]) {
        variants.push({
          label: `keyboard grid ${rows}x${columns}`,
          build: () => buildMechanicalKeyboard65({ layout: { rows, columns } }),
        });
      }
    }
    // The dumbbell-and-ring cage has no parameters; one extra build confirms the builder is repeatable.
    variants.push({ label: "dumbbell-ring (no params)", build: () => buildDeadlockCageDumbbellRing({}) });

    for (const variant of variants) {
      it(variant.label, () => {
        const payload = objectToPayload(variant.build());
        const request: SolveRequestMessage = {
          type: "solve",
          requestId: 2,
          source: { kind: "scene", fileName: `${variant.label}.glb`, scene: { root: payload.root, meshCount: payload.meshCount } },
        };
        const run = solveWithRecording(request);
        // Core's answer for the same input the worker rebuilds from the payload. A fresh payload
        // keeps the two runs from sharing buffers. (Rebuilding turns `Group` nodes into `Object3D`,
        // which only shows in the diagnostics text, so the direct builder tree is not comparable.)
        const expectedPlan = solveDisassembly(payloadToObject(objectToPayload(variant.build()).root));
        verify(run, expectedPlan, null);
        console.info(
          `[worker-pipeline-fidelity] ${variant.label}: status=${run.result.plan.status} parts=${run.result.parts.length} elapsed=${Math.round(run.elapsedMs)}ms`,
        );
      });
    }
  });
});
