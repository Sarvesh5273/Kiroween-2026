import type { Vec3 } from "../types";

/** Axis-aligned bounding box in double precision. Closed on every side. */
export interface Aabb {
  min: Vec3;
  max: Vec3;
}

/** Builds the box of a flat `[x0, y0, z0, x1, y1, z1, ...]` list of points. */
export function aabbFromFlatPoints(flat: ArrayLike<number>): Aabb {
  if (flat.length < 3 || flat.length % 3 !== 0) {
    throw new RangeError(`aabbFromFlatPoints expects a non-empty list of xyz triples; received ${flat.length} values`);
  }
  const min: Vec3 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: Vec3 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let i = 0; i < flat.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const value = flat[i + k];
      if (value === undefined || !Number.isFinite(value)) {
        throw new RangeError(`aabbFromFlatPoints received a non-finite coordinate at index ${i + k}`);
      }
      if (value < (min[k] ?? 0)) {
        min[k] = value;
      }
      if (value > (max[k] ?? 0)) {
        max[k] = value;
      }
    }
  }
  return { min, max };
}

/** Smallest box that contains both `a` and `b`. */
export function unionAabb(a: Aabb, b: Aabb): Aabb {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

/** Grows every side of `box` outward by `amount`. */
export function expandAabb(box: Aabb, amount: number): Aabb {
  return {
    min: [box.min[0] - amount, box.min[1] - amount, box.min[2] - amount],
    max: [box.max[0] + amount, box.max[1] + amount, box.max[2] + amount],
  };
}

/**
 * Exact slab test for the ray `origin + t·dir` with `t` in `[0, tMax]`, inclusive.
 * A zero direction component only tests that the origin lies within that slab.
 */
export function rayIntersectsAabb(origin: Vec3, dir: Vec3, box: Aabb, tMax: number): boolean {
  let tNear = 0;
  let tFar = tMax;
  for (let k = 0; k < 3; k++) {
    const o = origin[k];
    const d = dir[k];
    const lo = box.min[k];
    const hi = box.max[k];
    if (o === undefined || d === undefined || lo === undefined || hi === undefined) {
      throw new RangeError("rayIntersectsAabb expects 3-component vectors");
    }
    if (d === 0) {
      if (o < lo || o > hi) {
        return false;
      }
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
    }
    tNear = Math.max(tNear, t1);
    tFar = Math.min(tFar, t2);
    if (tNear > tFar) {
      return false;
    }
  }
  return tNear <= tFar;
}

/**
 * True when some translate `moving + t·dir` with `t >= 0` touches or overlaps `target`.
 * Each axis gives a closed interval of `t`, and the test checks that the intervals intersect.
 * Boxes that only touch count as overlapping.
 */
export function sweptAabbOverlaps(moving: Aabb, dir: Vec3, target: Aabb): boolean {
  let lo = 0;
  let hi = Number.POSITIVE_INFINITY;
  for (let k = 0; k < 3; k++) {
    const d = dir[k];
    const aMin = moving.min[k];
    const aMax = moving.max[k];
    const bMin = target.min[k];
    const bMax = target.max[k];
    if (d === undefined || aMin === undefined || aMax === undefined || bMin === undefined || bMax === undefined) {
      throw new RangeError("sweptAabbOverlaps expects 3-component vectors");
    }
    if (d === 0) {
      if (aMax < bMin || aMin > bMax) {
        return false;
      }
      continue;
    }
    let t1 = (bMin - aMax) / d;
    let t2 = (bMax - aMin) / d;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
    }
    lo = Math.max(lo, t1);
    hi = Math.min(hi, t2);
    if (lo > hi) {
      return false;
    }
  }
  return lo <= hi;
}
