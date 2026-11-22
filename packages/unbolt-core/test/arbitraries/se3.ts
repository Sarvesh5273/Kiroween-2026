import fc from "fast-check";

/** Unit quaternion in `[x, y, z, w]` order. */
export type Quaternion4 = [number, number, number, number];

/** Rigid transform: a rotation (quaternion) followed by a translation. No scale. */
export interface Se3Transform {
  quaternion: Quaternion4;
  translation: [number, number, number];
}

const SQRT_HALF = Math.SQRT1_2;

/**
 * Identity, half-turns about each axis and quarter-turns in both directions about each axis.
 * These keep the Assembly aligned with the canonical directions, so ties between equal
 * escape distances occur often.
 */
const EXACT_ROTATIONS: readonly Quaternion4[] = [
  [0, 0, 0, 1],
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [SQRT_HALF, 0, 0, SQRT_HALF],
  [-SQRT_HALF, 0, 0, SQRT_HALF],
  [0, SQRT_HALF, 0, SQRT_HALF],
  [0, -SQRT_HALF, 0, SQRT_HALF],
  [0, 0, SQRT_HALF, SQRT_HALF],
  [0, 0, -SQRT_HALF, SQRT_HALF],
];

const unitComponent = fc.double({ min: -1, max: 1, noNaN: true });
const translationComponent = fc.double({ min: -100, max: 100, noNaN: true });

const randomUnitQuaternion: fc.Arbitrary<Quaternion4> = fc
  .tuple(unitComponent, unitComponent, unitComponent, unitComponent)
  .filter(([x, y, z, w]) => Math.hypot(x, y, z, w) >= 0.1)
  .map(([x, y, z, w]): Quaternion4 => {
    const norm = Math.hypot(x, y, z, w);
    return [x / norm, y / norm, z / norm, w / norm];
  });

const exactQuaternion: fc.Arbitrary<Quaternion4> = fc
  .constantFrom(...EXACT_ROTATIONS)
  .map((q): Quaternion4 => [q[0], q[1], q[2], q[3]]);

/**
 * The only SE3 arbitrary in the test suite (Req 25.9). Its quaternion norm is within `1e-15`
 * of 1 and every translation component lies in `[-100, 100]`.
 */
export const se3Arbitrary: fc.Arbitrary<Se3Transform> = fc.record({
  quaternion: fc.oneof(
    { weight: 3, arbitrary: randomUnitQuaternion },
    { weight: 1, arbitrary: exactQuaternion },
  ),
  translation: fc.tuple(translationComponent, translationComponent, translationComponent),
});
