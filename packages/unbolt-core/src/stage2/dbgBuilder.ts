import type { ResolvedSolverConfig } from "../config";
import { InvalidSampleCountError, formatRejected } from "../errors";
import { CANDIDATE_AXIS_COUNT } from "../stage1/candidateAxes";
import type { BlockingEdge, BlockingGraph, ErrorResult, NormalizedPart, Stage1Result, Vec3 } from "../types";
import { filterNearest } from "./hitFilter";
import { ObbPruner } from "./obbPruning";
import { castAllHits, createRayHits, createRayTarget, type RayHits, type RayTarget } from "./rayCast";
import { buildSampleSet, type SampleSet } from "./sampler";
export interface DbgOptions {
  /** Default `true`. `false` is for tests (Req 11.4, 11.6). */
  obbPruning?: boolean | undefined;
  /** Default `false`. `true` adds `diagnostics` to the result (Req 22.17, 22.18). */
  collectRayCounts?: boolean | undefined;
}
/** The rays of one source Part cast along one direction into one target Part. */
interface RaySet {
  /** Source triangle of every ray that produced an Opposing_Normal_Collision. May repeat. */
  readonly sourceTris: readonly number[];
  /** Target triangle hit by each of those rays, in the same order. */
  readonly hitTris: readonly number[];
  /** Number of rays that produced an Opposing_Normal_Collision. */
  readonly collidingRays: number;
}
const EMPTY_RAY_SET: RaySet = Object.freeze({
  sourceTris: Object.freeze([] as number[]),
  hitTris: Object.freeze([] as number[]),
  collidingRays: 0,
});
interface PartRuntime {
  readonly part: NormalizedPart;
  readonly samples: SampleSet;
  readonly target: RayTarget;
}
const directionBits = new Float64Array(3);
const directionWords = new Uint32Array(directionBits.buffer);
/** Exact float64 bit pattern of a direction, as a string key. */
function directionKey(dir: Vec3): string {
  directionBits[0] = dir[0];
  directionBits[1] = dir[1];
  directionBits[2] = dir[2];
  return directionWords.join(",");
}
/** `x + 0` turns `-0` into `+0`, so equal directions always have equal bits. */
function cleanDirection(dir: Vec3): Vec3 {
  return [dir[0] + 0, dir[1] + 0, dir[2] + 0];
}
/** `0 - x` is the exact negation of `x`, with `+0` for either zero. */
function negateDirection(dir: Vec3): Vec3 {
  return [0 - dir[0], 0 - dir[1], 0 - dir[2]];
}
function comparePartIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function sortedUnique(first: readonly number[], second: readonly number[]): number[] {
  const merged = first.concat(second).sort((a, b) => a - b);
  const result: number[] = [];
  for (const value of merged) {
    if (result[result.length - 1] !== value) {
      result.push(value);
    }
  }
  return result;
}
/**
 * Stage 2: builds the Directional Blocking Graph (Req 11, 12, 13).
 *
 * For every ordered pair of distinct Parts `(A, B)` and every one of A's 32 Candidate_Axes `d`,
 * the pair is optionally pruned by OBB tests. Otherwise N rays from A's stratified samples
 * travel along `+d` into B's BVH, and N rays from B's samples travel along `-d` into A's BVH.
 * Every intersection of a ray is collected. A ray only sees the other Part's BVH, so own-Part
 * hits cannot occur (Req 13.8). Hits closer than Clearance_Epsilon and grazing or back-facing
 * hits are discarded, and the nearest remaining hit is that ray's Opposing_Normal_Collision.
 * One Blocking_Edge `(A, B, d)` is recorded when either side has at least one collision.
 *
 * `edges` are sorted by `(from, dirIndex, to)`. `fromTriangles` is A's Part-local triangles:
 * the sources of A-origin colliding rays plus the A triangles hit by B-origin colliding rays.
 * `toTriangles` is the same for B. Both lists are sorted with no duplicates (Req 12.5).
 *
 * **Memoization (design D6, Req 12.5).** `raySet(X -> Y, dir)` is cached under the Part_IDs and
 * the exact float64 bits of `dir`. The B-origin set of `(A, B, d)` is `raySet(B -> A, -d)`, which
 * is the A-origin set of `(B, A, -d)` whenever `-d` is also one of B's axes, as for every
 * canonical direction. Cached sets are identical to fresh ones, so memoization changes neither
 * edges nor triangle lists, only `stats.raysCast`, which counts the rays actually cast.
 *
 * **Pruning soundness.** With `obbPruning` on, a pruned triple casts no rays. The result equals
 * the unpruned one only for Assemblies whose Parts are all Watertight_Solid_Parts (closed,
 * outward-wound, and thicker than Micro_Shrink everywhere), because only then does every ray
 * origin lie inside its Part's OBB. For open, inward-wound or very thin meshes pruning still
 * runs with the same margins, but equality is not guaranteed.
 *
 * Sampling depends only on `(seed, Part_ID)` and the stride, so it does not depend on the
 * pruning option or on other Parts. With `collectRayCounts`, `diagnostics` lists the
 * per-triple counts of colliding rays and the pruned triples. It reads values the loop already
 * computes, so `edges` and `stats` are identical with or without it.
 *
 * @param config Only `samplesPerPartPerDirection`, `microShrink`, `clearanceEpsilon`, `tau` and
 *   `seed` are read. The caller is responsible for the other fields.
 * @throws InvalidSampleCountError when `samplesPerPartPerDirection` is not an integer `>= 1`.
 *   This happens before any sampling or ray casting (Req 12.8). The pipeline rejects such a
 *   value earlier, through configuration validation, and returns a `ConfigurationError`.
 * @returns An incoming `ErrorResult` unchanged.
 */
export function stage2BuildDbg(input: Stage1Result, config: ResolvedSolverConfig, options?: DbgOptions): BlockingGraph;
export function stage2BuildDbg(
  input: Stage1Result | ErrorResult,
  config: ResolvedSolverConfig,
  options?: DbgOptions,
): BlockingGraph | ErrorResult;
export function stage2BuildDbg(
  input: Stage1Result | ErrorResult,
  config: ResolvedSolverConfig,
  options: DbgOptions = {},
): BlockingGraph | ErrorResult {
  if (input.status === "error") {
    return input;
  }
  const sampleCount = config.samplesPerPartPerDirection;
  if (!Number.isInteger(sampleCount) || sampleCount < 1) {
    throw new InvalidSampleCountError(formatRejected(sampleCount));
  }
  const pruningEnabled = options.obbPruning ?? true;
  const collect = options.collectRayCounts ?? false;
  const parts = input.parts.slice().sort((a, b) => comparePartIds(a.partId, b.partId));
  const runtimes: PartRuntime[] = parts.map((part) => ({
    part,
    samples: buildSampleSet(part, input.sampling.stride, config),
    target: createRayTarget(part),
  }));
  const pruner = pruningEnabled ? new ObbPruner(parts) : null;
  const stats = {
    pairsTested: 0,
    pairsPruned: 0,
    raysCast: 0,
    zeroAreaParts: runtimes.filter((runtime) => runtime.samples.count === 0).length,
  };
  const memo = new Map<string, RaySet>();
  const hits = createRayHits();
  const raySet = (source: PartRuntime, target: PartRuntime, dir: Vec3): RaySet => {
    const key = `${source.part.partId}\u0000${target.part.partId}\u0000${directionKey(dir)}`;
    const cached = memo.get(key);
    if (cached !== undefined) {
      return cached;
    }
    stats.raysCast += source.samples.count;
    const result = castRaySet(source, target, dir, config, hits);
    memo.set(key, result);
    return result;
  };
  const edges: BlockingEdge[] = [];
  const rayCounts: NonNullable<BlockingGraph["diagnostics"]>["rayCounts"] = [];
  const prunedTriples: NonNullable<BlockingGraph["diagnostics"]>["prunedTriples"] = [];
  for (const a of runtimes) {
    for (let k = 0; k < CANDIDATE_AXIS_COUNT; k++) {
      const axis = a.part.candidateAxes[k];
      if (axis === undefined) {
        throw new RangeError(`Part ${a.part.partId} has no Candidate_Axis ${k}`);
      }
      const forward = cleanDirection(axis);
      const backward = negateDirection(forward);
      for (const b of runtimes) {
        if (b === a) {
          continue;
        }
        stats.pairsTested++;
        if (pruner !== null && pruner.isPruned(a.part, b.part, k)) {
          stats.pairsPruned++;
          if (collect) {
            prunedTriples.push({ from: a.part.partId, to: b.part.partId, dirIndex: k });
          }
          continue;
        }
        const fwd = raySet(a, b, forward);
        const bwd = raySet(b, a, backward);
        if (fwd.collidingRays + bwd.collidingRays === 0) {
          continue;
        }
        edges.push({
          from: a.part.partId,
          to: b.part.partId,
          dirIndex: k,
          dir: [axis[0], axis[1], axis[2]],
          fromTriangles: sortedUnique(fwd.sourceTris, bwd.hitTris),
          toTriangles: sortedUnique(fwd.hitTris, bwd.sourceTris),
        });
        if (collect) {
          rayCounts.push({
            from: a.part.partId,
            to: b.part.partId,
            dirIndex: k,
            forwardRays: fwd.collidingRays,
            backwardRays: bwd.collidingRays,
          });
        }
      }
    }
  }
  const candidateAxes: Record<string, Vec3[]> = {};
  for (const { part } of runtimes) {
    candidateAxes[part.partId] = part.candidateAxes.map((axis): Vec3 => [axis[0], axis[1], axis[2]]);
  }
  const graph: BlockingGraph = { partIds: parts.map((part) => part.partId), candidateAxes, edges, stats };
  if (collect) {
    graph.diagnostics = { rayCounts, prunedTriples };
  }
  return graph;
}
/** Casts every sample of `source` along `dir` into `target` and keeps the colliding rays. */
function castRaySet(
  source: PartRuntime,
  target: PartRuntime,
  dir: Vec3,
  config: ResolvedSolverConfig,
  hits: RayHits,
): RaySet {
  const { samples } = source;
  let sourceTris: number[] | null = null;
  let hitTris: number[] | null = null;
  for (let i = 0; i < samples.count; i++) {
    const hitCount = castAllHits(
      target.target,
      samples.originX[i] ?? Number.NaN,
      samples.originY[i] ?? Number.NaN,
      samples.originZ[i] ?? Number.NaN,
      dir,
      hits,
    );
    if (hitCount === 0) {
      continue;
    }
    const triangle = filterNearest(hits, dir, target.part.faceNormals, config.clearanceEpsilon, config.tau);
    if (triangle < 0) {
      continue;
    }
    sourceTris ??= [];
    hitTris ??= [];
    sourceTris.push(samples.sourceTri[i] ?? Number.NaN);
    hitTris.push(triangle);
  }
  if (sourceTris === null || hitTris === null) {
    return EMPTY_RAY_SET;
  }
  return { sourceTris, hitTris, collidingRays: sourceTris.length };
}
