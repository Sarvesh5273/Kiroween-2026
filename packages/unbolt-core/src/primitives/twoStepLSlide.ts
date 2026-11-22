import { PrimitiveParamError } from "../errors";
import type { Pose, Vec3 } from "../types";
import type { MotionPrimitive, TwoStepLSlideParams } from "./types";
import {
  PRIMITIVE_TOLERANCE,
  assertDistance,
  assertParamsObject,
  assertUnitVec3,
  assertValidT,
  copyVec3,
  identityRotation,
} from "./se3";

/**
 * `two_step_l_slide` (Req 18.5, 19.5, 19.9). Applies exactly when `step.secondary !== null`. The
 * Peel_Solver never emits such a step (Req 14.10), so it applies only to steps that a consumer
 * or test supplies.
 *
 * Pose: `R = I`, and `T = 2t·s1·d1` for `t <= 0.5`, else `s1·d1 + (2t − 1)·s2·d2`. The two
 * directions must be orthogonal within `1e-9`.
 */
export const twoStepLSlide: MotionPrimitive<TwoStepLSlideParams> = {
  name: "two_step_l_slide",
  priority: 30,
  isApplicable(step) {
    return step.secondary !== null;
  },
  buildParams(step): TwoStepLSlideParams {
    if (step.secondary === null) {
      throw new PrimitiveParamError("secondary", "two_step_l_slide needs a Plan_Step with a non-null secondary");
    }
    return {
      kind: "two_step_l_slide",
      d1: copyVec3(step.dir),
      s1: step.escapeDistance,
      d2: copyVec3(step.secondary.dir),
      s2: step.secondary.distance,
    };
  },
  pose(t: number, params: TwoStepLSlideParams): Pose {
    assertValidT(t);
    assertParamsObject(params);
    assertUnitVec3("d1", params.d1);
    assertDistance("s1", params.s1);
    assertUnitVec3("d2", params.d2);
    assertDistance("s2", params.s2);
    const { d1, d2, s1, s2 } = params;
    if (Math.abs(d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]) > PRIMITIVE_TOLERANCE) {
      throw new PrimitiveParamError("d2", "d1 and d2 must be orthogonal within 1e-9");
    }
    let translation: Vec3;
    if (t <= 0.5) {
      const travel = 2 * t * s1;
      translation = [travel * d1[0], travel * d1[1], travel * d1[2]];
    } else {
      const travel = (2 * t - 1) * s2;
      translation = [s1 * d1[0] + travel * d2[0], s1 * d1[1] + travel * d2[1], s1 * d1[2] + travel * d2[2]];
    }
    return { rotation: identityRotation(), translation };
  },
};
