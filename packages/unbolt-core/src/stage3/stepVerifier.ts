import type { Box3 } from "three";
import type { ResolvedSolverConfig } from "../config";
import { expandAabb, type Aabb } from "../math/aabb";
import { at } from "../stage0/arrayAccess";
import { filterNearest } from "../stage2/hitFilter";
import { castAllHits, createRayHits, createRayTarget, type RayHits, type RayTarget } from "../stage2/rayCast";
import type { BlockingEdge, NormalizedPart, Vec3 } from "../types";

/**
 * Margin on both boxes of the coarse swept-AABB test, in normalized units. It only lets more
 * pairs through to the exact rays, so it can never hide a collision.
 */
export const SWEEP_MARGIN = 1e-9;
/** A vertex whose area-weighted normal sum is not longer than this uses its largest incident face. */
const KNIFE_EDGE_LENGTH = 1e-12;
/**
 * An edge whose incident face normals all agree to within this (`1 - n_t · n_first`) lies inside
 * one flat face, such as the diagonal of a triangulated quad, and is not swept by Stage B.
 */
const FLAT_EDGE_TOLERANCE = 1e-9;

/**
 * Margin on the query box of an edge sweep against a BVH, in normalized units. The library
 * stores float32 node bounds, which can sit up to one float32 ulp (about 6e-8) inside the exact
 * float64 geometry, so this only lets more triangles through to the exact test.
 */
const BVH_QUERY_MARGIN = 1e-6;

/** The request that the Peel_Solver hands to a step verifier before it commits a Plan_Step. */
export interface StepVerificationRequest {
  /** The Part that the cascade selected. */
  readonly partId: string;
  /** Index of the chosen Candidate_Axis. */
  readonly dirIndex: number;
  /** The chosen Candidate_Axis itself. */
  readonly dir: Vec3;
  /**
   * Travel along `dir` in normalized units: the selected Escape_Distance, which Stage 4 compiles
   * into `linear_slide.distance`. Contact beyond it is not part of the move.
   */
  readonly distance: number;
  /** Every unremoved Part other than `partId`, ascending by Part_ID. */
  readonly unremovedPartIds: readonly string[];
}

/**
 * Checks one selected move before the Peel_Solver commits it (Req 14.11). Returns one
 * Blocking_Edge `(partId, B, dirIndex)` for every unremoved Part B that the move over
 * `[0, distance]` collides with, or an empty list when no collision is detected.
 */
export type StepVerifier = (request: StepVerificationRequest) => BlockingEdge[];

/** Which detector of the step verifier found a Blocking_Edge. */
export type StepDetectionStage = "ray" | "edge_sweep";

/** One Blocking_Edge reported by the step verifier, with the exact move it was found for. */
export interface StepDetection {
  readonly from: string;
  readonly to: string;
  readonly dirIndex: number;
  readonly dir: Vec3;
  readonly distance: number;
  /** `ray` for Stage A (vertex and centroid rays), `edge_sweep` for Stage B. */
  readonly stage: StepDetectionStage;
}

/**
 * The deterministic ray sources of one Part, as micro-shrunk origins. Vertex sources come
 * first, then centroid sources. `sourceTri[i]` is the Part-local triangle that source `i`
 * belongs to: the triangle itself for a centroid, the largest incident triangle for a vertex.
 */
interface SourceSet {
  readonly count: number;
  readonly originX: Float64Array;
  readonly originY: Float64Array;
  readonly originZ: Float64Array;
  readonly sourceTri: Uint32Array;
}

/**
 * The welded edges of one Part, micro-shrunk, for Stage B. Edge `i` runs from `(ax, ay, az)[i]`
 * to `(bx, by, bz)[i]`, and `edgeTri[i]` is its largest incident positive-area triangle.
 */
interface EdgeSet {
  readonly count: number;
  readonly ax: Float64Array;
  readonly ay: Float64Array;
  readonly az: Float64Array;
  readonly bx: Float64Array;
  readonly by: Float64Array;
  readonly bz: Float64Array;
  readonly edgeTri: Uint32Array;
}

interface PartRuntime {
  readonly part: NormalizedPart;
  readonly target: RayTarget;
  /** Built on first use, so Parts that never take part in a verification cost nothing. */
  sources: SourceSet | null;
  edges: EdgeSet | null;
}

/**
 * Builds the vertex and centroid ray sources of a Part from Stage 1's own face normals and
 * areas.
 *
 * Welded vertex: the representative vertex of each weld cluster, with the normal
 * `normalize(Σ area_t · n_t)` over the distinct positive-area triangles with a corner in the
 * cluster. When that sum is not longer than `1e-12` (a knife edge), the normal of the largest
 * incident triangle is used instead, the lowest index on ties. A cluster with no positive-area
 * incident triangle casts no ray.
 *
 * Centroid: the mean of the corners of every positive-area triangle, with its face normal.
 *
 * Each origin is the surface point moved `microShrink` against its normal, so it lies inside a
 * Watertight_Solid_Part, as Stage 2's Sample_Rays do (Req 13.1).
 */
function buildSourceSet(part: NormalizedPart, microShrink: number): SourceSet {
  const { positions, triangles, weldIds, weldRepresentatives, faceNormals, triangleAreas } = part;
  const triangleCount = Math.floor(triangles.length / 3);
  const clusterCount = weldRepresentatives.length;
  const sumX = new Float64Array(clusterCount);
  const sumY = new Float64Array(clusterCount);
  const sumZ = new Float64Array(clusterCount);
  const largestArea = new Float64Array(clusterCount);
  const largestTriangle = new Int32Array(clusterCount).fill(-1);
  const accumulate = (cluster: number, t: number, area: number): void => {
    sumX[cluster] = at(sumX, cluster) + area * at(faceNormals, 3 * t);
    sumY[cluster] = at(sumY, cluster) + area * at(faceNormals, 3 * t + 1);
    sumZ[cluster] = at(sumZ, cluster) + area * at(faceNormals, 3 * t + 2);
    // Ascending triangle order and a strict comparison keep the lowest index on ties.
    if (area > at(largestArea, cluster)) {
      largestArea[cluster] = area;
      largestTriangle[cluster] = t;
    }
  };
  let positiveTriangles = 0;
  for (let t = 0; t < triangleCount; t++) {
    const area = at(triangleAreas, t);
    if (!(area > 0)) {
      continue;
    }
    positiveTriangles++;
    const ca = at(weldIds, at(triangles, 3 * t));
    const cb = at(weldIds, at(triangles, 3 * t + 1));
    const cc = at(weldIds, at(triangles, 3 * t + 2));
    accumulate(ca, t, area);
    if (cb !== ca) {
      accumulate(cb, t, area);
    }
    if (cc !== ca && cc !== cb) {
      accumulate(cc, t, area);
    }
  }
  let vertexSources = 0;
  for (let c = 0; c < clusterCount; c++) {
    if (largestTriangle[c] !== -1) {
      vertexSources++;
    }
  }
  const count = vertexSources + positiveTriangles;
  const originX = new Float64Array(count);
  const originY = new Float64Array(count);
  const originZ = new Float64Array(count);
  const sourceTri = new Uint32Array(count);
  let next = 0;
  for (let c = 0; c < clusterCount; c++) {
    const largest = at(largestTriangle, c);
    if (largest === -1) {
      continue;
    }
    const v = 3 * at(weldRepresentatives, c);
    const sx = at(sumX, c);
    const sy = at(sumY, c);
    const sz = at(sumZ, c);
    const length = Math.sqrt(sx * sx + sy * sy + sz * sz);
    let nx: number;
    let ny: number;
    let nz: number;
    if (length <= KNIFE_EDGE_LENGTH) {
      nx = at(faceNormals, 3 * largest);
      ny = at(faceNormals, 3 * largest + 1);
      nz = at(faceNormals, 3 * largest + 2);
    } else {
      nx = sx / length;
      ny = sy / length;
      nz = sz / length;
    }
    originX[next] = at(positions, v) - microShrink * nx;
    originY[next] = at(positions, v + 1) - microShrink * ny;
    originZ[next] = at(positions, v + 2) - microShrink * nz;
    sourceTri[next] = largest;
    next++;
  }
  for (let t = 0; t < triangleCount; t++) {
    if (!(at(triangleAreas, t) > 0)) {
      continue;
    }
    const a = 3 * at(triangles, 3 * t);
    const b = 3 * at(triangles, 3 * t + 1);
    const c = 3 * at(triangles, 3 * t + 2);
    originX[next] = (at(positions, a) + at(positions, b) + at(positions, c)) / 3 - microShrink * at(faceNormals, 3 * t);
    originY[next] = (at(positions, a + 1) + at(positions, b + 1) + at(positions, c + 1)) / 3 - microShrink * at(faceNormals, 3 * t + 1);
    originZ[next] = (at(positions, a + 2) + at(positions, b + 2) + at(positions, c + 2)) / 3 - microShrink * at(faceNormals, 3 * t + 2);
    sourceTri[next] = t;
    next++;
  }
  return { count, originX, originY, originZ, sourceTri };
}

function sortedUnique(values: readonly number[]): number[] {
  const sorted = values.slice().sort((x, y) => x - y);
  const result: number[] = [];
  for (const value of sorted) {
    if (result[result.length - 1] !== value) {
      result.push(value);
    }
  }
  return result;
}

/**
 * Builds the welded feature edges of a Part for Stage B, from Stage 1's own face normals and
 * areas.
 *
 * An edge joins two distinct weld clusters and belongs to at least one positive-area triangle
 * whose three corners lie in three distinct clusters. It is kept when it has one incident
 * triangle, or when its incident face normals differ by more than `FLAT_EDGE_TOLERANCE`; an
 * edge inside one flat face is dropped, because its endpoints sit on the Part's other faces
 * without any shrink toward them. Its endpoints are the clusters'
 * representative vertices, moved `microShrink` against the edge normal
 * `normalize(Σ area_t · n_t)` over its incident triangles. When that sum is not longer than
 * `1e-12` (a knife edge), the normal of the largest incident triangle is used, the lowest index
 * on ties. Edges are numbered in order of first appearance in the triangle list, so the set is
 * deterministic.
 */
function buildEdgeSet(part: NormalizedPart, microShrink: number): EdgeSet {
  const { positions, triangles, weldIds, weldRepresentatives, faceNormals, triangleAreas } = part;
  const triangleCount = Math.floor(triangles.length / 3);
  const clusterCount = weldRepresentatives.length;
  const indexOfKey = new Map<number, number>();
  const lo: number[] = [];
  const hi: number[] = [];
  const sumX: number[] = [];
  const sumY: number[] = [];
  const sumZ: number[] = [];
  const largestArea: number[] = [];
  const largestTri: number[] = [];
  const incident: number[] = [];
  const firstTri: number[] = [];
  const minDot: number[] = [];
  const addEdge = (c0: number, c1: number, t: number, area: number): void => {
    const a = Math.min(c0, c1);
    const b = Math.max(c0, c1);
    const key = a * clusterCount + b;
    let e = indexOfKey.get(key);
    if (e === undefined) {
      e = lo.length;
      indexOfKey.set(key, e);
      lo.push(a);
      hi.push(b);
      sumX.push(0);
      sumY.push(0);
      sumZ.push(0);
      largestArea.push(0);
      largestTri.push(t);
      incident.push(0);
      firstTri.push(t);
      minDot.push(1);
    }
    incident[e] = (incident[e] as number) + 1;
    const f = firstTri[e] as number;
    const agreement =
      at(faceNormals, 3 * t) * at(faceNormals, 3 * f) + at(faceNormals, 3 * t + 1) * at(faceNormals, 3 * f + 1) + at(faceNormals, 3 * t + 2) * at(faceNormals, 3 * f + 2);
    if (agreement < (minDot[e] as number)) {
      minDot[e] = agreement;
    }
    sumX[e] = (sumX[e] as number) + area * at(faceNormals, 3 * t);
    sumY[e] = (sumY[e] as number) + area * at(faceNormals, 3 * t + 1);
    sumZ[e] = (sumZ[e] as number) + area * at(faceNormals, 3 * t + 2);
    if (area > (largestArea[e] as number)) {
      largestArea[e] = area;
      largestTri[e] = t;
    }
  };
  for (let t = 0; t < triangleCount; t++) {
    const area = at(triangleAreas, t);
    if (!(area > 0)) {
      continue;
    }
    const ca = at(weldIds, at(triangles, 3 * t));
    const cb = at(weldIds, at(triangles, 3 * t + 1));
    const cc = at(weldIds, at(triangles, 3 * t + 2));
    if (ca === cb || cb === cc || cc === ca) {
      continue;
    }
    addEdge(ca, cb, t, area);
    addEdge(cb, cc, t, area);
    addEdge(cc, ca, t, area);
  }
  // Feature edges only: an edge with one incident triangle (an open boundary) or with incident
  // faces that are not coplanar. First contact between translating solids that no vertex ray
  // sees begins edge against edge, and only feature edges can make it.
  const kept: number[] = [];
  for (let e = 0; e < lo.length; e++) {
    if ((incident[e] as number) < 2 || 1 - (minDot[e] as number) > FLAT_EDGE_TOLERANCE) {
      kept.push(e);
    }
  }
  const count = kept.length;
  const set: EdgeSet = {
    count,
    ax: new Float64Array(count),
    ay: new Float64Array(count),
    az: new Float64Array(count),
    bx: new Float64Array(count),
    by: new Float64Array(count),
    bz: new Float64Array(count),
    edgeTri: new Uint32Array(count),
  };
  for (let k = 0; k < count; k++) {
    const e = kept[k] as number;
    const sx = sumX[e] as number;
    const sy = sumY[e] as number;
    const sz = sumZ[e] as number;
    const length = Math.sqrt(sx * sx + sy * sy + sz * sz);
    const t = largestTri[e] as number;
    let nx: number;
    let ny: number;
    let nz: number;
    if (length <= KNIFE_EDGE_LENGTH) {
      nx = at(faceNormals, 3 * t);
      ny = at(faceNormals, 3 * t + 1);
      nz = at(faceNormals, 3 * t + 2);
    } else {
      nx = sx / length;
      ny = sy / length;
      nz = sz / length;
    }
    const va = 3 * at(weldRepresentatives, lo[e] as number);
    const vb = 3 * at(weldRepresentatives, hi[e] as number);
    set.ax[k] = at(positions, va) - microShrink * nx;
    set.ay[k] = at(positions, va + 1) - microShrink * ny;
    set.az[k] = at(positions, va + 2) - microShrink * nz;
    set.bx[k] = at(positions, vb) - microShrink * nx;
    set.by[k] = at(positions, vb + 1) - microShrink * ny;
    set.bz[k] = at(positions, vb + 2) - microShrink * nz;
    set.edgeTri[k] = t;
  }
  return set;
}

/**
 * Whether the segment `a + u·(b − a)`, `u ∈ [0, 1]`, translated by `s·d` for some
 * `s ∈ [eps, distance]`, meets the closed triangle `t` of `part`.
 *
 * With the triangle's plane `N·x = N·v0` (`N = (v1 − v0) × (v2 − v0)`, `N·d ≠ 0`), the travel at
 * which the point `u` reaches the plane is affine in `u`, `s(u) = s0 + s1·u`, so the point it
 * reaches, `x(u)`, and its three unnormalized barycentric coordinates
 * `λk(x) = N·((v(k+1) − x) × (v(k+2) − x))` are affine in `u` too. The sweep meets the triangle
 * exactly when the `u` interval on which `0 ≤ u ≤ 1`, every `λk ≥ 0` and `eps ≤ s(u) ≤ distance`
 * is non-empty. Each constraint is checked at `u = 0` and `u = 1` and clips the interval.
 */
function sweptSegmentMeetsTriangle(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  d: Vec3,
  eps: number,
  distance: number,
  part: NormalizedPart,
  t: number,
): boolean {
  const { positions, triangles } = part;
  const i0 = 3 * at(triangles, 3 * t);
  const i1 = 3 * at(triangles, 3 * t + 1);
  const i2 = 3 * at(triangles, 3 * t + 2);
  const v0x = at(positions, i0);
  const v0y = at(positions, i0 + 1);
  const v0z = at(positions, i0 + 2);
  const v1x = at(positions, i1);
  const v1y = at(positions, i1 + 1);
  const v1z = at(positions, i1 + 2);
  const v2x = at(positions, i2);
  const v2y = at(positions, i2 + 1);
  const v2z = at(positions, i2 + 2);
  const e1x = v1x - v0x;
  const e1y = v1y - v0y;
  const e1z = v1z - v0z;
  const e2x = v2x - v0x;
  const e2y = v2y - v0y;
  const e2z = v2z - v0z;
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  const nd = nx * d[0] + ny * d[1] + nz * d[2];
  if (nd === 0) {
    return false;
  }
  const ex = bx - ax;
  const ey = by - ay;
  const ez = bz - az;
  const s0 = (nx * (v0x - ax) + ny * (v0y - ay) + nz * (v0z - az)) / nd;
  const s1 = -(nx * ex + ny * ey + nz * ez) / nd;
  // x(0) and x(1) on the plane.
  const p0x = ax + s0 * d[0];
  const p0y = ay + s0 * d[1];
  const p0z = az + s0 * d[2];
  const p1x = bx + (s0 + s1) * d[0];
  const p1y = by + (s0 + s1) * d[1];
  const p1z = bz + (s0 + s1) * d[2];
  let lo = 0;
  let hi = 1;
  // Restricts [lo, hi] to the u where the affine function with values f0 at 0 and f1 at 1 is
  // >= 0, or > 0 when it is constant and `strict`. The interval must keep a positive length.
  const clip = (f0: number, f1: number, strict: boolean): boolean => {
    const slope = f1 - f0;
    if (slope === 0) {
      return strict ? f0 > 0 : f0 >= 0;
    }
    const root = -f0 / slope;
    if (slope > 0) {
      lo = Math.max(lo, root);
    } else {
      hi = Math.min(hi, root);
    }
    return lo < hi;
  };
  if (!clip(s0 - eps, s0 + s1 - eps, false) || !clip(distance - s0, distance - s0 - s1, false)) {
    return false;
  }
  const lambda = (px: number, py: number, pz: number, qx: number, qy: number, qz: number, rx: number, ry: number, rz: number): number => {
    // N · ((q − p) × (r − p)) for the point p.
    const ux = qx - px;
    const uy = qy - py;
    const uz = qz - pz;
    const wx = rx - px;
    const wy = ry - py;
    const wz = rz - pz;
    return nx * (uy * wz - uz * wy) + ny * (uz * wx - ux * wz) + nz * (ux * wy - uy * wx);
  };
  return (
    clip(lambda(p0x, p0y, p0z, v1x, v1y, v1z, v2x, v2y, v2z), lambda(p1x, p1y, p1z, v1x, v1y, v1z, v2x, v2y, v2z), true) &&
    clip(lambda(p0x, p0y, p0z, v2x, v2y, v2z, v0x, v0y, v0z), lambda(p1x, p1y, p1z, v2x, v2y, v2z, v0x, v0y, v0z), true) &&
    clip(lambda(p0x, p0y, p0z, v0x, v0y, v0z, v1x, v1y, v1z), lambda(p1x, p1y, p1z, v0x, v0y, v0z, v1x, v1y, v1z), true)
  );
}

/**
 * Stage B for one direction of one pair: sweeps every edge of `source` along `dir` over
 * `[eps, distance]` and looks for a triangle of `target` that opposes the motion
 * (`n · dir < -tau`, with Stage 1's face normal `n`) and that the swept edge meets. Stops at the
 * first such edge and returns `[sourceTriangle, targetTriangle]`, or `null` when there is none.
 *
 * Edges whose swept box misses `targetBox` are skipped without a BVH query. Candidate triangles
 * come from a `shapecast` over the swept edge's box grown by `BVH_QUERY_MARGIN`, and every
 * candidate is decided by the exact test of {@link sweptSegmentMeetsTriangle} on float64 Part
 * positions. With an indirect BVH, `shapecast` reports Part-local triangle indices.
 */
function sweepEdges(
  edges: EdgeSet,
  target: NormalizedPart,
  targetBox: Aabb,
  dir: Vec3,
  eps: number,
  tau: number,
  distance: number,
  stats: StepVerifierStats,
): [number, number] | null {
  const tdx = distance * dir[0];
  const tdy = distance * dir[1];
  const tdz = distance * dir[2];
  const qMin: Vec3 = [0, 0, 0];
  const qMax: Vec3 = [0, 0, 0];
  const normals = target.faceNormals;
  let edge = 0;
  let hitTriangle = -1;
  const callbacks = {
    intersectsBounds: (box: Box3): boolean =>
      box.min.x <= qMax[0] && box.max.x >= qMin[0] && box.min.y <= qMax[1] && box.max.y >= qMin[1] && box.min.z <= qMax[2] && box.max.z >= qMin[2],
    intersectsTriangle: (_triangle: unknown, t: number): boolean => {
      if (at(normals, 3 * t) * dir[0] + at(normals, 3 * t + 1) * dir[1] + at(normals, 3 * t + 2) * dir[2] >= -tau) {
        return false;
      }
      if (
        sweptSegmentMeetsTriangle(
          at(edges.ax, edge),
          at(edges.ay, edge),
          at(edges.az, edge),
          at(edges.bx, edge),
          at(edges.by, edge),
          at(edges.bz, edge),
          dir,
          eps,
          distance,
          target,
          t,
        )
      ) {
        hitTriangle = t;
        return true;
      }
      return false;
    },
  };
  for (edge = 0; edge < edges.count; edge++) {
    const ax = at(edges.ax, edge);
    const ay = at(edges.ay, edge);
    const az = at(edges.az, edge);
    const bx = at(edges.bx, edge);
    const by = at(edges.by, edge);
    const bz = at(edges.bz, edge);
    qMin[0] = Math.min(ax, bx, ax + tdx, bx + tdx) - BVH_QUERY_MARGIN;
    qMin[1] = Math.min(ay, by, ay + tdy, by + tdy) - BVH_QUERY_MARGIN;
    qMin[2] = Math.min(az, bz, az + tdz, bz + tdz) - BVH_QUERY_MARGIN;
    qMax[0] = Math.max(ax, bx, ax + tdx, bx + tdx) + BVH_QUERY_MARGIN;
    qMax[1] = Math.max(ay, by, ay + tdy, by + tdy) + BVH_QUERY_MARGIN;
    qMax[2] = Math.max(az, bz, az + tdz, bz + tdz) + BVH_QUERY_MARGIN;
    if (
      qMin[0] > targetBox.max[0] ||
      qMax[0] < targetBox.min[0] ||
      qMin[1] > targetBox.max[1] ||
      qMax[1] < targetBox.min[1] ||
      qMin[2] > targetBox.max[2] ||
      qMax[2] < targetBox.min[2]
    ) {
      continue;
    }
    stats.edgesSwept++;
    if (target.bvh.shapecast(callbacks)) {
      return [at(edges.edgeTri, edge), hitTriangle];
    }
  }
  return null;
}

/** Whether `moving` swept along `dir` over `[0, distance]` meets `target`, both boxes closed. */
function sweptBoxMeets(moving: Aabb, dir: Vec3, distance: number, target: Aabb): boolean {
  for (let j = 0; j < 3; j++) {
    const step = distance * (dir[j] as number);
    if ((moving.min[j] as number) + Math.min(0, step) > (target.max[j] as number) || (moving.max[j] as number) + Math.max(0, step) < (target.min[j] as number)) {
      return false;
    }
  }
  return true;
}

/**
 * Keeps only the first `out.count` hits with `distance <= maxDistance`, in their original
 * order, so the hit filter sees the hits within the move and nothing beyond it.
 */
function keepHitsWithin(out: RayHits, maxDistance: number): number {
  let kept = 0;
  for (let i = 0; i < out.count; i++) {
    const distance = out.distance[i] as number;
    if (distance <= maxDistance) {
      out.distance[kept] = distance;
      out.faceIndex[kept] = out.faceIndex[i] as number;
      kept++;
    }
  }
  out.count = kept;
  return kept;
}

/**
 * Stage A for one direction of one pair: casts every source of `source` along `dir` into
 * `target` with Stage 2's all-hit caster and hit filter, keeping only hits at a ray distance
 * `t ≤ maxDistance` (the filter itself drops `t < eps`), and appends the source triangle and
 * the hit triangle of each colliding ray. Returns the number of rays cast.
 */
function castSources(
  source: SourceSet,
  target: PartRuntime,
  dir: Vec3,
  eps: number,
  tau: number,
  maxDistance: number,
  hits: RayHits,
  sourceTris: number[],
  hitTris: number[],
): number {
  for (let i = 0; i < source.count; i++) {
    const hitCount = castAllHits(target.target, at(source.originX, i), at(source.originY, i), at(source.originZ, i), dir, hits);
    if (hitCount === 0 || keepHitsWithin(hits, maxDistance) === 0) {
      continue;
    }
    const triangle = filterNearest(hits, dir, target.part.faceNormals, eps, tau);
    if (triangle >= 0) {
      sourceTris.push(at(source.sourceTri, i));
      hitTris.push(triangle);
    }
  }
  return source.count;
}

/** Counters of one verifier, for tests and diagnostics. They never affect a plan. */
export interface StepVerifierStats {
  /** Calls of the verifier. */
  verifications: number;
  /** Ordered pairs `(A, B)` that passed the coarse swept-AABB test. */
  pairsChecked: number;
  raysCast: number;
  /** Welded edges whose sweep reached a BVH query in Stage B. */
  edgesSwept: number;
  /** Blocking_Edges the verifier reported. */
  edgesFound: number;
}

export interface StepVerifierHandle {
  readonly verify: StepVerifier;
  readonly stats: StepVerifierStats;
  /** Every reported Blocking_Edge in report order, with its move and the stage that found it. */
  readonly detections: readonly StepDetection[];
}

/**
 * Coarse-to-fine lazy exact step verification (Req 14.11), for one `stage3Peel` call.
 *
 * For a selected move of Part A along its Candidate_Axis `d` over the travel `D`
 * (`request.distance`, the selected Escape_Distance):
 *
 * 1. **Coarse.** Every unremoved Part B is skipped when A's AABB swept along `+d` over `[0, D]`
 *    misses B's AABB. Both boxes are grown by `microShrink + 1e-9`, so no ray origin or shrunk
 *    edge can lie outside them.
 * 2. **Stage A, rays.** For each remaining B, every source of A (all welded vertices and all
 *    positive-area triangle centroids, micro-shrunk) casts a ray along `+d` into B's BVH, and
 *    every source of B casts a ray along `-d` into A's BVH. Hits are collected with Stage 2's
 *    `castAllHits`, only hits at `t ≤ D` are kept, and the rest are classified with Stage 2's
 *    `filterNearest`, so the hit rules are those of the Blocking_Graph (Req 13.2 to 13.6) within
 *    the move: `eps ≤ t ≤ D`. Contact beyond the move is not a collision of the move.
 * 3. **Stage B, edge sweeps.** Only for a B that Stage A did not block. Every welded edge of A,
 *    micro-shrunk, is swept along `+d` over `[eps, D]` against B's triangles that oppose the
 *    motion (`n_B · d < -tau`), and every welded edge of B along `-d` against A's triangles with
 *    `n_A · (-d) < -tau`. This finds first contact that begins edge against edge, which no
 *    vertex or centroid ray can see (crossed bars).
 *
 * Each B with at least one hit gives one Blocking_Edge `(A, B, d)`. For a Stage A edge,
 * `fromTriangles` are A's source triangles of forward hits plus A's triangles hit by backward
 * rays, and `toTriangles` the same for B. For a Stage B edge they are the swept edge's largest
 * incident triangle and the triangle it meets, on the Part each belongs to. Both lists are
 * sorted with no duplicates (Req 12.5). `detections` records which stage found each edge.
 *
 * Ray sources and edges are built on first use and cached per Part in a Map that lives only as
 * long as the returned verifier. Nothing here is random and nothing depends on call order, so
 * the same inputs always give the same edges (Req 14.9).
 *
 * This module is solver code. It does not import the Clash_Checker oracle, and the oracle does
 * not import it.
 *
 * @param parts The normalized Parts of one Stage1Result.
 * @param config Only `microShrink`, `clearanceEpsilon` and `tau` are read.
 */
export function createStepVerifier(
  parts: readonly NormalizedPart[],
  config: Pick<ResolvedSolverConfig, "microShrink" | "clearanceEpsilon" | "tau">,
): StepVerifierHandle {
  const runtimes = new Map<string, PartRuntime>();
  for (const part of parts) {
    if (runtimes.has(part.partId)) {
      throw new RangeError(`Part_ID ${part.partId} appears twice`);
    }
    runtimes.set(part.partId, { part, target: createRayTarget(part), sources: null, edges: null });
  }
  const reach = config.microShrink + SWEEP_MARGIN;
  const sweepBoxes = new Map<string, Aabb>();
  const sweepBoxOf = (runtime: PartRuntime): Aabb => {
    let box = sweepBoxes.get(runtime.part.partId);
    if (box === undefined) {
      box = expandAabb(runtime.part.aabb, reach);
      sweepBoxes.set(runtime.part.partId, box);
    }
    return box;
  };
  const sourcesOf = (runtime: PartRuntime): SourceSet => {
    runtime.sources ??= buildSourceSet(runtime.part, config.microShrink);
    return runtime.sources;
  };
  const edgesOf = (runtime: PartRuntime): EdgeSet => {
    runtime.edges ??= buildEdgeSet(runtime.part, config.microShrink);
    return runtime.edges;
  };
  const runtimeOf = (partId: string): PartRuntime => {
    const runtime = runtimes.get(partId);
    if (runtime === undefined) {
      throw new RangeError(`step verification names Part ${partId}, which is not in the Assembly`);
    }
    return runtime;
  };
  const stats: StepVerifierStats = { verifications: 0, pairsChecked: 0, raysCast: 0, edgesSwept: 0, edgesFound: 0 };
  const detections: StepDetection[] = [];
  const hits = createRayHits();
  const eps = config.clearanceEpsilon;
  const tau = config.tau;

  const verify: StepVerifier = ({ partId, dirIndex, dir, distance, unremovedPartIds }) => {
    if (typeof distance !== "number" || !Number.isFinite(distance) || distance < 0) {
      throw new RangeError(`step verification of ${partId} needs a finite distance >= 0, received ${String(distance)}`);
    }
    stats.verifications++;
    const moving = runtimeOf(partId);
    // `x + 0` turns `-0` into `+0`, and `0 - x` negates exactly, as in Stage 2.
    const forward: Vec3 = [dir[0] + 0, dir[1] + 0, dir[2] + 0];
    const backward: Vec3 = [0 - forward[0], 0 - forward[1], 0 - forward[2]];
    const movingBox = sweepBoxOf(moving);
    const edges: BlockingEdge[] = [];
    for (const otherId of unremovedPartIds) {
      if (otherId === partId) {
        throw new RangeError(`step verification of ${partId} lists the moving Part as unremoved`);
      }
      const other = runtimeOf(otherId);
      const otherBox = sweepBoxOf(other);
      if (!sweptBoxMeets(movingBox, forward, distance, otherBox)) {
        continue;
      }
      stats.pairsChecked++;
      const fromTris: number[] = [];
      const toTris: number[] = [];
      let stage: StepDetectionStage = "ray";
      stats.raysCast += castSources(sourcesOf(moving), other, forward, eps, tau, distance, hits, fromTris, toTris);
      stats.raysCast += castSources(sourcesOf(other), moving, backward, eps, tau, distance, hits, toTris, fromTris);
      if (fromTris.length === 0) {
        const forwardHit = sweepEdges(edgesOf(moving), other.part, otherBox, forward, eps, tau, distance, stats);
        const backwardHit = forwardHit === null ? sweepEdges(edgesOf(other), moving.part, movingBox, backward, eps, tau, distance, stats) : null;
        if (forwardHit !== null) {
          fromTris.push(forwardHit[0]);
          toTris.push(forwardHit[1]);
        } else if (backwardHit !== null) {
          toTris.push(backwardHit[0]);
          fromTris.push(backwardHit[1]);
        } else {
          continue;
        }
        stage = "edge_sweep";
      }
      detections.push({ from: partId, to: otherId, dirIndex, dir: [dir[0], dir[1], dir[2]], distance, stage });
      edges.push({
        from: partId,
        to: otherId,
        dirIndex,
        dir: [dir[0], dir[1], dir[2]],
        fromTriangles: sortedUnique(fromTris),
        toTriangles: sortedUnique(toTris),
      });
    }
    stats.edgesFound += edges.length;
    return edges;
  };
  return { verify, stats, detections };
}
