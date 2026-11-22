import { MeshBVH } from "three-mesh-bvh";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvalidDirectionError, InvalidSolverConfigError, MovingPartInStaticSetError } from "../../src/errors";
import { checkClashes } from "../../src/oracle/clashChecker";
import type { ClashPart, Vec3 } from "../../src/types";
import { makeClashPart } from "../helpers/clashParts";
import { collisionKey, referenceClash } from "../helpers/reference/clash";

const CONFIG = { microShrink: 0.01, clearanceEpsilon: 0.006, tau: 0.05 };
const PLUS_X: Vec3 = [1, 0, 0];

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A large triangle in the plane `x = x0`. Its corners are far from every test Part, so rays
 * from the wall's own vertices and centroid never reach them. The face normal is `-X` for
 * `minusX` (it faces a Part moving along `+X`) and `+X` for `plusX` (back-facing to that Part).
 */
function wall(partId: string, x0: number, facing: "minusX" | "plusX"): ClashPart {
  return makeClashPart(partId, [x0, -5, -5, x0, -5, 8, x0, 8, -5], facing === "minusX" ? [0, 1, 2] : [0, 2, 1]);
}

/** Triangle at `x = 0` with outward normal `+X` and area 0.5. */
function movingTriangle(): ClashPart {
  return makeClashPart("moving", [0, 0, 0, 0, 1, 0, 0, 0, 1], [0, 1, 2]);
}

describe("Clash_Checker: knife-edge vertices (Req 20.4)", () => {
  /**
   * Vertex `a` (index 0) is shared by two double-sided sheets that cancel exactly:
   *  - triangles 0 and 1 are `(a, b, c)` and `(a, c, b)` in the plane z = 0 (normals +Z and -Z, area 0.5);
   *  - triangles 2 and 3 are `(a, e, f)` and `(a, f, e)` in the plane x = 0 (normals +X and -X, area 2).
   * The area-weighted sum at `a` is exactly 0, so the largest incident triangle decides. That is
   * triangle 2 (area 2, lowest index of the tie), so the origin is `a - micro * (+X)`.
   *
   * The wall at x = 0.005 faces the sweep. From `a - micro * (+X)` the wall is 0.015 away and
   * counts. From the other candidates it does not:
   *  - triangle 3 gives the origin `a + micro * X`, which lies beyond the wall;
   *  - triangles 0 and 1 give an origin at x = 0, only 0.005 from the wall, below
   *    Clearance_Epsilon (0.006), so the hit is discarded.
   */
  const moving = makeClashPart(
    "moving",
    [0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 2, 0, 0, 0, 2],
    [0, 1, 2, 0, 2, 1, 0, 3, 4, 0, 4, 3],
  );
  const target = wall("wall", 0.005, "minusX");

  it("uses the largest incident triangle, and the lowest index among equal areas", () => {
    const result = checkClashes(moving, PLUS_X, [target], CONFIG);
    const moved = result.collisions.filter((collision) => collision.originSide === "moving");
    const vertexRays = moved.filter((collision) => collision.originKind === "vertex");

    const apex = vertexRays.find((collision) => collision.originIndex === 0);
    expect(apex, "the apex vertex must collide through triangle 2").toBeDefined();
    expect(apex?.originTriangle).toBe(2);
    expect(apex?.hitPartId).toBe("wall");
    expect(apex?.hitTriangle).toBe(0);
    expect(apex?.distance).toBeCloseTo(0.015, 12);

    // Vertices b and c belong only to triangles 0 and 1 (equal areas), so the lowest index, 0, is used.
    // Vertex b is 0.005 from the wall at its shifted origin and is discarded; vertex c is far from it and collides.
    expect(vertexRays.find((collision) => collision.originIndex === 1)).toBeUndefined();
    expect(vertexRays.find((collision) => collision.originIndex === 2)?.originTriangle).toBe(0);
    // Vertices e and f belong only to triangles 2 and 3, so the lowest index, 2, is used.
    expect(vertexRays.find((collision) => collision.originIndex === 3)?.originTriangle).toBe(2);
    expect(vertexRays.find((collision) => collision.originIndex === 4)?.originTriangle).toBe(2);
  });

  it("reports the same collisions as the brute-force reference, and none from the wall's own rays", () => {
    const result = checkClashes(moving, PLUS_X, [target], CONFIG);
    const reference = referenceClash(moving, PLUS_X, [target], CONFIG);
    expect(result.collisions.map(collisionKey).sort()).toEqual(reference.collisions.map(collisionKey).sort());
    expect(result.collisions.every((collision) => collision.originSide === "moving")).toBe(true);
    // 4 vertex rays (a, c, e, f) and 3 centroid rays (triangles 0, 1, 2). Triangle 3 faces away, so its origin is beyond the wall.
    expect(result.count).toBe(7);
    expect(result.movingTriangles).toEqual([0, 1, 2]);
    expect(result.staticTriangles).toEqual([{ partId: "wall", triangles: [0] }]);
  });
});

describe("Clash_Checker: empty static set (Req 20.1)", () => {
  it("gives a count of 0 and empty lists", () => {
    expect(checkClashes(movingTriangle(), PLUS_X, [], CONFIG)).toStrictEqual({
      count: 0,
      movingTriangles: [],
      staticTriangles: [],
      collisions: [],
    });
  });
});

describe("Clash_Checker: zero-area triangles cast no ray (Req 20.6)", () => {
  it("ignores the vertices and centroid of a zero-area triangle", () => {
    // Triangle 0 is real. Triangle 1 has three exactly collinear corners (indices 3, 4, 5).
    const moving = makeClashPart(
      "moving",
      [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.1, 0.1, 0, 0.2, 0.2, 0, 0.3, 0.3],
      [0, 1, 2, 3, 4, 5],
    );
    const result = checkClashes(moving, PLUS_X, [wall("wall", 0.1, "minusX")], CONFIG);
    expect(result.count).toBe(4);
    expect(result.collisions.map((collision) => `${collision.originKind}:${collision.originIndex}`).sort()).toEqual([
      "centroid:0",
      "vertex:0",
      "vertex:1",
      "vertex:2",
    ]);
    expect(result.movingTriangles).toEqual([0]);
  });

  it("casts nothing from a Part whose triangles all have zero area", () => {
    const flat = makeClashPart("moving", [0, 0, 0, 0, 0.5, 0, 0, 1, 0], [0, 1, 2]);
    const result = checkClashes(flat, PLUS_X, [wall("wall", 0.1, "minusX")], CONFIG);
    expect(result.count).toBe(0);
    expect(result.collisions).toEqual([]);
  });

  it("casts nothing from an unreferenced vertex", () => {
    const moving = makeClashPart("moving", [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.3, 0.3], [0, 1, 2]);
    const result = checkClashes(moving, PLUS_X, [wall("wall", 0.1, "minusX")], CONFIG);
    expect(result.collisions.filter((collision) => collision.originKind === "vertex").map((collision) => collision.originIndex)).toEqual([0, 1, 2]);
  });
});

describe("Clash_Checker: the nearest survivor is taken across all static Parts (Req 20.7 to 20.9)", () => {
  it("lets a nearer back-facing wall in one Part not mask a farther opposing wall in another", () => {
    const result = checkClashes(movingTriangle(), PLUS_X, [wall("near-wall", 0.05, "plusX"), wall("far-wall", 0.2, "minusX")], CONFIG);
    expect(result.count).toBe(4);
    expect(result.collisions.every((collision) => collision.hitPartId === "far-wall")).toBe(true);
    expect(result.staticTriangles).toEqual([{ partId: "far-wall", triangles: [0] }]);
  });

  it("picks the nearer of two opposing walls in different Parts", () => {
    const result = checkClashes(movingTriangle(), PLUS_X, [wall("far-wall", 0.2, "minusX"), wall("near-wall", 0.05, "minusX")], CONFIG);
    expect(result.count).toBe(4);
    expect(result.collisions.every((collision) => collision.hitPartId === "near-wall")).toBe(true);
  });

  it("breaks an exact distance tie by Part_ID, whatever the order of the static list", () => {
    const first = checkClashes(movingTriangle(), PLUS_X, [wall("b-wall", 0.1, "minusX"), wall("a-wall", 0.1, "minusX")], CONFIG);
    const second = checkClashes(movingTriangle(), PLUS_X, [wall("a-wall", 0.1, "minusX"), wall("b-wall", 0.1, "minusX")], CONFIG);
    expect(first.count).toBe(4);
    expect(first.collisions.every((collision) => collision.hitPartId === "a-wall")).toBe(true);
    expect(second).toStrictEqual(first);
  });

  it("casts static-Part rays along the negated direction against the moving Part only", () => {
    // The wall's single triangle faces -X and sits over the moving triangle, so its rays travel -X toward it.
    const small = makeClashPart("wall", [0.1, 0.1, 0.1, 0.1, 0.1, 0.4, 0.1, 0.4, 0.1], [0, 1, 2]);
    const result = checkClashes(movingTriangle(), PLUS_X, [small], CONFIG);
    const fromStatic = result.collisions.filter((collision) => collision.originSide === "static");
    expect(fromStatic.length).toBeGreaterThan(0);
    for (const collision of fromStatic) {
      expect(collision.originPartId).toBe("wall");
      expect(collision.hitPartId).toBe("moving");
    }
    expect(result.movingTriangles).toEqual([0]);
    expect(result.staticTriangles).toEqual([{ partId: "wall", triangles: [0] }]);
  });
});

describe("Clash_Checker: misuse throws before any ray is cast (Req 20.12, 20.13)", () => {
  it("rejects a non-unit, non-finite or malformed direction", () => {
    const raycast = vi.spyOn(MeshBVH.prototype, "raycast");
    const statics = [wall("wall", 0.1, "minusX")];
    expect(() => checkClashes(movingTriangle(), [2, 0, 0], statics, CONFIG)).toThrow(InvalidDirectionError);
    expect(() => checkClashes(movingTriangle(), [Number.NaN, 0, 0], statics, CONFIG)).toThrow(InvalidDirectionError);
    expect(() => checkClashes(movingTriangle(), [Number.POSITIVE_INFINITY, 0, 0], statics, CONFIG)).toThrow(InvalidDirectionError);
    expect(() => checkClashes(movingTriangle(), [0, 0, 0], statics, CONFIG)).toThrow(InvalidDirectionError);
    expect(() => checkClashes(movingTriangle(), [1, 0] as unknown as Vec3, statics, CONFIG)).toThrow(InvalidDirectionError);
    expect(raycast).not.toHaveBeenCalled();
  });

  it("accepts a direction whose length is within 1e-6 of 1", () => {
    expect(() => checkClashes(movingTriangle(), [1 + 5e-7, 0, 0], [wall("wall", 0.1, "minusX")], CONFIG)).not.toThrow();
  });

  it("rejects a static set that contains the moving Part", () => {
    const raycast = vi.spyOn(MeshBVH.prototype, "raycast");
    const moving = movingTriangle();
    const clone = makeClashPart("moving", [5, 5, 5, 5, 6, 5, 5, 5, 6], [0, 1, 2]);
    expect(() => checkClashes(moving, PLUS_X, [wall("wall", 0.1, "minusX"), clone], CONFIG)).toThrow(MovingPartInStaticSetError);
    expect(raycast).not.toHaveBeenCalled();
  });

  it("rejects an invalid Solver_Config and never substitutes values", () => {
    const raycast = vi.spyOn(MeshBVH.prototype, "raycast");
    expect(() => checkClashes(movingTriangle(), PLUS_X, [wall("wall", 0.1, "minusX")], { tau: 2 })).toThrow(InvalidSolverConfigError);
    expect(raycast).not.toHaveBeenCalled();
  });

  it("takes Micro_Shrink, Clearance_Epsilon and Tau from the config it is given", () => {
    // The wall sits 0.015 behind the moving triangle's plane. Every origin is 0.02 behind that
    // plane, so the wall is 0.005 from the origin along the ray.
    const statics = [wall("wall", -0.015, "minusX")];
    expect(checkClashes(movingTriangle(), PLUS_X, statics, { microShrink: 0.02, clearanceEpsilon: 0.004 }).count).toBe(4);
    expect(checkClashes(movingTriangle(), PLUS_X, statics, { microShrink: 0.02, clearanceEpsilon: 0.006 }).count).toBe(0);
    // A head-on wall has dot = -1, so no Tau below 1 discards it.
    expect(checkClashes(movingTriangle(), PLUS_X, statics, { microShrink: 0.02, clearanceEpsilon: 0.004, tau: 0 }).count).toBe(4);
    expect(checkClashes(movingTriangle(), PLUS_X, statics, { microShrink: 0.02, clearanceEpsilon: 0.004, tau: 0.99 }).count).toBe(4);
  });
});
