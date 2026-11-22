import { type Mesh, type Object3D, Vector3 } from "three";
/**
 * Geometry helpers for the kit guarantee tests (Req 22.15, 23.12, 24.3, 24.4).
 *
 * This file imports nothing from `src/`, so a defect in the engine cannot make a kit pass its
 * own check. It provides:
 *
 * - a triangle-triangle intersection test and an exact triangle-triangle distance;
 * - {@link TriangleTree}, an AABB tree over the triangles of one Part. Every query culls with the
 *   boxes of tree nodes and then the box of each triangle before it runs the exact test, so the
 *   brute-force answer is unchanged and 22,000-triangle Assemblies still take seconds;
 * - {@link minTriangleDistance}, {@link findIntersectingTrianglePairs} and
 *   {@link radialClearanceLowerBound} on top of the tree;
 * - {@link measureInwardThickness}, a ray from every triangle centroid along the inward normal;
 * - {@link findSourceMesh} and {@link worldConstructionAxis}, which map a Part's node path back to
 *   its mesh and read `userData.constructionAxis` (only kit tests may read `userData`).
 */
export type V3 = [number, number, number];
/** The arrays of one Part. A `Part` or `NormalizedPart` of the engine satisfies this shape. */
export interface TriangleSet {
  /** 3 numbers per vertex. */
  readonly positions: ArrayLike<number>;
  /** 3 vertex indices per triangle. */
  readonly triangles: ArrayLike<number>;
}
// ---------------------------------------------------------------------------
// Exact triangle-triangle tests on 9-number scratch buffers (3 vertices of x, y, z)
// ---------------------------------------------------------------------------
const SCRATCH_A = new Float64Array(9);
const SCRATCH_B = new Float64Array(9);
/** Copies triangle `t` of `set` into `out`. */
function loadTriangle(set: TriangleSet, t: number, out: Float64Array): void {
  for (let k = 0; k < 3; k++) {
    const vertex = set.triangles[3 * t + k]!;
    out[3 * k] = set.positions[3 * vertex]!;
    out[3 * k + 1] = set.positions[3 * vertex + 1]!;
    out[3 * k + 2] = set.positions[3 * vertex + 2]!;
  }
}
/** Squared distance between segment `(ia, ja)` of triangle `A` and segment `(ib, jb)` of `B`. */
function segmentSegmentDistSq(A: Float64Array, ia: number, ja: number, B: Float64Array, ib: number, jb: number): number {
  const p1x = A[3 * ia]!;
  const p1y = A[3 * ia + 1]!;
  const p1z = A[3 * ia + 2]!;
  const d1x = A[3 * ja]! - p1x;
  const d1y = A[3 * ja + 1]! - p1y;
  const d1z = A[3 * ja + 2]! - p1z;
  const p2x = B[3 * ib]!;
  const p2y = B[3 * ib + 1]!;
  const p2z = B[3 * ib + 2]!;
  const d2x = B[3 * jb]! - p2x;
  const d2y = B[3 * jb + 1]! - p2y;
  const d2z = B[3 * jb + 2]! - p2z;
  const rx = p1x - p2x;
  const ry = p1y - p2y;
  const rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  const tiny = 1e-300;
  let s: number;
  let t: number;
  if (a <= tiny && e <= tiny) {
    return rx * rx + ry * ry + rz * rz;
  }
  if (a <= tiny) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= tiny) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denominator = a * e - b * b;
      s = denominator > 0 ? clamp01((b * f - c * e) / denominator) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const dx = p1x + d1x * s - (p2x + d2x * t);
  const dy = p1y + d1y * s - (p2y + d2y * t);
  const dz = p1z + d1z * s - (p2z + d2z * t);
  return dx * dx + dy * dy + dz * dz;
}
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
/** Squared distance from point `(px, py, pz)` to the triangle in `T` (closest point of a triangle). */
function pointTriangleDistSq(px: number, py: number, pz: number, T: Float64Array): number {
  const ax = T[0]!;
  const ay = T[1]!;
  const az = T[2]!;
  const abx = T[3]! - ax;
  const aby = T[4]! - ay;
  const abz = T[5]! - az;
  const acx = T[6]! - ax;
  const acy = T[7]! - ay;
  const acz = T[8]! - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let cx: number;
  let cy: number;
  let cz: number;
  if (d1 <= 0 && d2 <= 0) {
    [cx, cy, cz] = [ax, ay, az];
  } else {
    const bpx = px - T[3]!;
    const bpy = py - T[4]!;
    const bpz = pz - T[5]!;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    const vc = d1 * d4 - d3 * d2;
    const cpx = px - T[6]!;
    const cpy = py - T[7]!;
    const cpz = pz - T[8]!;
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    const vb = d5 * d2 - d1 * d6;
    const va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) {
      [cx, cy, cz] = [T[3]!, T[4]!, T[5]!];
    } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      [cx, cy, cz] = [ax + v * abx, ay + v * aby, az + v * abz];
    } else if (d6 >= 0 && d5 <= d6) {
      [cx, cy, cz] = [T[6]!, T[7]!, T[8]!];
    } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6);
      [cx, cy, cz] = [ax + w * acx, ay + w * acy, az + w * acz];
    } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      [cx, cy, cz] = [T[3]! + w * (T[6]! - T[3]!), T[4]! + w * (T[7]! - T[4]!), T[5]! + w * (T[8]! - T[5]!)];
    } else {
      const denominator = 1 / (va + vb + vc);
      const v = vb * denominator;
      const w = vc * denominator;
      [cx, cy, cz] = [ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w];
    }
  }
  const dx = px - cx;
  const dy = py - cy;
  const dz = pz - cz;
  return dx * dx + dy * dy + dz * dz;
}
/** Smallest squared distance over the 9 edge pairs and the 6 vertex-face pairs. */
function candidateDistSq(A: Float64Array, B: Float64Array): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      best = Math.min(best, segmentSegmentDistSq(A, i, (i + 1) % 3, B, j, (j + 1) % 3));
    }
    best = Math.min(best, pointTriangleDistSq(A[3 * i]!, A[3 * i + 1]!, A[3 * i + 2]!, B));
    best = Math.min(best, pointTriangleDistSq(B[3 * i]!, B[3 * i + 1]!, B[3 * i + 2]!, A));
  }
  return best;
}
/** Largest absolute coordinate of both triangles, floored at 1, for tolerances. */
function toleranceFor(A: Float64Array, B: Float64Array): number {
  let scale = 1;
  for (let i = 0; i < 9; i++) {
    scale = Math.max(scale, Math.abs(A[i]!), Math.abs(B[i]!));
  }
  return 1e-12 * scale;
}
/** Unit normal of the triangle in `T` and its length before normalizing (0 for a degenerate one). */
function planeOf(T: Float64Array, out: Float64Array): number {
  const ux = T[3]! - T[0]!;
  const uy = T[4]! - T[1]!;
  const uz = T[5]! - T[2]!;
  const vx = T[6]! - T[0]!;
  const vy = T[7]! - T[1]!;
  const vz = T[8]! - T[2]!;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  if (length > 0) {
    out[0] = nx / length;
    out[1] = ny / length;
    out[2] = nz / length;
  }
  return length;
}
const PLANE_A = new Float64Array(3);
const PLANE_B = new Float64Array(3);
const SEGMENT = new Float64Array(9);
function signedDistanceToPlane(T: Float64Array, normal: Float64Array, x: number, y: number, z: number): number {
  return normal[0]! * (x - T[0]!) + normal[1]! * (y - T[1]!) + normal[2]! * (z - T[2]!);
}
/**
 * True when the closed segment from corner `i` to corner `j` of `S` touches the triangle in `T`,
 * whose unit normal is in `normal`.
 */
function segmentTouchesTriangle(S: Float64Array, i: number, j: number, T: Float64Array, normal: Float64Array, tolerance: number): boolean {
  const d0 = signedDistanceToPlane(T, normal, S[3 * i]!, S[3 * i + 1]!, S[3 * i + 2]!);
  const d1 = signedDistanceToPlane(T, normal, S[3 * j]!, S[3 * j + 1]!, S[3 * j + 2]!);
  if ((d0 > tolerance && d1 > tolerance) || (d0 < -tolerance && d1 < -tolerance)) {
    return false;
  }
  const spread = d0 - d1;
  const s = Math.abs(spread) <= tolerance ? 0 : clamp01(d0 / spread);
  const px = S[3 * i]! + s * (S[3 * j]! - S[3 * i]!);
  const py = S[3 * i + 1]! + s * (S[3 * j + 1]! - S[3 * i + 1]!);
  const pz = S[3 * i + 2]! + s * (S[3 * j + 2]! - S[3 * i + 2]!);
  if (pointTriangleDistSq(px, py, pz, T) <= tolerance * tolerance) {
    return true;
  }
  // A segment lying in the plane may meet the triangle away from the point chosen above.
  if (Math.abs(d0) <= tolerance && Math.abs(d1) <= tolerance) {
    SEGMENT[0] = S[3 * i]!;
    SEGMENT[1] = S[3 * i + 1]!;
    SEGMENT[2] = S[3 * i + 2]!;
    SEGMENT[3] = S[3 * j]!;
    SEGMENT[4] = S[3 * j + 1]!;
    SEGMENT[5] = S[3 * j + 2]!;
    SEGMENT[6] = SEGMENT[3]!;
    SEGMENT[7] = SEGMENT[4]!;
    SEGMENT[8] = SEGMENT[5]!;
    for (let k = 0; k < 3; k++) {
      if (segmentSegmentDistSq(SEGMENT, 0, 1, T, k, (k + 1) % 3) <= tolerance * tolerance) {
        return true;
      }
    }
  }
  return false;
}
/** Exact test on loaded scratch triangles. Touching counts as intersecting. */
function scratchTrianglesIntersect(A: Float64Array, B: Float64Array): boolean {
  const tolerance = toleranceFor(A, B);
  const lengthA = planeOf(A, PLANE_A);
  const lengthB = planeOf(B, PLANE_B);
  if (!(lengthA > 0) || !(lengthB > 0)) {
    // A degenerate triangle is a segment or a point: compare by distance.
    return candidateDistSq(A, B) <= tolerance * tolerance;
  }
  let aAbove = 0;
  let aBelow = 0;
  let aOn = 0;
  let bAbove = 0;
  let bBelow = 0;
  for (let k = 0; k < 3; k++) {
    const dA = signedDistanceToPlane(B, PLANE_B, A[3 * k]!, A[3 * k + 1]!, A[3 * k + 2]!);
    const dB = signedDistanceToPlane(A, PLANE_A, B[3 * k]!, B[3 * k + 1]!, B[3 * k + 2]!);
    if (dA > tolerance) aAbove++;
    else if (dA < -tolerance) aBelow++;
    else aOn++;
    if (dB > tolerance) bAbove++;
    else if (dB < -tolerance) bBelow++;
  }
  if (aAbove === 3 || aBelow === 3 || bAbove === 3 || bBelow === 3) {
    return false;
  }
  if (aOn === 3) {
    // Coplanar: they meet exactly when some vertex lies in the other triangle or two edges cross,
    // and the vertex-face and edge-edge distances cover both.
    return candidateDistSq(A, B) <= tolerance * tolerance;
  }
  for (let k = 0; k < 3; k++) {
    if (segmentTouchesTriangle(A, k, (k + 1) % 3, B, PLANE_B, tolerance)) return true;
    if (segmentTouchesTriangle(B, k, (k + 1) % 3, A, PLANE_A, tolerance)) return true;
  }
  return false;
}
function fromCorners(corners: readonly [V3, V3, V3], out: Float64Array): Float64Array {
  for (let k = 0; k < 3; k++) {
    out[3 * k] = corners[k]![0];
    out[3 * k + 1] = corners[k]![1];
    out[3 * k + 2] = corners[k]![2];
  }
  return out;
}
/** True when two triangles share at least one point. Touching counts as intersecting. */
export function trianglesIntersect(a: readonly [V3, V3, V3], b: readonly [V3, V3, V3]): boolean {
  return scratchTrianglesIntersect(fromCorners(a, new Float64Array(9)), fromCorners(b, new Float64Array(9)));
}
/** Exact smallest distance between two triangles, 0 when they intersect. */
export function triangleDistance(a: readonly [V3, V3, V3], b: readonly [V3, V3, V3]): number {
  const A = fromCorners(a, new Float64Array(9));
  const B = fromCorners(b, new Float64Array(9));
  return scratchTrianglesIntersect(A, B) ? 0 : Math.sqrt(candidateDistSq(A, B));
}
// ---------------------------------------------------------------------------
// AABB tree
// ---------------------------------------------------------------------------
const LEAF_SIZE = 8;
/**
 * A binary AABB tree over the triangles of one Part, built by median split of the triangle box
 * centers along the longest axis. Box layout everywhere: `minX, minY, minZ, maxX, maxY, maxZ`.
 */
export class TriangleTree {
  readonly set: TriangleSet;
  readonly triangleCount: number;
  /** 6 numbers per triangle. */
  readonly triangleBoxes: Float64Array;
  /** Triangle indices, grouped by leaf. */
  readonly order: Uint32Array;
  /** Per node, 6 numbers. Node 0 is the root. */
  nodeBoxes: Float64Array = new Float64Array(0);
  /** Per node, the child indices, or -1 for a leaf. */
  nodeLeft: Int32Array = new Int32Array(0);
  nodeRight: Int32Array = new Int32Array(0);
  /** Per leaf, its range in `order`. */
  nodeStart: Int32Array = new Int32Array(0);
  nodeEnd: Int32Array = new Int32Array(0);
  constructor(set: TriangleSet) {
    this.set = set;
    this.triangleCount = Math.floor(set.triangles.length / 3);
    if (this.triangleCount === 0) {
      throw new RangeError("a TriangleTree needs at least one triangle");
    }
    this.triangleBoxes = new Float64Array(6 * this.triangleCount);
    for (let t = 0; t < this.triangleCount; t++) {
      const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let k = 0; k < 3; k++) {
        const vertex = set.triangles[3 * t + k]!;
        for (let c = 0; c < 3; c++) {
          const value = set.positions[3 * vertex + c]!;
          box[c] = Math.min(box[c]!, value);
          box[3 + c] = Math.max(box[3 + c]!, value);
        }
      }
      this.triangleBoxes.set(box, 6 * t);
    }
    this.order = Uint32Array.from({ length: this.triangleCount }, (_, i) => i);
    const boxes: number[] = [];
    const left: number[] = [];
    const right: number[] = [];
    const start: number[] = [];
    const end: number[] = [];
    const build = (from: number, to: number): number => {
      const node = left.length;
      left.push(-1);
      right.push(-1);
      start.push(from);
      end.push(to);
      const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let i = from; i < to; i++) {
        const t = this.order[i]!;
        for (let c = 0; c < 3; c++) {
          box[c] = Math.min(box[c]!, this.triangleBoxes[6 * t + c]!);
          box[3 + c] = Math.max(box[3 + c]!, this.triangleBoxes[6 * t + 3 + c]!);
        }
      }
      boxes.push(...box);
      if (to - from > LEAF_SIZE) {
        let axis = 0;
        for (let c = 1; c < 3; c++) {
          if (box[3 + c]! - box[c]! > box[3 + axis]! - box[axis]!) axis = c;
        }
        const center = (t: number): number => this.triangleBoxes[6 * t + axis]! + this.triangleBoxes[6 * t + 3 + axis]!;
        this.order.subarray(from, to).sort((x, y) => center(x) - center(y) || x - y);
        const middle = (from + to) >> 1;
        const l = build(from, middle);
        const r = build(middle, to);
        left[node] = l;
        right[node] = r;
      }
      return node;
    };
    build(0, this.triangleCount);
    this.nodeBoxes = Float64Array.from(boxes);
    this.nodeLeft = Int32Array.from(left);
    this.nodeRight = Int32Array.from(right);
    this.nodeStart = Int32Array.from(start);
    this.nodeEnd = Int32Array.from(end);
  }
  /** Box of the whole Part. */
  get bounds(): { min: V3; max: V3 } {
    const b = this.nodeBoxes;
    return { min: [b[0]!, b[1]!, b[2]!], max: [b[3]!, b[4]!, b[5]!] };
  }
}
function boxGapSq(A: Float64Array, ia: number, B: Float64Array, ib: number): number {
  let sum = 0;
  for (let c = 0; c < 3; c++) {
    const gap = Math.max(A[ia + c]! - B[ib + 3 + c]!, B[ib + c]! - A[ia + 3 + c]!, 0);
    sum += gap * gap;
  }
  return sum;
}
/** Smallest distance between the boxes of two trees, 0 when they overlap. */
export function boundsDistance(a: TriangleTree, b: TriangleTree): number {
  return Math.sqrt(boxGapSq(a.nodeBoxes, 0, b.nodeBoxes, 0));
}
function boxSizeSq(boxes: Float64Array, offset: number): number {
  let sum = 0;
  for (let c = 0; c < 3; c++) {
    const extent = boxes[offset + 3 + c]! - boxes[offset + c]!;
    sum += extent * extent;
  }
  return sum;
}
/**
 * Visits every pair of leaf triangles that the node-level and triangle-level culls leave.
 * `skipNodes(gapSq, boxesA, offsetA, boxesB, offsetB)` may skip a pair of nodes, and
 * `onTrianglePair(ta, tb, boxGapSq)` receives each triangle pair whose boxes pass `skipBoxes`.
 */
function traversePairs(
  a: TriangleTree,
  b: TriangleTree,
  skipBoxes: (gapSq: number) => boolean,
  skipNodes: (boxesA: Float64Array, offsetA: number, boxesB: Float64Array, offsetB: number) => boolean,
  onTrianglePair: (ta: number, tb: number, gapSq: number) => void,
): void {
  const visit = (na: number, nb: number): void => {
    const gapSq = boxGapSq(a.nodeBoxes, 6 * na, b.nodeBoxes, 6 * nb);
    if (skipBoxes(gapSq) || skipNodes(a.nodeBoxes, 6 * na, b.nodeBoxes, 6 * nb)) {
      return;
    }
    const aLeaf = a.nodeLeft[na]! < 0;
    const bLeaf = b.nodeLeft[nb]! < 0;
    if (aLeaf && bLeaf) {
      for (let i = a.nodeStart[na]!; i < a.nodeEnd[na]!; i++) {
        const ta = a.order[i]!;
        for (let j = b.nodeStart[nb]!; j < b.nodeEnd[nb]!; j++) {
          const tb = b.order[j]!;
          const pairGap = boxGapSq(a.triangleBoxes, 6 * ta, b.triangleBoxes, 6 * tb);
          if (!skipBoxes(pairGap)) {
            onTrianglePair(ta, tb, pairGap);
          }
        }
      }
      return;
    }
    const splitA = !aLeaf && (bLeaf || boxSizeSq(a.nodeBoxes, 6 * na) >= boxSizeSq(b.nodeBoxes, 6 * nb));
    if (splitA) {
      const l = a.nodeLeft[na]!;
      const r = a.nodeRight[na]!;
      const gl = boxGapSq(a.nodeBoxes, 6 * l, b.nodeBoxes, 6 * nb);
      const gr = boxGapSq(a.nodeBoxes, 6 * r, b.nodeBoxes, 6 * nb);
      const [first, second] = gl <= gr ? [l, r] : [r, l];
      visit(first, nb);
      visit(second, nb);
    } else {
      const l = b.nodeLeft[nb]!;
      const r = b.nodeRight[nb]!;
      const gl = boxGapSq(a.nodeBoxes, 6 * na, b.nodeBoxes, 6 * l);
      const gr = boxGapSq(a.nodeBoxes, 6 * na, b.nodeBoxes, 6 * r);
      const [first, second] = gl <= gr ? [l, r] : [r, l];
      visit(na, first);
      visit(na, second);
    }
  };
  visit(0, 0);
}
export interface DistanceOptions {
  /** Stop looking for pairs farther than this. Default: no limit. */
  cutoff?: number;
  /**
   * Only triangle pairs whose projections onto this axis overlap (touching counts) are compared.
   * The axis need not be a unit vector.
   */
  projectionAxis?: V3;
}
export interface DistanceResult {
  /** `Infinity` (or the cutoff) when no pair qualified. */
  distance: number;
  /** Triangle indices of the closest pair, -1 when none qualified. */
  triangleA: number;
  triangleB: number;
}
/** Projection interval of the box at `offset` onto `axis`. */
function boxInterval(boxes: Float64Array, offset: number, axis: V3): [number, number] {
  let center = 0;
  let half = 0;
  for (let c = 0; c < 3; c++) {
    const lo = boxes[offset + c]!;
    const hi = boxes[offset + 3 + c]!;
    center += 0.5 * (lo + hi) * axis[c]!;
    half += 0.5 * (hi - lo) * Math.abs(axis[c]!);
  }
  return [center - half, center + half];
}
function triangleInterval(T: Float64Array, axis: V3): [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let k = 0; k < 3; k++) {
    const p = T[3 * k]! * axis[0] + T[3 * k + 1]! * axis[1] + T[3 * k + 2]! * axis[2];
    lo = Math.min(lo, p);
    hi = Math.max(hi, p);
  }
  return [lo, hi];
}
/**
 * Exact smallest distance between the surfaces of two Parts (triangle to triangle, 0 when any
 * pair intersects), found by AABB-culled search. The result equals the brute-force minimum over
 * all triangle pairs that pass the optional projection filter.
 */
export function minTriangleDistance(a: TriangleTree, b: TriangleTree, options: DistanceOptions = {}): DistanceResult {
  let bestSq = options.cutoff === undefined ? Number.POSITIVE_INFINITY : options.cutoff * options.cutoff;
  let triangleA = -1;
  let triangleB = -1;
  const axis = options.projectionAxis;
  const skipNodes = (boxesA: Float64Array, offsetA: number, boxesB: Float64Array, offsetB: number): boolean => {
    if (axis === undefined) return false;
    const [loA, hiA] = boxInterval(boxesA, offsetA, axis);
    const [loB, hiB] = boxInterval(boxesB, offsetB, axis);
    return hiA < loB - 1e-12 || hiB < loA - 1e-12;
  };
  traversePairs(
    a,
    b,
    (gapSq) => gapSq >= bestSq,
    skipNodes,
    (ta, tb, gapSq) => {
      loadTriangle(a.set, ta, SCRATCH_A);
      loadTriangle(b.set, tb, SCRATCH_B);
      if (axis !== undefined) {
        const [loA, hiA] = triangleInterval(SCRATCH_A, axis);
        const [loB, hiB] = triangleInterval(SCRATCH_B, axis);
        if (hiA < loB || hiB < loA) return;
      }
      const distSq = gapSq === 0 && scratchTrianglesIntersect(SCRATCH_A, SCRATCH_B) ? 0 : candidateDistSq(SCRATCH_A, SCRATCH_B);
      if (distSq < bestSq) {
        bestSq = distSq;
        triangleA = ta;
        triangleB = tb;
      }
    },
  );
  return { distance: Math.sqrt(bestSq), triangleA, triangleB };
}
/** Every pair `(triangle of a, triangle of b)` that intersects, at most `limit` pairs. */
export function findIntersectingTrianglePairs(a: TriangleTree, b: TriangleTree, limit = 16): [number, number][] {
  const found: [number, number][] = [];
  traversePairs(
    a,
    b,
    (gapSq) => gapSq > 0 || found.length >= limit,
    () => false,
    (ta, tb) => {
      loadTriangle(a.set, ta, SCRATCH_A);
      loadTriangle(b.set, tb, SCRATCH_B);
      if (scratchTrianglesIntersect(SCRATCH_A, SCRATCH_B)) {
        found.push([ta, tb]);
      }
    },
  );
  return found;
}
/** Smallest distance between any vertex of `a` and any vertex of `b`, brute force with a box cull. */
export function minVertexDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const boxOf = (p: ArrayLike<number>): number[] => {
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        box[c] = Math.min(box[c]!, p[i + c]!);
        box[3 + c] = Math.max(box[3 + c]!, p[i + c]!);
      }
    }
    return box;
  };
  const boxB = boxOf(b);
  let bestSq = Number.POSITIVE_INFINITY;
  for (let i = 0; i < a.length; i += 3) {
    // Distance from the vertex to b's box is a lower bound of its distance to any vertex of b.
    let boxSq = 0;
    for (let c = 0; c < 3; c++) {
      const gap = Math.max(boxB[c]! - a[i + c]!, a[i + c]! - boxB[3 + c]!, 0);
      boxSq += gap * gap;
    }
    if (boxSq >= bestSq) continue;
    for (let j = 0; j < b.length; j += 3) {
      const dx = a[i]! - b[j]!;
      const dy = a[i + 1]! - b[j + 1]!;
      const dz = a[i + 2]! - b[j + 2]!;
      bestSq = Math.min(bestSq, dx * dx + dy * dy + dz * dz);
    }
  }
  return Math.sqrt(bestSq);
}
/**
 * Lower bound of the Radial_Clearance of Part `index` along `axis` (Req 23.12): the smallest
 * triangle-triangle distance between that Part and any other Part, taken over triangle pairs whose
 * projections onto `axis` overlap. Every pair of surface points at the same position along the
 * axis lies on such a triangle pair, and a 3D distance is never longer than the perpendicular
 * one between them, so this never exceeds the true Radial_Clearance. Returns `Infinity` for a
 * Part with no neighbor.
 */
export function radialClearanceLowerBound(
  trees: readonly TriangleTree[],
  index: number,
  axis: V3,
): { distance: number; otherIndex: number } {
  const own = trees[index];
  if (own === undefined) {
    throw new RangeError(`no tree at index ${index}`);
  }
  const candidates = trees
    .map((tree, otherIndex) => ({ tree, otherIndex, gap: boundsDistance(own, tree) }))
    .filter((candidate) => candidate.otherIndex !== index)
    .sort((x, y) => x.gap - y.gap || x.otherIndex - y.otherIndex);
  let best = Number.POSITIVE_INFINITY;
  let bestIndex = -1;
  for (const candidate of candidates) {
    if (candidate.gap >= best) {
      break;
    }
    const result = minTriangleDistance(own, candidate.tree, { cutoff: best, projectionAxis: axis });
    if (result.triangleA >= 0 && result.distance < best) {
      best = result.distance;
      bestIndex = candidate.otherIndex;
    }
  }
  return { distance: best, otherIndex: bestIndex };
}
// ---------------------------------------------------------------------------
// Inward-ray thickness
// ---------------------------------------------------------------------------
export interface ThicknessReport {
  /** Smallest inward distance over all measured centroids, `Infinity` when no ray hit anything. */
  minimum: number;
  /** Triangle whose inward ray gave `minimum`, -1 when none. */
  minimumTriangle: number;
  /** Triangles whose inward ray hit nothing (the surface is not closed there). */
  unclosedTriangles: number;
  /** Triangles with a usable normal. */
  measuredTriangles: number;
}
/**
 * Casts a ray from the centroid of every triangle along its negated unit normal and takes the
 * nearest hit on any other triangle of the same Part (Req 22.15). Hits closer than `1e-9` times
 * the Part's box diagonal are ignored as coincident-surface noise.
 */
export function measureInwardThickness(tree: TriangleTree): ThicknessReport {
  const set = tree.set;
  const b = tree.bounds;
  const diagonal = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  const hitFloor = 1e-9 * diagonal;
  const triangle = new Float64Array(9);
  const stack = new Int32Array(128);
  let minimum = Number.POSITIVE_INFINITY;
  let minimumTriangle = -1;
  let unclosed = 0;
  let measured = 0;
  const other = new Float64Array(9);
  for (let t = 0; t < tree.triangleCount; t++) {
    loadTriangle(set, t, triangle);
    const e1x = triangle[3]! - triangle[0]!;
    const e1y = triangle[4]! - triangle[1]!;
    const e1z = triangle[5]! - triangle[2]!;
    const e2x = triangle[6]! - triangle[0]!;
    const e2y = triangle[7]! - triangle[1]!;
    const e2z = triangle[8]! - triangle[2]!;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const length = Math.hypot(nx, ny, nz);
    if (!(length > 0)) continue;
    measured++;
    const dx = -nx / length;
    const dy = -ny / length;
    const dz = -nz / length;
    const ox = (triangle[0]! + triangle[3]! + triangle[6]!) / 3;
    const oy = (triangle[1]! + triangle[4]! + triangle[7]!) / 3;
    const oz = (triangle[2]! + triangle[5]! + triangle[8]!) / 3;
    const invX = 1 / dx;
    const invY = 1 / dy;
    const invZ = 1 / dz;
    let nearest = Number.POSITIVE_INFINITY;
    let top = 0;
    stack[top++] = 0;
    while (top > 0) {
      const node = stack[--top]!;
      const o = 6 * node;
      if (!rayHitsBox(tree.nodeBoxes, o, ox, oy, oz, dx, dy, dz, invX, invY, invZ, nearest)) continue;
      if (tree.nodeLeft[node]! < 0) {
        for (let i = tree.nodeStart[node]!; i < tree.nodeEnd[node]!; i++) {
          const u = tree.order[i]!;
          if (u === t) continue;
          loadTriangle(set, u, other);
          const hit = rayTriangle(ox, oy, oz, dx, dy, dz, other);
          if (hit > hitFloor && hit < nearest) nearest = hit;
        }
      } else {
        stack[top++] = tree.nodeLeft[node]!;
        stack[top++] = tree.nodeRight[node]!;
      }
    }
    if (nearest === Number.POSITIVE_INFINITY) {
      unclosed++;
    } else if (nearest < minimum) {
      minimum = nearest;
      minimumTriangle = t;
    }
  }
  return { minimum, minimumTriangle, unclosedTriangles: unclosed, measuredTriangles: measured };
}
/** Slab test of the ray against the box at `offset`, for distances in `[0, limit]`. */
function rayHitsBox(
  boxes: Float64Array,
  offset: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  invX: number,
  invY: number,
  invZ: number,
  limit: number,
): boolean {
  const slack = 1e-12;
  let tNear = 0;
  let tFar = limit;
  const origin = [ox, oy, oz];
  const direction = [dx, dy, dz];
  const inverse = [invX, invY, invZ];
  for (let c = 0; c < 3; c++) {
    const lo = boxes[offset + c]!;
    const hi = boxes[offset + 3 + c]!;
    if (direction[c] === 0) {
      if (origin[c]! < lo - slack || origin[c]! > hi + slack) return false;
    } else {
      const t1 = (lo - origin[c]!) * inverse[c]!;
      const t2 = (hi - origin[c]!) * inverse[c]!;
      tNear = Math.max(tNear, Math.min(t1, t2));
      tFar = Math.min(tFar, Math.max(t1, t2));
      if (tNear > tFar + slack) return false;
    }
  }
  return true;
}
/** Double-sided Moeller-Trumbore. Returns the distance along the ray, or `-1` for a miss. */
function rayTriangle(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, T: Float64Array): number {
  const e1x = T[3]! - T[0]!;
  const e1y = T[4]! - T[1]!;
  const e1z = T[5]! - T[2]!;
  const e2x = T[6]! - T[0]!;
  const e2y = T[7]! - T[1]!;
  const e2z = T[8]! - T[2]!;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const determinant = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(determinant) < 1e-18) return -1;
  const inverse = 1 / determinant;
  const sx = ox - T[0]!;
  const sy = oy - T[1]!;
  const sz = oz - T[2]!;
  const u = (sx * px + sy * py + sz * pz) * inverse;
  const slack = 1e-12;
  if (u < -slack || u > 1 + slack) return -1;
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inverse;
  if (v < -slack || u + v > 1 + slack) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inverse;
  return t > 0 ? t : -1;
}
// ---------------------------------------------------------------------------
// Source mesh lookup and Construction_Axis
// ---------------------------------------------------------------------------
/**
 * Follows `path`, a list of child indices from `root`, to the node it names (the Part's
 * `sourceNodePath`). An empty path is the root. Throws when a step leaves the hierarchy.
 */
export function findNodeByPath(root: Object3D, path: readonly number[]): Object3D {
  let node: Object3D = root;
  for (const [depth, childIndex] of path.entries()) {
    const child: Object3D | undefined = node.children[childIndex];
    if (child === undefined) {
      throw new RangeError(`node path [${path.join(", ")}] leaves the hierarchy at step ${depth} (child ${childIndex})`);
    }
    node = child;
  }
  return node;
}
/** The mesh at `path`. Throws when the node is not a mesh. */
export function findSourceMesh(root: Object3D, path: readonly number[]): Mesh {
  const node = findNodeByPath(root, path);
  if ((node as Mesh).isMesh !== true) {
    throw new RangeError(`node at path [${path.join(", ")}] (${node.name || node.type}) is not a mesh`);
  }
  return node as Mesh;
}
/**
 * Reads `mesh.userData.constructionAxis`. It must be a 3-element array of finite numbers with
 * length 1 within `1e-9`. Returns the axis in the mesh's local frame, or the reason it is invalid.
 */
export function readConstructionAxis(mesh: Mesh): { axis: V3 } | { problem: string } {
  const raw: unknown = mesh.userData.constructionAxis;
  if (!Array.isArray(raw) || raw.length !== 3) {
    return { problem: `userData.constructionAxis of ${mesh.name} is not a 3-element array` };
  }
  const components = raw as unknown[];
  if (!components.every((value): value is number => typeof value === "number" && Number.isFinite(value))) {
    return { problem: `userData.constructionAxis of ${mesh.name} has a non-finite component` };
  }
  const axis: V3 = [components[0] as number, components[1] as number, components[2] as number];
  const length = Math.hypot(axis[0], axis[1], axis[2]);
  if (!(Math.abs(length - 1) <= 1e-9)) {
    return { problem: `userData.constructionAxis of ${mesh.name} has length ${length}, not 1` };
  }
  return { axis };
}
/**
 * The Construction_Axis of `mesh` in world space, `transformDirection(mesh.matrixWorld)`. The
 * caller must have called `updateMatrixWorld(true)` on the hierarchy root. The Normalizer applies a
 * uniform positive scale and a translation, so this is also the axis in normalized coordinates.
 */
export function worldConstructionAxis(mesh: Mesh, axis: V3): V3 {
  const direction = new Vector3(axis[0], axis[1], axis[2]).transformDirection(mesh.matrixWorld);
  return [direction.x, direction.y, direction.z];
}
