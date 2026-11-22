import fc from "fast-check";
import { Box3, Quaternion, Vector3, type BufferGeometry } from "three";
import type { MeshBVHOptions } from "three-mesh-bvh";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Stage1FailureError } from "../../src/errors";
import { assertAllCollinearAssembly } from "../../src/stage1/axisGenerator";
import { CANONICAL_DIRECTIONS, CANDIDATE_AXIS_COUNT, CANONICAL_DIRECTION_COUNT } from "../../src/stage1/candidateAxes";
import { normalizeParts } from "../../src/stage1/normalizer";
import { computePartMetrics } from "../../src/stage1/partMetrics";
import { stage1Prepare } from "../../src/stage1/stage1";
import { stage0ParseScene } from "../../src/stage0/stage0";
import type { ErrorResult, NormalizationTransform, NormalizedPart, Part, PartFrame, Stage0Result, Vec3 } from "../../src/types";
import { assemblyArbitrary } from "../arbitraries/assemblies";
import { se3Arbitrary, type Quaternion4 } from "../arbitraries/se3";
import { applySe3 } from "../helpers/applySe3";
import {
  CUBE_POSITIONS,
  CUBE_TRIANGLES,
  OCTAHEDRON_POSITIONS,
  OCTAHEDRON_TRIANGLES,
  PYRAMID_POSITIONS,
  PYRAMID_TRIANGLES,
  SKEWED_HEXAHEDRON_POSITIONS,
  TIGHT_FRAME_TRIANGLES,
  collinearSegment,
  groupOf,
  meshFromArrays,
  permuteVertices,
  prepare,
  referenceBox,
  requireStage0,
  requireStage1,
  tightFramePositions,
} from "../helpers/handMeshes";

// The mock behaves like the real library unless a test switches it on, so every other test in
// this file uses real BVHs.
const control = vi.hoisted(() => ({
  constructorError: null as Error | null,
  rootBox: "real" as "real" | "too-small" | "too-large",
}));

vi.mock("three-mesh-bvh", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three-mesh-bvh")>();
  class ControlledMeshBVH extends actual.MeshBVH {
    constructor(geometry: BufferGeometry, options?: MeshBVHOptions) {
      if (control.constructorError !== null) {
        throw control.constructorError;
      }
      super(geometry, options);
    }

    override getBoundingBox(target: Box3): Box3 {
      const box = super.getBoundingBox(target);
      if (control.rootBox === "too-small") {
        box.expandByScalar(-1e-3);
      } else if (control.rootBox === "too-large") {
        box.expandByScalar(1e-3);
      }
      return box;
    }
  }
  return { ...actual, MeshBVH: ControlledMeshBVH };
});

afterEach(() => {
  control.constructorError = null;
  control.rootBox = "real";
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns what `action` throws, so a test can inspect its fields. The error is not swallowed. */
function captureThrown(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

function stage0Of(...meshes: ReturnType<typeof meshFromArrays>[]): Stage0Result {
  return requireStage0(stage0ParseScene(groupOf(...meshes)));
}

function requireError(result: { status: string }): ErrorResult {
  if (result.status !== "error") {
    throw new Error(`expected an error result, received status ${result.status}`);
  }
  return result as ErrorResult;
}

function partById(parts: readonly NormalizedPart[], partId: string): NormalizedPart {
  const part = parts.find((candidate) => candidate.partId === partId);
  if (part === undefined) {
    throw new Error(`no Part ${partId}; have ${parts.map((p) => p.partId).join(", ")}`);
  }
  return part;
}

function dot(a: readonly number[], b: readonly number[]): number {
  return (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
}

/** Indexed read that throws instead of returning `undefined`, for `noUncheckedIndexedAccess`. */
function num(list: ArrayLike<number>, index: number): number {
  const value = list[index];
  if (value === undefined) {
    throw new RangeError(`index ${index} is outside a list of length ${list.length}`);
  }
  return value;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function rotate(q: Quaternion4, v: readonly number[]): Vec3 {
  const r = new Vector3(v[0], v[1], v[2]).applyQuaternion(new Quaternion(q[0], q[1], q[2], q[3]));
  return [r.x, r.y, r.z];
}

/** Req 9.3, 9.4, 10.4, 10.5: orthonormal right-handed axes, OBB that bounds every vertex, 32 unit axes. */
function expectValidFrame(part: NormalizedPart): void {
  const { axes, obb } = part.frame;
  for (let i = 0; i < 3; i++) {
    expect(Math.hypot(...(axes[i] ?? [0, 0, 0])), `|axis ${i}|`).toBeCloseTo(1, 9);
    for (let j = i + 1; j < 3; j++) {
      expect(Math.abs(dot(axes[i] ?? [], axes[j] ?? [])), `axis ${i} · axis ${j}`).toBeLessThanOrEqual(1e-9);
    }
  }
  const handed = cross(axes[0], axes[1]);
  for (let k = 0; k < 3; k++) {
    expect(Math.abs(num(handed, k) - num(axes[2], k)), `axis 1 × axis 2, component ${k}`).toBeLessThanOrEqual(1e-9);
  }
  for (let k = 0; k < 3; k++) {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < part.positions.length; i += 3) {
      const offset = [0, 1, 2].map((c) => (part.positions[i + c] ?? 0) - obb.center[c]!);
      const projection = dot(offset, axes[k] ?? []);
      lo = Math.min(lo, projection);
      hi = Math.max(hi, projection);
    }
    expect(lo, `OBB min along axis ${k}`).toBeCloseTo(-num(obb.halfExtents, k), 9);
    expect(hi, `OBB max along axis ${k}`).toBeCloseTo(num(obb.halfExtents, k), 9);
  }
  expect(part.candidateAxes).toHaveLength(CANDIDATE_AXIS_COUNT);
  for (const axis of part.candidateAxes) {
    expect(axis.every((component) => Number.isFinite(component))).toBe(true);
    expect(Math.hypot(...axis)).toBeCloseTo(1, 9);
  }
}

function rulesOf(frame: PartFrame, subject: "axis" | "sign"): string[] {
  return frame.decisions.filter((d) => d.subject === subject).map((d) => `${d.axis}:${d.rule}`);
}

// ---------------------------------------------------------------------------
// Normalizer (Req 8)
// ---------------------------------------------------------------------------

describe("Normalizer", () => {
  it("scales to maxExtent 1, centers at the origin, round-trips and leaves its input unchanged", () => {
    const stage0 = stage0Of(meshFromArrays(CUBE_POSITIONS, CUBE_TRIANGLES, [10, 20, 30]), referenceBox([15, 22, 29]));
    const before = stage0.parts.map((part) => Float64Array.from(part.positions));
    const result = normalizeParts(stage0.parts);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const part of result.parts) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, num(part.aabb.min, k));
        hi[k] = Math.max(hi[k]!, num(part.aabb.max, k));
      }
    }
    expect(Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!)).toBeCloseTo(1, 9);
    for (let k = 0; k < 3; k++) {
      expect(Math.abs((lo[k]! + hi[k]!) / 2)).toBeLessThanOrEqual(1e-9);
    }
    const { scale, translation } = result.normalization;
    expect(scale).toBeGreaterThan(0);
    stage0.parts.forEach((part, i) => {
      const normalized = result.parts[i];
      for (let c = 0; c < part.positions.length; c++) {
        const restored = ((normalized?.positions[c] ?? Number.NaN) - (translation[c % 3] ?? 0)) / scale;
        expect(Math.abs(restored - (before[i]?.[c] ?? Number.NaN))).toBeLessThanOrEqual(1e-9 * 10);
      }
      expect(part.positions).toEqual(before[i]);
    });
  });

  it("returns zero-extent for an Assembly whose vertices all coincide", () => {
    const stage0 = stage0Of(meshFromArrays(CUBE_POSITIONS, CUBE_TRIANGLES), referenceBox());
    const collapsed = { ...stage0, parts: stage0.parts.map((part) => ({ ...part, positions: new Float64Array(part.positions.length) })) };
    const result = requireError(stage1Prepare(collapsed));
    expect(result.error).toMatchObject({ kind: "InvalidGeometryError", reason: "zero-extent", nodePaths: [] });
  });

  it("returns non-finite-scale for a subnormal extent (Req 8.7)", () => {
    const stage0 = stage0Of(meshFromArrays(CUBE_POSITIONS, CUBE_TRIANGLES), referenceBox());
    const tiny = { ...stage0, parts: stage0.parts.map((part) => ({ ...part, positions: part.positions.map((v) => v * 1e-320) })) };
    const maxExtent = Math.max(...tiny.parts.flatMap((part) => Array.from(part.positions)));
    expect(maxExtent).toBeGreaterThan(0);
    expect(1 / maxExtent).toBe(Number.POSITIVE_INFINITY);
    const result = requireError(stage1Prepare(tiny));
    expect(result.error).toMatchObject({ kind: "InvalidGeometryError", reason: "non-finite-scale", nodePaths: [] });
  });

  it("returns non-finite and names the node path when a coordinate is NaN", () => {
    const stage0 = stage0Of(meshFromArrays(CUBE_POSITIONS, CUBE_TRIANGLES), referenceBox());
    const second = stage0.parts[1];
    if (second === undefined) {
      throw new Error("expected two Parts");
    }
    const broken = Float64Array.from(second.positions);
    broken[1] = Number.NaN;
    const result = requireError(stage1Prepare({ ...stage0, parts: [stage0.parts[0] as Part, { ...second, positions: broken }] }));
    expect(result.error).toMatchObject({ kind: "InvalidGeometryError", reason: "non-finite", nodePaths: [[1]] });
  });

  it("returns an incoming ErrorResult unchanged and a ConfigurationError for a bad config", () => {
    const incoming = requireError(stage0ParseScene(groupOf(), undefined));
    expect(stage1Prepare(incoming)).toBe(incoming);
    const stage0 = stage0Of(meshFromArrays(CUBE_POSITIONS, CUBE_TRIANGLES), referenceBox());
    const invalid = requireError(stage1Prepare(stage0, { tau: 2 }));
    expect(invalid.error.kind).toBe("ConfigurationError");
  });

  it("emits Parts in ascending Part_ID order with the resolved config and the normalization", () => {
    const stage1 = prepare(groupOf(meshFromArrays(CUBE_POSITIONS, CUBE_TRIANGLES), referenceBox(), referenceBox([-4, 0, 0])));
    expect(stage1.parts.map((part) => part.partId)).toEqual(["/0#0", "/1#0", "/2#0"]);
    expect(stage1.config.samplesPerPartPerDirection).toBe(48);
    expect(stage1.normalization.scale).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// BVH_Builder (Req 9.1, 9.2, 9.10, 9.11)
// ---------------------------------------------------------------------------

describe("BVH_Builder", () => {
  it("builds one BVH per Part, keeps the index buffer in triangle order and bounds the exact AABB", () => {
    const stage1 = prepare(groupOf(meshFromArrays(SKEWED_HEXAHEDRON_POSITIONS, CUBE_TRIANGLES), referenceBox()));
    expect(stage1.parts).toHaveLength(2);
    for (const part of stage1.parts) {
      const index = part.bvh.geometry.getIndex();
      expect(Array.from(index?.array ?? [])).toEqual(Array.from(part.triangles));
      const box = part.bvh.getBoundingBox(new Box3());
      const root = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
      for (let k = 0; k < 3; k++) {
        expect(root[k]!).toBeLessThanOrEqual(num(part.aabb.min, k));
        expect(root[3 + k]!).toBeGreaterThanOrEqual(num(part.aabb.max, k));
        expect(num(part.aabb.min, k) - root[k]!).toBeLessThanOrEqual(1e-6);
        expect(root[3 + k]! - num(part.aabb.max, k)).toBeLessThanOrEqual(1e-6);
      }
    }
  });

  it("holds the root-box guarantee for every Part of 40 generated Assemblies", () => {
    const assemblies = fc.sample(assemblyArbitrary(), { seed: 0x0b0b, numRuns: 40 });
    for (const assembly of assemblies) {
      const stage1 = requireStage1(stage1Prepare(stage0ParseScene(assembly.root)));
      expect(stage1.parts).toHaveLength(assembly.parts.length);
      for (const part of stage1.parts) {
        const box = part.bvh.getBoundingBox(new Box3());
        const root = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
        for (let k = 0; k < 3; k++) {
          expect(root[k]!, `${assembly.layout} ${part.partId} min ${k}`).toBeLessThanOrEqual(num(part.aabb.min, k));
          expect(root[3 + k]!, `${assembly.layout} ${part.partId} max ${k}`).toBeGreaterThanOrEqual(num(part.aabb.max, k));
          expect(num(part.aabb.min, k) - root[k]!).toBeLessThanOrEqual(1e-6);
          expect(root[3 + k]! - num(part.aabb.max, k)).toBeLessThanOrEqual(1e-6);
        }
      }
    }
  });

  it("rethrows a failing MeshBVH constructor as Stage1FailureError with the Part_ID, component and cause", () => {
    const stage0 = stage0Of(meshFromArrays(CUBE_POSITIONS, CUBE_TRIANGLES), referenceBox());
    const injected = new Error("injected constructor failure");
    control.constructorError = injected;
    const thrown = captureThrown(() => stage1Prepare(stage0));
    expect(thrown).toBeInstanceOf(Stage1FailureError);
    const failure = thrown as Stage1FailureError;
    expect(failure.partId).toBe("/0#0");
    expect(failure.component).toBe("BVH_Builder");
    expect(failure.cause).toBe(injected);
  });

  it.each(["too-small", "too-large"] as const)("throws Stage1FailureError when the root box is %s (Req 9.2)", (mode) => {
    const stage0 = stage0Of(meshFromArrays(CUBE_POSITIONS, CUBE_TRIANGLES), referenceBox());
    control.rootBox = mode;
    const thrown = captureThrown(() => stage1Prepare(stage0));
    expect(thrown).toBeInstanceOf(Stage1FailureError);
    const failure = thrown as Stage1FailureError;
    expect(failure).toMatchObject({ partId: "/0#0", component: "BVH_Builder" });
    expect(failure.cause).toBeInstanceOf(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Part metrics (Req 15.2, 15.5, 15.6, 19.4, 19.8)
// ---------------------------------------------------------------------------

describe("Part metrics", () => {
  const config = { fastenerSymmetryTolerance: 0.1, fastenerSlendernessThreshold: 2 };

  it("sorts extents, computes slenderness and classifies Fasteners from geometry and config only", () => {
    const screw = computePartMetrics([0.05, 0.4, 0.052], config);
    expect(screw.extentsSorted).toEqual([0.8, 0.104, 0.1]);
    expect(screw.slenderness).toBeCloseTo(0.8 / ((0.104 + 0.1) / 2), 12);
    expect(screw.isFastener).toBe(true);

    const plate = computePartMetrics([0.4, 0.3, 0.02], config);
    expect(plate.isFastener).toBe(false); // short extents differ by far more than 10%

    const cube = computePartMetrics([0.2, 0.2, 0.2], config);
    expect(cube.slenderness).toBe(1);
    expect(cube.isFastener).toBe(false); // below the slenderness threshold
  });

  it("treats two zero short extents as infinite slenderness, never NaN", () => {
    const needle = computePartMetrics([0.5, 0, 0], config);
    expect(needle.slenderness).toBe(Number.POSITIVE_INFINITY);
    expect(needle.isFastener).toBe(true);
    const point = computePartMetrics([0, 0, 0], config);
    expect(Number.isNaN(point.slenderness)).toBe(false);
  });

  it("applies the tolerances at their boundaries", () => {
    expect(computePartMetrics([2, 0.5, 0.45], config).isFastener).toBe(true); // |e2-e3| = 0.1 = 0.1 * 1
    expect(computePartMetrics([2, 0.5, 0.44], config).isFastener).toBe(false);
    expect(computePartMetrics([1, 0.5, 0.5], { ...config, fastenerSlendernessThreshold: 2 }).isFastener).toBe(true); // slenderness exactly 2
  });
});

// ---------------------------------------------------------------------------
// Canonical directions and Candidate_Axes (Req 10.1 to 10.4)
// ---------------------------------------------------------------------------

describe("Canonical directions", () => {
  const nonZeroCount = (direction: readonly number[]): number => direction.filter((c) => c !== 0).length;

  it("has 26 distinct unit directions: 6 faces, 12 edge diagonals, 8 corner diagonals", () => {
    expect(CANONICAL_DIRECTIONS).toHaveLength(CANONICAL_DIRECTION_COUNT);
    expect(new Set(CANONICAL_DIRECTIONS.map((d) => d.join(","))).size).toBe(26);
    const counts = [1, 2, 3].map((n) => CANONICAL_DIRECTIONS.filter((d) => nonZeroCount(d) === n).length);
    expect(counts).toEqual([6, 12, 8]);
    for (const direction of CANONICAL_DIRECTIONS) {
      expect(Math.hypot(...direction)).toBeCloseTo(1, 15);
      const n = nonZeroCount(direction);
      for (const component of direction) {
        expect(component === 0 || Math.abs(component) === (n === 1 ? 1 : n === 2 ? Math.SQRT1_2 : 1 / Math.sqrt(3))).toBe(true);
        expect(Object.is(component, -0)).toBe(false);
      }
    }
  });

  it("orders faces +X, -X, +Y, -Y, +Z, -Z first, then edges, then corners", () => {
    expect(CANONICAL_DIRECTIONS.slice(0, 6).map((d) => [...d])).toEqual([
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ]);
    expect(CANONICAL_DIRECTIONS.slice(6, 18).every((d) => nonZeroCount(d) === 2)).toBe(true);
    expect(CANONICAL_DIRECTIONS.slice(18, 26).every((d) => nonZeroCount(d) === 3)).toBe(true);
  });

  it("makes each negation bitwise equal to the opposite entry", () => {
    const keys = new Map(CANONICAL_DIRECTIONS.map((d, i) => [d.map((c) => Object.is(c, -0) ? "-0" : String(c)).join(","), i]));
    for (const direction of CANONICAL_DIRECTIONS) {
      const negated = direction.map((c) => (c === 0 ? 0 : -c));
      expect(keys.has(negated.join(",")), `negation of ${direction.join(",")}`).toBe(true);
    }
  });

  it("gives every Part 32 axes: 26 canonical, then +PCA1, -PCA1, +PCA2, -PCA2, +PCA3, -PCA3", () => {
    const stage1 = prepare(groupOf(meshFromArrays(SKEWED_HEXAHEDRON_POSITIONS, CUBE_TRIANGLES), referenceBox()));
    for (const part of stage1.parts) {
      expect(part.candidateAxes).toHaveLength(32);
      CANONICAL_DIRECTIONS.forEach((direction, i) => expect(part.candidateAxes[i]).toEqual([...direction]));
      part.frame.axes.forEach((axis, k) => {
        expect(part.candidateAxes[26 + 2 * k]).toEqual(axis.map((c) => c + 0));
        expect(part.candidateAxes[27 + 2 * k]).toEqual(axis.map((c) => -c + 0));
      });
    }
  });

  it("keeps a PCA axis even when it equals a canonical direction", () => {
    // An axis-aligned box: its PCA axes are canonical, and the six PCA entries stay.
    const stage1 = prepare(groupOf(meshFromArrays([0, 0, 0, 4, 0, 0, 4, 2, 0, 0, 2, 0, 0, 0, 1, 4, 0, 1, 4, 2, 1, 0, 2, 1], CUBE_TRIANGLES), referenceBox([8, 0, 0])));
    const part = partById(stage1.parts, "/0#0");
    expect(part.candidateAxes).toHaveLength(32);
    expect(Math.abs(part.frame.axes[0][0])).toBeCloseTo(1, 12);
    expect(part.candidateAxes.slice(26).map((axis) => Math.hypot(...axis))).toEqual(Array(6).fill(expect.closeTo(1, 12)));
  });
});

// ---------------------------------------------------------------------------
// Intrinsic_Frame_Rule branches (Req 9.5 to 9.9, 10.7)
// ---------------------------------------------------------------------------

describe("Intrinsic_Frame_Rule", () => {
  it("resolves distinct eigenvalues from the eigenvectors and the skew, and is Frame_Unique", () => {
    const stage1 = prepare(groupOf(meshFromArrays(SKEWED_HEXAHEDRON_POSITIONS, CUBE_TRIANGLES), referenceBox()));
    const part = partById(stage1.parts, "/0#0");
    expectValidFrame(part);
    expect(rulesOf(part.frame, "axis")).toEqual(["PCA1:eigen", "PCA2:eigen", "PCA3:eigen"]);
    expect(rulesOf(part.frame, "sign")).toEqual(["PCA1:skew", "PCA2:skew"]);
    expect(part.frame.frameUnique).toBe(true);
    expect(part.frame.minRelativeMargin).toBeGreaterThanOrEqual(1e-3);
  });

  it("takes the farthest-vertex branch for a tied Part made unique by one far vertex", () => {
    const stage1 = prepare(groupOf(meshFromArrays(tightFramePositions(), TIGHT_FRAME_TRIANGLES), referenceBox()));
    const part = partById(stage1.parts, "/0#0");
    expectValidFrame(part);
    const [v1, v2, v3] = part.frame.variances;
    expect(Math.abs(v1 - v3)).toBeLessThanOrEqual(1e-9 * v1); // all three eigenvalues tied
    expect(rulesOf(part.frame, "axis")).toEqual(["PCA1:farthest", "PCA2:farthest"]);
    expect(v2).toBeGreaterThan(0);
    expect(part.frame.frameUnique).toBe(true);
  });

  it("takes the largest-face branch when the farthest-vertex sum cancels, then fallback F1", () => {
    const stage1 = prepare(groupOf(meshFromArrays(OCTAHEDRON_POSITIONS, OCTAHEDRON_TRIANGLES), referenceBox()));
    const part = partById(stage1.parts, "/0#0");
    expectValidFrame(part);
    expect(rulesOf(part.frame, "axis")).toEqual(["PCA1:largest-face", "PCA2:F1"]);
    // The largest-face step picks the shared normal (1,1,1)/sqrt(3) as PCA1 (up to sign).
    expect(Math.abs(dot(part.frame.axes[0], [1, 1, 1])) / Math.sqrt(3)).toBeCloseTo(1, 9);
    expect(part.frame.frameUnique).toBe(false); // F1 was used, so the Part is Frame_Ambiguous
  });

  it("takes fallback F1 for a regular tetrahedron-like Part with no geometric preference", () => {
    // A square plate: 4 equal corners, equal triangles, normals orthogonal to the tied plane.
    const plate = [1, 1, 0, -1, 1, 0, -1, -1, 0, 1, -1, 0];
    const stage1 = prepare(groupOf(meshFromArrays(plate, [0, 2, 1, 0, 3, 2]), referenceBox([4, 0, 0])));
    const part = partById(stage1.parts, "/0#0");
    expectValidFrame(part);
    expect(rulesOf(part.frame, "axis")).toContain("PCA1:F1");
    expect(part.frame.frameUnique).toBe(false);
  });

  it("resolves a collinear Part inside a non-collinear Assembly through F2, never F3", () => {
    const segment = collinearSegment(-0.1, 0.1);
    const stage1 = prepare(groupOf(meshFromArrays(segment.positions, segment.triangles), referenceBox()));
    const part = partById(stage1.parts, "/0#0");
    expectValidFrame(part);
    const decisions = part.frame.decisions.map((d) => d.rule);
    expect(decisions).toContain("F2");
    expect(decisions).not.toContain("F3");
    expect(part.frame.frameUnique).toBe(false);
    // The segment lies on the x axis, so PCA1 is along it.
    expect(Math.abs(part.frame.axes[0][0])).toBeCloseTo(1, 9);
  });

  it("resolves a Part whose vertices all coincide through F2", () => {
    const stage1 = prepare(groupOf(meshFromArrays([0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2], [0, 1, 2]), referenceBox()));
    const part = partById(stage1.parts, "/0#0");
    expectValidFrame(part);
    expect(part.frame.variances).toEqual([0, 0, 0]);
    expect(part.frame.decisions.map((d) => d.rule)).not.toContain("F3");
    expect(part.frame.frameUnique).toBe(false);
  });

  it("reaches F3 only in an All_Collinear_Assembly and completes the frame with the orthonormal basis", () => {
    const first = collinearSegment(-0.1, 0.1);
    const second = collinearSegment(0.3, 0.5);
    const stage1 = prepare(groupOf(meshFromArrays(first.positions, first.triangles), meshFromArrays(second.positions, second.triangles)));
    for (const part of stage1.parts) {
      expectValidFrame(part);
      expect(rulesOf(part.frame, "axis")).toEqual(["PCA1:eigen", "PCA2:F3", "PCA3:F3"]);
      expect(Math.abs(part.frame.axes[0][0])).toBeCloseTo(1, 9);
      expect(part.frame.frameUnique).toBe(false);
    }
  });

  it("refuses F3 for an Assembly that is not collinear (Req 9.5)", () => {
    const stage0 = stage0Of(meshFromArrays(CUBE_POSITIONS, CUBE_TRIANGLES), referenceBox());
    const failure = captureThrown(() => assertAllCollinearAssembly(stage0.parts, [0, 0, 0], [1, 0, 0], "/0#0"));
    expect(failure).toBeInstanceOf(Stage1FailureError);
    expect(failure).toMatchObject({ partId: "/0#0", component: "Axis_Generator" });
    // A line that really contains every vertex passes.
    const first = collinearSegment(-0.1, 0.1);
    const second = collinearSegment(0.3, 0.5);
    const collinear = stage0Of(meshFromArrays(first.positions, first.triangles), meshFromArrays(second.positions, second.triangles));
    expect(() => assertAllCollinearAssembly(collinear.parts, [0, 0, 0], [1, 0, 0], "/0#0")).not.toThrow();
  });

  it("does not depend on vertex index order for the farthest-vertex tie-break", () => {
    const orders = [
      [0, 1, 2, 3, 4],
      [4, 3, 2, 1, 0],
      [2, 4, 0, 3, 1],
      [3, 0, 4, 1, 2],
    ];
    const cases = [
      { name: "pyramid", positions: PYRAMID_POSITIONS, triangles: PYRAMID_TRIANGLES },
      { name: "tight frame", positions: tightFramePositions(), triangles: TIGHT_FRAME_TRIANGLES },
    ];
    for (const { name, positions, triangles } of cases) {
      const reference = partById(prepare(groupOf(meshFromArrays(positions, triangles), referenceBox())).parts, "/0#0");
      expect(rulesOf(reference.frame, "axis")[0], name).toBe("PCA1:farthest");
      for (const order of orders) {
        const permuted = permuteVertices(positions, triangles, order);
        const part = partById(prepare(groupOf(meshFromArrays(permuted.positions, permuted.triangles), referenceBox())).parts, "/0#0");
        expectValidFrame(part);
        part.frame.axes.forEach((axis, k) => {
          axis.forEach((component, c) => {
            expect(Math.abs(component - reference.frame.axes[k]![c]!), `${name} order ${order.join("")} axis ${k}[${c}]`).toBeLessThanOrEqual(1e-9);
          });
        });
      }
    }
  });

  it("gives identical bits when the same Assembly is prepared twice (Req 9.6, 10.6)", () => {
    const build = () => groupOf(meshFromArrays(tightFramePositions(), TIGHT_FRAME_TRIANGLES), referenceBox());
    const a = partById(prepare(build()).parts, "/0#0");
    const b = partById(prepare(build()).parts, "/0#0");
    expect(b.frame).toEqual(a.frame);
    expect(b.candidateAxes).toEqual(a.candidateAxes);
  });
});

// ---------------------------------------------------------------------------
// SE(3) equivariance (Req 9.8), seeded
// ---------------------------------------------------------------------------

interface Analysis {
  frame: PartFrame;
  normalization: NormalizationTransform;
  /** OBB center in pre-normalization world space. */
  centerWorld: Vec3;
  /** OBB half-extents in pre-normalization world space. */
  halfWorld: Vec3;
  /** Diagonal of the Assembly AABB in world space. */
  diagonal: number;
}

function analyse(root: ReturnType<typeof groupOf>, partId: string): Analysis {
  const stage0 = requireStage0(stage0ParseScene(root));
  const stage1 = requireStage1(stage1Prepare(stage0));
  const part = partById(stage1.parts, partId);
  const { scale, translation } = stage1.normalization;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const source of stage0.parts) {
    for (let i = 0; i < source.positions.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3]!, source.positions[i]!);
      hi[i % 3] = Math.max(hi[i % 3]!, source.positions[i]!);
    }
  }
  const { center, halfExtents } = part.frame.obb;
  return {
    frame: part.frame,
    normalization: stage1.normalization,
    centerWorld: [0, 1, 2].map((k) => (center[k]! - translation[k]!) / scale) as Vec3,
    halfWorld: halfExtents.map((h) => h / scale) as Vec3,
    diagonal: Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!),
  };
}

const EQUIVARIANCE_SEED = 0x5e3e91a;

describe("SE(3) equivariance of Frame_Unique frames (Req 9.8)", () => {
  const subjects = [
    {
      name: "a Frame_Unique Part with distinct eigenvalues",
      build: () => meshFromArrays(SKEWED_HEXAHEDRON_POSITIONS, CUBE_TRIANGLES),
      tied: false,
      axisRule: "eigen",
    },
    {
      name: "a tied-eigenvalue asymmetric Part resolved by the farthest vertex",
      build: () => meshFromArrays(tightFramePositions(), TIGHT_FRAME_TRIANGLES),
      tied: true,
      axisRule: "farthest",
    },
  ];

  for (const subject of subjects) {
    it(`maps axes, OBB center and half-extents of ${subject.name} under 100 seeded SE(3) transforms`, () => {
      const buildRoot = () => groupOf(subject.build(), referenceBox());
      const base = analyse(buildRoot(), "/0#0");

      // The subject must be what its name says, or the property would check nothing.
      expect(base.frame.frameUnique).toBe(true);
      expect(base.frame.decisions.some((d) => d.subject === "axis" && d.rule === subject.axisRule)).toBe(true);
      const spread = (base.frame.variances[0] - base.frame.variances[2]) / base.frame.variances[0];
      if (subject.tied) {
        expect(spread).toBeLessThanOrEqual(1e-9);
      } else {
        expect(spread).toBeGreaterThan(1e-3);
      }

      fc.assert(
        fc.property(se3Arbitrary, (transform) => {
          const root = buildRoot();
          applySe3(root, transform);
          const moved = analyse(root, "/0#0");
          expect(moved.frame.frameUnique).toBe(true);

          // Axes: same order, same signs, rotated.
          for (let k = 0; k < 3; k++) {
            const expected = rotate(transform.quaternion, base.frame.axes[k]!);
            for (let c = 0; c < 3; c++) {
              expect(Math.abs(moved.frame.axes[k]![c]! - expected[c]!), `axis ${k} component ${c}`).toBeLessThanOrEqual(1e-6);
            }
          }

          // OBB in world space: center moves rigidly, half-extents are unchanged.
          const rotatedCenter = rotate(transform.quaternion, base.centerWorld);
          const tolerance = 1e-6 * moved.diagonal;
          for (let c = 0; c < 3; c++) {
            const expectedCenter = rotatedCenter[c]! + transform.translation[c]!;
            expect(Math.abs(moved.centerWorld[c]! - expectedCenter), `center component ${c}`).toBeLessThanOrEqual(tolerance);
            expect(Math.abs(moved.halfWorld[c]! - base.halfWorld[c]!), `half-extent ${c}`).toBeLessThanOrEqual(tolerance);
          }
        }),
        { seed: EQUIVARIANCE_SEED, numRuns: 100 },
      );
    });
  }
});
