import type { Vec3 } from "../types";

/** Tuple vector helpers. No `THREE` dependency, so the same code runs in every environment. */

export function vec3(x: number, y: number, z: number): Vec3 {
  return [x, y, z];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/** `a + b * s`. */
export function addScaled(a: Vec3, b: Vec3, s: number): Vec3 {
  return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function lengthSquared(a: Vec3): number {
  return dot(a, a);
}

export function length(a: Vec3): number {
  return Math.sqrt(lengthSquared(a));
}

export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

/**
 * Unit vector in the direction of `a`.
 * Throws `RangeError` for a zero or non-finite vector, because the caller has no valid direction.
 */
export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  if (!(len > 0) || !Number.isFinite(len)) {
    throw new RangeError(`cannot normalize a vector with length ${String(len)}`);
  }
  return [a[0] / len, a[1] / len, a[2] / len];
}
