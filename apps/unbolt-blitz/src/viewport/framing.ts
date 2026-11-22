import type { Vec3 } from "@unboltkit/core";
import type { Aabb } from "../game/blitzEngine";

/** Camera placement that shows a whole assembly (Req 9.8). */
export interface FrameResult {
  /** Distance from `center` along the view direction to the camera. */
  distance: number;
  near: number;
  far: number;
  /** Center of the box, the orbit target. */
  center: Vec3;
  /** Radius of the bounding sphere of the box. */
  radius: number;
}

/**
 * Distance for a camera that looks at the center of `aabb` so every box corner
 * lies inside the frustum at any aspect ratio.
 *
 * The bounding sphere of radius `r` fits inside the cone of the smaller half
 * angle when `distance = r * margin / sin(min(halfV, halfH))`, and that cone
 * lies inside the frustum. `near` and `far` bracket the sphere: every corner
 * has a view depth of at least `distance - r`, which is positive for
 * `margin >= 1`.
 *
 * Throws `RangeError` for a fov outside (0, 180), a non-positive aspect, a
 * margin below 1, or a box with non-finite or inverted bounds.
 */
export function frameBounds(
  aabb: Aabb,
  fovDeg: number,
  aspect: number,
  margin = 1.25,
): FrameResult {
  if (!(Number.isFinite(fovDeg) && fovDeg > 0 && fovDeg < 180)) {
    throw new RangeError(`fovDeg must be in (0, 180), got ${fovDeg}.`);
  }
  if (!(Number.isFinite(aspect) && aspect > 0)) {
    throw new RangeError(`aspect must be positive, got ${aspect}.`);
  }
  if (!(Number.isFinite(margin) && margin >= 1)) {
    throw new RangeError(`margin must be at least 1, got ${margin}.`);
  }
  for (let i = 0; i < 3; i++) {
    const lo = aabb.min[i] as number;
    const hi = aabb.max[i] as number;
    if (!(Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi)) {
      throw new RangeError("aabb must have finite bounds with min <= max.");
    }
  }

  const center: Vec3 = [
    ((aabb.min[0] as number) + (aabb.max[0] as number)) / 2,
    ((aabb.min[1] as number) + (aabb.max[1] as number)) / 2,
    ((aabb.min[2] as number) + (aabb.max[2] as number)) / 2,
  ];
  const radius =
    Math.hypot(
      (aabb.max[0] as number) - (aabb.min[0] as number),
      (aabb.max[1] as number) - (aabb.min[1] as number),
      (aabb.max[2] as number) - (aabb.min[2] as number),
    ) / 2;

  const halfV = (fovDeg * Math.PI) / 360;
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  const distance = (radius * margin) / Math.sin(Math.min(halfV, halfH));

  // Every corner has view depth >= distance - radius. Keep near safely inside
  // that bound and far safely beyond the farthest corner (distance + radius).
  const near = Math.max((distance - radius) * 0.5, 1e-4);
  const far = Math.max((distance + radius) * 4, near * 2);
  return { distance, near, far, center, radius };
}
