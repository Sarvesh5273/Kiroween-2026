import { DoubleSide, Ray } from "three";
import type { MeshBVH } from "three-mesh-bvh";
import { expandAabb, rayIntersectsAabb, type Aabb } from "../math/aabb";
import type { NormalizedPart, Vec3 } from "../types";
/** Margin added to the target box before the per-ray slab test, in normalized units. */
export const SLAB_MARGIN = 1e-9;
/** What a ray is cast against: one Part's BVH and its exact AABB grown by {@link SLAB_MARGIN}. */
export interface RayTarget {
  readonly bvh: MeshBVH;
  readonly box: Aabb;
}
export function createRayTarget(part: NormalizedPart): RayTarget {
  return { bvh: part.bvh, box: expandAabb(part.aabb, SLAB_MARGIN) };
}
/**
 * Every intersection of one ray, as parallel arrays. `faceIndex[i]` is the Part-local triangle
 * index and `distance[i]` is measured from the ray origin along the unit direction. Only the
 * first `count` entries are valid. The object is reused between rays.
 */
export interface RayHits {
  count: number;
  faceIndex: number[];
  distance: number[];
}
export function createRayHits(): RayHits {
  return { count: 0, faceIndex: [], distance: [] };
}
const ray = new Ray();
const originScratch: Vec3 = [0, 0, 0];
/**
 * Collects every hit along the full ray `origin + t·dir`, `t >= 0`, against `target` into `out`
 * and returns the number of hits (Req 13.5). `dir` must be a unit vector.
 *
 * The call is `bvh.raycast(ray, DoubleSide, 0, Infinity)` of `three-mesh-bvh` 0.8.3, whose
 * signature is `raycast(ray, materialOrSide, near, far)`. It returns all intersections, so back
 * faces are visible and can be classified and discarded by the hit filter. This module never
 * uses a nearest-hit-only query of the library, because it would let a coincident or grazing
 * hit mask a farther opposing one (Req 13.6).
 *
 * The BVH is built with `indirect: true`, so the library reports `faceIndex = _indirectBuffer[i]`,
 * which is the index of the triangle in the unmodified index buffer, that is the Part-local
 * triangle index (Req 9.10).
 *
 * Before the BVH is queried, an exact slab test against the target's box skips rays that cannot
 * touch it. Every hit lies on a triangle inside that box, so the skip never changes a result.
 */
export function castAllHits(
  target: RayTarget,
  originX: number,
  originY: number,
  originZ: number,
  dir: Vec3,
  out: RayHits,
): number {
  out.count = 0;
  originScratch[0] = originX;
  originScratch[1] = originY;
  originScratch[2] = originZ;
  if (!rayIntersectsAabb(originScratch, dir, target.box, Number.POSITIVE_INFINITY)) {
    return 0;
  }
  ray.origin.set(originX, originY, originZ);
  ray.direction.set(dir[0], dir[1], dir[2]);
  const hits = target.bvh.raycast(ray, DoubleSide, 0, Number.POSITIVE_INFINITY);
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    if (hit === undefined || hit.faceIndex === undefined || hit.faceIndex === null) {
      throw new TypeError("three-mesh-bvh returned an intersection without a faceIndex");
    }
    out.faceIndex[i] = hit.faceIndex;
    out.distance[i] = hit.distance;
  }
  out.count = hits.length;
  return hits.length;
}
