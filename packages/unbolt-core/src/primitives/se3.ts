import { PrimitiveParamError, PrimitiveRangeError, formatRejected } from "../errors";
import type { Pose, Vec3 } from "../types";

/** Tolerance for unit-length directions and for the L-slide orthogonality check (Req 18.8). */
export const PRIMITIVE_TOLERANCE = 1e-9;

/** Row-major 3×3 identity. */
export function identityRotation(): number[] {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

/**
 * Rotation by `angle` radians about the unit vector `axis`, positive by the right-hand rule
 * (Rodrigues): `R = cosθ·I + sinθ·[k]× + (1 − cosθ)·k·kᵀ`, as 9 row-major numbers. At `angle = 0`
 * the result is exactly the identity.
 */
export function rodrigues(axis: Vec3, angle: number): number[] {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = 1 - c;
  return [
    c + x * x * k,
    x * y * k - z * s,
    x * z * k + y * s,
    y * x * k + z * s,
    c + y * y * k,
    y * z * k - x * s,
    z * x * k - y * s,
    z * y * k + x * s,
    c + z * z * k,
  ];
}

/** `R·v` for a row-major rotation. */
export function rotate(rotation: readonly number[], v: Vec3): Vec3 {
  const r = (i: number): number => rotation[i] as number;
  return [
    r(0) * v[0] + r(1) * v[1] + r(2) * v[2],
    r(3) * v[0] + r(4) * v[1] + r(5) * v[2],
    r(6) * v[0] + r(7) * v[1] + r(8) * v[2],
  ];
}

/** `R·x + T`. */
export function applyPose(pose: Pose, point: Vec3): Vec3 {
  const rotated = rotate(pose.rotation, point);
  return [rotated[0] + pose.translation[0], rotated[1] + pose.translation[1], rotated[2] + pose.translation[2]];
}

/** The pose that applies `first`, then `second`: `x ↦ R2·(R1·x + T1) + T2`. */
export function composePoses(first: Pose, second: Pose): Pose {
  const a = second.rotation;
  const b = first.rotation;
  const rotation: number[] = new Array<number>(9).fill(0);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) {
        sum += (a[row * 3 + k] as number) * (b[k * 3 + col] as number);
      }
      rotation[row * 3 + col] = sum;
    }
  }
  const moved = rotate(second.rotation, first.translation);
  return {
    rotation,
    translation: [
      moved[0] + second.translation[0],
      moved[1] + second.translation[1],
      moved[2] + second.translation[2],
    ],
  };
}

/** Rotation by `angle` about `axis` through `pivot`, then a translation by `translation`. */
export function rotationAboutPivot(axis: Vec3, angle: number, pivot: Vec3, translation: Vec3): Pose {
  const rotation = rodrigues(axis, angle);
  const rotatedPivot = rotate(rotation, pivot);
  return {
    rotation,
    translation: [
      pivot[0] - rotatedPivot[0] + translation[0],
      pivot[1] - rotatedPivot[1] + translation[1],
      pivot[2] - rotatedPivot[2] + translation[2],
    ],
  };
}

// ---------------------------------------------------------------------------
// Validation shared by the built-in primitives (Req 18.7, 18.8)
// ---------------------------------------------------------------------------

/** @throws PrimitiveRangeError unless `t` is a finite number in `[0, 1]`. */
export function assertValidT(t: number): void {
  if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > 1) {
    throw new PrimitiveRangeError(t);
  }
}

/** @throws PrimitiveParamError unless `params` is a non-null object. */
export function assertParamsObject(params: unknown): asserts params is Record<string, unknown> {
  if (typeof params !== "object" || params === null) {
    throw new PrimitiveParamError("params", `expected an object, received ${formatRejected(params)}`);
  }
}

/** @throws PrimitiveParamError unless `value` is three finite numbers. */
export function assertVec3(name: string, value: unknown): asserts value is Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((c) => typeof c === "number" && Number.isFinite(c))) {
    throw new PrimitiveParamError(name, `expected three finite numbers, received ${formatRejected(value)}`);
  }
}

/** @throws PrimitiveParamError unless `value` is a finite vector of length 1 within `1e-9`. */
export function assertUnitVec3(name: string, value: unknown): asserts value is Vec3 {
  assertVec3(name, value);
  const length = Math.hypot(value[0], value[1], value[2]);
  if (Math.abs(length - 1) > PRIMITIVE_TOLERANCE) {
    throw new PrimitiveParamError(name, `expected unit length within 1e-9, received length ${formatRejected(length)}`);
  }
}

/** @throws PrimitiveParamError unless `value` is a finite number that is not negative. */
export function assertDistance(name: string, value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new PrimitiveParamError(name, `expected a finite, non-negative number, received ${formatRejected(value)}`);
  }
}

/** @throws PrimitiveParamError unless `value` is a finite number greater than 0. */
export function assertPositive(name: string, value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new PrimitiveParamError(name, `expected a finite number greater than 0, received ${formatRejected(value)}`);
  }
}

export function copyVec3(v: Vec3): Vec3 {
  return [v[0], v[1], v[2]];
}
