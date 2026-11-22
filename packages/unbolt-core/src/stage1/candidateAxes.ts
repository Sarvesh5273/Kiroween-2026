import type { PartFrame, Vec3 } from "../types";

/** Number of Canonical_Directions (Req 10.1). */
export const CANONICAL_DIRECTION_COUNT = 26;
/** Candidate_Axes per Part: 26 canonical plus both signs of 3 PCA axes (Req 10.2). */
export const CANDIDATE_AXIS_COUNT = 32;

const INV_SQRT_3 = 1 / Math.sqrt(3);

/**
 * Component magnitude for a direction with `nonZero` non-zero entries. Each constant is exact
 * and shared, so negating a direction gives the bitwise value of its opposite entry (design D6).
 */
function magnitude(nonZero: number): number {
  if (nonZero === 1) {
    return 1;
  }
  return nonZero === 2 ? Math.SQRT1_2 : INV_SQRT_3;
}

function canonical(x: number, y: number, z: number): readonly [number, number, number] {
  const nonZero = [x, y, z].filter((component) => component !== 0).length;
  const m = magnitude(nonZero);
  // A zero component is always `+0`, never `-0`, so opposite entries differ only in sign.
  const part = (component: number): number => (component === 0 ? 0 : component * m);
  return Object.freeze([part(x), part(y), part(z)] as const);
}

/**
 * The 26 Canonical_Directions in the fixed index order of Req 10.3: six faces
 * (+X, -X, +Y, -Y, +Z, -Z), twelve edge diagonals, then eight corner diagonals.
 */
export const CANONICAL_DIRECTIONS: readonly (readonly [number, number, number])[] = Object.freeze([
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
]);

/**
 * The 32 Candidate_Axes of a Part: indices 0 to 25 are the Canonical_Directions, indices 26 to 31
 * are `+PCA1, -PCA1, +PCA2, -PCA2, +PCA3, -PCA3` (Req 10.2, 10.3). A PCA direction is kept even
 * when it equals a canonical one. Every call returns fresh arrays.
 */
export function buildCandidateAxes(axes: PartFrame["axes"]): Vec3[] {
  const result: Vec3[] = CANONICAL_DIRECTIONS.map((direction): Vec3 => [direction[0], direction[1], direction[2]]);
  for (const axis of axes) {
    // `x + 0` turns `-0` into `+0`, so a negated zero component never differs from a zero one.
    result.push([axis[0] + 0, axis[1] + 0, axis[2] + 0]);
    result.push([-axis[0] + 0, -axis[1] + 0, -axis[2] + 0]);
  }
  return result;
}
