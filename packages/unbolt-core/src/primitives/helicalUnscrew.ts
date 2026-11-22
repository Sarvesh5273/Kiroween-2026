import type { Pose } from "../types";
import type { HelicalUnscrewParams, MotionPrimitive } from "./types";
import {
  assertDistance,
  assertParamsObject,
  assertPositive,
  assertUnitVec3,
  assertValidT,
  assertVec3,
  copyVec3,
  rotationAboutPivot,
} from "./se3";

/**
 * `helical_unscrew` (Req 18.4, 19.4, 19.8). Applies to a Fastener whose step direction lies
 * within the helical angular tolerance of either sign of the Part's principal axis `a1`. The
 * angle is `atan2(|dir × a1|, |dir · a1|)`, which stays accurate near 0° and 90°. Because the
 * tolerance is below 90°, an applicable step never has `dir · a1 = 0`.
 *
 * Pose: `θ = 2π·t·s/p`, `R = Rodrigues(axis, θ)` about the unit `axis = a1 · sign(a1 · dir)`
 * through `pivot`, then `T = pivot − R·pivot + t·s·dir`. The pivot is the OBB center, and it maps
 * to `R·pivot + T = pivot + t·s·dir` whatever the angle between `axis` and `dir`, which is the
 * Req 18.6 guarantee at `t = 1`.
 */
export const helicalUnscrew: MotionPrimitive<HelicalUnscrewParams> = {
  name: "helical_unscrew",
  priority: 20,
  isApplicable(step, part, ctx) {
    if (!part.isFastener) {
      return false;
    }
    const dir = step.dir;
    const a = part.principalAxis;
    const crossX = dir[1] * a[2] - dir[2] * a[1];
    const crossY = dir[2] * a[0] - dir[0] * a[2];
    const crossZ = dir[0] * a[1] - dir[1] * a[0];
    const angle = Math.atan2(
      Math.hypot(crossX, crossY, crossZ),
      Math.abs(dir[0] * a[0] + dir[1] * a[1] + dir[2] * a[2]),
    );
    return angle <= (ctx.config.helicalAngularToleranceDeg * Math.PI) / 180;
  },
  buildParams(step, part, ctx): HelicalUnscrewParams {
    const a = part.principalAxis;
    const sign = a[0] * step.dir[0] + a[1] * step.dir[1] + a[2] * step.dir[2] >= 0 ? 1 : -1;
    return {
      kind: "helical_unscrew",
      dir: copyVec3(step.dir),
      distance: step.escapeDistance,
      axis: [sign * a[0], sign * a[1], sign * a[2]],
      pivot: copyVec3(part.obbCenter),
      pitch: ctx.config.threadPitch,
    };
  },
  pose(t: number, params: HelicalUnscrewParams): Pose {
    assertValidT(t);
    assertParamsObject(params);
    assertUnitVec3("dir", params.dir);
    assertDistance("distance", params.distance);
    assertUnitVec3("axis", params.axis);
    assertVec3("pivot", params.pivot);
    assertPositive("pitch", params.pitch);
    const length = Math.hypot(params.axis[0], params.axis[1], params.axis[2]);
    // The axis is unit within 1e-9. Dividing by its exact length keeps the rotation orthonormal.
    const axis: [number, number, number] = [params.axis[0] / length, params.axis[1] / length, params.axis[2] / length];
    const travel = t * params.distance;
    const angle = (2 * Math.PI * t * params.distance) / params.pitch;
    return rotationAboutPivot(axis, angle, params.pivot, [
      travel * params.dir[0],
      travel * params.dir[1],
      travel * params.dir[2],
    ]);
  },
};
