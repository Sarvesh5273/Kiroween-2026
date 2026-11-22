/**
 * Seeded synthetic levels for the engine tests.
 *
 * Boxes sit on a jittered grid, so no two boxes touch. Every part has the 32
 * candidate axes in Core's fixed layout (26 canonical directions, then +/- the
 * three PCA axes, which for an axis-aligned box are +/-X, +/-Y, +/-Z).
 *
 * Solvable levels draw a hidden removal order and add blocking edges that only
 * point at parts earlier in that order, so the edge graph is a DAG and the
 * hidden order is a valid removal order.
 *
 * Deadlocked levels take such a DAG, then pick two parts, drop their other
 * outgoing edges, and make each block the other on all 32 axes. The witness is
 * computed afterwards by peeling every removable part and running Tarjan's
 * algorithm on what is left. It never reads the injected pair, so a test can
 * compare the two.
 *
 * All randomness comes from the `Rng` passed in (mulberry32). No `Math.random`.
 * This file imports nothing from the engine except types.
 */
import type { Vec3 } from "@unboltkit/core";
import type { EngineEdge, EngineLevelInput, EnginePart } from "../../src/game/blitzEngine";
import { mulberry32, shuffle } from "./prng";
import type { Rng } from "./prng";

export const SYNTHETIC_AXIS_COUNT = 32;
export const SYNTHETIC_CANONICAL_COUNT = 26;

// ---------------------------------------------------------------------------
// Candidate axes (same order and same float values as Core's candidateAxes.ts)
// ---------------------------------------------------------------------------

const INV_SQRT_3 = 1 / Math.sqrt(3);

function canonical(x: number, y: number, z: number): Vec3 {
  const nonZero = [x, y, z].filter((component) => component !== 0).length;
  const m = nonZero === 1 ? 1 : nonZero === 2 ? Math.SQRT1_2 : INV_SQRT_3;
  const part = (component: number): number => (component === 0 ? 0 : component * m);
  return [part(x), part(y), part(z)];
}

/** Six faces, twelve edge diagonals, eight corner diagonals. */
const CANONICAL_26: readonly Vec3[] = [
  canonical(1, 0, 0),
  canonical(-1, 0, 0),
  canonical(0, 1, 0),
  canonical(0, -1, 0),
  canonical(0, 0, 1),
  canonical(0, 0, -1),

  canonical(1, 1, 0),
  canonical(1, -1, 0),
  canonical(-1, 1, 0),
  canonical(-1, -1, 0),
  canonical(1, 0, 1),
  canonical(1, 0, -1),
  canonical(-1, 0, 1),
  canonical(-1, 0, -1),
  canonical(0, 1, 1),
  canonical(0, 1, -1),
  canonical(0, -1, 1),
  canonical(0, -1, -1),

  canonical(1, 1, 1),
  canonical(1, 1, -1),
  canonical(1, -1, 1),
  canonical(1, -1, -1),
  canonical(-1, 1, 1),
  canonical(-1, 1, -1),
  canonical(-1, -1, 1),
  canonical(-1, -1, -1),
];

/** A fresh copy of the 32 candidate axes: indices 26 to 31 are +X, -X, +Y, -Y, +Z, -Z. */
export function syntheticCandidateAxes(): Vec3[] {
  const axes: Vec3[] = CANONICAL_26.map((axis): Vec3 => [axis[0], axis[1], axis[2]]);
  axes.push([1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]);
  return axes;
}

// ---------------------------------------------------------------------------
// Options and result
// ---------------------------------------------------------------------------

export interface SyntheticLevelOptions {
  /** Number of parts. At least 1, or at least 2 when `deadlocked` is true. */
  partCount: number;
  /** Inject a mutual-block pair. Default false. */
  deadlocked?: boolean;
  /** Share of parts that are fasteners, in [0, 1]. At least one fastener when above 0. Default 0.3. */
  fastenerFraction?: number;
  /** Chance that a part (not first in the hidden order) blocks one given axis. Default 0.5. */
  blockProbability?: number;
  /** Chance that a part has a blocker on every one of its 32 axes. Default 0.4. */
  fullyBlockedProbability?: number;
  /** Most blockers placed on one axis. Default 2. */
  maxBlockersPerAxis?: number;
}

export interface SyntheticLevel {
  readonly input: EngineLevelInput;
  readonly solvable: boolean;
  /** A valid removal order for a solvable level, otherwise null. */
  readonly removalOrder: readonly string[] | null;
  /** The injected mutual-block pair (sorted), or null for a solvable level. */
  readonly injectedPair: readonly [string, string] | null;
  /** SCCs of size 2 or more among the parts that can never be removed, found by Tarjan. */
  readonly witness: readonly (readonly string[])[];
  /** For each fastener, the candidate axis index (0 to 5) its principal axis equals. */
  readonly fastenerAxisIndex: ReadonlyMap<string, number>;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareEdges(a: EngineEdge, b: EngineEdge): number {
  return compareIds(a.from, b.from) || a.dirIndex - b.dirIndex || compareIds(a.to, b.to);
}

function partIdFor(index: number): string {
  return `part_${String(index).padStart(3, "0")}`;
}

function checkProbability(name: string, value: number): void {
  if (!(value >= 0 && value <= 1)) throw new RangeError(`${name} must be in [0, 1], got ${value}`);
}

/** Builds a level from a seed. The same seed and options always give the same level. */
export function generateSyntheticLevel(seed: number, options: SyntheticLevelOptions): SyntheticLevel {
  return generateSyntheticLevelFromRng(mulberry32(seed), options);
}

export function generateSyntheticLevelFromRng(rng: Rng, options: SyntheticLevelOptions): SyntheticLevel {
  const n = options.partCount;
  const deadlocked = options.deadlocked === true;
  const fastenerFraction = options.fastenerFraction ?? 0.3;
  const blockProbability = options.blockProbability ?? 0.5;
  const fullyBlockedProbability = options.fullyBlockedProbability ?? 0.4;
  const maxBlockers = options.maxBlockersPerAxis ?? 2;
  if (!Number.isInteger(n) || n < (deadlocked ? 2 : 1)) {
    throw new RangeError(`partCount must be an integer of at least ${deadlocked ? 2 : 1}, got ${n}`);
  }
  if (!Number.isInteger(maxBlockers) || maxBlockers < 1) {
    throw new RangeError(`maxBlockersPerAxis must be a positive integer, got ${maxBlockers}`);
  }
  checkProbability("fastenerFraction", fastenerFraction);
  checkProbability("blockProbability", blockProbability);
  checkProbability("fullyBlockedProbability", fullyBlockedProbability);

  // Parts on a jittered grid: each part owns a distinct cell and stays strictly inside it.
  const side = Math.max(1, Math.ceil(Math.cbrt(n)));
  const cell = 1 / side;
  const cellIndexes = shuffle(
    rng,
    Array.from({ length: side * side * side }, (_, i) => i),
  ).slice(0, n);

  const ids = Array.from({ length: n }, (_, i) => partIdFor(i));
  const fastenerCount =
    fastenerFraction === 0 ? 0 : Math.min(n, Math.max(1, Math.round(n * fastenerFraction)));
  const fastenerIds = new Set(shuffle(rng, ids).slice(0, fastenerCount));
  const fastenerAxisIndex = new Map<string, number>();

  const parts: EnginePart[] = ids.map((partId, i) => {
    const c = cellIndexes[i] as number;
    const base: Vec3 = [
      ((c % side) + 0.5) * cell - 0.5,
      ((Math.floor(c / side) % side) + 0.5) * cell - 0.5,
      (Math.floor(c / (side * side)) + 0.5) * cell - 0.5,
    ];
    const half = cell / 2;
    let halfExtents: Vec3;
    let principalAxis: Vec3;
    const isFastener = fastenerIds.has(partId);
    if (isFastener) {
      const coordinate = Math.min(2, Math.floor(rng() * 3));
      const negative = rng() < 0.5;
      const longAxis = 2 * coordinate + (negative ? 1 : 0);
      const extents: [number, number, number] = [0, 0, 0];
      for (let j = 0; j < 3; j++) {
        extents[j] = j === coordinate ? half * (0.7 + 0.15 * rng()) : half * (0.1 + 0.1 * rng());
      }
      halfExtents = extents;
      principalAxis = syntheticCandidateAxes()[SYNTHETIC_CANONICAL_COUNT + longAxis] as Vec3;
      fastenerAxisIndex.set(partId, longAxis);
    } else {
      halfExtents = [
        half * (0.25 + 0.6 * rng()),
        half * (0.25 + 0.6 * rng()),
        half * (0.25 + 0.6 * rng()),
      ];
      const longest = halfExtents[0] >= halfExtents[1] && halfExtents[0] >= halfExtents[2] ? 0 : halfExtents[1] >= halfExtents[2] ? 1 : 2;
      principalAxis = [longest === 0 ? 1 : 0, longest === 1 ? 1 : 0, longest === 2 ? 1 : 0];
    }
    const center: Vec3 = [0, 0, 0];
    for (let j = 0; j < 3; j++) {
      const slack = half - (halfExtents[j] as number);
      center[j] = (base[j] as number) + (rng() * 2 - 1) * 0.9 * slack;
    }
    return {
      partId,
      displayName: `Part ${i}`,
      isFastener,
      principalAxis,
      obb: { center: [center[0], center[1], center[2]], halfExtents },
      aabb: {
        min: [center[0] - halfExtents[0], center[1] - halfExtents[1], center[2] - halfExtents[2]],
        max: [center[0] + halfExtents[0], center[1] + halfExtents[1], center[2] + halfExtents[2]],
      },
      candidateAxes: syntheticCandidateAxes(),
    };
  });

  // DAG edges: a part blocked by `to` along axis k needs `to` removed first, so `to` is earlier in the order.
  const order = shuffle(rng, ids);
  let edges: EngineEdge[] = [];
  for (let i = 1; i < n; i++) {
    const from = order[i] as string;
    const earlier = order.slice(0, i);
    const fullyBlocked = rng() < fullyBlockedProbability;
    for (let k = 0; k < SYNTHETIC_AXIS_COUNT; k++) {
      if (!fullyBlocked && !(rng() < blockProbability)) continue;
      const count = Math.min(earlier.length, 1 + Math.floor(rng() * maxBlockers));
      for (const to of shuffle(rng, earlier).slice(0, count)) {
        edges.push({ from, to, dirIndex: k });
      }
    }
  }

  let injectedPair: [string, string] | null = null;
  if (deadlocked) {
    const [a, b] = shuffle(rng, ids).slice(0, 2).sort(compareIds) as [string, string];
    injectedPair = [a, b];
    edges = edges.filter((edge) => edge.from !== a && edge.from !== b);
    for (let k = 0; k < SYNTHETIC_AXIS_COUNT; k++) {
      edges.push({ from: a, to: b, dirIndex: k }, { from: b, to: a, dirIndex: k });
    }
  }
  edges.sort(compareEdges);

  const witness = deadlocked ? computeWitness(parts, edges) : [];
  if (deadlocked && witness.length === 0) {
    throw new Error("Synthetic deadlock level has no witness SCC; the generator is broken.");
  }

  return {
    input: { parts, edges, deadlockSccs: witness },
    solvable: !deadlocked,
    removalOrder: deadlocked ? null : order,
    injectedPair,
    witness,
    fastenerAxisIndex,
  };
}

// ---------------------------------------------------------------------------
// Witness: peel, then Tarjan
// ---------------------------------------------------------------------------

/** Ids of the parts that can never be removed: no sequence of removals ever clears an axis. */
function neverRemovable(parts: readonly EnginePart[], edges: readonly EngineEdge[]): string[] {
  const blockers = new Map<string, Set<string>[]>();
  for (const part of parts) {
    blockers.set(
      part.partId,
      part.candidateAxes.map(() => new Set<string>()),
    );
  }
  for (const edge of edges) {
    (blockers.get(edge.from) as Set<string>[])[edge.dirIndex]?.add(edge.to);
  }
  const removed = new Set<string>();
  let progress = true;
  while (progress) {
    progress = false;
    for (const part of parts) {
      if (removed.has(part.partId)) continue;
      const perAxis = blockers.get(part.partId) as Set<string>[];
      const free = perAxis.some((ids) => [...ids].every((id) => removed.has(id)));
      if (free) {
        removed.add(part.partId);
        progress = true;
      }
    }
  }
  return parts.map((part) => part.partId).filter((id) => !removed.has(id));
}

/** Tarjan's strongly connected components. Each SCC is sorted. */
function tarjanSccs(nodes: readonly string[], adjacency: ReadonlyMap<string, readonly string[]>): string[][] {
  const indexOf = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  const visit = (v: string): void => {
    indexOf.set(v, counter);
    lowLink.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of adjacency.get(v) ?? []) {
      if (!indexOf.has(w)) {
        visit(w);
        lowLink.set(v, Math.min(lowLink.get(v) as number, lowLink.get(w) as number));
      } else if (onStack.has(w)) {
        lowLink.set(v, Math.min(lowLink.get(v) as number, indexOf.get(w) as number));
      }
    }
    if (lowLink.get(v) === indexOf.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop() as string;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc.sort(compareIds));
    }
  };

  for (const node of nodes) {
    if (!indexOf.has(node)) visit(node);
  }
  return sccs;
}

/** SCCs with 2 or more parts among the parts that can never be removed, sorted by first member. */
function computeWitness(parts: readonly EnginePart[], edges: readonly EngineEdge[]): string[][] {
  const stuck = neverRemovable(parts, edges);
  const stuckSet = new Set(stuck);
  const adjacency = new Map<string, string[]>();
  for (const id of stuck) adjacency.set(id, []);
  for (const edge of edges) {
    if (stuckSet.has(edge.from) && stuckSet.has(edge.to) && edge.from !== edge.to) {
      const list = adjacency.get(edge.from) as string[];
      if (!list.includes(edge.to)) list.push(edge.to);
    }
  }
  return tarjanSccs(stuck, adjacency)
    .filter((scc) => scc.length >= 2)
    .sort((a, b) => compareIds(a[0] as string, b[0] as string));
}
