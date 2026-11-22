import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Vec2, convexHull2D, convexPolygonDistance } from "../../src/math/hull2d";
import { jacobiEigen3 } from "../../src/math/eigen3";
import { orthonormalBasis } from "../../src/math/onb";
import type { Vec3 } from "../../src/types";

const PROPERTY_SEED = 0x2027c0de;
const TOLERANCE = 1e-12;

/** Row-major symmetric matrix times vector. */
function multiplyMatrix(m: readonly number[], v: Vec3): Vec3 {
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
    m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
  ];
}

/** Sum over k of values[k] * v_k v_k^T, as a row-major 3x3 matrix. */
function reconstruct(values: Vec3, vectors: [Vec3, Vec3, Vec3]): number[] {
  const out = new Array<number>(9).fill(0);
  for (let k = 0; k < 3; k++) {
    const v = vectors[k]!;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        out[3 * i + j]! += values[k]! * v[i]! * v[j]!;
      }
    }
  }
  return out;
}

/** Rotation matrix from Rodrigues' formula for a unit axis and an angle in radians. */
function rodrigues(axis: Vec3, angle: number): number[] {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

function transposeMatrix(m: readonly number[]): number[] {
  return [m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!];
}

function multiplyMatrices(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[3 * i + j] = a[3 * i]! * b[j]! + a[3 * i + 1]! * b[3 + j]! + a[3 * i + 2]! * b[6 + j]!;
    }
  }
  return out;
}

function expectMatrixClose(actual: readonly number[], expected: readonly number[], tolerance: number): void {
  for (let i = 0; i < 9; i++) {
    expect(Math.abs(actual[i]! - expected[i]!)).toBeLessThanOrEqual(tolerance);
  }
}

describe("jacobiEigen3", () => {
  it("returns the diagonal of a diagonal matrix, sorted in descending order", () => {
    const result = jacobiEigen3([1, 0, 0, 0, 3, 0, 0, 0, 2]);
    expect(result.values).toStrictEqual([3, 2, 1]);
    expect(result.vectors[0]).toStrictEqual([0, 1, 0]);
    expect(result.vectors[1]).toStrictEqual([0, 0, 1]);
    expect(result.vectors[2]).toStrictEqual([1, 0, 0]);
  });

  it("reconstructs a rotated diagonal matrix within 1e-12", () => {
    const rotation = rodrigues([1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)], 0.7);
    const diagonal = [5, 0, 0, 0, 2, 0, 0, 0, 1];
    const matrix = multiplyMatrices(multiplyMatrices(rotation, diagonal), transposeMatrix(rotation));

    const result = jacobiEigen3(matrix);
    expectMatrixClose(reconstruct(result.values, result.vectors), matrix, TOLERANCE);
    expect(result.values[0]).toBeCloseTo(5, 12);
    expect(result.values[1]).toBeCloseTo(2, 12);
    expect(result.values[2]).toBeCloseTo(1, 12);
  });

  it("reconstructs a matrix with a repeated eigenvalue within 1e-12", () => {
    // 2I + u u^T with u = (1, 1, 1): eigenvalues 5, 2 and 2.
    const matrix = [3, 1, 1, 1, 3, 1, 1, 1, 3];
    const result = jacobiEigen3(matrix);
    expectMatrixClose(reconstruct(result.values, result.vectors), matrix, TOLERANCE);
    expect(result.values[0]).toBeCloseTo(5, 12);
    expect(result.values[1]).toBeCloseTo(2, 12);
    expect(result.values[2]).toBeCloseTo(2, 12);
  });

  it("returns orthonormal eigenvectors that satisfy A v = lambda v", () => {
    const matrix = [4, 1, -2, 1, 2, 0, -2, 0, 3];
    const { values, vectors } = jacobiEigen3(matrix);
    for (let k = 0; k < 3; k++) {
      const v = vectors[k]!;
      const av = multiplyMatrix(matrix, v);
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(av[i]! - values[k]! * v[i]!)).toBeLessThanOrEqual(TOLERANCE);
      }
    }
    for (let k = 0; k < 3; k++) {
      for (let l = 0; l < 3; l++) {
        const dot = vectors[k]![0] * vectors[l]![0] + vectors[k]![1] * vectors[l]![1] + vectors[k]![2] * vectors[l]![2];
        expect(Math.abs(dot - (k === l ? 1 : 0))).toBeLessThanOrEqual(TOLERANCE);
      }
    }
  });

  it("rejects a non-finite entry", () => {
    expect(() => jacobiEigen3([1, 0, 0, 0, Number.NaN, 0, 0, 0, 1])).toThrow(RangeError);
  });
});

/**
 * Reference distance between two convex polygons given in counter-clockwise order. A point is a
 * one-vertex polygon and a segment is a two-vertex polygon. The reference checks overlap with
 * segment intersection and containment, and it does not use the separating axis test.
 */
function referenceDistance(a: readonly Vec2[], b: readonly Vec2[]): number {
  if (polygonsOverlap(a, b)) {
    return 0;
  }
  let best = Number.POSITIVE_INFINITY;
  for (const [s0, s1] of boundarySegments(a)) {
    for (const v of b) {
      best = Math.min(best, pointToSegment(v, s0, s1));
    }
  }
  for (const [s0, s1] of boundarySegments(b)) {
    for (const v of a) {
      best = Math.min(best, pointToSegment(v, s0, s1));
    }
  }
  return best;
}

function boundarySegments(polygon: readonly Vec2[]): [Vec2, Vec2][] {
  if (polygon.length === 1) {
    return [[polygon[0]!, polygon[0]!]];
  }
  if (polygon.length === 2) {
    return [[polygon[0]!, polygon[1]!]];
  }
  return polygon.map((p, i): [Vec2, Vec2] => [p, polygon[(i + 1) % polygon.length]!]);
}

function polygonsOverlap(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  for (const [a0, a1] of boundarySegments(a)) {
    for (const [b0, b1] of boundarySegments(b)) {
      if (segmentsIntersect(a0, a1, b0, b1)) {
        return true;
      }
    }
  }
  return containsPoint(a, b[0]!) || containsPoint(b, a[0]!);
}

/** True when `p` lies inside or on a convex counter-clockwise polygon with 3 or more vertices. */
function containsPoint(polygon: readonly Vec2[], p: Vec2): boolean {
  if (polygon.length < 3) {
    return false;
  }
  return polygon.every((v, i) => {
    const w = polygon[(i + 1) % polygon.length]!;
    return (w[0] - v[0]) * (p[1] - v[1]) - (w[1] - v[1]) * (p[0] - v[0]) >= 0;
  });
}

function orientation(p: Vec2, q: Vec2, r: Vec2): number {
  return Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
}

function onSegment(p: Vec2, q: Vec2, r: Vec2): boolean {
  return (
    Math.min(p[0], r[0]) <= q[0] && q[0] <= Math.max(p[0], r[0]) && Math.min(p[1], r[1]) <= q[1] && q[1] <= Math.max(p[1], r[1])
  );
}

function segmentsIntersect(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const o1 = orientation(p1, p2, q1);
  const o2 = orientation(p1, p2, q2);
  const o3 = orientation(q1, q2, p1);
  const o4 = orientation(q1, q2, p2);
  if (o1 !== o2 && o3 !== o4) {
    return true;
  }
  return (
    (o1 === 0 && onSegment(p1, q1, p2)) ||
    (o2 === 0 && onSegment(p1, q2, p2)) ||
    (o3 === 0 && onSegment(q1, p1, q2)) ||
    (o4 === 0 && onSegment(q1, p2, q2))
  );
}

function pointToSegment(p: Vec2, s0: Vec2, s1: Vec2): number {
  const dx = s1[0] - s0[0];
  const dy = s1[1] - s0[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - s0[0]) * dx + (p[1] - s0[1]) * dy) / len2));
  return Math.hypot(p[0] - s0[0] - t * dx, p[1] - s0[1] - t * dy);
}

/** Convex polygon from points on a circle, sorted by angle, so the vertices are counter-clockwise. */
function circlePolygon(center: Vec2, radius: number, anglesDeg: readonly number[]): Vec2[] {
  return [...anglesDeg]
    .sort((x, y) => x - y)
    .map((deg): Vec2 => {
      const angle = (deg * Math.PI) / 180;
      return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
    });
}

describe("convexPolygonDistance", () => {
  const unitSquare: Vec2[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];

  it("measures the corner-to-corner gap of two facing squares", () => {
    const farSquare: Vec2[] = unitSquare.map((p): Vec2 => [p[0] + 2, p[1] + 2]);
    expect(convexPolygonDistance(unitSquare, farSquare)).toBeCloseTo(Math.SQRT2, 12);
  });

  it("measures the edge gap of two squares side by side", () => {
    const shifted: Vec2[] = unitSquare.map((p): Vec2 => [p[0] + 3, p[1]]);
    expect(convexPolygonDistance(unitSquare, shifted)).toBeCloseTo(2, 12);
  });

  it("returns 0 for touching and overlapping squares", () => {
    const touching: Vec2[] = unitSquare.map((p): Vec2 => [p[0] + 1, p[1]]);
    const overlapping: Vec2[] = unitSquare.map((p): Vec2 => [p[0] + 0.5, p[1] + 0.5]);
    expect(convexPolygonDistance(unitSquare, touching)).toBe(0);
    expect(convexPolygonDistance(unitSquare, overlapping)).toBe(0);
  });

  it("measures the distance between two separated segments", () => {
    expect(
      convexPolygonDistance(
        [
          [0, 0],
          [1, 0],
        ],
        [
          [3, 1],
          [4, 1],
        ],
      ),
    ).toBeCloseTo(Math.sqrt(5), 12);
  });

  it("measures point-to-point and point-to-segment distances", () => {
    expect(convexPolygonDistance([[0, 0]], [[3, 4]])).toBeCloseTo(5, 12);
    expect(
      convexPolygonDistance(
        [[2, 3]],
        [
          [0, 0],
          [4, 0],
        ],
      ),
    ).toBeCloseTo(3, 12);
  });

  it("matches the brute-force reference for random convex polygons", () => {
    const vertexSet = fc.uniqueArray(fc.integer({ min: 0, max: 359 }), { minLength: 1, maxLength: 6 });
    const polygonArbitrary = fc.record({
      center: fc.tuple(fc.integer({ min: -6, max: 6 }), fc.integer({ min: -6, max: 6 })),
      radius: fc.integer({ min: 1, max: 3 }),
      angles: vertexSet,
    });
    fc.assert(
      fc.property(polygonArbitrary, polygonArbitrary, (first, second) => {
        const a = circlePolygon([first.center[0], first.center[1]], first.radius, first.angles);
        const b = circlePolygon(
          [second.center[0] + 0.25, second.center[1] - 0.5],
          second.radius,
          second.angles,
        );
        const expected = referenceDistance(a, b);
        const actual = convexPolygonDistance(a, b);
        expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-9);
      }),
      { seed: PROPERTY_SEED, numRuns: 200 },
    );
  });
});

describe("convexHull2D", () => {
  it("keeps only the corners of a square with interior and collinear points", () => {
    const hull = convexHull2D([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [1, 1],
      [1, 0],
    ]);
    expect(hull).toStrictEqual([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ]);
  });

  it("returns the two endpoints for collinear input and one point for duplicates", () => {
    expect(
      convexHull2D([
        [0, 0],
        [1, 1],
        [2, 2],
      ]),
    ).toStrictEqual([
      [0, 0],
      [2, 2],
    ]);
    expect(convexHull2D([[5, 5], [5, 5]])).toStrictEqual([[5, 5]]);
  });
});

describe("orthonormalBasis", () => {
  it("returns a right-handed orthonormal basis for axis-aligned and skew unit normals", () => {
    const normals: Vec3[] = [
      [0, 0, 1],
      [0, 0, -1],
      [1, 0, 0],
      [0, -1, 0],
      [1 / Math.sqrt(3), 1 / Math.sqrt(3), -1 / Math.sqrt(3)],
    ];
    for (const n of normals) {
      const [b1, b2] = orthonormalBasis(n);
      const cross: Vec3 = [
        b1[1] * b2[2] - b1[2] * b2[1],
        b1[2] * b2[0] - b1[0] * b2[2],
        b1[0] * b2[1] - b1[1] * b2[0],
      ];
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(cross[k]! - n[k]!)).toBeLessThanOrEqual(TOLERANCE);
      }
      expect(Math.abs(b1[0] * b1[0] + b1[1] * b1[1] + b1[2] * b1[2] - 1)).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(b2[0] * b2[0] + b2[1] * b2[1] + b2[2] * b2[2] - 1)).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(b1[0] * b2[0] + b1[1] * b2[1] + b1[2] * b2[2])).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  it("is orthonormal and right-handed for random unit normals", () => {
    const unitNormal = fc
      .tuple(
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
      )
      .filter(([x, y, z]) => Math.hypot(x, y, z) >= 0.1)
      .map(([x, y, z]): Vec3 => {
        const length = Math.hypot(x, y, z);
        return [x / length, y / length, z / length];
      });
    fc.assert(
      fc.property(unitNormal, (n) => {
        const [b1, b2] = orthonormalBasis(n);
        const cross: Vec3 = [
          b1[1] * b2[2] - b1[2] * b2[1],
          b1[2] * b2[0] - b1[0] * b2[2],
          b1[0] * b2[1] - b1[1] * b2[0],
        ];
        for (let k = 0; k < 3; k++) {
          expect(Math.abs(cross[k]! - n[k]!)).toBeLessThanOrEqual(1e-9);
        }
        expect(Math.abs(b1[0] * n[0] + b1[1] * n[1] + b1[2] * n[2])).toBeLessThanOrEqual(1e-9);
        expect(Math.abs(b2[0] * n[0] + b2[1] * n[1] + b2[2] * n[2])).toBeLessThanOrEqual(1e-9);
      }),
      { seed: PROPERTY_SEED, numRuns: 200 },
    );
  });
});
