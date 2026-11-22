import { DoubleSide, Ray } from "three";
import type { SolverConfig, ResolvedSolverConfig } from "../config";
import { validateConfig } from "../config";
import { InvalidDirectionError, InvalidSolverConfigError, MovingPartInStaticSetError } from "../errors";
import { expandAabb, rayIntersectsAabb, sweptAabbOverlaps } from "../math/aabb";
import type { Aabb } from "../math/aabb";
import type { ClashPart, ClashResult, Vec3 } from "../types";

/**
 * Clash_Checker oracle (Req 20).
 *
 * This module is deliberately independent of the DBG_Builder. It has its own face-normal
 * recomputation, its own ray sources, its own all-hit loop and its own hit filter. It must not
 * import (directly or through another module) the stratified sampler, the Seeded_PRNG, the DBG
 * hit filter or the DBG ray caster. `test/static/clash-independence.test.ts` walks the import
 * graph and enforces that (Req 20.11). The only project modules it reads are the type
 * definitions, the configuration validator, the error classes and the vector and box helpers.
 */

/** Tolerance of the direction length check (Req 20.12). */
const DIRECTION_TOLERANCE = 1e-6;
/** A vertex whose area-weighted normal sum is not longer than this uses the largest incident face (Req 20.4). */
const KNIFE_EDGE_LENGTH = 1e-12;
/**
 * Extra margin on every box used for culling, in normalized units. A hit lies on a triangle
 * inside the target's box, so a margin of rounding size keeps each cull from ever removing a
 * ray that the BVH would have reported. It cannot add a hit, because culled rays are only
 * skipped, never counted.
 */
const CULL_MARGIN = 1e-9;

/** The rays one Part casts: vertex sources first, then centroid sources. Origins are not stored, because Micro_Shrink comes from the call. */
interface PartData {
  /** Unit outward face normal per triangle, 3 numbers each. `[0, 0, 0]` for a zero-area triangle. */
  readonly faceNormals: Float64Array;
  readonly sourceCount: number;
  /** 0 for a welded vertex, 1 for a centroid. */
  readonly kinds: Uint8Array;
  readonly originIndices: Uint32Array;
  readonly originTriangles: Uint32Array;
  /** Surface point of each source, 3 numbers each. */
  readonly points: Float64Array;
  /** Unit normal that moves the origin inward, 3 numbers each. */
  readonly normals: Float64Array;
}

const VERTEX_KIND = 0;
const CENTROID_KIND = 1;

/** Per-Part source cache (Req 20, design "cached in a WeakMap keyed by the Part object"). */
const partDataCache = new WeakMap<ClashPart, PartData>();

function at(values: ArrayLike<number>, index: number): number {
  const value = values[index];
  if (value === undefined) {
    throw new RangeError(`index ${index} is outside a list of ${values.length} numbers`);
  }
  return value;
}

/** Recomputes the unit outward normal and area of every triangle from its winding. */
function computeFaces(part: ClashPart): { faceNormals: Float64Array; areas: Float64Array } {
  const { positions, triangles } = part;
  const triangleCount = triangles.length / 3;
  const faceNormals = new Float64Array(3 * triangleCount);
  const areas = new Float64Array(triangleCount);
  for (let t = 0; t < triangleCount; t++) {
    const a = at(triangles, 3 * t);
    const b = at(triangles, 3 * t + 1);
    const c = at(triangles, 3 * t + 2);
    const e1x = at(positions, 3 * b) - at(positions, 3 * a);
    const e1y = at(positions, 3 * b + 1) - at(positions, 3 * a + 1);
    const e1z = at(positions, 3 * b + 2) - at(positions, 3 * a + 2);
    const e2x = at(positions, 3 * c) - at(positions, 3 * a);
    const e2y = at(positions, 3 * c + 1) - at(positions, 3 * a + 1);
    const e2z = at(positions, 3 * c + 2) - at(positions, 3 * a + 2);
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    const doubled = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (doubled > 0) {
      faceNormals[3 * t] = cx / doubled;
      faceNormals[3 * t + 1] = cy / doubled;
      faceNormals[3 * t + 2] = cz / doubled;
      areas[t] = 0.5 * doubled;
    }
  }
  return { faceNormals, areas };
}

/**
 * Builds the ray sources of a Part (Req 20.2 to 20.6).
 *
 * Welded vertex `v`: `n_v = normalize(Σ area_t · n_t)` over the distinct triangles that have a
 * corner in the same weld cluster. When `|Σ| <= 1e-12` and some incident triangle has area > 0,
 * `n_v` is the unit normal of the largest incident triangle (lowest index on ties). When no
 * incident triangle has area > 0, including a vertex with no incident triangle, the vertex
 * casts no ray. The reported source triangle of a vertex is that largest incident triangle.
 *
 * Centroid of a triangle with area > 0: the mean of its corners, with the face normal.
 */
function buildPartData(part: ClashPart): PartData {
  const { positions, triangles, weldIds, weldRepresentatives } = part;
  const triangleCount = triangles.length / 3;
  const clusterCount = weldRepresentatives.length;
  const { faceNormals, areas } = computeFaces(part);

  const sumX = new Float64Array(clusterCount);
  const sumY = new Float64Array(clusterCount);
  const sumZ = new Float64Array(clusterCount);
  const largestArea = new Float64Array(clusterCount);
  const largestTriangle = new Int32Array(clusterCount).fill(-1);

  const accumulate = (cluster: number, t: number, area: number): void => {
    sumX[cluster] = at(sumX, cluster) + area * at(faceNormals, 3 * t);
    sumY[cluster] = at(sumY, cluster) + area * at(faceNormals, 3 * t + 1);
    sumZ[cluster] = at(sumZ, cluster) + area * at(faceNormals, 3 * t + 2);
    // Triangles are visited in ascending index, so a strict comparison keeps the lowest index on ties.
    if (area > at(largestArea, cluster)) {
      largestArea[cluster] = area;
      largestTriangle[cluster] = t;
    }
  };

  for (let t = 0; t < triangleCount; t++) {
    const area = at(areas, t);
    if (!(area > 0)) {
      continue;
    }
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

  let positiveAreaTriangles = 0;
  for (let t = 0; t < triangleCount; t++) {
    if (at(areas, t) > 0) {
      positiveAreaTriangles++;
    }
  }
  let vertexSources = 0;
  for (let c = 0; c < clusterCount; c++) {
    if (largestTriangle[c] !== -1) {
      vertexSources++;
    }
  }

  const sourceCount = vertexSources + positiveAreaTriangles;
  const kinds = new Uint8Array(sourceCount);
  const originIndices = new Uint32Array(sourceCount);
  const originTriangles = new Uint32Array(sourceCount);
  const points = new Float64Array(3 * sourceCount);
  const normals = new Float64Array(3 * sourceCount);

  let next = 0;
  for (let c = 0; c < clusterCount; c++) {
    const largest = largestTriangle[c];
    if (largest === undefined || largest === -1) {
      continue;
    }
    const representative = at(weldRepresentatives, c);
    const sx = at(sumX, c);
    const sy = at(sumY, c);
    const sz = at(sumZ, c);
    const sumLength = Math.sqrt(sx * sx + sy * sy + sz * sz);
    let nx: number;
    let ny: number;
    let nz: number;
    if (sumLength <= KNIFE_EDGE_LENGTH) {
      nx = at(faceNormals, 3 * largest);
      ny = at(faceNormals, 3 * largest + 1);
      nz = at(faceNormals, 3 * largest + 2);
    } else {
      nx = sx / sumLength;
      ny = sy / sumLength;
      nz = sz / sumLength;
    }
    kinds[next] = VERTEX_KIND;
    originIndices[next] = representative;
    originTriangles[next] = largest;
    points[3 * next] = at(positions, 3 * representative);
    points[3 * next + 1] = at(positions, 3 * representative + 1);
    points[3 * next + 2] = at(positions, 3 * representative + 2);
    normals[3 * next] = nx;
    normals[3 * next + 1] = ny;
    normals[3 * next + 2] = nz;
    next++;
  }
  for (let t = 0; t < triangleCount; t++) {
    if (!(at(areas, t) > 0)) {
      continue;
    }
    const a = at(triangles, 3 * t);
    const b = at(triangles, 3 * t + 1);
    const c = at(triangles, 3 * t + 2);
    kinds[next] = CENTROID_KIND;
    originIndices[next] = t;
    originTriangles[next] = t;
    for (let k = 0; k < 3; k++) {
      points[3 * next + k] = (at(positions, 3 * a + k) + at(positions, 3 * b + k) + at(positions, 3 * c + k)) / 3;
      normals[3 * next + k] = at(faceNormals, 3 * t + k);
    }
    next++;
  }
  return { faceNormals, sourceCount, kinds, originIndices, originTriangles, points, normals };
}

function dataOf(part: ClashPart): PartData {
  let data = partDataCache.get(part);
  if (data === undefined) {
    data = buildPartData(part);
    partDataCache.set(part, data);
  }
  return data;
}

function validateDirection(dir: readonly number[]): void {
  if (!Array.isArray(dir) || dir.length !== 3 || !dir.every((component) => typeof component === "number" && Number.isFinite(component))) {
    throw new InvalidDirectionError(dir);
  }
  const length = Math.sqrt(dir.reduce((sum, component) => sum + component * component, 0));
  if (!(Math.abs(length - 1) <= DIRECTION_TOLERANCE)) {
    throw new InvalidDirectionError(dir);
  }
}

/** The nearest surviving hit of one ray against one target Part. */
interface Survivor {
  triangle: number;
  distance: number;
}

/**
 * The oracle's own hit filter (Req 20.8). Over every intersection of the ray, drop hits with
 * `distance < eps` and hits whose outward face normal `n` has `dot(n, rayDir) >= -tau`, then
 * return the nearest remaining one (lowest triangle index on equal distance). The face normal
 * is the one recomputed from winding, not the interpolated normal of the BVH library.
 */
function nearestSurvivor(
  target: ClashPart,
  data: PartData,
  ray: Ray,
  rayDir: Vec3,
  eps: number,
  tau: number,
): Survivor | null {
  const hits = target.bvh.raycast(ray, DoubleSide, 0, Number.POSITIVE_INFINITY);
  let best: Survivor | null = null;
  for (const hit of hits) {
    const triangle = hit.faceIndex;
    if (triangle === undefined || triangle === null) {
      throw new TypeError("three-mesh-bvh returned an intersection without a faceIndex");
    }
    if (hit.distance < eps) {
      continue;
    }
    const dot =
      at(data.faceNormals, 3 * triangle) * rayDir[0] +
      at(data.faceNormals, 3 * triangle + 1) * rayDir[1] +
      at(data.faceNormals, 3 * triangle + 2) * rayDir[2];
    if (dot >= -tau) {
      continue;
    }
    if (best === null || hit.distance < best.distance || (hit.distance === best.distance && triangle < best.triangle)) {
      best = { triangle, distance: hit.distance };
    }
  }
  return best;
}

type Collision = ClashResult["collisions"][number];

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareCollisions(a: Collision, b: Collision): number {
  if (a.originSide !== b.originSide) {
    return a.originSide === "moving" ? -1 : 1;
  }
  const byPart = compareText(a.originPartId, b.originPartId);
  if (byPart !== 0) {
    return byPart;
  }
  if (a.originKind !== b.originKind) {
    return a.originKind === "vertex" ? -1 : 1;
  }
  return a.originIndex - b.originIndex;
}

function sortedUnique(values: Iterable<number>): number[] {
  return Array.from(new Set(values)).sort((x, y) => x - y);
}

/**
 * Counts Opposing_Normal_Collisions of `moving` swept along `dir` against `statics` (Req 20).
 *
 * Every vertex and every triangle centroid of the moving Part casts one ray along `dir`, tested
 * against all static Parts. Every vertex and centroid of each static Part casts one ray along
 * `-dir`, tested only against the moving Part. Each origin sits `microShrink` inside its
 * surface. A ray collects every intersection along its full length, and the hit filter then
 * drops hits closer than `clearanceEpsilon` and hits with `dot(n, rayDir) >= -tau`. The nearest
 * survivor is the ray's single collision, so a discarded hit never masks a farther opposing one
 * (Req 20.9). For a moving-Part ray the nearest survivor is taken over all static Parts, with
 * ties broken by Part_ID and then triangle index.
 *
 * `microShrink`, `clearanceEpsilon` and `tau` are read from `config`; missing fields take the
 * documented defaults, and no value is adjusted (Req 20.10). The result is plain data and is a
 * pure function of the inputs (Req 20.14).
 *
 * Whole static Parts are skipped when the moving Part's box, grown by `microShrink` and swept
 * along the ray direction, misses the static Part's box (and the mirror test for static rays),
 * and each remaining ray is slab-tested against its target's box. Both culls only skip rays
 * that cannot hit, so they do not change the result.
 *
 * @throws InvalidSolverConfigError when `config` fails validation.
 * @throws InvalidDirectionError when `dir` has a non-finite component or its length differs from 1 by more than `1e-6`.
 * @throws MovingPartInStaticSetError when a static Part has the moving Part's `partId`.
 * All three are thrown before any ray is cast.
 */
export function checkClashes(
  moving: ClashPart,
  dir: Vec3,
  statics: readonly ClashPart[],
  config: ResolvedSolverConfig | SolverConfig,
): ClashResult {
  const validation = validateConfig(config);
  if (!validation.ok) {
    throw new InvalidSolverConfigError(validation.error);
  }
  const { microShrink, clearanceEpsilon, tau } = validation.config;
  validateDirection(dir);
  for (const part of statics) {
    if (part.partId === moving.partId) {
      throw new MovingPartInStaticSetError(moving.partId);
    }
  }

  // `x + 0` turns `-0` into `+0`, and `0 - x` negates exactly.
  const forward: Vec3 = [dir[0] + 0, dir[1] + 0, dir[2] + 0];
  const backward: Vec3 = [0 - forward[0], 0 - forward[1], 0 - forward[2]];

  const ray = new Ray();
  const origin: Vec3 = [0, 0, 0];
  const collisions: Collision[] = [];
  const movingTriangles = new Set<number>();
  const staticTriangles = new Map<string, Set<number>>();

  const movingData = dataOf(moving);
  const movingBox: Aabb = expandAabb(moving.aabb, CULL_MARGIN);
  const movingReach: Aabb = expandAabb(moving.aabb, microShrink + CULL_MARGIN);

  // Moving-Part rays: only static Parts the swept box can reach take part.
  const reachable: { part: ClashPart; data: PartData; box: Aabb }[] = [];
  for (const part of statics) {
    const box = expandAabb(part.aabb, CULL_MARGIN);
    if (sweptAabbOverlaps(movingReach, forward, box)) {
      reachable.push({ part, data: dataOf(part), box });
    }
  }
  if (reachable.length > 0) {
    for (let i = 0; i < movingData.sourceCount; i++) {
      for (let k = 0; k < 3; k++) {
        origin[k] = at(movingData.points, 3 * i + k) - microShrink * at(movingData.normals, 3 * i + k);
      }
      ray.origin.set(origin[0], origin[1], origin[2]);
      ray.direction.set(forward[0], forward[1], forward[2]);
      let bestPart: ClashPart | null = null;
      let best: Survivor | null = null;
      for (const target of reachable) {
        if (!rayIntersectsAabb(origin, forward, target.box, Number.POSITIVE_INFINITY)) {
          continue;
        }
        const survivor = nearestSurvivor(target.part, target.data, ray, forward, clearanceEpsilon, tau);
        if (survivor === null) {
          continue;
        }
        if (
          best === null ||
          bestPart === null ||
          survivor.distance < best.distance ||
          (survivor.distance === best.distance &&
            (target.part.partId < bestPart.partId ||
              (target.part.partId === bestPart.partId && survivor.triangle < best.triangle)))
        ) {
          best = survivor;
          bestPart = target.part;
        }
      }
      if (best === null || bestPart === null) {
        continue;
      }
      const originTriangle = at(movingData.originTriangles, i);
      collisions.push({
        originSide: "moving",
        originPartId: moving.partId,
        originKind: at(movingData.kinds, i) === VERTEX_KIND ? "vertex" : "centroid",
        originIndex: at(movingData.originIndices, i),
        originTriangle,
        hitPartId: bestPart.partId,
        hitTriangle: best.triangle,
        distance: best.distance,
      });
      movingTriangles.add(originTriangle);
      let hitSet = staticTriangles.get(bestPart.partId);
      if (hitSet === undefined) {
        hitSet = new Set<number>();
        staticTriangles.set(bestPart.partId, hitSet);
      }
      hitSet.add(best.triangle);
    }
  }

  // Static-Part rays travel along the negated direction and see only the moving Part.
  for (const part of statics) {
    const reach = expandAabb(part.aabb, microShrink + CULL_MARGIN);
    if (!sweptAabbOverlaps(reach, backward, movingBox)) {
      continue;
    }
    const data = dataOf(part);
    for (let i = 0; i < data.sourceCount; i++) {
      for (let k = 0; k < 3; k++) {
        origin[k] = at(data.points, 3 * i + k) - microShrink * at(data.normals, 3 * i + k);
      }
      if (!rayIntersectsAabb(origin, backward, movingBox, Number.POSITIVE_INFINITY)) {
        continue;
      }
      ray.origin.set(origin[0], origin[1], origin[2]);
      ray.direction.set(backward[0], backward[1], backward[2]);
      const survivor = nearestSurvivor(moving, movingData, ray, backward, clearanceEpsilon, tau);
      if (survivor === null) {
        continue;
      }
      const originTriangle = at(data.originTriangles, i);
      collisions.push({
        originSide: "static",
        originPartId: part.partId,
        originKind: at(data.kinds, i) === VERTEX_KIND ? "vertex" : "centroid",
        originIndex: at(data.originIndices, i),
        originTriangle,
        hitPartId: moving.partId,
        hitTriangle: survivor.triangle,
        distance: survivor.distance,
      });
      movingTriangles.add(survivor.triangle);
      let ownSet = staticTriangles.get(part.partId);
      if (ownSet === undefined) {
        ownSet = new Set<number>();
        staticTriangles.set(part.partId, ownSet);
      }
      ownSet.add(originTriangle);
    }
  }

  collisions.sort(compareCollisions);
  return {
    count: collisions.length,
    movingTriangles: sortedUnique(movingTriangles),
    staticTriangles: Array.from(staticTriangles.keys())
      .sort(compareText)
      .map((partId) => ({ partId, triangles: sortedUnique(staticTriangles.get(partId) ?? []) })),
    collisions,
  };
}
