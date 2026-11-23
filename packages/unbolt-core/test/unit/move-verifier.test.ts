import { describe, expect, it } from "vitest";
import {
  InvalidDirectionError,
  InvalidMoveDistanceError,
  InvalidTrajectoryError,
  MovingPartInStaticSetError,
  checkClashes,
  combineVerdicts,
  stage2BuildDbg,
  stage3Peel,
  stage4Compile,
  verifyLinearMove,
  verifyTrajectory,
} from "../../src/index";
import type { MoveVerdict, NormalizedPart, TrajectoryStep, Vec3 } from "../../src/types";
import {
  boxGeometry,
  buildScene,
  pinAlongZ,
  plateBars,
  plateWithSquareHole,
  reversedWinding,
  worldBox,
  type BuiltScene,
} from "../helpers/moveScenes";
import { boxDepth, boxStrictlyInside, sweptBoxOverlap, translatedBox, type Box } from "../helpers/reference/boxSweep";
import { radialClearance } from "../helpers/reference/pinClearance";

/**
 * Finite straight-move verifier (spec crossed-bars-false-verified, design "Independent move
 * verifier"). Every expected verdict is backed by an independent reference: R1 (exact swept-box
 * separating axes, `boxSweep.ts`) or R2 (radial clearance, `pinClearance.ts`). Neither uses the
 * verifier's code, a BVH or a winding number.
 */
const EPS = 5e-5;
const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];
const Z: Vec3 = [0, 0, 1];

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

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

function crossedBarBoxes(scene: BuiltScene, zBarX: number): { yBar: Box; zBar: Box; backPlate: Box } {
  const z = zBarAt(zBarX);
  return {
    yBar: scene.normalizeBox(worldBox(Y_BAR.center, Y_BAR.size)),
    zBar: scene.normalizeBox(worldBox(z.center, z.size)),
    backPlate: scene.normalizeBox(worldBox(BACK_PLATE.center, BACK_PLATE.size)),
  };
}

function pairOf(result: ReturnType<typeof verifyLinearMove>, staticPart: NormalizedPart) {
  const pair = result.pairs.find((entry) => entry.staticPartId === staticPart.partId);
  if (pair === undefined) {
    throw new Error(`no pair for ${staticPart.partId}`);
  }
  return pair;
}

function signedVolume(part: NormalizedPart): number {
  let volume = 0;
  for (let t = 0; t < part.triangles.length; t += 3) {
    const p = (k: number): Vec3 => {
      const v = 3 * (part.triangles[t + k] as number);
      return [part.positions[v] as number, part.positions[v + 1] as number, part.positions[v + 2] as number];
    };
    const [a, b, c] = [p(0), p(1), p(2)];
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return volume;
}

const linearStep = (part: NormalizedPart, dir: Vec3, distance: number): TrajectoryStep => ({
  partId: part.partId,
  primitive: "linear_slide",
  params: { kind: "linear_slide", dir: [dir[0], dir[1], dir[2]], distance },
});

// ---------------------------------------------------------------------------
// Crossed bars: the original failure, the near miss and the longer solver-selected failure
// ---------------------------------------------------------------------------

describe("crossed bars (original failure, near miss, longer solver-selected failure)", () => {
  it("original failure: Y_bar +X for 1.2 world through Z_bar is Blocked with a witness inside both bars", () => {
    const scene = crossedBars(1);
    const yBar = scene.part("Y_bar");
    const zBar = scene.part("Z_bar");
    const backPlate = scene.part("back_plate");
    const boxes = crossedBarBoxes(scene, 1);
    const distance = 1.2 * scene.scale;
    // R1: the swept Y_bar overlaps Z_bar by far more than epsilon, and clears the back plate.
    expect(sweptBoxOverlap(boxes.yBar, X, distance, boxes.zBar)).toBeGreaterThan(10 * EPS);
    expect(sweptBoxOverlap(boxes.yBar, X, distance, boxes.backPlate)).toBeLessThan(-10 * EPS);

    const result = verifyLinearMove(yBar, X, distance, [zBar, backPlate], scene.stage1.config);
    expect(result.verdict).toBe("blocked");
    const pair = pairOf(result, zBar);
    expect(pair.verdict).toBe("blocked");
    expect(pair.reason).toBe("penetration_witness");
    expect(pairOf(result, backPlate).verdict).toBe("clear");

    // The witness re-checked with box arithmetic only: more than epsilon inside both bars.
    const { travel, point } = pair.evidence;
    if (travel === undefined || point === undefined) {
      throw new Error("a penetration witness must report its travel and point");
    }
    expect(travel).toBeGreaterThanOrEqual(0);
    expect(travel).toBeLessThanOrEqual(distance);
    expect(boxDepth(translatedBox(boxes.yBar, X, travel), point)).toBeGreaterThan(EPS);
    expect(boxDepth(boxes.zBar, point)).toBeGreaterThan(EPS);
  });

  it("fixed-distance near miss: same Part, direction and distance with Z_bar at x = 1.416 is Clear", () => {
    const scene = crossedBars(1.416);
    const boxes = crossedBarBoxes(scene, 1.416);
    const distance = 1.2 * scene.scale;
    // R1: a gap of 0.016 world, 0.001 normalized.
    const overlap = sweptBoxOverlap(boxes.yBar, X, distance, boxes.zBar);
    expect(overlap).toBeLessThan(-10 * EPS);
    expect(overlap).toBeCloseTo(-0.016 * scene.scale, 9);

    const result = verifyLinearMove(scene.part("Y_bar"), X, distance, [scene.part("Z_bar"), scene.part("back_plate")], scene.stage1.config);
    expect(result.verdict).toBe("clear");
  });

  it("longer solver-selected failure: the union-AABB escape distance (1.616 world) along +X is Blocked", () => {
    const scene = crossedBars(1.416);
    const yBar = scene.part("Y_bar");
    const zBar = scene.part("Z_bar");
    const boxes = crossedBarBoxes(scene, 1.416);
    // The escape distance the solver uses: union max x minus Y_bar min x, from Stage 1 boxes.
    const distance = Math.max(zBar.aabb.max[0], scene.part("back_plate").aabb.max[0]) - yBar.aabb.min[0];
    expect(distance / scene.scale).toBeCloseTo(1.616, 6);
    expect(sweptBoxOverlap(boxes.yBar, X, distance, boxes.zBar)).toBeGreaterThan(10 * EPS);

    const result = verifyLinearMove(yBar, X, distance, [zBar, scene.part("back_plate")], scene.stage1.config);
    expect(result.verdict).toBe("blocked");
    expect(pairOf(result, zBar).reason).toBe("penetration_witness");
  });

  it("boundary twin (Z_bar at 1.384) and pass-through (1.4 world) are Blocked", () => {
    const twin = crossedBars(1.384);
    const twinBoxes = crossedBarBoxes(twin, 1.384);
    const twinDistance = 1.2 * twin.scale;
    expect(sweptBoxOverlap(twinBoxes.yBar, X, twinDistance, twinBoxes.zBar)).toBeGreaterThan(10 * EPS);
    expect(verifyLinearMove(twin.part("Y_bar"), X, twinDistance, [twin.part("Z_bar")], twin.stage1.config).verdict).toBe("blocked");

    const scene = crossedBars(1);
    const boxes = crossedBarBoxes(scene, 1);
    const distance = 1.4 * scene.scale;
    // Start, end and midpoint poses are all clear of Z_bar; only the path is not.
    for (const s of [0, distance / 2, distance]) {
      expect(sweptBoxOverlap(translatedBox(boxes.yBar, X, s), X, 0, boxes.zBar)).toBeLessThan(0);
    }
    expect(sweptBoxOverlap(boxes.yBar, X, distance, boxes.zBar)).toBeGreaterThan(10 * EPS);
    expect(verifyLinearMove(scene.part("Y_bar"), X, distance, [scene.part("Z_bar")], scene.stage1.config).verdict).toBe("blocked");
  });

  it("binds each verdict to its distance: Clear at 1.2 world, Blocked at 1.616, Clear again at 1.2", () => {
    const scene = crossedBars(1.416);
    const yBar = scene.part("Y_bar");
    const statics = [scene.part("Z_bar")];
    const short = 1.2 * scene.scale;
    const long = 1.616 * scene.scale;
    const first = verifyLinearMove(yBar, X, short, statics, scene.stage1.config);
    const second = verifyLinearMove(yBar, X, long, statics, scene.stage1.config);
    const third = verifyLinearMove(yBar, X, short, statics, scene.stage1.config);
    expect([first.verdict, second.verdict, third.verdict]).toEqual(["clear", "blocked", "clear"]);
    expect(third).toEqual(first);
    expect(first.move).toEqual({ partId: yBar.partId, dir: X, distance: short, presentPartIds: [statics[0]?.partId] });
    expect(second.move.distance).toBe(long);
  });
});

// ---------------------------------------------------------------------------
// Legacy ray hits are diagnostics, not finite-path collisions
// ---------------------------------------------------------------------------

describe("two unit cubes at x = 0 and x = 3, the first moved +X by 1 world", () => {
  it("keeps 40 legacy ray hits and is Clear for the finite move", () => {
    const scene = buildScene([
      { name: "first", geometry: boxGeometry(1, 1, 1), position: [0, 0, 0] },
      { name: "second", geometry: boxGeometry(1, 1, 1), position: [3, 0, 0] },
    ]);
    const first = scene.part("first");
    const second = scene.part("second");
    const distance = 1 * scene.scale;
    expect(checkClashes(first, X, [second], scene.stage1.config).count).toBe(40);
    const gap = sweptBoxOverlap(scene.normalizeBox(worldBox([0, 0, 0], [1, 1, 1])), X, distance, scene.normalizeBox(worldBox([3, 0, 0], [1, 1, 1])));
    expect(gap).toBeCloseTo(-1 * scene.scale, 9);
    const result = verifyLinearMove(first, X, distance, [second], scene.stage1.config);
    expect(result.verdict).toBe("clear");
    expect(pairOf(result, second).reason).toBe("separated_boxes");
  });
});

// ---------------------------------------------------------------------------
// Review decision: nested solids and invalid orientation are never Clear
// ---------------------------------------------------------------------------

describe("a cube of side 0.5 centred inside a solid cube of side 4", () => {
  const cases = [
    { mover: "inner", reversed: false, reason: "nested_at_start" },
    { mover: "outer", reversed: false, reason: "nested_at_start" },
    { mover: "inner", reversed: true, reason: "invalid_orientation" },
    { mover: "outer", reversed: true, reason: "invalid_orientation" },
  ] as const;

  it.each(cases)("$mover moves +X by 0.1 world, outer winding reversed: $reversed, is Unverified ($reason)", ({ mover, reversed, reason }) => {
    const outerGeometry = boxGeometry(4, 4, 4);
    const scene = buildScene([
      { name: "inner", geometry: boxGeometry(0.5, 0.5, 0.5), position: [0, 0, 0] },
      { name: "outer", geometry: reversed ? reversedWinding(outerGeometry) : outerGeometry, position: [0, 0, 0] },
    ]);
    const inner = scene.part("inner");
    const outer = scene.part("outer");
    // References: the inner box lies strictly inside the outer box, so the solids overlap; the
    // reversed mesh really is inward-wound.
    expect(boxStrictlyInside(scene.normalizeBox(worldBox([0, 0, 0], [0.5, 0.5, 0.5])), scene.normalizeBox(worldBox([0, 0, 0], [4, 4, 4])))).toBe(true);
    expect(Math.sign(signedVolume(outer))).toBe(reversed ? -1 : 1);
    expect(signedVolume(inner)).toBeGreaterThan(0);

    const [moving, fixed] = mover === "inner" ? [inner, outer] : [outer, inner];
    const result = verifyLinearMove(moving, X, 0.1 * scene.scale, [fixed], scene.stage1.config);
    expect(result.verdict).not.toBe("clear");
    expect(result.verdict).toBe("unverified");
    expect(pairOf(result, fixed).reason).toBe(reason);
  });
});

// ---------------------------------------------------------------------------
// Review decision: positive overlap within epsilon is not proof of separation
// ---------------------------------------------------------------------------

describe("contact plane", () => {
  it.each(["upper", "lower"] as const)("two unit cubes overlapping by 5e-5 world, %s slides +X: never Clear", (mover) => {
    const scene = buildScene([
      { name: "lower", geometry: boxGeometry(1, 1, 1), position: [0, 0, 0] },
      { name: "upper", geometry: boxGeometry(1, 1, 1), position: [0, 0.99995, 0] },
    ]);
    const lowerBox = scene.normalizeBox(worldBox([0, 0, 0], [1, 1, 1]));
    const upperBox = scene.normalizeBox(worldBox([0, 0.99995, 0], [1, 1, 1]));
    const distance = 0.5 * scene.scale;
    // R1: a real interpenetration thinner than epsilon, the case the old rule cleared.
    const overlap = sweptBoxOverlap(mover === "upper" ? upperBox : lowerBox, X, distance, mover === "upper" ? lowerBox : upperBox);
    expect(overlap).toBeGreaterThan(0);
    expect(overlap).toBeLessThan(EPS);

    const [moving, fixed] = mover === "upper" ? [scene.part("upper"), scene.part("lower")] : [scene.part("lower"), scene.part("upper")];
    const result = verifyLinearMove(moving, X, distance, [fixed], scene.stage1.config);
    expect(result.verdict).not.toBe("clear");
    expect(result.verdict).toBe("unverified");
    expect(pairOf(result, fixed).reason).toBe("contact_unresolved");
  });

  const base = { center: [0, -0.5, 0] as Vec3, size: [2, 1, 2] as Vec3 };
  const contactCases: { label: string; block: Vec3; dir: Vec3; travel: number; reason: string }[] = [
    { label: "genuine face contact, sliding +X", block: [0, 0.5, 0], dir: X, travel: 0.5, reason: "contact_plane" },
    { label: "lift-off +Y from face contact", block: [0, 0.5, 0], dir: Y, travel: 1, reason: "contact_plane" },
    { label: "touch at the end pose", block: [-2, -0.5, 0], dir: X, travel: 0.5, reason: "contact_plane" },
  ];
  it.each(contactCases)("$label is Clear ($reason)", ({ block, dir, travel, reason }) => {
    const scene = buildScene([
      { name: "base", geometry: boxGeometry(...base.size), position: base.center },
      { name: "block", geometry: boxGeometry(1, 1, 1), position: block },
    ]);
    const distance = travel * scene.scale;
    // R1: the boxes touch (overlap exactly 0) and never interpenetrate.
    expect(sweptBoxOverlap(scene.normalizeBox(worldBox(block, [1, 1, 1])), dir, distance, scene.normalizeBox(worldBox(base.center, base.size)))).toBeCloseTo(0, 12);
    const result = verifyLinearMove(scene.part("block"), dir, distance, [scene.part("base")], scene.stage1.config);
    expect(result.verdict).toBe("clear");
    expect(pairOf(result, scene.part("base")).reason).toBe(reason);
  });

  it("a real gap of 0.1 world while sliding +X is Clear", () => {
    const scene = buildScene([
      { name: "base", geometry: boxGeometry(...base.size), position: base.center },
      { name: "block", geometry: boxGeometry(1, 1, 1), position: [0, 0.6, 0] },
    ]);
    const distance = 0.5 * scene.scale;
    expect(sweptBoxOverlap(scene.normalizeBox(worldBox([0, 0.6, 0], [1, 1, 1])), X, distance, scene.normalizeBox(worldBox(base.center, base.size)))).toBeLessThan(-10 * EPS);
    expect(verifyLinearMove(scene.part("block"), X, distance, [scene.part("base")], scene.stage1.config).verdict).toBe("clear");
  });
});

// ---------------------------------------------------------------------------
// Pins: direct linear moves
// ---------------------------------------------------------------------------

describe("pins through a plate with a 1 x 1 square hole (direct linear moves)", () => {
  it("a radius-0.3 pin through the wide hole is Clear although the swept bounding boxes overlap", () => {
    const scene = buildScene([
      { name: "plate", geometry: plateWithSquareHole(4, 1, 0.5), position: [0, 0, 0] },
      { name: "pin", geometry: pinAlongZ(0.3, 3, 16), position: [0, 0, 0] },
    ]);
    const pin = scene.part("pin");
    const plate = scene.part("plate");
    const distance = 3 * scene.scale;
    // Precondition: the swept AABBs overlap, so box culling alone cannot clear this move.
    const sweptPin: Box = { min: pin.aabb.min, max: [pin.aabb.max[0], pin.aabb.max[1], pin.aabb.max[2] + distance] };
    expect(sweptBoxOverlap(sweptPin, Z, 0, { min: plate.aabb.min, max: plate.aabb.max })).toBeGreaterThan(0);
    // R2: 0.2 world (0.05 normalized) of radial clearance at every travel along z, less the
    // float32 rounding of the source geometry (the radius 0.3 is stored as 0.30000001).
    const axis = scene.toNormalized([0, 0, 0]);
    const clearance = radialClearance(pin, plate, axis[0], axis[1]);
    expect(clearance.clearance).toBeGreaterThan(0.2 * scene.scale * (1 - 1e-6));
    expect(clearance.clearance).toBeGreaterThan(1000 * EPS * (1 - 1e-6));

    const result = verifyLinearMove(pin, Z, distance, [plate], scene.stage1.config);
    expect(result.verdict).toBe("clear");
    expect(pairOf(result, plate).reason).toBe("separation_distance");
    expect(pairOf(result, plate).evidence.minDistance ?? 0).toBeGreaterThanOrEqual(EPS);
  });

  it("an exact-fit 1 x 1 pin sliding on all four walls is Unverified, never Blocked", () => {
    const scene = buildScene([
      { name: "plate", geometry: plateWithSquareHole(4, 1, 0.5), position: [0, 0, 0] },
      { name: "pin", geometry: boxGeometry(1, 1, 3), position: [0, 0, 0] },
    ]);
    const distance = 3 * scene.scale;
    // R1 over the plate's four bars: the pin touches some bars and penetrates none.
    const pinBox = scene.normalizeBox(worldBox([0, 0, 0], [1, 1, 3]));
    const overlaps = plateBars(4, 1, 0.5, [0, 0, 0]).map((bar) => sweptBoxOverlap(pinBox, Z, distance, scene.normalizeBox(bar)));
    expect(Math.max(...overlaps)).toBeCloseTo(0, 12);

    const result = verifyLinearMove(scene.part("pin"), Z, distance, [scene.part("plate")], scene.stage1.config);
    expect(result.verdict).toBe("unverified");
    expect(pairOf(result, scene.part("plate")).reason).toBe("contact_unresolved");
  });
});

// ---------------------------------------------------------------------------
// Trajectories
// ---------------------------------------------------------------------------

describe("verifyTrajectory", () => {
  const shaftAndRing = (): BuiltScene =>
    buildScene([
      { name: "shaft", geometry: boxGeometry(0.4, 0.4, 4), position: [0, 0, 0] },
      { name: "ring", geometry: plateWithSquareHole(2, 0.6, 0.5), position: [0, 0, 0] },
    ]);

  it("checks a targeted guide against a Part that has no step (the shaft stays present)", () => {
    const scene = shaftAndRing();
    const ring = scene.part("ring");
    const shaft = scene.part("shaft");
    const shaftBox = scene.normalizeBox(worldBox([0, 0, 0], [0.4, 0.4, 4]));
    const bars = plateBars(2, 0.6, 0.5, [0, 0, 0]).map((bar) => scene.normalizeBox(bar));

    // Off the end of the shaft along its axis: R1 keeps every bar 0.1 world from the shaft.
    const along = 3 * scene.scale;
    expect(Math.max(...bars.map((bar) => sweptBoxOverlap(bar, Z, along, shaftBox)))).toBeLessThan(-10 * EPS);
    const off = verifyTrajectory(scene.stage1.parts, [linearStep(ring, Z, along)], scene.stage1.config);
    expect(off.verdict).toBe("clear");
    expect(off.steps[0]?.move?.move.presentPartIds).toEqual([shaft.partId]);

    // Sideways into the shaft: R1 finds a bar that penetrates it.
    const sideways = 0.5 * scene.scale;
    expect(Math.max(...bars.map((bar) => sweptBoxOverlap(bar, X, sideways, shaftBox)))).toBeGreaterThan(10 * EPS);
    const into = verifyTrajectory(scene.stage1.parts, [linearStep(ring, X, sideways)], scene.stage1.config);
    expect(into.verdict).toBe("blocked");
    expect(into.steps[0]?.blockerIds).toEqual([shaft.partId]);
  });

  it("removes a Part only after its own step", () => {
    const scene = crossedBars(1);
    const yBar = scene.part("Y_bar");
    const zBar = scene.part("Z_bar");
    const backPlate = scene.part("back_plate");
    const config = scene.stage1.config;
    // Z_bar leaves first along +X; afterwards Y_bar's +X slide no longer meets it.
    const ordered = verifyTrajectory(scene.stage1.parts, [linearStep(zBar, X, 1 * scene.scale), linearStep(yBar, X, 1.2 * scene.scale)], config);
    expect(ordered.steps.map((step) => step.move?.move.presentPartIds)).toEqual([
      [yBar.partId, backPlate.partId].sort(),
      [backPlate.partId],
    ]);
    expect(ordered.steps.map((step) => step.verdict)).toEqual(["clear", "clear"]);
    // The defect order: Y_bar first, with Z_bar still present.
    const defect = verifyTrajectory(scene.stage1.parts, [linearStep(yBar, X, 1.2 * scene.scale)], config);
    expect(defect.verdict).toBe("blocked");
    expect(defect.steps[0]?.blockerIds).toEqual([zBar.partId]);
  });

  it("marks a non-linear primitive Unverified without geometry, and lets a Blocked step take priority", () => {
    const scene = crossedBars(1);
    const yBar = scene.part("Y_bar");
    const zBar = scene.part("Z_bar");
    const helical: TrajectoryStep = {
      partId: zBar.partId,
      primitive: "helical_unscrew",
      params: { kind: "helical_unscrew", dir: X, distance: 0.01, axis: X, pivot: [0, 0, 0], pitch: 0.01 },
    };
    const onlyHelical = verifyTrajectory(scene.stage1.parts, [helical], scene.stage1.config);
    expect(onlyHelical.verdict).toBe("unverified");
    expect(onlyHelical.steps[0]).toMatchObject({ verdict: "unverified", reason: "unsupported_primitive", move: null, blockerIds: [] });

    const blockedFirst = verifyTrajectory(scene.stage1.parts, [linearStep(yBar, X, 1.2 * scene.scale), helical], scene.stage1.config);
    expect(blockedFirst.steps.map((step) => step.verdict)).toEqual(["blocked", "unverified"]);
    expect(blockedFirst.verdict).toBe("blocked");
  });

  it("rejects unknown and duplicate step Part_IDs before any geometry runs", () => {
    const scene = crossedBars(1);
    const yBar = scene.part("Y_bar");
    const config = scene.stage1.config;
    const unknown: TrajectoryStep = { ...linearStep(yBar, X, 0.01), partId: "/99#0" };
    expect(() => verifyTrajectory(scene.stage1.parts, [unknown], config)).toThrow(InvalidTrajectoryError);
    expect(() => verifyTrajectory(scene.stage1.parts, [linearStep(yBar, X, 0.01), linearStep(yBar, Y, 0.01)], config)).toThrow(InvalidTrajectoryError);
    expect(() => verifyTrajectory([yBar, yBar], [linearStep(yBar, X, 0.01)], config)).toThrow(InvalidTrajectoryError);
  });
});

describe("compiled trajectories of the pin scenes (default compiler, no primitive override)", () => {
  const scenes = [
    { label: "wide hole", pin: () => pinAlongZ(0.3, 3, 16) },
    { label: "exact fit", pin: () => boxGeometry(1, 1, 3) },
  ];
  it.each(scenes)("$label: the compiler picks helical_unscrew for the pin, so its step is Unverified", ({ pin }) => {
    const scene = buildScene([
      { name: "plate", geometry: plateWithSquareHole(4, 1, 0.5), position: [0, 0, 0] },
      { name: "pin", geometry: pin(), position: [0, 0, 0] },
    ]);
    const stage1 = scene.stage1;
    const plan = stage3Peel(stage1, stage2BuildDbg(stage1, stage1.config), stage1.config);
    expect(plan.status).toBe("solved");
    const compiled = stage4Compile(plan, stage1, stage1.config);
    if (!compiled.ok) {
      throw new Error(`stage 4 failed: ${compiled.error.message}`);
    }
    const pinId = scene.part("pin").partId;
    const pinStep = compiled.steps.find((step) => step.partId === pinId);
    expect(pinStep?.primitive).toBe("helical_unscrew");

    const verification = verifyTrajectory(stage1.parts, compiled.steps, stage1.config);
    const verdictOfPin = verification.steps.find((step) => step.partId === pinId);
    expect(verdictOfPin).toMatchObject({ verdict: "unverified", reason: "unsupported_primitive" });
    expect(verification.verdict).toBe(combineVerdicts(verification.steps.map((step) => step.verdict)));
    expect(verification.verdict).toBe("unverified");
  });
});

// ---------------------------------------------------------------------------
// Input validation and the combine rule
// ---------------------------------------------------------------------------

describe("input validation", () => {
  it("throws before any geometry for a bad distance, a bad direction or the mover among the statics", () => {
    const scene = crossedBars(1);
    const yBar = scene.part("Y_bar");
    const zBar = scene.part("Z_bar");
    const config = scene.stage1.config;
    for (const distance of [Number.NaN, -1e-9, Number.POSITIVE_INFINITY]) {
      expect(() => verifyLinearMove(yBar, X, distance, [zBar], config)).toThrow(InvalidMoveDistanceError);
    }
    expect(() => verifyLinearMove(yBar, [1, 1, 0], 0.01, [zBar], config)).toThrow(InvalidDirectionError);
    expect(() => verifyLinearMove(yBar, X, 0.01, [zBar, yBar], config)).toThrow(MovingPartInStaticSetError);
  });
});

describe("combineVerdicts", () => {
  const table: [MoveVerdict[], MoveVerdict][] = [
    [[], "clear"],
    [["clear", "clear"], "clear"],
    [["clear", "unverified"], "unverified"],
    [["unverified", "blocked", "clear"], "blocked"],
  ];
  it.each(table)("%j combines to %s", (verdicts, expected) => {
    expect(combineVerdicts(verdicts)).toBe(expected);
  });
});
