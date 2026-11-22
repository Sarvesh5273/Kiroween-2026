import type { Vec3 } from "@unboltkit/core";

/** Axis-aligned bounding box in normalized coordinates. */
export interface Aabb {
  min: Vec3;
  max: Vec3;
}

/** Boxes that only touch (gap or overlap within this value) do not overlap. */
export const TOUCH = 1e-9;

/** A direction component smaller than this counts as no motion on that axis. */
const AXIS_EPSILON = 1e-12;

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** Returns `a` scaled to unit length. Throws `RangeError` for a zero-length vector. */
export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  if (!(len > 0)) throw new RangeError("Cannot normalize a zero-length vector.");
  return scale(a, 1 / len);
}

/** Angle between two vectors in degrees, in [0, 180]. Throws `RangeError` for a zero-length vector. */
export function angleDeg(a: Vec3, b: Vec3): number {
  const la = length(a);
  const lb = length(b);
  if (!(la > 0) || !(lb > 0)) throw new RangeError("Cannot measure the angle of a zero-length vector.");
  const cos = Math.min(1, Math.max(-1, dot(a, b) / (la * lb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Travel along `dir` before `box` no longer overlaps the AABB of any box in
 * `others`, in normalized units. The result is the largest per-box exit
 * distance, and 0 when `others` is empty or nothing overlaps along `dir`.
 *
 * A box moving by `s * dir` overlaps another box for `s` in an open interval,
 * the intersection of the per-axis intervals. Boxes that only touch do not
 * overlap (see `TOUCH`).
 */
export function escapeDistance(box: Aabb, dir: Vec3, others: readonly Aabb[]): number {
  let result = 0;
  for (const other of others) {
    let lo = -Infinity;
    let hi = Infinity;
    let disjoint = false;
    for (let j = 0; j < 3; j++) {
      const d = dir[j] as number;
      const boxMin = box.min[j] as number;
      const boxMax = box.max[j] as number;
      const otherMin = other.min[j] as number;
      const otherMax = other.max[j] as number;
      if (Math.abs(d) < AXIS_EPSILON) {
        // No motion on this axis: the boxes overlap on it either always or never.
        if (boxMax <= otherMin + TOUCH || boxMin >= otherMax - TOUCH) {
          disjoint = true;
          break;
        }
        continue;
      }
      const a = (otherMin - boxMax) / d;
      const b = (otherMax - boxMin) / d;
      lo = Math.max(lo, Math.min(a, b));
      hi = Math.min(hi, Math.max(a, b));
    }
    if (disjoint) continue;
    // Overlap runs over (lo, hi). It matters only if the interval is non-empty and ends after s = 0.
    if (hi - lo > TOUCH && hi > 0) result = Math.max(result, hi);
  }
  return result;
}
