/**
 * Part transforms for the Viewport (Requirements 11.2 to 11.7, 13.1, 13.2, 14.9, 14.10).
 *
 * Turns the timeline position (DBG mode) or the Explode_Slider value (Naive mode) into one 4x4
 * matrix per Part. All matrices act on normalized coordinates as `x ↦ R·x + T`.
 *
 * Pure functions on plain arrays. This module imports no React, no three and no DOM symbol.
 * The only Core value import is `createDefaultPrimitiveRegistry`, used to look up `pose`.
 *
 * Registry lookup failures and `pose` errors are not caught. Core guarantees valid parameters for
 * compiled steps, so such an error is a contract violation that the viewport error boundary shows.
 */
import { createDefaultPrimitiveRegistry } from "@unboltkit/core";
import type { Pose } from "@unboltkit/core";
import type { SolveResult } from "../protocol";
import type { Mode } from "../state/types";
import { naiveOffset } from "./naiveExplode";
import { localParameter } from "./timeline";

/** 16 numbers in column-major order (the order of Three.js `Matrix4.fromArray`). */
export type Mat4 = number[];

/** Created once per module. The built-in primitives hold no mutable state. */
const registry = createDefaultPrimitiveRegistry();

/**
 * Builds the column-major matrix of `x ↦ R·x + T` from a Pose whose `rotation` holds 9 row-major
 * numbers `[r00, r01, r02, r10, r11, r12, r20, r21, r22]`.
 *
 * @throws RangeError when `rotation` does not hold 9 numbers.
 */
export function poseToMat4(pose: Pose): Mat4 {
  const r = pose.rotation;
  if (r.length !== 9) {
    throw new RangeError(`pose rotation must hold 9 numbers, got ${r.length}`);
  }
  const [tx, ty, tz] = pose.translation;
  return [
    r[0] as number, r[3] as number, r[6] as number, 0,
    r[1] as number, r[4] as number, r[7] as number, 0,
    r[2] as number, r[5] as number, r[8] as number, 0,
    tx, ty, tz, 1,
  ];
}

/** Column-major matrix of a pure translation. */
function translationMat4(offset: readonly [number, number, number]): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, offset[0], offset[1], offset[2], 1];
}

export interface PartTransformInput {
  result: SolveResult;
  mode: Mode;
  /** Step_Timeline position `p` in `[0, N]`. Read in DBG mode only. */
  timelineP: number;
  /** Explode_Slider value `s` in `[0, 1]`. Read in Naive mode only. */
  naiveExplode: number;
}

/**
 * Matrix per Part id.
 *
 * - DBG mode, solved plan with a trajectory: for Trajectory_Step `i` the pose at
 *   `t = clamp(p - i, 0, 1)`. At `t = 0` the primitive returns the assembled pose and at `t = 1`
 *   the final pose.
 * - DBG mode, deadlocked or error plan (no trajectory): an empty map, so every Part keeps its
 *   assembled position.
 * - Naive mode with a Naive_Report: a translation of `s * NAIVE_TRAVEL_DISTANCE` along each
 *   `perPart` direction, for solved and deadlocked plans alike.
 * - Naive mode without a Naive_Report: an empty map.
 *
 * @throws RangeError when the value that the mode reads is not finite.
 * @throws Error when a Trajectory_Step names a primitive that the registry does not hold.
 */
export function computePartTransforms(input: PartTransformInput): Map<string, Mat4> {
  const { result, mode } = input;
  const transforms = new Map<string, Mat4>();

  if (mode === "naive") {
    const s = input.naiveExplode;
    if (!Number.isFinite(s)) {
      throw new RangeError(`naiveExplode must be finite, got ${String(s)}`);
    }
    if (result.naive === null) return transforms;
    for (const entry of result.naive.perPart) {
      transforms.set(entry.partId, translationMat4(naiveOffset(s, entry.direction)));
    }
    return transforms;
  }

  const p = input.timelineP;
  if (!Number.isFinite(p)) {
    throw new RangeError(`timelineP must be finite, got ${String(p)}`);
  }
  if (result.plan.status !== "solved" || result.trajectory === null) return transforms;
  result.trajectory.forEach((step, i) => {
    const lookup = registry.get(step.primitive);
    if (!lookup.ok) {
      throw new Error(`computePartTransforms: unknown motion primitive "${step.primitive}" for part ${step.partId}`);
    }
    transforms.set(step.partId, poseToMat4(lookup.value.pose(localParameter(p, i), step.params)));
  });
  return transforms;
}
