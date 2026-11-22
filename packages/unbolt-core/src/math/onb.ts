import type { Vec3 } from "../types";

/**
 * Branchless orthonormal basis of Duff, Burgess, Christensen, Hery, Kensler, Liani and
 * Ruben, "Building an Orthonormal Basis, Revisited", JCGT 2017. Given a unit vector `n`, it
 * returns `[b1, b2]` with `b1 × b2 = n`, so `(b1, b2, n)` is right-handed.
 *
 * Callers must pass a unit vector. The Axis_Generator uses this only in the F3 fallback, and
 * the static test checks that no other `stage1/` file imports it.
 */
export function orthonormalBasis(n: Vec3): [Vec3, Vec3] {
  const [nx, ny, nz] = n;
  // copysign(1, nz): -1 for negative zero as well as for negative values.
  const sign = nz < 0 || Object.is(nz, -0) ? -1 : 1;
  const a = -1 / (sign + nz);
  const b = nx * ny * a;
  const b1: Vec3 = [1 + sign * nx * nx * a, sign * b, -sign * nx];
  const b2: Vec3 = [b, sign + ny * ny * a, -ny];
  return [b1, b2];
}
