import { at } from "./arrayAccess";

/**
 * Writes the unit normal of the triangle with corners `a`, `b`, `c` to `out[offset..offset+2]`
 * and returns the triangle area.
 *
 * `a`, `b` and `c` are vertex indices into `points`, which holds 3 numbers per vertex. The normal
 * follows the right-hand rule `(b - a) x (c - a)`, so a counter-clockwise triangle seen from
 * outside gets an outward normal. A zero-area triangle writes `[0, 0, 0]` and returns 0.
 */
export function writeFaceNormal(
  points: Float64Array,
  a: number,
  b: number,
  c: number,
  out: Float64Array,
  offset: number,
): number {
  const ax = at(points, 3 * a);
  const ay = at(points, 3 * a + 1);
  const az = at(points, 3 * a + 2);
  const e1x = at(points, 3 * b) - ax;
  const e1y = at(points, 3 * b + 1) - ay;
  const e1z = at(points, 3 * b + 2) - az;
  const e2x = at(points, 3 * c) - ax;
  const e2y = at(points, 3 * c + 1) - ay;
  const e2z = at(points, 3 * c + 2) - az;

  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  const length = Math.sqrt(nx * nx + ny * ny + nz * nz);

  if (length > 0) {
    out[offset] = nx / length;
    out[offset + 1] = ny / length;
    out[offset + 2] = nz / length;
  } else {
    out[offset] = 0;
    out[offset + 1] = 0;
    out[offset + 2] = 0;
  }
  return 0.5 * length;
}
