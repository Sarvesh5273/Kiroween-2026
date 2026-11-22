import { convexHull2D, convexPolygonDistance, type Vec2 } from "../math/hull2d";
import { orthonormalBasis } from "../math/onb";
import { CANONICAL_DIRECTION_COUNT } from "../stage1/candidateAxes";
import type { NormalizedPart, Vec3 } from "../types";
/**
 * Margin of Req 11.2 and 11.3, in normalized units. A gap must be strictly greater than this
 * to prune. Touching boxes and gaps up to this size count as overlapping.
 */
export const PRUNE_MARGIN = 1e-9;
/**
 * OBB pair pruning (Req 11). For the ordered pair `(A, B)` and a direction `d` from A's
 * Candidate_Axes, the pair is pruned (no rays are cast) when
 *
 * 1. along `d`: `maxB < minA - 1e-9`, where each interval is `center·d ± Σ h_i |a_i·d|`; or
 * 2. in the plane perpendicular to `d`: the exact Euclidean distance between the convex hulls of
 *    the two projected 8-corner OBBs is strictly greater than `1e-9`.
 *
 * The distance is exact. A separating-axis gap over edge normals alone would underestimate the
 * gap between two corners that face each other and so miss prunes that Req 11.2 requires.
 *
 * Projected hulls of canonical directions are cached per `(Part, canonical direction index)`,
 * because every Part shares the same 26 canonical vectors. Hulls of A along its own PCA
 * directions are cached too. B's hull along a PCA direction of A depends on the pair, so it is
 * computed on demand.
 *
 * Soundness (Req 11.4) holds only for Assemblies whose Parts are all Watertight_Solid_Parts:
 * every ray origin is then inside the solid, hence inside the OBB. The test is deterministic,
 * so a given `(A, B, d)` always gets the same classification (Req 11.8).
 */
export class ObbPruner {
  private readonly slots = new Map<NormalizedPart, number>();
  private readonly hulls = new Map<number, Vec2[]>();
  private readonly cornerBuffer: Vec3[] = [];
  constructor(parts: readonly NormalizedPart[]) {
    for (const [index, part] of parts.entries()) {
      this.slots.set(part, index);
    }
  }
  /** True when the pair `(a, b)` along `a.candidateAxes[dirIndex]` can be skipped. */
  isPruned(a: NormalizedPart, b: NormalizedPart, dirIndex: number): boolean {
    const d = a.candidateAxes[dirIndex];
    if (d === undefined) {
      throw new RangeError(`dirIndex ${dirIndex} is outside the 32 Candidate_Axes of Part ${a.partId}`);
    }
    // 1. Along d. B lies entirely behind A.
    const minA = projectionInterval(a, d)[0];
    const maxB = projectionInterval(b, d)[1];
    if (maxB < minA - PRUNE_MARGIN) {
      return true;
    }
    // 2. Perpendicular plane.
    const [u, v] = orthonormalBasis(d);
    const hullA = this.hullOf(a, u, v, dirIndex, true);
    const hullB = this.hullOf(b, u, v, dirIndex, dirIndex < CANONICAL_DIRECTION_COUNT);
    return convexPolygonDistance(hullA, hullB) > PRUNE_MARGIN;
  }
  private hullOf(part: NormalizedPart, u: Vec3, v: Vec3, dirIndex: number, cacheable: boolean): Vec2[] {
    const slot = this.slots.get(part);
    if (!cacheable || slot === undefined) {
      return this.projectHull(part, u, v);
    }
    // Every Part has 32 axes, so `slot * 32 + dirIndex` is a unique key per (Part, direction).
    const key = slot * 32 + dirIndex;
    let hull = this.hulls.get(key);
    if (hull === undefined) {
      hull = this.projectHull(part, u, v);
      this.hulls.set(key, hull);
    }
    return hull;
  }
  private projectHull(part: NormalizedPart, u: Vec3, v: Vec3): Vec2[] {
    const corners = obbCorners(part, this.cornerBuffer);
    const points: Vec2[] = corners.map((p): Vec2 => [
      p[0] * u[0] + p[1] * u[1] + p[2] * u[2],
      p[0] * v[0] + p[1] * v[1] + p[2] * v[2],
    ]);
    return convexHull2D(points);
  }
}
/** `[min, max]` of the OBB projected on the unit direction `d`: `center·d ± Σ h_i |a_i·d|`. */
export function projectionInterval(part: NormalizedPart, d: Vec3): [number, number] {
  const { center, halfExtents } = part.frame.obb;
  const c = center[0] * d[0] + center[1] * d[1] + center[2] * d[2];
  let radius = 0;
  for (let i = 0; i < 3; i++) {
    const axis = part.frame.axes[i];
    const h = halfExtents[i];
    if (axis === undefined || h === undefined) {
      throw new RangeError(`Part ${part.partId} has no frame axis ${i}`);
    }
    radius += h * Math.abs(axis[0] * d[0] + axis[1] * d[1] + axis[2] * d[2]);
  }
  return [c - radius, c + radius];
}
/** The 8 corners of the Part's OBB, `center ± h0·a0 ± h1·a1 ± h2·a2`. Reuses `buffer`. */
function obbCorners(part: NormalizedPart, buffer: Vec3[]): Vec3[] {
  const { center, halfExtents } = part.frame.obb;
  const [a0, a1, a2] = part.frame.axes;
  buffer.length = 0;
  for (const s0 of [-1, 1]) {
    for (const s1 of [-1, 1]) {
      for (const s2 of [-1, 1]) {
        const e0 = s0 * halfExtents[0];
        const e1 = s1 * halfExtents[1];
        const e2 = s2 * halfExtents[2];
        buffer.push([
          center[0] + e0 * a0[0] + e1 * a1[0] + e2 * a2[0],
          center[1] + e0 * a0[1] + e1 * a1[1] + e2 * a2[1],
          center[2] + e0 * a0[2] + e1 * a1[2] + e2 * a2[2],
        ]);
      }
    }
  }
  return buffer;
}
