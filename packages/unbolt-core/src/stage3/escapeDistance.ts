import type { Aabb } from "../math/aabb";
import type { Vec3 } from "../types";

/** Escape distances closer than this count as identical (Req 14.3, 15.3). */
export const ESCAPE_TIE_TOLERANCE = 1e-9;

/**
 * Per-axis extremes of a set of boxes: the two smallest `min` values and the two largest `max`
 * values on each axis, with the owner of the best one. This lets the union of every box except
 * one be read in O(1) (Req 15.4).
 */
export interface UnionExtremes {
  readonly count: number;
  readonly min1: Vec3;
  readonly min2: Vec3;
  readonly min1Owner: [number, number, number];
  readonly max1: Vec3;
  readonly max2: Vec3;
  readonly max1Owner: [number, number, number];
}

/**
 * Builds the extremes of the given boxes in one pass. `id` identifies a box for later exclusion.
 * Equal values are kept as two separate entries, so a tie for the best value still leaves the
 * same value as the runner-up when the owner is excluded.
 */
export function buildUnionExtremes(items: readonly { readonly id: number; readonly aabb: Aabb }[]): UnionExtremes {
  const min1: Vec3 = [Infinity, Infinity, Infinity];
  const min2: Vec3 = [Infinity, Infinity, Infinity];
  const max1: Vec3 = [-Infinity, -Infinity, -Infinity];
  const max2: Vec3 = [-Infinity, -Infinity, -Infinity];
  const min1Owner: [number, number, number] = [-1, -1, -1];
  const max1Owner: [number, number, number] = [-1, -1, -1];
  for (const { id, aabb } of items) {
    for (let j = 0; j < 3; j++) {
      const lo = aabb.min[j] as number;
      if (lo < (min1[j] as number)) {
        min2[j] = min1[j] as number;
        min1[j] = lo;
        min1Owner[j] = id;
      } else if (lo < (min2[j] as number)) {
        min2[j] = lo;
      }
      const hi = aabb.max[j] as number;
      if (hi > (max1[j] as number)) {
        max2[j] = max1[j] as number;
        max1[j] = hi;
        max1Owner[j] = id;
      } else if (hi > (max2[j] as number)) {
        max2[j] = hi;
      }
    }
  }
  return { count: items.length, min1, min2, min1Owner, max1, max2, max1Owner };
}

/**
 * The AABB union of every box in `extremes` except the box `excludedId`, or `null` when no other
 * box remains. `excludedId` must be one of the ids that built `extremes`.
 */
export function unionExcluding(extremes: UnionExtremes, excludedId: number): Aabb | null {
  if (extremes.count <= 1) {
    return null;
  }
  const min: Vec3 = [0, 0, 0];
  const max: Vec3 = [0, 0, 0];
  for (let j = 0; j < 3; j++) {
    min[j] = extremes.min1Owner[j] === excludedId ? (extremes.min2[j] as number) : (extremes.min1[j] as number);
    max[j] = extremes.max1Owner[j] === excludedId ? (extremes.max2[j] as number) : (extremes.max1[j] as number);
  }
  return { min, max };
}

/**
 * Escape_Distance of `box` along the unit direction `dir` against `others`, the AABB union of
 * all other unremoved Parts (Req 14.3, 14.8).
 *
 * For each axis `j` with `d_j != 0`, the box clears `others` on that axis after
 * `s_j = (others.max_j - box.min_j) / d_j` when `d_j > 0`, and
 * `s_j = (box.max_j - others.min_j) / -d_j` when `d_j < 0`. The result is `max(0, min_j s_j)`.
 * It is 0 when `others` is `null` (the last Part), and 0 when the box already misses `others` on
 * some axis.
 */
export function escapeDistance(box: Aabb, dir: Vec3, others: Aabb | null): number {
  if (others === null) {
    return 0;
  }
  for (let j = 0; j < 3; j++) {
    if ((box.max[j] as number) < (others.min[j] as number) || (box.min[j] as number) > (others.max[j] as number)) {
      return 0;
    }
  }
  let best = Infinity;
  for (let j = 0; j < 3; j++) {
    const d = dir[j] as number;
    if (d === 0) {
      continue;
    }
    const s = d > 0 ? ((others.max[j] as number) - (box.min[j] as number)) / d : ((box.max[j] as number) - (others.min[j] as number)) / -d;
    if (s < best) {
      best = s;
    }
  }
  return Number.isFinite(best) ? Math.max(0, best) : 0;
}

export interface DirectionChoice {
  dirIndex: number;
  escapeDistance: number;
}

/**
 * Picks the removal direction among unblocked axes (Req 14.3). `unblocked` must be in ascending
 * `dirIndex` order. Every axis whose escape distance is at most `m + 1e-9` counts as identical
 * to the smallest one `m`, and the first such axis wins. The comparison is always against the
 * single minimum, so the choice cannot depend on iteration order.
 */
export function chooseDirection(unblocked: readonly DirectionChoice[]): DirectionChoice {
  let minimum = Infinity;
  for (const choice of unblocked) {
    if (choice.escapeDistance < minimum) {
      minimum = choice.escapeDistance;
    }
  }
  for (const choice of unblocked) {
    if (choice.escapeDistance <= minimum + ESCAPE_TIE_TOLERANCE) {
      return choice;
    }
  }
  throw new RangeError("chooseDirection requires at least one unblocked axis");
}
