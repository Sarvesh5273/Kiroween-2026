import type { Mesh } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as core from "@unboltkit/core";
import packageManifest from "../../package.json";
import { CUBE_POSITIONS, CUBE_TRIANGLES, groupOf, meshFromArrays, prepare, requireStage1 } from "../helpers/handMeshes";
import { isPlainData } from "../helpers/plainData";

afterEach(() => {
  vi.restoreAllMocks();
});

type Triple = [number, number, number];

/** An axis-aligned box built from the unit cube. */
function boxMesh(min: Triple, max: Triple): Mesh {
  const positions: number[] = [];
  for (let i = 0; i < CUBE_POSITIONS.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const t = CUBE_POSITIONS[i + k] ?? 0;
      positions.push((min[k] ?? 0) + t * ((max[k] ?? 0) - (min[k] ?? 0)));
    }
  }
  return meshFromArrays(positions, CUBE_TRIANGLES);
}

function isThenable(value: unknown): boolean {
  return (
    value instanceof Promise ||
    ((typeof value === "object" || typeof value === "function") && value !== null && typeof (value as { then?: unknown }).then === "function")
  );
}

const FUNCTION_EXPORTS = [
  // Req 30.1 and 30.2
  "solveDisassembly",
  "stage0ParseScene",
  "stage1Prepare",
  "stage2BuildDbg",
  "stage3Peel",
  "stage4Compile",
  "createPrimitiveRegistry",
  "createDefaultPrimitiveRegistry",
  "checkClashes",
  "computeNaiveRadialClashes",
  "validateConfig",
  "computeSamplingMetadata",
] as const;

const ERROR_EXPORTS = [
  "UnboltCoreError",
  "InvalidSampleCountError",
  "Stage1FailureError",
  "DeadlockWitnessInvariantError",
  "PrimitiveRangeError",
  "PrimitiveParamError",
  "InvalidDirectionError",
  "MovingPartInStaticSetError",
  "AssemblyNotNormalizedError",
  "InvalidSolverConfigError",
] as const;

describe("public API surface at the package root (Req 30.1, 30.2, 30.5)", () => {
  it.each(FUNCTION_EXPORTS)("exports the function %s", (name) => {
    expect(typeof core[name]).toBe("function");
  });

  it("exports the constants", () => {
    expect(core.DEFAULT_SOLVER_CONFIG).toMatchObject({ samplesPerPartPerDirection: 48, tau: 0.05 });
    expect(core.DEFAULT_SEED).toBe(0x5eed2027);
    expect(core.CANONICAL_DIRECTIONS).toHaveLength(26);
    expect(core.POLY_BUDGET).toBe(150000);
    expect(core.UNBOLT_CORE_VERSION).toBe("0.1.0");
    expect(core.UNBOLT_CORE_VERSION).toBe(packageManifest.version);
  });

  it.each(ERROR_EXPORTS)("exports the error class %s, derived from UnboltCoreError", (name) => {
    const ErrorClass = core[name];
    expect(typeof ErrorClass).toBe("function");
    expect(ErrorClass.prototype).toBeInstanceOf(Error);
    if (name !== "UnboltCoreError") {
      expect(ErrorClass.prototype).toBeInstanceOf(core.UnboltCoreError);
    }
  });

  it("exports no undefined value", () => {
    for (const [name, value] of Object.entries(core)) {
      expect(value, `export ${name}`).not.toBeUndefined();
    }
  });
});

describe("stage results are not thenables (Req 1.4)", () => {
  const root = groupOf(boxMesh([0, 0, 0], [0.1, 0.1, 1]), boxMesh([-1, -1, -0.3], [1, 1, -0.1]));

  it("returns every stage result directly, so a Worker can call it synchronously", () => {
    const plan = core.solveDisassembly(root);
    const stage0 = core.stage0ParseScene(root);
    const stage1 = core.stage1Prepare(stage0);
    if (stage1.status !== "ok") {
      throw new Error(`Stage 1 returned ${stage1.error.kind}`);
    }
    const graph = core.stage2BuildDbg(stage1, stage1.config);
    const stage3 = core.stage3Peel(stage1, graph, stage1.config);
    const stage4 = core.stage4Compile(stage3, stage1, {});
    const baseline = core.computeNaiveRadialClashes(stage1);
    const registry = core.createDefaultPrimitiveRegistry();
    const clash = core.checkClashes(stage1.parts[0] as core.ClashPart, [0, 0, 1], stage1.parts.slice(1), stage1.config);
    const validation = core.validateConfig({});
    const sampling = core.computeSamplingMetadata(10);

    const results: Record<string, unknown> = { plan, stage0, stage1, graph, stage3, stage4, baseline, registry, clash, validation, sampling };
    for (const [name, value] of Object.entries(results)) {
      expect(isThenable(value), `${name} must not be a thenable`).toBe(false);
    }
    expect(plan.status).toBe("solved");
    // The chained stages equal the pipeline entry (Req 30.6).
    expect(stage3).toStrictEqual(plan);
    expect(stage4.ok).toBe(true);
  });
});

describe("computeNaiveRadialClashes (Req 21)", () => {
  /**
   * A big plate B with a small box A hovering above it, and two tiny boxes high up on either side.
   * The mean of the OBB centers lies far above A, so A's radial direction points straight down
   * into B. B and the two tiny boxes move away from the others.
   */
  function hoveringScene() {
    return groupOf(
      boxMesh([-1, -0.5, -1], [1, 0, 1]), // B, child 0
      boxMesh([-0.1, 0.1, -0.1], [0.1, 0.3, 0.1]), // A, child 1
      boxMesh([-1, 1.5, -0.1], [-0.9, 1.6, 0.1]), // child 2
      boxMesh([0.9, 1.5, -0.1], [1, 1.6, 0.1]), // child 3
    );
  }
  const stage1 = prepare(hoveringScene());
  const idOf = (child: number): string => {
    const part = stage1.parts.find((candidate) => candidate.sourceNodePath[0] === child);
    if (part === undefined) {
      throw new Error(`no Part came from child ${child}`);
    }
    return part.partId;
  };

  it("sends each Part along the unit vector from the OBB-center centroid, and counts its clashes with the Clash_Checker", () => {
    const result = core.computeNaiveRadialClashes(stage1);
    expect(result.perPart.map((entry) => entry.partId)).toEqual(stage1.parts.map((part) => part.partId));
    expect(isPlainData(result)).toBe(true);

    const centers = stage1.parts.map((part) => part.frame.obb.center);
    const centroid = [0, 1, 2].map((k) => centers.reduce((sum, center) => sum + (center[k] ?? 0), 0) / centers.length);
    let total = 0;
    for (const entry of result.perPart) {
      const part = stage1.parts.find((candidate) => candidate.partId === entry.partId);
      if (part === undefined) {
        throw new Error(`unknown Part ${entry.partId}`);
      }
      const offset = [0, 1, 2].map((k) => (part.frame.obb.center[k] ?? 0) - (centroid[k] ?? 0));
      const length = Math.hypot(...offset);
      entry.direction.forEach((component, k) => {
        expect(component).toBeCloseTo((offset[k] ?? 0) / length, 12);
      });
      expect(Math.hypot(...entry.direction)).toBeCloseTo(1, 12);

      const direct = core.checkClashes(
        part,
        entry.direction,
        stage1.parts.filter((other) => other.partId !== part.partId),
        core.DEFAULT_SOLVER_CONFIG,
      );
      expect(entry.clashCount).toBe(direct.count);
      expect(entry.clashes).toHaveLength(entry.clashCount);
      total += entry.clashCount;
    }
    expect(result.totalClashes).toBe(total);
  });

  it("finds clashes for the Part that moves into its neighbour, and none for the others", () => {
    const result = core.computeNaiveRadialClashes(stage1);
    const byId = new Map(result.perPart.map((entry) => [entry.partId, entry]));
    const hovering = byId.get(idOf(1));
    expect(hovering?.direction[1]).toBeCloseTo(-1, 12);
    expect(hovering?.clashCount ?? 0).toBeGreaterThan(0);
    for (const clash of hovering?.clashes ?? []) {
      expect(clash.obstructingPartId).toBe(idOf(0));
    }
    expect(byId.get(idOf(0))?.clashCount).toBe(0);
    expect(byId.get(idOf(2))?.clashCount).toBe(0);
    expect(byId.get(idOf(3))?.clashCount).toBe(0);
    expect(result.totalClashes).toBe(hovering?.clashCount);
    // Clashes are sorted by (obstructing Part, moving triangle, obstructing triangle).
    const keys = (hovering?.clashes ?? []).map((clash) => [clash.obstructingPartId, clash.movingTriangle, clash.obstructingTriangle]);
    expect(keys).toEqual(keys.slice().sort((a, b) => (a[0] as string).localeCompare(b[0] as string) || (a[1] as number) - (b[1] as number) || (a[2] as number) - (b[2] as number)));
  });

  it("is repeatable, order independent and leaves the input unchanged (Req 21.8, 21.9)", () => {
    const before = stage1.parts.map((part) => ({
      partId: part.partId,
      positions: part.positions.slice(),
      triangles: part.triangles.slice(),
    }));
    const first = core.computeNaiveRadialClashes(stage1);
    expect(core.computeNaiveRadialClashes(stage1)).toStrictEqual(first);
    const shuffled = { ...stage1, parts: stage1.parts.slice().reverse() };
    expect(core.computeNaiveRadialClashes(shuffled)).toStrictEqual(first);
    stage1.parts.forEach((part, i) => {
      expect(part.partId).toBe(before[i]?.partId);
      expect(part.positions).toStrictEqual(before[i]?.positions);
      expect(part.triangles).toStrictEqual(before[i]?.triangles);
    });
  });

  it("sends a Part at the centroid along +Y (Req 21.3)", () => {
    const line = prepare(
      groupOf(boxMesh([-3, 0, 0], [-2, 1, 1]), boxMesh([-0.5, 0, 0], [0.5, 1, 1]), boxMesh([2, 0, 0], [3, 1, 1])),
    );
    const result = core.computeNaiveRadialClashes(line);
    expect(result.perPart).toHaveLength(3);
    const middle = result.perPart.find((entry) => entry.partId === "/1#0");
    expect(middle?.direction).toStrictEqual([0, 1, 0]);
    const left = result.perPart.find((entry) => entry.partId === "/0#0");
    const right = result.perPart.find((entry) => entry.partId === "/2#0");
    expect(left?.direction[0]).toBeCloseTo(-1, 9);
    expect(right?.direction[0]).toBeCloseTo(1, 9);
  });

  it("rejects an invalid Solver_Config", () => {
    expect(() => core.computeNaiveRadialClashes(stage1, { tau: 2 })).toThrow(core.InvalidSolverConfigError);
  });

  it("forwards the supplied Micro_Shrink, Clearance_Epsilon and Tau to the Clash_Checker (Req 21.4)", () => {
    const config = { microShrink: 0.02, clearanceEpsilon: 0.01, tau: 0.5 };
    const result = core.computeNaiveRadialClashes(stage1, config);
    let total = 0;
    for (const entry of result.perPart) {
      const part = stage1.parts.find((candidate) => candidate.partId === entry.partId);
      if (part === undefined) {
        throw new Error(`unknown Part ${entry.partId}`);
      }
      const direct = core.checkClashes(
        part,
        entry.direction,
        stage1.parts.filter((other) => other.partId !== part.partId),
        config,
      );
      expect(entry.clashCount, entry.partId).toBe(direct.count);
      total += direct.count;
    }
    expect(result.totalClashes).toBe(total);
    expect(result.totalClashes).toBeGreaterThan(0);
  });
});

describe("AssemblyNotNormalizedError (Req 21.7)", () => {
  const stage1 = requireStage1(
    core.stage1Prepare(core.stage0ParseScene(groupOf(boxMesh([0, 0, 0], [0.1, 0.1, 1]), boxMesh([-1, -1, -0.3], [1, 1, -0.1])))),
  );

  /** The same Assembly with every AABB scaled about the origin, so its maxExtent becomes `factor`. */
  function scaled(factor: number): core.Stage1Result {
    return {
      ...stage1,
      parts: stage1.parts.map((part) => ({
        ...part,
        aabb: {
          min: part.aabb.min.map((c) => c * factor) as Triple,
          max: part.aabb.max.map((c) => c * factor) as Triple,
        },
      })),
    };
  }

  it("throws with the measured maxExtent, before any ray is cast", () => {
    const raycast = vi.spyOn(MeshBVH.prototype, "raycast");
    let caught: unknown;
    try {
      core.computeNaiveRadialClashes(scaled(1.5));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(core.AssemblyNotNormalizedError);
    expect(caught).toBeInstanceOf(core.UnboltCoreError);
    const error = caught as core.AssemblyNotNormalizedError;
    expect(error.code).toBe("AssemblyNotNormalized");
    expect(error.measuredMaxExtent).toBeCloseTo(1.5, 9);
    expect(error.message).toContain("1.5");
    expect(raycast).not.toHaveBeenCalled();
  });

  it("accepts a maxExtent within 1e-6 of 1 and rejects one just outside it", () => {
    expect(() => core.computeNaiveRadialClashes(scaled(1 + 5e-7))).not.toThrow();
    expect(() => core.computeNaiveRadialClashes(scaled(1 - 5e-7))).not.toThrow();
    expect(() => core.computeNaiveRadialClashes(scaled(1 + 2e-6))).toThrow(core.AssemblyNotNormalizedError);
    expect(() => core.computeNaiveRadialClashes(scaled(1 - 2e-6))).toThrow(core.AssemblyNotNormalizedError);
  });

  it("rejects an Assembly with no Parts, reporting a maxExtent of 0", () => {
    let caught: unknown;
    try {
      core.computeNaiveRadialClashes({ ...stage1, parts: [] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(core.AssemblyNotNormalizedError);
    expect((caught as core.AssemblyNotNormalizedError).measuredMaxExtent).toBe(0);
  });

  it("leaves the input untouched when it throws", () => {
    const input = scaled(2);
    const before = input.parts.map((part) => ({ partId: part.partId, positions: part.positions.slice(), triangles: part.triangles.slice() }));
    expect(() => core.computeNaiveRadialClashes(input)).toThrow(core.AssemblyNotNormalizedError);
    input.parts.forEach((part, i) => {
      expect(part.partId).toBe(before[i]?.partId);
      expect(part.positions).toStrictEqual(before[i]?.positions);
      expect(part.triangles).toStrictEqual(before[i]?.triangles);
    });
  });

  it("is the first check that depends on the Assembly, but a config error comes first", () => {
    expect(() => core.computeNaiveRadialClashes(scaled(2), { tau: -1 })).toThrow(core.InvalidSolverConfigError);
  });
});
