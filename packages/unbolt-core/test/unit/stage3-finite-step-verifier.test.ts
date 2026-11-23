import { Matrix4 } from "three";
import { describe, expect, it } from "vitest";
import { createDefaultPrimitiveRegistry } from "../../src/primitives/registry";
import { checkClashes } from "../../src/oracle/clashChecker";
import { verifyLinearMove, verifyTrajectory } from "../../src/oracle/moveVerifier";
import { stage2BuildDbg } from "../../src/stage2/dbgBuilder";
import { stage3Peel } from "../../src/stage3/peelSolver";
import { createStepVerifier } from "../../src/stage3/stepVerifier";
import { stage4Compile } from "../../src/stage4/trajectoryCompiler";
import type { MoveVerdict, NormalizedPart, Vec3 } from "../../src/types";
import { boxGeometry, buildScene, pinAlongZ, plateWithSquareHole, reversedWinding, worldBox, type BuiltScene } from "../helpers/moveScenes";
import { sweptBoxOverlap, type Box } from "../helpers/reference/boxSweep";

/**
 * Solver-side finite step verification (spec crossed-bars-false-verified, slice 2).
 *
 * The step verifier receives the exact move (A, d, D, S) and reports a Blocking_Edge only for a
 * collision its own detectors find within [0, D]: Stage A rays with `eps <= t <= D`, and Stage B
 * edge sweeps against opposing faces. The expected answers come from the independent verifier
 * of slice 1 (`verifyLinearMove`, a different method) and from the expected verdict table of
 * `bugfix.md` 2.3, which reference R1 or R2 backs in `move-verifier.test.ts`.
 */
const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];
const Z: Vec3 = [0, 0, 1];

const Y_BAR = { center: [0, 0, 0] as Vec3, size: [0.2, 12, 0.2] as Vec3 };
const BACK_PLATE = { center: [-2, 0, 0] as Vec3, size: [3, 16, 16] as Vec3 };
const zBarAt = (x: number) => ({ center: [x, 0, 0] as Vec3, size: [0.2, 0.2, 9] as Vec3 });

function crossedBars(zBarX: number): BuiltScene {
  const z = zBarAt(zBarX);
  return buildScene([
    { name: "Y_bar", geometry: boxGeometry(...Y_BAR.size), position: Y_BAR.center },
    { name: "Z_bar", geometry: boxGeometry(...z.size), position: z.center },
    { name: "back_plate", geometry: boxGeometry(...BACK_PLATE.size), position: BACK_PLATE.center },
  ]);
}

interface DirectMove {
  label: string;
  scene: () => BuiltScene;
  mover: string;
  statics: string[];
  dir: Vec3;
  /** World units, or `escape` for the union-AABB escape distance of the mover along `dir`. */
  travel: number | "escape";
  expected: MoveVerdict;
}

const contactBase = { center: [0, -0.5, 0] as Vec3, size: [2, 1, 2] as Vec3 };
const blockOnBase = (block: Vec3) => () =>
  buildScene([
    { name: "base", geometry: boxGeometry(...contactBase.size), position: contactBase.center },
    { name: "block", geometry: boxGeometry(1, 1, 1), position: block },
  ]);
const nested = (reversed: boolean) => () => {
  const outer = boxGeometry(4, 4, 4);
  return buildScene([
    { name: "inner", geometry: boxGeometry(0.5, 0.5, 0.5), position: [0, 0, 0] },
    { name: "outer", geometry: reversed ? reversedWinding(outer) : outer, position: [0, 0, 0] },
  ]);
};
const overlapping = () =>
  buildScene([
    { name: "lower", geometry: boxGeometry(1, 1, 1), position: [0, 0, 0] },
    { name: "upper", geometry: boxGeometry(1, 1, 1), position: [0, 0.99995, 0] },
  ]);
const pinScene = (pin: () => ReturnType<typeof boxGeometry>) => () =>
  buildScene([
    { name: "plate", geometry: plateWithSquareHole(4, 1, 0.5), position: [0, 0, 0] },
    { name: "pin", geometry: pin(), position: [0, 0, 0] },
  ]);
const shaftAndRing = () =>
  buildScene([
    { name: "shaft", geometry: boxGeometry(0.4, 0.4, 4), position: [0, 0, 0] },
    { name: "ring", geometry: plateWithSquareHole(2, 0.6, 0.5), position: [0, 0, 0] },
  ]);

/** The direct linear moves of `bugfix.md` 2.3, with the verdict that table requires. */
const DIRECT_MOVES: DirectMove[] = [
  { label: "original failure", scene: () => crossedBars(1), mover: "Y_bar", statics: ["Z_bar", "back_plate"], dir: X, travel: 1.2, expected: "blocked" },
  { label: "fixed-distance near miss", scene: () => crossedBars(1.416), mover: "Y_bar", statics: ["Z_bar", "back_plate"], dir: X, travel: 1.2, expected: "clear" },
  { label: "longer solver-selected failure", scene: () => crossedBars(1.416), mover: "Y_bar", statics: ["Z_bar", "back_plate"], dir: X, travel: "escape", expected: "blocked" },
  { label: "boundary twin", scene: () => crossedBars(1.384), mover: "Y_bar", statics: ["Z_bar"], dir: X, travel: 1.2, expected: "blocked" },
  { label: "pass-through", scene: () => crossedBars(1), mover: "Y_bar", statics: ["Z_bar"], dir: X, travel: 1.4, expected: "blocked" },
  {
    label: "two unit cubes, the first moved +X by 1",
    scene: () =>
      buildScene([
        { name: "first", geometry: boxGeometry(1, 1, 1), position: [0, 0, 0] },
        { name: "second", geometry: boxGeometry(1, 1, 1), position: [3, 0, 0] },
      ]),
    mover: "first",
    statics: ["second"],
    dir: X,
    travel: 1,
    expected: "clear",
  },
  { label: "nested, inner moves", scene: nested(false), mover: "inner", statics: ["outer"], dir: X, travel: 0.1, expected: "unverified" },
  { label: "nested, outer moves", scene: nested(false), mover: "outer", statics: ["inner"], dir: X, travel: 0.1, expected: "unverified" },
  { label: "nested reversed, inner moves", scene: nested(true), mover: "inner", statics: ["outer"], dir: X, travel: 0.1, expected: "unverified" },
  { label: "nested reversed, outer moves", scene: nested(true), mover: "outer", statics: ["inner"], dir: X, travel: 0.1, expected: "unverified" },
  { label: "5e-5 overlap, upper slides", scene: overlapping, mover: "upper", statics: ["lower"], dir: X, travel: 0.5, expected: "unverified" },
  { label: "5e-5 overlap, lower slides", scene: overlapping, mover: "lower", statics: ["upper"], dir: X, travel: 0.5, expected: "unverified" },
  { label: "face contact while sliding", scene: blockOnBase([0, 0.5, 0]), mover: "block", statics: ["base"], dir: X, travel: 0.5, expected: "clear" },
  { label: "lift-off", scene: blockOnBase([0, 0.5, 0]), mover: "block", statics: ["base"], dir: Y, travel: 1, expected: "clear" },
  { label: "touch at the end pose", scene: blockOnBase([-2, -0.5, 0]), mover: "block", statics: ["base"], dir: X, travel: 0.5, expected: "clear" },
  { label: "real gap of 0.1 while sliding", scene: blockOnBase([0, 0.6, 0]), mover: "block", statics: ["base"], dir: X, travel: 0.5, expected: "clear" },
  { label: "wide-hole pin", scene: pinScene(() => pinAlongZ(0.3, 3, 16)), mover: "pin", statics: ["plate"], dir: Z, travel: 3, expected: "clear" },
  { label: "exact-fit pin", scene: pinScene(() => boxGeometry(1, 1, 3)), mover: "pin", statics: ["plate"], dir: Z, travel: 3, expected: "unverified" },
  { label: "ring off the end of the shaft", scene: shaftAndRing, mover: "ring", statics: ["shaft"], dir: Z, travel: 3, expected: "clear" },
  { label: "ring sideways into the shaft", scene: shaftAndRing, mover: "ring", statics: ["shaft"], dir: X, travel: 0.5, expected: "blocked" },
];

function moveDistance(scene: BuiltScene, move: DirectMove): number {
  if (move.travel !== "escape") {
    return move.travel * scene.scale;
  }
  // The union-AABB escape along +X, as `escapeDistance` computes it for the solver.
  const mover = scene.part(move.mover);
  const others = scene.stage1.parts.filter((part) => part.partId !== mover.partId);
  return Math.max(...others.map((part) => part.aabb.max[0])) - mover.aabb.min[0];
}

describe("the solver request for each slice-1 scene gives an edge exactly where the independent verdict is Blocked", () => {
  it.each(DIRECT_MOVES)("$label", (move) => {
    const scene = move.scene();
    const mover = scene.part(move.mover);
    const statics = move.statics.map((name) => scene.part(name));
    const distance = moveDistance(scene, move);
    const config = scene.stage1.config;

    const independent = verifyLinearMove(mover, move.dir, distance, statics, config);
    expect(independent.verdict).toBe(move.expected);
    const blockedIds = independent.pairs.filter((pair) => pair.verdict === "blocked").map((pair) => pair.staticPartId);

    const verifier = createStepVerifier(scene.stage1.parts, config);
    const edges = verifier.verify({
      partId: mover.partId,
      dirIndex: 0,
      dir: move.dir,
      distance,
      unremovedPartIds: statics.map((part) => part.partId).sort(),
    });
    expect(edges.map((edge) => edge.to).sort()).toEqual(blockedIds.sort());
    expect(verifier.detections.map((detection) => detection.to)).toEqual(edges.map((edge) => edge.to));
    for (const detection of verifier.detections) {
      expect(detection).toMatchObject({ from: mover.partId, dirIndex: 0, dir: move.dir, distance });
    }
  });

  it("the crossed-bars collision is found by the edge sweep, with no ray hit within the move", () => {
    const scene = crossedBars(1);
    const yBar = scene.part("Y_bar");
    const zBar = scene.part("Z_bar");
    const distance = 1.2 * scene.scale;
    // No vertex or centroid of either bar lies where the bars cross, so the legacy checker,
    // which casts rays from the same points without a bound, sees nothing.
    expect(checkClashes(yBar, X, [zBar], scene.stage1.config).count).toBe(0);
    const verifier = createStepVerifier(scene.stage1.parts, scene.stage1.config);
    const edges = verifier.verify({ partId: yBar.partId, dirIndex: 0, dir: X, distance, unremovedPartIds: [zBar.partId] });
    expect(edges.map((edge) => edge.to)).toEqual([zBar.partId]);
    expect(verifier.detections.map((detection) => detection.stage)).toEqual(["edge_sweep"]);
    const triangleCount = (part: NormalizedPart) => part.triangles.length / 3;
    for (const [list, part] of [
      [edges[0]?.fromTriangles ?? [], yBar],
      [edges[0]?.toTriangles ?? [], zBar],
    ] as const) {
      expect(list.length).toBeGreaterThan(0);
      for (const triangle of list) {
        expect(Number.isInteger(triangle) && triangle >= 0 && triangle < triangleCount(part)).toBe(true);
      }
    }
  });

  it("a legacy ray hit beyond the move is not an edge: two cubes keep 40 legacy hits and give none", () => {
    const scene = buildScene([
      { name: "first", geometry: boxGeometry(1, 1, 1), position: [0, 0, 0] },
      { name: "second", geometry: boxGeometry(1, 1, 1), position: [3, 0, 0] },
    ]);
    const first = scene.part("first");
    const second = scene.part("second");
    expect(checkClashes(first, X, [second], scene.stage1.config).count).toBe(40);
    const verifier = createStepVerifier(scene.stage1.parts, scene.stage1.config);
    const request = { partId: first.partId, dirIndex: 0, dir: X, unremovedPartIds: [second.partId] };
    expect(verifier.verify({ ...request, distance: 1 * scene.scale })).toEqual([]);
    // The same Part and direction collide once the travel reaches the second cube (gap 2 world).
    expect(verifier.verify({ ...request, distance: 2.5 * scene.scale }).map((edge) => edge.to)).toEqual([second.partId]);
    expect(verifyLinearMove(first, X, 2.5 * scene.scale, [second], scene.stage1.config).verdict).toBe("blocked");
  });

  it("rejects a distance that is not finite and non-negative", () => {
    const scene = crossedBars(1);
    const verifier = createStepVerifier(scene.stage1.parts, scene.stage1.config);
    const request = { partId: scene.part("Y_bar").partId, dirIndex: 0, dir: X, unremovedPartIds: [scene.part("Z_bar").partId] };
    for (const distance of [Number.NaN, -1e-9, Number.POSITIVE_INFINITY]) {
      expect(() => verifier.verify({ ...request, distance })).toThrow(RangeError);
    }
  });
});

describe("crossed bars end to end at the default Solver_Config", () => {
  const SCENES = [
    { label: "original scene (Z_bar at x = 1)", zBarX: 1 },
    { label: "near-miss scene (Z_bar at x = 1.416)", zBarX: 1.416 },
  ];

  it.each(SCENES)("$label: solved, no step Blocked, R1 agrees, and no sampled pose interpenetrates", ({ zBarX }) => {
    const scene = crossedBars(zBarX);
    const stage1 = scene.stage1;
    const plan = stage3Peel(stage1, stage2BuildDbg(stage1, stage1.config), stage1.config);
    expect(plan.status).toBe("solved");
    expect(new Set(plan.steps.map((step) => step.partId))).toEqual(new Set(stage1.parts.map((part) => part.partId)));

    const z = zBarAt(zBarX);
    const worldBoxes: Record<string, Box> = {
      Y_bar: worldBox(Y_BAR.center, Y_BAR.size),
      Z_bar: worldBox(z.center, z.size),
      back_plate: worldBox(BACK_PLATE.center, BACK_PLATE.size),
    };
    const byId = new Map(stage1.parts.map((part) => [part.partId, part]));
    const boxOf = (part: NormalizedPart): Box => scene.normalizeBox(worldBoxes[part.sourceNodeName] as Box);

    plan.steps.forEach((step, index) => {
      const moving = byId.get(step.partId) as NormalizedPart;
      const later = plan.steps.slice(index + 1).map((next) => byId.get(next.partId) as NormalizedPart);
      // Independent verifier: the exact solver move is never Blocked.
      const independent = verifyLinearMove(moving, step.dir, step.escapeDistance, later, stage1.config);
      expect(independent.verdict, `step ${index} ${moving.sourceNodeName}`).not.toBe("blocked");
      // R1: the swept box never enters a later box (touching, overlap 0, is allowed).
      for (const fixed of later) {
        expect(sweptBoxOverlap(boxOf(moving), step.dir, step.escapeDistance, boxOf(fixed)), `step ${index} ${moving.sourceNodeName} vs ${fixed.sourceNodeName}`).toBeLessThanOrEqual(1e-12);
      }
    });

    const compiled = stage4Compile(plan, stage1, stage1.config);
    if (!compiled.ok) {
      throw new Error(`stage 4 failed: ${compiled.error.message}`);
    }
    expect(verifyTrajectory(stage1.parts, compiled.steps, stage1.config).verdict).not.toBe("blocked");

    // The probe's own check: no sampled interior pose of a compiled step meets a later Part.
    const registry = createDefaultPrimitiveRegistry();
    const intersections: string[] = [];
    compiled.steps.forEach((trajectory, index) => {
      const moving = byId.get(trajectory.partId) as NormalizedPart;
      const primitive = registry.get(trajectory.primitive);
      if (!primitive.ok) {
        throw new Error(`missing primitive ${trajectory.primitive}`);
      }
      const later = compiled.steps.slice(index + 1).map((next) => byId.get(next.partId) as NormalizedPart);
      for (const t of [0.25, 0.5, 0.75, 5 / 6]) {
        const { rotation: r, translation: u } = primitive.value.pose(t, trajectory.params);
        const m = (i: number) => r[i] as number;
        const pose = new Matrix4().set(m(0), m(1), m(2), u[0], m(3), m(4), m(5), u[1], m(6), m(7), m(8), u[2], 0, 0, 0, 1);
        for (const fixed of later) {
          if (fixed.bvh.intersectsGeometry(moving.bvh.geometry, pose)) {
            intersections.push(`step ${index} ${moving.sourceNodeName} meets ${fixed.sourceNodeName} at t = ${t}`);
          }
        }
      }
    });
    expect(intersections).toEqual([]);
  });
});
