import type { Vec3 } from "../types";
import type { RayHits } from "./rayCast";
/**
 * DBG filter-then-nearest (Req 13.2 to 13.6).
 *
 * Over all `hits.count` hits of one ray, in this order:
 * 1. drop hits with `distance < eps` (coincident, Req 13.2);
 * 2. drop hits whose outward face normal `n` has `dot(n, dir) >= -tau` (grazing or back-facing,
 *    Req 13.3). `n` is the engine's own face normal looked up by `faceIndex` in
 *    `targetFaceNormals`, never the interpolated normal of the BVH library;
 * 3. return the nearest survivor, breaking equal distances by the lower triangle index.
 *
 * Returns that survivor's Part-local triangle index, or `-1` when none survives. Because
 * discarded hits are removed before the nearest is chosen, a coincident or grazing hit in front
 * of a farther opposing hit never masks it (Req 13.6). A zero-area triangle has a zero normal,
 * so `dot = 0 >= -tau` and it is always dropped.
 *
 * @param targetFaceNormals 3 numbers per triangle of the target Part.
 */
export function filterNearest(
  hits: RayHits,
  dir: Vec3,
  targetFaceNormals: ArrayLike<number>,
  eps: number,
  tau: number,
): number {
  let bestTriangle = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < hits.count; i++) {
    const distance = hits.distance[i];
    const triangle = hits.faceIndex[i];
    if (distance === undefined || triangle === undefined) {
      throw new RangeError(`hit ${i} is missing from a buffer of ${hits.count} hits`);
    }
    if (distance < eps) {
      continue;
    }
    const nx = targetFaceNormals[3 * triangle];
    const ny = targetFaceNormals[3 * triangle + 1];
    const nz = targetFaceNormals[3 * triangle + 2];
    if (nx === undefined || ny === undefined || nz === undefined) {
      throw new RangeError(`triangle ${triangle} has no face normal`);
    }
    if (nx * dir[0] + ny * dir[1] + nz * dir[2] >= -tau) {
      continue;
    }
    if (distance < bestDistance || (distance === bestDistance && triangle < bestTriangle)) {
      bestDistance = distance;
      bestTriangle = triangle;
    }
  }
  return bestTriangle;
}
