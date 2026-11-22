/**
 * Independent Watertight_Solid_Part checker (Req 11.7, design "Watertight assembly generator").
 *
 * This file imports nothing from `src/`, so a bug in the engine cannot make a bad generated
 * Part pass. It checks, in the units of the given positions:
 *
 * 1. closedness: after welding vertices within a tolerance, every edge is shared by exactly 2
 *    triangles that traverse it in opposite directions (so the surface is a closed, consistently
 *    oriented 2-manifold, with no collapsed triangle);
 * 2. outward winding: the signed volume `sum(a · (b × c)) / 6` is strictly positive;
 * 3. thickness: a brute-force ray from every triangle centroid along the inward normal, tested
 *    against every other triangle, hits something strictly farther than `minThickness`.
 */

export interface WatertightOptions {
  /**
   * Smallest allowed inward thickness, in the units of `positions`. For Micro_Shrink `m` in
   * normalized units and an Assembly of maximum extent `E`, pass `m * E`.
   */
  minThickness: number;
  /** Vertices closer than this are welded. Default `1e-7` times the AABB diagonal. */
  weldTolerance?: number;
}

export interface WatertightReport {
  ok: boolean;
  /** At most 12 human-readable problems. Empty when `ok`. */
  problems: string[];
  triangleCount: number;
  signedVolume: number;
  /** Smallest inward distance found over every centroid ray, `Infinity` for an empty Part. */
  thickness: number;
}

const MAX_PROBLEMS = 12;

export function checkWatertight(
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null,
  options: WatertightOptions,
): WatertightReport {
  const problems: string[] = [];
  const report = (message: string): void => {
    if (problems.length < MAX_PROBLEMS) {
      problems.push(message);
    }
  };

  const cornerCount = index === null ? Math.floor(positions.length / 3) : index.length;
  const triangleCount = Math.floor(cornerCount / 3);
  const corner = (c: number): number => (index === null ? c : (index[c] ?? Number.NaN));

  if (positions.length % 3 !== 0 || cornerCount % 3 !== 0 || triangleCount === 0) {
    report(`expected a non-empty triangle list; received ${positions.length} position values and ${cornerCount} corners`);
    return { ok: false, problems, triangleCount, signedVolume: 0, thickness: Number.POSITIVE_INFINITY };
  }

  const point = (vertex: number): [number, number, number] => [
    positions[3 * vertex] ?? Number.NaN,
    positions[3 * vertex + 1] ?? Number.NaN,
    positions[3 * vertex + 2] ?? Number.NaN,
  ];

  // Bounding box of the referenced vertices, for the diagonal and for a stable volume origin.
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let c = 0; c < cornerCount; c++) {
    const p = point(corner(c));
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k] ?? Infinity, p[k] ?? Number.NaN);
      hi[k] = Math.max(hi[k] ?? -Infinity, p[k] ?? Number.NaN);
    }
  }
  if (![...lo, ...hi].every((value) => Number.isFinite(value))) {
    report("a position is not finite or an index is out of range");
    return { ok: false, problems, triangleCount, signedVolume: 0, thickness: Number.POSITIVE_INFINITY };
  }
  const diagonal = Math.hypot((hi[0] ?? 0) - (lo[0] ?? 0), (hi[1] ?? 0) - (lo[1] ?? 0), (hi[2] ?? 0) - (lo[2] ?? 0));
  const weldTolerance = Math.max(options.weldTolerance ?? 1e-7 * diagonal, 1e-12);
  const origin = [0, 1, 2].map((k) => ((lo[k] ?? 0) + (hi[k] ?? 0)) / 2);

  // 1. Weld vertices with a grid hash and union-find.
  const clusterOf = weldClusters(positions, corner, cornerCount, weldTolerance);

  // 2. Edge pairing on welded vertices.
  const edges = new Map<string, { forward: number; backward: number }>();
  const minArea = 1e-12 * diagonal * diagonal;
  for (let t = 0; t < triangleCount; t++) {
    const a = clusterOf.get(corner(3 * t));
    const b = clusterOf.get(corner(3 * t + 1));
    const c = clusterOf.get(corner(3 * t + 2));
    if (a === undefined || b === undefined || c === undefined) {
      report(`triangle ${t} references a vertex that was not welded`);
      continue;
    }
    if (a === b || b === c || c === a) {
      report(`triangle ${t} is collapsed: two corners weld together`);
      continue;
    }
    if (triangleArea(point(corner(3 * t)), point(corner(3 * t + 1)), point(corner(3 * t + 2))) <= minArea) {
      report(`triangle ${t} has zero area`);
    }
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      const entry = edges.get(key) ?? { forward: 0, backward: 0 };
      if (u < v) {
        entry.forward++;
      } else {
        entry.backward++;
      }
      edges.set(key, entry);
    }
  }
  for (const [key, entry] of edges) {
    if (entry.forward !== 1 || entry.backward !== 1) {
      report(`edge ${key} is shared by ${entry.forward} forward and ${entry.backward} backward triangles, not 1 and 1`);
    }
  }

  // 3. Signed volume about the box center.
  let signedVolume = 0;
  for (let t = 0; t < triangleCount; t++) {
    const a = shifted(point(corner(3 * t)), origin);
    const b = shifted(point(corner(3 * t + 1)), origin);
    const c = shifted(point(corner(3 * t + 2)), origin);
    signedVolume += dot3(a, cross3(b, c)) / 6;
  }
  if (!(signedVolume > 0)) {
    report(`signed volume ${signedVolume} is not positive`);
  }

  // 4. Thickness by brute-force inward rays from every centroid.
  let thickness = Number.POSITIVE_INFINITY;
  const hitFloor = 1e-9 * diagonal;
  for (let t = 0; t < triangleCount; t++) {
    const a = point(corner(3 * t));
    const b = point(corner(3 * t + 1));
    const c = point(corner(3 * t + 2));
    const normal = cross3(sub3(b, a), sub3(c, a));
    const normalLength = Math.hypot(normal[0], normal[1], normal[2]);
    if (!(normalLength > 0)) {
      continue;
    }
    const inward: [number, number, number] = [-normal[0] / normalLength, -normal[1] / normalLength, -normal[2] / normalLength];
    const centroid: [number, number, number] = [
      (a[0] + b[0] + c[0]) / 3,
      (a[1] + b[1] + c[1]) / 3,
      (a[2] + b[2] + c[2]) / 3,
    ];
    let nearest = Number.POSITIVE_INFINITY;
    for (let u = 0; u < triangleCount; u++) {
      if (u === t) {
        continue;
      }
      const hit = rayTriangleDistance(
        centroid,
        inward,
        point(corner(3 * u)),
        point(corner(3 * u + 1)),
        point(corner(3 * u + 2)),
      );
      if (hit !== null && hit > hitFloor && hit < nearest) {
        nearest = hit;
      }
    }
    if (nearest === Number.POSITIVE_INFINITY) {
      report(`the inward ray from the centroid of triangle ${t} hits nothing, so the surface is not closed`);
    } else if (!(nearest > options.minThickness)) {
      report(`the inward ray from the centroid of triangle ${t} hits at ${nearest}, not above ${options.minThickness}`);
    }
    thickness = Math.min(thickness, nearest);
  }

  return { ok: problems.length === 0, problems, triangleCount, signedVolume, thickness };
}

// ---------------------------------------------------------------------------
// Welding
// ---------------------------------------------------------------------------

/** Maps every referenced vertex to the smallest vertex index within its weld cluster. */
function weldClusters(
  positions: ArrayLike<number>,
  corner: (c: number) => number,
  cornerCount: number,
  tolerance: number,
): Map<number, number> {
  const referenced = [...new Set(Array.from({ length: cornerCount }, (_, c) => corner(c)))].sort((x, y) => x - y);
  const parent = new Map<number, number>(referenced.map((v) => [v, v]));
  const find = (v: number): number => {
    let root = v;
    while ((parent.get(root) ?? root) !== root) {
      root = parent.get(root) ?? root;
    }
    return root;
  };
  const union = (x: number, y: number): void => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) {
      parent.set(Math.max(rx, ry), Math.min(rx, ry));
    }
  };

  const cellOf = (v: number): [number, number, number] => [
    Math.floor((positions[3 * v] ?? 0) / tolerance),
    Math.floor((positions[3 * v + 1] ?? 0) / tolerance),
    Math.floor((positions[3 * v + 2] ?? 0) / tolerance),
  ];
  const grid = new Map<string, number[]>();
  for (const v of referenced) {
    const [cx, cy, cz] = cellOf(v);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const other of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            const d = Math.hypot(
              (positions[3 * v] ?? 0) - (positions[3 * other] ?? 0),
              (positions[3 * v + 1] ?? 0) - (positions[3 * other + 1] ?? 0),
              (positions[3 * v + 2] ?? 0) - (positions[3 * other + 2] ?? 0),
            );
            if (d <= tolerance) {
              union(v, other);
            }
          }
        }
      }
    }
    const key = `${cx},${cy},${cz}`;
    const bucket = grid.get(key);
    if (bucket === undefined) {
      grid.set(key, [v]);
    } else {
      bucket.push(v);
    }
  }
  return new Map(referenced.map((v) => [v, find(v)]));
}

// ---------------------------------------------------------------------------
// Vector helpers and ray test (double-sided Moeller-Trumbore)
// ---------------------------------------------------------------------------

type V3 = [number, number, number];

function sub3(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross3(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot3(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function shifted(p: V3, origin: readonly number[]): V3 {
  return [p[0] - (origin[0] ?? 0), p[1] - (origin[1] ?? 0), p[2] - (origin[2] ?? 0)];
}

function triangleArea(a: V3, b: V3, c: V3): number {
  const n = cross3(sub3(b, a), sub3(c, a));
  return 0.5 * Math.hypot(n[0], n[1], n[2]);
}

/** Distance along the ray to the triangle, or `null` when it misses or is parallel. */
function rayTriangleDistance(origin: V3, direction: V3, a: V3, b: V3, c: V3): number | null {
  const edge1 = sub3(b, a);
  const edge2 = sub3(c, a);
  const p = cross3(direction, edge2);
  const determinant = dot3(edge1, p);
  if (Math.abs(determinant) < 1e-18) {
    return null;
  }
  const inverse = 1 / determinant;
  const toOrigin = sub3(origin, a);
  const u = dot3(toOrigin, p) * inverse;
  const slack = 1e-12;
  if (u < -slack || u > 1 + slack) {
    return null;
  }
  const q = cross3(toOrigin, edge1);
  const v = dot3(direction, q) * inverse;
  if (v < -slack || u + v > 1 + slack) {
    return null;
  }
  const t = dot3(edge2, q) * inverse;
  return t > 0 ? t : null;
}
