/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { DEFAULT_SOLVER_CONFIG } from "../../src/config";
import { PrimitiveParamError, PrimitiveRangeError } from "../../src/errors";
import { helicalUnscrew } from "../../src/primitives/helicalUnscrew";
import { linearSlide } from "../../src/primitives/linearSlide";
import { createDefaultPrimitiveRegistry, createPrimitiveRegistry } from "../../src/primitives/registry";
import { applyPose } from "../../src/primitives/se3";
import { twoStepLSlide } from "../../src/primitives/twoStepLSlide";
import type {
  HelicalUnscrewParams,
  LinearSlideParams,
  MotionPrimitive,
  PrimitiveContext,
  PrimitivePartInfo,
  TwoStepLSlideParams,
} from "../../src/primitives/types";
import { stage2BuildDbg } from "../../src/stage2/dbgBuilder";
import { stage3Peel } from "../../src/stage3/peelSolver";
import { stage4Compile } from "../../src/stage4/trajectoryCompiler";
import type {
  DisassemblyPlan,
  NormalizedPart,
  PlanStep,
  Pose,
  SolvedPlan,
  Stage1Result,
  TrajectoryStep,
  Vec3,
} from "../../src/types";
import { CUBE_POSITIONS, CUBE_TRIANGLES, groupOf, meshFromArrays, prepare } from "../helpers/handMeshes";

// ---------------------------------------------------------------------------
// Fixture: a slender screw-like box above a flat plate, prepared through Stage 1
// ---------------------------------------------------------------------------

function boxMesh(min: Vec3, max: Vec3) {
  const positions: number[] = [];
  for (let i = 0; i < CUBE_POSITIONS.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const t = CUBE_POSITIONS[i + k] ?? 0;
      positions.push((min[k] ?? 0) + t * ((max[k] ?? 0) - (min[k] ?? 0)));
    }
  }
  return meshFromArrays(positions, CUBE_TRIANGLES);
}

function scene() {
  return groupOf(boxMesh([0, 0, 0], [0.1, 0.1, 1]), boxMesh([-1, -1, -0.3], [1, 1, -0.1]));
}

function partFromChild(stage1: Stage1Result, childIndex: number): NormalizedPart {
  const part = stage1.parts.find((candidate) => candidate.sourceNodePath[0] === childIndex);
  if (part === undefined) {
    throw new Error(`no Part came from child ${childIndex}`);
  }
  return part;
}

const stage1 = prepare(scene());
const screw = partFromChild(stage1, 0);
const plate = partFromChild(stage1, 1);
const CTX: PrimitiveContext = { config: DEFAULT_SOLVER_CONFIG };

// ---------------------------------------------------------------------------
// Small vector helpers, written independently of the code under test
// ---------------------------------------------------------------------------

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function unit(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

function neg(v: Vec3): Vec3 {
  return [-v[0], -v[1], -v[2]];
}

/** A unit vector orthogonal to `a`, built from the coordinate axis that is least aligned with it. */
function perpendicularTo(a: Vec3): Vec3 {
  const abs = a.map(Math.abs);
  const smallest = abs.indexOf(Math.min(...abs));
  const axis: Vec3 = [0, 0, 0];
  axis[smallest] = 1;
  return unit(cross(a, axis));
}

/** The unit vector `deg` degrees away from the unit vector `a`. */
function tilted(a: Vec3, deg: number): Vec3 {
  const phi = (deg * Math.PI) / 180;
  const u = perpendicularTo(a);
  return [
    Math.cos(phi) * a[0] + Math.sin(phi) * u[0],
    Math.cos(phi) * a[1] + Math.sin(phi) * u[1],
    Math.cos(phi) * a[2] + Math.sin(phi) * u[2],
  ];
}

/** Rotation of `v` about the unit `axis` by `angle`, through a unit quaternion. This is not the Rodrigues matrix. */
function rotateByQuaternion(axis: Vec3, angle: number, v: Vec3): Vec3 {
  const w = Math.cos(angle / 2);
  const s = Math.sin(angle / 2);
  const q: Vec3 = [axis[0] * s, axis[1] * s, axis[2] * s];
  const qv = cross(q, v);
  const qqv = cross(q, qv);
  return [v[0] + 2 * (w * qv[0] + qqv[0]), v[1] + 2 * (w * qv[1] + qqv[1]), v[2] + 2 * (w * qv[2] + qqv[2])];
}

function det3(r: readonly number[]): number {
  const m = (i: number): number => r[i] as number;
  return m(0) * (m(4) * m(8) - m(5) * m(7)) - m(1) * (m(3) * m(8) - m(5) * m(6)) + m(2) * (m(3) * m(7) - m(4) * m(6));
}

function expectVecClose(actual: readonly number[], expected: readonly number[], tolerance = 1e-9): void {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(Math.abs((actual[i] as number) - (expected[i] as number)), `component ${i}: ${actual[i]} vs ${expected[i]}`).toBeLessThanOrEqual(
      tolerance,
    );
  }
}

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Asserts `R` is a rotation: `RᵀR = I` and `det(R) = 1`, each within 1e-9 (Req 18.2). */
function expectRigid(pose: Pose): void {
  const r = pose.rotation;
  expect(r).toHaveLength(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) {
        sum += (r[k * 3 + i] as number) * (r[k * 3 + j] as number);
      }
      expect(Math.abs(sum - (i === j ? 1 : 0))).toBeLessThanOrEqual(1e-9);
    }
  }
  expect(Math.abs(det3(r) - 1)).toBeLessThanOrEqual(1e-9);
}

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Plans and parts
// ---------------------------------------------------------------------------

const SCREW_AXIS = screw.frame.axes[0];
const SCREW_DISTANCE = 0.03;

function stepFor(part: NormalizedPart, dir: Vec3, secondary: PlanStep["secondary"] = null, distance = SCREW_DISTANCE): PlanStep {
  return { partId: part.partId, dir, dirIndex: 0, escapeDistance: distance, secondary };
}

function solvedPlan(steps: PlanStep[]): SolvedPlan {
  return {
    status: "solved",
    steps,
    normalization: stage1.normalization,
    sampling: stage1.sampling,
    diagnostics: [],
  };
}

function infoOf(part: NormalizedPart, isFastener: boolean): PrimitivePartInfo {
  return {
    partId: part.partId,
    isFastener,
    principalAxis: part.frame.axes[0],
    obbCenter: part.frame.obb.center,
    obbHalfExtents: part.frame.obb.halfExtents,
  };
}

function compile(plan: DisassemblyPlan, config: Parameters<typeof stage4Compile>[2] = DEFAULT_SOLVER_CONFIG): TrajectoryStep[] {
  const result = stage4Compile(plan, stage1, config);
  if (!result.ok) {
    throw new Error(`compile failed: ${result.error.kind}`);
  }
  return result.steps;
}

function onlyStep(steps: TrajectoryStep[]): TrajectoryStep {
  const [first] = steps;
  if (first === undefined || steps.length !== 1) {
    throw new Error(`expected one trajectory step, received ${steps.length}`);
  }
  return first;
}

function customPrimitive(name: string, priority: number, applicable = true): MotionPrimitive {
  return {
    name,
    priority,
    isApplicable: () => applicable,
    buildParams: (step) => ({ kind: name, partId: step.partId }),
    pose: () => ({ rotation: [...IDENTITY], translation: [0, 0, 0] }),
  };
}

// ---------------------------------------------------------------------------
// Fixture sanity
// ---------------------------------------------------------------------------

describe("Stage 4 fixture", () => {
  it("has a slender, symmetric Fastener screw and a non-Fastener plate", () => {
    expect(screw.metrics.isFastener).toBe(true);
    expect(plate.metrics.isFastener).toBe(false);
    expect(Math.abs(dot(SCREW_AXIS, [0, 0, 1]))).toBeCloseTo(1, 12);
  });
});

// ---------------------------------------------------------------------------
// Registry (Req 17)
// ---------------------------------------------------------------------------

describe("Primitive_Registry", () => {
  it("holds exactly the 3 built-ins in priority order (Req 17.2, 17.7)", () => {
    const registry = createDefaultPrimitiveRegistry();
    expect(registry.list().map((primitive) => [primitive.name, primitive.priority])).toEqual([
      ["two_step_l_slide", 30],
      ["helical_unscrew", 20],
      ["linear_slide", 0],
    ]);
    for (const name of ["linear_slide", "helical_unscrew", "two_step_l_slide"]) {
      const found = registry.get(name);
      expect(found.ok && found.value.name).toBe(name);
    }
  });

  it("starts empty when created without the built-ins, and registries do not share state", () => {
    const empty = createPrimitiveRegistry();
    expect(empty.list()).toEqual([]);
    const registered = empty.register(customPrimitive("only_here", 1));
    expect(registered.ok).toBe(true);
    expect(createDefaultPrimitiveRegistry().list().map((primitive) => primitive.name)).not.toContain("only_here");
    expect(createPrimitiveRegistry().list()).toEqual([]);
  });

  it("returns a fresh listing, so editing it cannot change the registry", () => {
    const registry = createDefaultPrimitiveRegistry();
    (registry.list() as MotionPrimitive[]).length = 0;
    expect(registry.list()).toHaveLength(3);
  });

  it("keeps one source file per built-in primitive under src/primitives (Req 17.1)", () => {
    // The sources are read as text through Vite, so the test needs no Node built-in.
    const sources = import.meta.glob("../../src/primitives/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const files = Object.keys(sources).map((path) => path.slice(path.lastIndexOf("/") + 1)).sort();
    expect(files).toEqual(["helicalUnscrew.ts", "linearSlide.ts", "registry.ts", "se3.ts", "twoStepLSlide.ts", "types.ts"]);
    const declared = Object.entries(sources)
      .flatMap(([path, source]) =>
        [...source.matchAll(/^\s+name: "([a-z0-9_]+)",$/gm)].map((match) => [path.slice(path.lastIndexOf("/") + 1), match[1]]),
      )
      .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1));
    expect(declared).toEqual([
      ["helicalUnscrew.ts", "helical_unscrew"],
      ["linearSlide.ts", "linear_slide"],
      ["twoStepLSlide.ts", "two_step_l_slide"],
    ]);
  });

  it("lists the same order whatever order the primitives were registered in (Req 17.7)", () => {
    const specs: [string, number][] = [["zeta", 5], ["alpha", 5], ["mid", 9], ["low", -3]];
    const forward = createPrimitiveRegistry();
    const backward = createPrimitiveRegistry();
    for (const [name, priority] of specs) {
      forward.register(customPrimitive(name, priority));
    }
    for (const [name, priority] of [...specs].reverse()) {
      backward.register(customPrimitive(name, priority));
    }
    expect(forward.list().map((primitive) => primitive.name)).toEqual(["mid", "alpha", "zeta", "low"]);
    expect(backward.list().map((primitive) => primitive.name)).toEqual(["mid", "alpha", "zeta", "low"]);
  });

  it("rejects a duplicate name, names the primitive, and keeps the first registration (Req 17.5)", () => {
    const registry = createDefaultPrimitiveRegistry();
    const before = registry.list().map((primitive) => primitive.name);
    const result = registry.register(customPrimitive("linear_slide", 99));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatchObject({ kind: "DuplicatePrimitiveName", name: "linear_slide" });
    expect(registry.list().map((primitive) => primitive.name)).toEqual(before);
    const kept = registry.get("linear_slide");
    expect(kept.ok && kept.value.priority).toBe(0);
  });

  it("matches names case-sensitively and reports an unknown name (Req 17.4, 17.6)", () => {
    const registry = createDefaultPrimitiveRegistry();
    const result = registry.get("Linear_Slide");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatchObject({ kind: "UnknownPrimitive", name: "Linear_Slide" });
    expect(registry.list()).toHaveLength(3);
  });

  it("rejects an invalid or missing member and names it, leaving the registry unchanged (Req 17.8)", () => {
    const registry = createPrimitiveRegistry();
    const valid = customPrimitive("fine", 1);
    const invalid: [string, unknown][] = [
      ["name", { ...valid, name: "Upper" }],
      ["name", { ...valid, name: "1abc" }],
      ["name", { ...valid, name: "" }],
      ["name", { ...valid, name: "a".repeat(65) }],
      ["name", { ...valid, name: "has-dash" }],
      ["name", { ...valid, name: undefined }],
      ["name", null],
      ["priority", { ...valid, priority: Number.NaN }],
      ["priority", { ...valid, priority: Number.POSITIVE_INFINITY }],
      ["priority", { ...valid, priority: Number.NEGATIVE_INFINITY }],
      ["priority", { ...valid, priority: undefined }],
      ["isApplicable", { ...valid, isApplicable: undefined }],
      ["buildParams", { ...valid, buildParams: "not a function" }],
      ["pose", { ...valid, pose: undefined }],
    ];
    for (const [member, candidate] of invalid) {
      const result = registry.register(candidate as MotionPrimitive);
      expect(result.ok, `${member}: ${JSON.stringify(candidate)}`).toBe(false);
      expect(!result.ok && result.error).toMatchObject({ kind: "InvalidPrimitive", member });
    }
    expect(registry.list()).toEqual([]);
    expect(registry.register(customPrimitive("a".repeat(64), 1)).ok).toBe(true);
  });

  it("selects the first applicable primitive, and breaks equal priorities by name (Req 17.9, 19.3)", () => {
    const registry = createPrimitiveRegistry();
    registry.register(customPrimitive("b_prim", 5));
    registry.register(customPrimitive("a_prim", 5));
    registry.register(customPrimitive("fallback", 0));
    const chosen = registry.select(stepFor(screw, SCREW_AXIS), infoOf(screw, true), CTX);
    expect(chosen.ok && chosen.value.name).toBe("a_prim");
  });

  it("returns NoApplicablePrimitive naming the Part when nothing applies (Req 17.10)", () => {
    const registry = createPrimitiveRegistry();
    registry.register(customPrimitive("never", 5, false));
    const chosen = registry.select(stepFor(screw, SCREW_AXIS), infoOf(screw, true), CTX);
    expect(chosen.ok).toBe(false);
    expect(!chosen.ok && chosen.error).toMatchObject({ kind: "NoApplicablePrimitive", partId: screw.partId });
    expect(createPrimitiveRegistry().select(stepFor(screw, SCREW_AXIS), infoOf(screw, true), CTX).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Trajectory_Compiler (Req 19)
// ---------------------------------------------------------------------------

describe("Trajectory_Compiler rejects plans that are not solved (Req 19.7)", () => {
  // Only `status` matters to the compiler, so the witness is a minimal placeholder.
  const deadlocked: DisassemblyPlan = {
    status: "deadlocked",
    steps: [],
    witness: { sccs: [{ partIds: [screw.partId, plate.partId], edges: [] }], unassignedPartIds: [] },
    normalization: stage1.normalization,
    sampling: stage1.sampling,
    diagnostics: [],
  };
  const errored: DisassemblyPlan = {
    status: "error",
    error: { kind: "EmptyAssemblyError", message: "empty", diagnostics: [] },
    diagnostics: [],
  };

  it("rejects a deadlocked plan with its status and returns no steps", () => {
    const result = stage4Compile(deadlocked, stage1, DEFAULT_SOLVER_CONFIG);
    expect(result).toMatchObject({ ok: false, error: { kind: "PlanNotSolved", status: "deadlocked" } });
    expect(result).not.toHaveProperty("steps");
    expect(!result.ok && result.error.message).toContain("deadlocked");
  });

  it("rejects an error result with its status and returns no steps", () => {
    const result = stage4Compile(errored, stage1, DEFAULT_SOLVER_CONFIG);
    expect(result).toMatchObject({ ok: false, error: { kind: "PlanNotSolved", status: "error" } });
    expect(result).not.toHaveProperty("steps");
  });

  it("reports the status before it looks at the config", () => {
    expect(stage4Compile(deadlocked, stage1, { threadPitch: -1 })).toMatchObject({ error: { kind: "PlanNotSolved" } });
  });
});

describe("Trajectory_Compiler on solved plans (Req 19.1, 19.2)", () => {
  it("compiles an empty plan to an empty list", () => {
    expect(stage4Compile(solvedPlan([]), stage1, DEFAULT_SOLVER_CONFIG)).toEqual({ ok: true, steps: [] });
  });

  it("returns one Trajectory_Step per Plan_Step, in order, and never touches the plan", () => {
    const plan = solvedPlan([stepFor(plate, plate.frame.axes[0]), stepFor(screw, SCREW_AXIS)]);
    const snapshot = structuredClone(plan);
    const steps = compile(plan);
    expect(steps.map((step) => step.partId)).toEqual([plate.partId, screw.partId]);
    expect(plan).toEqual(snapshot);
    // Editing a compiled step must not reach back into the plan.
    const first = steps[0]?.params as LinearSlideParams;
    first.dir[0] = 99;
    expect(plan).toEqual(snapshot);
  });

  it("returns the config error as a value when the config is invalid", () => {
    const result = stage4Compile(solvedPlan([stepFor(screw, SCREW_AXIS)]), stage1, { threadPitch: -1 });
    expect(result).toMatchObject({ ok: false, error: { kind: "ConfigurationError" } });
  });

  it("throws when a step names a Part that is not in the Stage 1 result", () => {
    const stray: PlanStep = { partId: "/99#0", dir: [1, 0, 0], dirIndex: 0, escapeDistance: 0, secondary: null };
    expect(() => stage4Compile(solvedPlan([stray]), stage1, DEFAULT_SOLVER_CONFIG)).toThrow(RangeError);
  });

  it("returns NoApplicablePrimitive when a custom registry has nothing for the step", () => {
    const registry = createPrimitiveRegistry();
    registry.register(customPrimitive("never", 5, false));
    const result = stage4Compile(solvedPlan([stepFor(screw, SCREW_AXIS)]), stage1, DEFAULT_SOLVER_CONFIG, registry);
    expect(result).toMatchObject({ ok: false, error: { kind: "NoApplicablePrimitive", partId: screw.partId } });
  });

  it("uses a custom registry and breaks equal priorities by ascending name (Req 19.3)", () => {
    const registry = createPrimitiveRegistry();
    registry.register(customPrimitive("b_prim", 5));
    registry.register(customPrimitive("a_prim", 5));
    const result = stage4Compile(solvedPlan([stepFor(plate, plate.frame.axes[0])]), stage1, DEFAULT_SOLVER_CONFIG, registry);
    expect(result.ok && result.steps[0]?.primitive).toBe("a_prim");
  });
});

describe("two_step_l_slide selection (Req 19.5, 19.9, 19.10)", () => {
  const secondary = (dir: Vec3): PlanStep["secondary"] => ({ dir, distance: 0.2 });

  it("compiles a supplied step with a non-null secondary to two_step_l_slide", () => {
    const dir1: Vec3 = [1, 0, 0];
    const dir2: Vec3 = [0, 1, 0];
    const step = onlyStep(compile(solvedPlan([stepFor(plate, dir1, secondary(dir2), 0.4)])));
    expect(step).toEqual({
      partId: plate.partId,
      primitive: "two_step_l_slide",
      params: { kind: "two_step_l_slide", d1: dir1, s1: 0.4, d2: dir2, s2: 0.2 },
    });
  });

  it("prefers two_step_l_slide over helical_unscrew when both apply, because its priority is higher", () => {
    const along = SCREW_AXIS;
    const step = onlyStep(compile(solvedPlan([stepFor(screw, along, secondary(perpendicularTo(along)))])));
    expect(step.primitive).toBe("two_step_l_slide");
    // Without the secondary the same step is a helical unscrew.
    expect(onlyStep(compile(solvedPlan([stepFor(screw, along)]))).primitive).toBe("helical_unscrew");
  });

  it("does not apply when the secondary is null", () => {
    expect(twoStepLSlide.isApplicable(stepFor(plate, [1, 0, 0]), infoOf(plate, false), CTX)).toBe(false);
    expect(twoStepLSlide.isApplicable(stepFor(plate, [1, 0, 0], secondary([0, 1, 0])), infoOf(plate, false), CTX)).toBe(true);
  });

  it("is never chosen for a plan from the Peel_Solver, which always emits secondary: null (Req 14.10)", () => {
    const graph = stage2BuildDbg(stage1, stage1.config);
    const plan = stage3Peel(stage1, graph, stage1.config);
    expect(plan.status).toBe("solved");
    for (const trajectory of compile(plan)) {
      expect(trajectory.primitive).not.toBe("two_step_l_slide");
    }
  });
});

describe("helical_unscrew versus linear_slide selection (Req 19.4, 19.6, 19.8)", () => {
  it("applies to a Fastener moving along either sign of its principal axis", () => {
    for (const dir of [SCREW_AXIS, neg(SCREW_AXIS)]) {
      const trajectory = onlyStep(compile(solvedPlan([stepFor(screw, dir)])));
      expect(trajectory.primitive).toBe("helical_unscrew");
      const params = trajectory.params as HelicalUnscrewParams;
      expect(params).toEqual({
        kind: "helical_unscrew",
        dir,
        distance: SCREW_DISTANCE,
        axis: dir,
        pivot: screw.frame.obb.center,
        pitch: DEFAULT_SOLVER_CONFIG.threadPitch,
      });
      // The axis always points along the motion, whichever sign PCA1 has (Req 18.4).
      expect(dot(params.axis, params.dir)).toBeGreaterThanOrEqual(0);
    }
  });

  it("flips the stored axis so its dot product with dir is non-negative", () => {
    const params = helicalUnscrew.buildParams(stepFor(screw, neg(SCREW_AXIS)), infoOf(screw, true), CTX);
    expect(params.axis).toEqual(neg(SCREW_AXIS));
    const forward = helicalUnscrew.buildParams(stepFor(screw, SCREW_AXIS), infoOf(screw, true), CTX);
    expect(forward.axis).toEqual(SCREW_AXIS);
  });

  it("uses the helical angular tolerance: 4.9 degrees applies and 5.1 degrees does not", () => {
    expect(onlyStep(compile(solvedPlan([stepFor(screw, tilted(SCREW_AXIS, 4.9))]))).primitive).toBe("helical_unscrew");
    expect(onlyStep(compile(solvedPlan([stepFor(screw, tilted(SCREW_AXIS, 5.1))]))).primitive).toBe("linear_slide");
    // The same holds for the opposite sign of the axis.
    expect(onlyStep(compile(solvedPlan([stepFor(screw, tilted(neg(SCREW_AXIS), 4.9))]))).primitive).toBe("helical_unscrew");
    expect(onlyStep(compile(solvedPlan([stepFor(screw, tilted(neg(SCREW_AXIS), 5.1))]))).primitive).toBe("linear_slide");
  });

  it("follows a configured tolerance and a configured thread pitch", () => {
    const wide = { helicalAngularToleranceDeg: 10, threadPitch: 0.02 };
    const trajectory = onlyStep(compile(solvedPlan([stepFor(screw, tilted(SCREW_AXIS, 7))]), wide));
    expect(trajectory.primitive).toBe("helical_unscrew");
    expect((trajectory.params as HelicalUnscrewParams).pitch).toBe(0.02);
    const narrow = { helicalAngularToleranceDeg: 1 };
    expect(onlyStep(compile(solvedPlan([stepFor(screw, tilted(SCREW_AXIS, 2))]), narrow)).primitive).toBe("linear_slide");
  });

  it("does not apply to a Fastener moving across its axis, or to a non-Fastener along its axis", () => {
    expect(onlyStep(compile(solvedPlan([stepFor(screw, perpendicularTo(SCREW_AXIS))]))).primitive).toBe("linear_slide");
    expect(onlyStep(compile(solvedPlan([stepFor(plate, plate.frame.axes[0])]))).primitive).toBe("linear_slide");
  });

  it("applies the 5 degree rule to the classification, with no per-Part overrides (Req 15.6)", () => {
    expect(helicalUnscrew.isApplicable(stepFor(screw, SCREW_AXIS), infoOf(screw, true), CTX)).toBe(true);
    expect(helicalUnscrew.isApplicable(stepFor(screw, SCREW_AXIS), infoOf(screw, false), CTX)).toBe(false);
  });

  it("makes linear_slide apply to every step (Req 19.6)", () => {
    for (const dir of [SCREW_AXIS, perpendicularTo(SCREW_AXIS), [0, 0, 0] as Vec3]) {
      expect(linearSlide.isApplicable(stepFor(screw, dir), infoOf(screw, true), CTX)).toBe(true);
    }
  });

  it("matches an independent angle test for every step of a Peel_Solver plan", () => {
    const plan = stage3Peel(stage1, stage2BuildDbg(stage1, stage1.config), stage1.config);
    const trajectory = compile(plan);
    expect(trajectory).toHaveLength(plan.steps.length);
    plan.steps.forEach((step, index) => {
      const part = stage1.parts.find((candidate) => candidate.partId === step.partId);
      if (part === undefined) {
        throw new Error(`no Part ${step.partId}`);
      }
      const angleDeg = (Math.acos(Math.min(1, Math.abs(dot(step.dir, part.frame.axes[0])))) * 180) / Math.PI;
      const expected = part.metrics.isFastener && angleDeg <= 5 ? "helical_unscrew" : "linear_slide";
      expect(trajectory[index]?.primitive, step.partId).toBe(expected);
      expect(trajectory[index]?.partId).toBe(step.partId);
    });
  });
});

// ---------------------------------------------------------------------------
// Poses (Req 18)
// ---------------------------------------------------------------------------

describe("helical_unscrew pose (Req 18.1, 18.2, 18.4, 18.6)", () => {
  const params = onlyStep(compile(solvedPlan([stepFor(screw, SCREW_AXIS)]))).params as HelicalUnscrewParams;
  // 0.03 / 0.01 = 3 full turns over the motion.
  const turns = SCREW_DISTANCE / DEFAULT_SOLVER_CONFIG.threadPitch;
  const samples = [0, 0.05, 0.1, 0.25, 1 / 3, 0.5, 0.77, 0.9, 1];
  const points: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0.3, -0.7, 0.2],
    [-2, 1, 4],
    [params.pivot[0] + 0.1, params.pivot[1], params.pivot[2] - 0.2],
  ];

  it("is the identity at t = 0", () => {
    const pose = helicalUnscrew.pose(0, params);
    expectVecClose(pose.rotation, IDENTITY);
    expectVecClose(pose.translation, [0, 0, 0]);
  });

  it("is a rotation at every sampled t", () => {
    for (const t of samples) {
      expectRigid(helicalUnscrew.pose(t, params));
    }
  });

  it("matches a quaternion reference: rotate by 2*pi*t*s/p about the axis through the OBB center, then slide t*s*dir", () => {
    for (const t of samples) {
      const pose = helicalUnscrew.pose(t, params);
      const angle = 2 * Math.PI * t * turns;
      for (const point of points) {
        const offset: Vec3 = [point[0] - params.pivot[0], point[1] - params.pivot[1], point[2] - params.pivot[2]];
        const rotated = rotateByQuaternion(params.axis, angle, offset);
        const expected = [
          params.pivot[0] + rotated[0] + t * params.distance * params.dir[0],
          params.pivot[1] + rotated[1] + t * params.distance * params.dir[1],
          params.pivot[2] + rotated[2] + t * params.distance * params.dir[2],
        ];
        expectVecClose(applyPose(pose, point), expected);
      }
    }
  });

  it("turns positively by the right-hand rule", () => {
    const quarter: HelicalUnscrewParams = {
      kind: "helical_unscrew",
      dir: [0, 0, 1],
      distance: 0.01,
      axis: [0, 0, 1],
      pivot: [1, 1, 0],
      pitch: 0.04,
    };
    // t = 1 gives theta = 2*pi*0.01/0.04 = pi/2, which takes +X to +Y about +Z.
    const pose = helicalUnscrew.pose(1, quarter);
    expectVecClose(pose.rotation, [0, -1, 0, 1, 0, 0, 0, 0, 1]);
    expectVecClose(applyPose(pose, [2, 1, 0]), [1, 2, 0.01]);
  });

  it("maps the OBB center to the center plus t*s*dir, even when the axis is tilted from dir (Req 18.6)", () => {
    const tiltedParams = onlyStep(compile(solvedPlan([stepFor(screw, tilted(SCREW_AXIS, 4.9))]))).params as HelicalUnscrewParams;
    for (const t of [0, 0.3, 0.8, 1]) {
      const moved = applyPose(helicalUnscrew.pose(t, tiltedParams), tiltedParams.pivot);
      expectVecClose(moved, [
        tiltedParams.pivot[0] + t * tiltedParams.distance * tiltedParams.dir[0],
        tiltedParams.pivot[1] + t * tiltedParams.distance * tiltedParams.dir[1],
        tiltedParams.pivot[2] + t * tiltedParams.distance * tiltedParams.dir[2],
      ]);
    }
    expectRigid(helicalUnscrew.pose(0.37, tiltedParams));
  });

  it("stays a rotation when the axis is unit only within 1e-9", () => {
    const loose: HelicalUnscrewParams = { ...params, axis: [params.axis[0] * (1 + 9e-10), params.axis[1] * (1 + 9e-10), params.axis[2] * (1 + 9e-10)] };
    expectRigid(helicalUnscrew.pose(0.41, loose));
  });
});

describe("linear_slide pose (Req 18.1, 18.3, 18.6)", () => {
  const params: LinearSlideParams = { kind: "linear_slide", dir: unit([1, 2, -2]), distance: 0.6 };

  it("is the identity at t = 0 and slides by t*s*dir with R = I", () => {
    expectVecClose(linearSlide.pose(0, params).translation, [0, 0, 0]);
    for (const t of [0, 0.25, 0.4, 1]) {
      const pose = linearSlide.pose(t, params);
      expectVecClose(pose.rotation, IDENTITY);
      expectVecClose(pose.translation, [t * 0.6 * params.dir[0], t * 0.6 * params.dir[1], t * 0.6 * params.dir[2]]);
      expectRigid(pose);
    }
  });

  it("builds its params from the step and moves the OBB center by s*dir at t = 1", () => {
    const step = stepFor(plate, plate.frame.axes[0], null, 0.25);
    const built = linearSlide.buildParams(step, infoOf(plate, false), CTX);
    expect(built).toEqual({ kind: "linear_slide", dir: step.dir, distance: 0.25 });
    expect(built.dir).not.toBe(step.dir);
    const center = plate.frame.obb.center;
    expectVecClose(applyPose(linearSlide.pose(1, built), center), [
      center[0] + 0.25 * step.dir[0],
      center[1] + 0.25 * step.dir[1],
      center[2] + 0.25 * step.dir[2],
    ]);
  });
});

describe("two_step_l_slide pose (Req 18.1, 18.5)", () => {
  const params: TwoStepLSlideParams = { kind: "two_step_l_slide", d1: [0, 0, 1], s1: 0.4, d2: [1, 0, 0], s2: 0.2 };

  it("moves 2t*s1*d1 in the first half and s1*d1 + (2t-1)*s2*d2 in the second, with R = I", () => {
    const expectations: [number, Vec3][] = [
      [0, [0, 0, 0]],
      [0.25, [0, 0, 0.2]],
      [0.5, [0, 0, 0.4]],
      [0.75, [0.1, 0, 0.4]],
      [1, [0.2, 0, 0.4]],
    ];
    for (const [t, translation] of expectations) {
      const pose = twoStepLSlide.pose(t, params);
      expectVecClose(pose.rotation, IDENTITY);
      expectVecClose(pose.translation, translation);
      expectRigid(pose);
    }
  });

  it("is continuous at t = 0.5", () => {
    const left = twoStepLSlide.pose(0.5, params).translation;
    const right = twoStepLSlide.pose(0.5 + 1e-12, params).translation;
    expectVecClose(left, right, 1e-9);
  });
});

describe("primitive rejection (Req 18.7, 18.8)", () => {
  const helical = onlyStep(compile(solvedPlan([stepFor(screw, SCREW_AXIS)]))).params as HelicalUnscrewParams;
  const linear: LinearSlideParams = { kind: "linear_slide", dir: [0, 0, 1], distance: 1 };
  const lSlide: TwoStepLSlideParams = { kind: "two_step_l_slide", d1: [1, 0, 0], s1: 1, d2: [0, 1, 0], s2: 1 };
  const poses: [string, (t: number) => Pose][] = [
    ["linear_slide", (t) => linearSlide.pose(t, linear)],
    ["helical_unscrew", (t) => helicalUnscrew.pose(t, helical)],
    ["two_step_l_slide", (t) => twoStepLSlide.pose(t, lSlide)],
  ];

  it("rejects t below 0, above 1, or not finite, with PrimitiveRangeError", () => {
    for (const [name, pose] of poses) {
      for (const t of [-1e-12, 1 + 1e-12, 2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(thrown(() => pose(t)), `${name} at t=${t}`).toBeInstanceOf(PrimitiveRangeError);
      }
      expect(() => pose(0)).not.toThrow();
      expect(() => pose(1)).not.toThrow();
    }
  });

  it("checks t before the parameters", () => {
    expect(thrown(() => linearSlide.pose(2, { kind: "linear_slide", dir: [0, 0, 0], distance: -1 }))).toBeInstanceOf(PrimitiveRangeError);
  });

  function badParam(run: () => unknown): string {
    const error = thrown(run);
    if (!(error instanceof PrimitiveParamError)) {
      throw new Error(`expected PrimitiveParamError, received ${String(error)}`);
    }
    return error.param;
  }

  it("rejects a direction whose length differs from 1 by more than 1e-9, or that is not finite", () => {
    const withDir = (dir: unknown): LinearSlideParams => ({ ...linear, dir: dir as Vec3 });
    expect(badParam(() => linearSlide.pose(0.5, withDir([0, 0, 1 + 2e-9])))).toBe("dir");
    expect(badParam(() => linearSlide.pose(0.5, withDir([0, 0, 0])))).toBe("dir");
    expect(badParam(() => linearSlide.pose(0.5, withDir([Number.NaN, 0, 0])))).toBe("dir");
    expect(badParam(() => linearSlide.pose(0.5, withDir([1, 0])))).toBe("dir");
    expect(() => linearSlide.pose(0.5, withDir([0, 0, 1 + 5e-10]))).not.toThrow();
  });

  it("rejects a negative or non-finite distance", () => {
    for (const distance of [-1e-12, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(badParam(() => linearSlide.pose(0.5, { ...linear, distance }))).toBe("distance");
      expect(badParam(() => helicalUnscrew.pose(0.5, { ...helical, distance }))).toBe("distance");
    }
    expect(badParam(() => twoStepLSlide.pose(0.5, { ...lSlide, s1: -1 }))).toBe("s1");
    expect(badParam(() => twoStepLSlide.pose(0.5, { ...lSlide, s2: Number.NaN }))).toBe("s2");
    expect(() => linearSlide.pose(0.5, { ...linear, distance: 0 })).not.toThrow();
  });

  it("rejects a thread pitch that is not finite or not above 0", () => {
    for (const pitch of [0, -0.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(badParam(() => helicalUnscrew.pose(0.5, { ...helical, pitch })), `pitch ${pitch}`).toBe("pitch");
    }
  });

  it("rejects a helical axis that is not a unit vector, or a pivot that is not finite", () => {
    expect(badParam(() => helicalUnscrew.pose(0.5, { ...helical, axis: [0, 0, 2] }))).toBe("axis");
    expect(badParam(() => helicalUnscrew.pose(0.5, { ...helical, pivot: [0, Number.NaN, 0] }))).toBe("pivot");
  });

  it("rejects two_step_l_slide directions whose absolute dot product exceeds 1e-9", () => {
    expect(badParam(() => twoStepLSlide.pose(0.5, { ...lSlide, d2: [1, 0, 0] }))).toBe("d2");
    expect(badParam(() => twoStepLSlide.pose(0.5, { ...lSlide, d2: neg(lSlide.d1) }))).toBe("d2");
    const nearlyOrthogonal = (dotValue: number): Vec3 => [dotValue, Math.sqrt(1 - dotValue * dotValue), 0];
    expect(badParam(() => twoStepLSlide.pose(0.5, { ...lSlide, d2: nearlyOrthogonal(2e-9) }))).toBe("d2");
    expect(() => twoStepLSlide.pose(0.5, { ...lSlide, d2: nearlyOrthogonal(5e-10) })).not.toThrow();
    expect(badParam(() => twoStepLSlide.pose(0.5, { ...lSlide, d1: [3, 0, 0] }))).toBe("d1");
  });

  it("rejects parameters that are not an object", () => {
    expect(badParam(() => linearSlide.pose(0.5, null as unknown as LinearSlideParams))).toBe("params");
  });

  it("refuses to build two_step_l_slide params from a step with no secondary", () => {
    expect(badParam(() => twoStepLSlide.buildParams(stepFor(plate, [1, 0, 0]), infoOf(plate, false), CTX))).toBe("secondary");
  });
});
