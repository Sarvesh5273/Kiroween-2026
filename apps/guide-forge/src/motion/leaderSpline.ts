/**
 * Leader_Spline sampling (Requirements 12.2, 12.3, 12.5).
 *
 * Pure functions on plain arrays. This module imports no React, no three and no DOM symbol.
 * The only Core value import is `createDefaultPrimitiveRegistry`, used to look up `pose`.
 */
import { createDefaultPrimitiveRegistry } from "@unboltkit/core";
import type { TrajectoryStep, Vec3 } from "@unboltkit/core";

/** Number of samples along a Leader_Spline. At least 16 are required (Requirement 12.2). */
export const LEADER_SAMPLES = 32;

/** Created once per module. The built-in primitives hold no mutable state. */
const registry = createDefaultPrimitiveRegistry();

function assertSampleCount(samples: number): void {
  if (!Number.isInteger(samples) || samples < 2) {
    throw new RangeError(`Leader_Spline needs an integer sample count of at least 2, got ${String(samples)}`);
  }
}

/**
 * Samples the path of `center` under the compiled motion of `step`.
 *
 * Sample `k` (0 <= k < samples) is `pose(k / (samples - 1), step.params)` applied to `center` as
 * `x ↦ R·x + T`. The first sample therefore equals `center` (the primitives return the identity pose
 * at t = 0) and the last sample is the final position.
 *
 * @throws RangeError when `samples` is not an integer of at least 2, or `center` is not finite.
 * @throws Error when `step.primitive` is not in the default registry. A `pose` failure propagates.
 */
export function sampleLeaderSpline(step: TrajectoryStep, center: Vec3, samples: number = LEADER_SAMPLES): Vec3[] {
  assertSampleCount(samples);
  if (!center.every(Number.isFinite)) {
    throw new RangeError("Leader_Spline center must hold finite numbers");
  }
  const lookup = registry.get(step.primitive);
  if (!lookup.ok) {
    throw new Error(`Leader_Spline: unknown motion primitive "${step.primitive}" for part ${step.partId}`);
  }
  const primitive = lookup.value;
  const [cx, cy, cz] = center;
  const last = samples - 1;
  const points: Vec3[] = [];
  for (let k = 0; k < samples; k += 1) {
    const t = k === last ? 1 : k / last;
    const { rotation: r, translation: tr } = primitive.pose(t, step.params);
    if (r.length !== 9) {
      throw new RangeError(`Leader_Spline: pose rotation must hold 9 numbers, got ${r.length}`);
    }
    points.push([
      (r[0] as number) * cx + (r[1] as number) * cy + (r[2] as number) * cz + tr[0],
      (r[3] as number) * cx + (r[4] as number) * cy + (r[5] as number) * cz + tr[1],
      (r[6] as number) * cx + (r[7] as number) * cy + (r[8] as number) * cz + tr[2],
    ]);
  }
  return points;
}

/**
 * The number of samples whose parameter `t_k = k / (samples - 1)` is at most `localParam`.
 * The result lies in `[1, samples]`, is non-decreasing in `localParam`, and equals `samples`
 * when `localParam` is 1. `localParam` is clamped to `[0, 1]`.
 *
 * @throws RangeError when `localParam` is not a number or `samples` is not an integer of at least 2.
 */
export function travelledSampleCount(localParam: number, samples: number): number {
  assertSampleCount(samples);
  if (Number.isNaN(localParam)) {
    throw new RangeError("Leader_Spline local parameter must not be NaN");
  }
  const t = Math.min(1, Math.max(0, localParam));
  const last = samples - 1;
  // Start from the closed-form estimate, then correct by one step so the result matches
  // the exact `k / last <= t` comparison used to define the samples.
  let count = Math.min(samples, Math.floor(t * last) + 1);
  while (count < samples && count / last <= t) count += 1;
  while (count > 1 && (count - 1) / last > t) count -= 1;
  return count;
}
