import type { Pose } from "../types";
import type { LinearSlideParams, MotionPrimitive } from "./types";
import { assertDistance, assertParamsObject, assertUnitVec3, assertValidT, copyVec3, identityRotation } from "./se3";

/**
 * `linear_slide` (Req 18.3, 19.6): a pure translation `T = t·s·dir` with `R = I`. It applies to
 * every Plan_Step, and its priority 0 makes it the fallback of the default registry.
 */
export const linearSlide: MotionPrimitive<LinearSlideParams> = {
  name: "linear_slide",
  priority: 0,
  isApplicable() {
    return true;
  },
  buildParams(step): LinearSlideParams {
    return { kind: "linear_slide", dir: copyVec3(step.dir), distance: step.escapeDistance };
  },
  pose(t: number, params: LinearSlideParams): Pose {
    assertValidT(t);
    assertParamsObject(params);
    assertUnitVec3("dir", params.dir);
    assertDistance("distance", params.distance);
    const travel = t * params.distance;
    return {
      rotation: identityRotation(),
      translation: [travel * params.dir[0], travel * params.dir[1], travel * params.dir[2]],
    };
  },
};
