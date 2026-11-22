import type { ResolvedSolverConfig } from "../config";
import { expandAabb, sweptAabbOverlaps, type Aabb } from "../math/aabb";
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

/** The request that the Peel_Solver hands to a step verifier before it commits a Plan_Step. */
export interface StepVerificationRequest {
  /** The Part that the cascade selected. */
  readonly partId: string;
  /** Index of the chosen Candidate_Axis. */
  readonly dirIndex: number;
  /** The chosen Candidate_Axis itself. */
  readonly dir: Vec3;
  /** Every unremoved Part other than `partId`, ascending by Part_ID. */
  readonly unremovedPartIds: readonly string[];
}

/**
 * Checks one selected move before the Peel_Solver commits it (Req 14.11). Returns one
 * Blocking_Edge `(partId, B, dirIndex)` for every unremoved Part B that the move collides with,
 * or an empty list when the move is clash-free.
 */
export type StepVerifier = (request: StepVerificationRequest) => BlockingEdge[];

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

interface PartRuntime {
  readonly part: NormalizedPart;
  readonly target: RayTarget;
  /** Built on first use, so Parts that never take part in a verification cost nothing. */
  sources: SourceSet | null;
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
 * Casts every source of `source` along `dir` into `target` with Stage 2's all-hit caster and
 * hit filter, and appends the source triangle and the hit triangle of each colliding ray.
 * Returns the number of rays cast.
 */
function castSources(
  source: SourceSet,
  target: PartRuntime,
  dir: Vec3,
  eps: number,
  tau: number,
  hits: RayHits,
  sourceTris: number[],
  hitTris: number[],
): number {
  for (let i = 0; i < source.count; i++) {
    const hitCount = castAllHits(target.target, at(source.originX, i), at(source.originY, i), at(source.originZ, i), dir, hits);
    if (hitCount === 0) {
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
  /** Blocking_Edges the verifier reported. */
  edgesFound: number;
}

export interface StepVerifierHandle {
  readonly verify: StepVerifier;
  readonly stats: StepVerifierStats;
}

/**
 * Coarse-to-fine lazy exact step verification (Req 14.11), for one `stage3Peel` call.
 *
 * For a selected move of Part A along its Candidate_Axis `d`:
 *
 * 1. **Coarse.** Every unremoved Part B is skipped when A's AABB swept along `+d` misses B's
 *    AABB. Both boxes are grown by `microShrink + 1e-9`, so no ray origin can lie outside them.
 * 2. **Fine.** For each remaining B, every source of A (all welded vertices and all
 *    positive-area triangle centroids, micro-shrunk) casts a ray along `+d` into B's BVH, and
 *    every source of B casts a ray along `-d` into A's BVH. Hits are collected with Stage 2's
 *    `castAllHits` and classified with Stage 2's `filterNearest`, so the hit rules are exactly
 *    those of the Blocking_Graph (Req 13.2 to 13.6). Only the ray sources differ: deterministic
 *    vertices and centroids instead of N stratified samples.
 *
 * Each B with at least one colliding ray gives one Blocking_Edge `(A, B, d)`. Its
 * `fromTriangles` are A's source triangles of forward hits plus A's triangles hit by backward
 * rays, and its `toTriangles` the same for B, both sorted with no duplicates (Req 12.5).
 *
 * Ray sources are built on first use and cached per Part in a Map that lives only as long as
 * the returned verifier. Nothing here is random and nothing depends on call order, so the same
 * inputs always give the same edges (Req 14.9).
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
    runtimes.set(part.partId, { part, target: createRayTarget(part), sources: null });
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
  const runtimeOf = (partId: string): PartRuntime => {
    const runtime = runtimes.get(partId);
    if (runtime === undefined) {
      throw new RangeError(`step verification names Part ${partId}, which is not in the Assembly`);
    }
    return runtime;
  };
  const stats: StepVerifierStats = { verifications: 0, pairsChecked: 0, raysCast: 0, edgesFound: 0 };
  const hits = createRayHits();

  const verify: StepVerifier = ({ partId, dirIndex, dir, unremovedPartIds }) => {
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
      if (!sweptAabbOverlaps(movingBox, forward, sweepBoxOf(other))) {
        continue;
      }
      stats.pairsChecked++;
      const fromTris: number[] = [];
      const toTris: number[] = [];
      stats.raysCast += castSources(sourcesOf(moving), other, forward, config.clearanceEpsilon, config.tau, hits, fromTris, toTris);
      stats.raysCast += castSources(sourcesOf(other), moving, backward, config.clearanceEpsilon, config.tau, hits, toTris, fromTris);
      if (fromTris.length === 0) {
        continue;
      }
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
  return { verify, stats };
}
