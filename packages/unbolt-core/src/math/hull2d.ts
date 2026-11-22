/** 2D point or direction as a tuple. */
export type Vec2 = [number, number];

/**
 * Convex hull by Andrew's monotone chain. The result is counter-clockwise, with no repeated and
 * no collinear interior vertices. One distinct point gives `[p]`. Collinear points give the two
 * endpoints. Throws `RangeError` on an empty input.
 */
export function convexHull2D(points: readonly Vec2[]): Vec2[] {
  if (points.length === 0) {
    throw new RangeError("convexHull2D requires at least one point");
  }
  const sorted = points
    .map((p): Vec2 => [p[0], p[1]])
    .sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const unique: Vec2[] = [];
  for (const p of sorted) {
    const last = unique[unique.length - 1];
    if (last === undefined || last[0] !== p[0] || last[1] !== p[1]) {
      unique.push(p);
    }
  }
  if (unique.length <= 1) {
    return unique;
  }

  const lower: Vec2[] = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross2(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i]!;
    while (upper.length >= 2 && cross2(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  // Each chain repeats the other's endpoint, so drop the last point of each.
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * Exact Euclidean distance between the convex hulls of two point sets. The result is 0 when the
 * hulls overlap or touch.
 *
 * Overlap uses the separating axis test. Each polygon contributes its edge normals. A segment
 * also contributes its own direction, which is needed when two segments are collinear. A
 * point contributes nothing, and two points are compared directly. When the hulls are
 * disjoint, the distance is the smallest vertex-to-segment distance taken in both directions.
 */
export function convexPolygonDistance(a: readonly Vec2[], b: readonly Vec2[]): number {
  const hullA = convexHull2D(a);
  const hullB = convexHull2D(b);

  if (hullA.length === 1 && hullB.length === 1) {
    const p = hullA[0]!;
    const q = hullB[0]!;
    return Math.hypot(p[0] - q[0], p[1] - q[1]);
  }
  if (!hullsSeparated(hullA, hullB)) {
    return 0;
  }

  let best = Number.POSITIVE_INFINITY;
  for (const [vertices, edgesOf] of [
    [hullA, hullB],
    [hullB, hullA],
  ] as const) {
    for (const v of vertices) {
      for (const [s0, s1] of hullEdges(edgesOf)) {
        best = Math.min(best, pointSegmentDistance(v, s0, s1));
      }
    }
  }
  return best;
}

/** True when some candidate axis separates the two hulls. Touching hulls are not separated. */
function hullsSeparated(hullA: readonly Vec2[], hullB: readonly Vec2[]): boolean {
  const axes = [...separatingAxes(hullA), ...separatingAxes(hullB)];
  for (const axis of axes) {
    const [minA, maxA] = projectRange(hullA, axis);
    const [minB, maxB] = projectRange(hullB, axis);
    if (maxA < minB || maxB < minA) {
      return true;
    }
  }
  return false;
}

function separatingAxes(hull: readonly Vec2[]): Vec2[] {
  if (hull.length === 1) {
    return [];
  }
  if (hull.length === 2) {
    const [p, q] = [hull[0]!, hull[1]!];
    const direction: Vec2 = [q[0] - p[0], q[1] - p[1]];
    return [direction, [-direction[1], direction[0]]];
  }
  return hullEdges(hull).map(([p, q]): Vec2 => [-(q[1] - p[1]), q[0] - p[0]]);
}

function projectRange(hull: readonly Vec2[], axis: Vec2): [number, number] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const p of hull) {
    const value = p[0] * axis[0] + p[1] * axis[1];
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return [min, max];
}

/** Edges of a hull as segments. A point gives a zero-length segment, and a pair gives one edge. */
function hullEdges(hull: readonly Vec2[]): [Vec2, Vec2][] {
  if (hull.length === 1) {
    return [[hull[0]!, hull[0]!]];
  }
  if (hull.length === 2) {
    return [[hull[0]!, hull[1]!]];
  }
  return hull.map((p, i): [Vec2, Vec2] => [p, hull[(i + 1) % hull.length]!]);
}

function pointSegmentDistance(p: Vec2, s0: Vec2, s1: Vec2): number {
  const dx = s1[0] - s0[0];
  const dy = s1[1] - s0[1];
  const lengthSq = dx * dx + dy * dy;
  let t = 0;
  if (lengthSq > 0) {
    t = ((p[0] - s0[0]) * dx + (p[1] - s0[1]) * dy) / lengthSq;
    t = Math.min(1, Math.max(0, t));
  }
  return Math.hypot(p[0] - (s0[0] + t * dx), p[1] - (s0[1] + t * dy));
}

function cross2(o: Vec2, a: Vec2, b: Vec2): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}
