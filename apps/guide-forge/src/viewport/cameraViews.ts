/**
 * Camera view and fit math for the Viewport (Requirements 3.7, 3.8).
 *
 * Pure functions on plain numbers and tuples. This module imports no React, no three and no DOM
 * symbol (type imports only), so tests run it in Node.
 *
 * Framing uses the bounding sphere of the bounds. With the camera on the view axis at distance
 * `d = margin * r / sin(θ/2)`, where `r` is the sphere radius and `θ = min(vfov, hfov)`, the whole
 * sphere lies inside the cone of half angle `θ/2` around the optical axis. Every point of that
 * cone projects inside `[-1, 1]` on both normalized device axes, so all corners of the bounds are
 * visible.
 */
import type { Vec3 } from "@unboltkit/core";
import type { PartRenderData } from "../protocol";
import type { Mat4 } from "../motion/partTransforms";

export type ViewKind = "iso" | "front" | "top";

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export interface CameraFrame {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  distance: number;
}

const ISO_COMPONENT = 1 / Math.sqrt(3);

/**
 * Unit vector from the bounds centre toward the camera, per view.
 * Iso looks from the (+x, +y, +z) octant, Front from +z, Top from +y.
 */
export const VIEW_DIRECTIONS: Readonly<Record<ViewKind, Vec3>> = {
  iso: [ISO_COMPONENT, ISO_COMPONENT, ISO_COMPONENT],
  front: [0, 0, 1],
  top: [0, 1, 0],
};

/**
 * Default distance factor. The camera frames the bounding sphere, which already encloses the
 * box corners with slack, so a factor of 1 fills the viewport generously without clipping.
 */
export const DEFAULT_FRAME_MARGIN = 1.0;

/** Lower bound of the sphere radius, so a point-sized box still gets a positive distance. */
const MIN_RADIUS = 1e-6;

/** `|direction.y|` above this value counts as a vertical view that needs a non-Y up vector. */
const VERTICAL_THRESHOLD = 0.999;

function assertFiniteVec3(label: string, v: readonly number[]): void {
  if (v.length !== 3 || !v.every((c) => Number.isFinite(c))) {
    throw new RangeError(`${label} must hold three finite numbers, got [${v.join(", ")}]`);
  }
}

function assertBounds(bounds: Bounds): void {
  assertFiniteVec3("bounds.min", bounds.min);
  assertFiniteVec3("bounds.max", bounds.max);
  for (let k = 0; k < 3; k++) {
    if ((bounds.min[k] as number) > (bounds.max[k] as number)) {
      throw new RangeError(`bounds.min[${k}] must not exceed bounds.max[${k}]`);
    }
  }
}

/**
 * Up vector that is never parallel to `direction`. Top (`+y`) uses `(0, 0, -1)` so the screen up
 * axis matches the Front view tilted down. A view from below (`-y`) uses `(0, 0, 1)`.
 */
function upFor(direction: Vec3): Vec3 {
  if (direction[1] > VERTICAL_THRESHOLD) return [0, 0, -1];
  if (direction[1] < -VERTICAL_THRESHOLD) return [0, 0, 1];
  return [0, 1, 0];
}

/**
 * Frames the bounding sphere of `bounds` so it fits the smaller of the vertical and horizontal
 * fields of view. The camera sits at `center + unit(direction) * distance` and looks at `center`.
 *
 * @param vfovDeg vertical field of view in degrees, in (0, 180).
 * @param aspect width divided by height, above 0.
 * @param margin factor of at least 1 applied to the distance.
 * @throws RangeError for a non-finite or inverted box, a zero direction, or an out-of-range
 *   field of view, aspect or margin.
 */
export function frameBounds(
  bounds: Bounds,
  direction: Vec3,
  vfovDeg: number,
  aspect: number,
  margin: number = DEFAULT_FRAME_MARGIN,
): CameraFrame {
  assertBounds(bounds);
  assertFiniteVec3("direction", direction);
  if (!(Number.isFinite(vfovDeg) && vfovDeg > 0 && vfovDeg < 180)) {
    throw new RangeError(`vfovDeg must be in (0, 180), got ${String(vfovDeg)}`);
  }
  if (!(Number.isFinite(aspect) && aspect > 0)) {
    throw new RangeError(`aspect must be a finite number above 0, got ${String(aspect)}`);
  }
  if (!(Number.isFinite(margin) && margin >= 1)) {
    throw new RangeError(`margin must be a finite number of at least 1, got ${String(margin)}`);
  }
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (length === 0) {
    throw new RangeError("direction must not be the zero vector");
  }
  const unit: Vec3 = [direction[0] / length, direction[1] / length, direction[2] / length];

  const target: Vec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const radius = Math.max(
    MIN_RADIUS,
    0.5 *
      Math.hypot(
        bounds.max[0] - bounds.min[0],
        bounds.max[1] - bounds.min[1],
        bounds.max[2] - bounds.min[2],
      ),
  );

  const halfV = (vfovDeg * Math.PI) / 360;
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  const halfTheta = Math.min(halfV, halfH);
  const distance = (margin * radius) / Math.sin(halfTheta);

  return {
    position: [
      target[0] + unit[0] * distance,
      target[1] + unit[1] * distance,
      target[2] + unit[2] * distance,
    ],
    target,
    up: upFor(unit),
    distance,
  };
}

/**
 * Union of the 8 corners of every Part AABB, each transformed by that Part's matrix
 * (`x ↦ R·x + T`, column-major). A Part without an entry in `transforms` stays at its assembled
 * position. Fit therefore includes the current explode pose.
 *
 * @throws RangeError when `parts` is empty or an AABB or matrix holds a non-finite value.
 */
export function boundsOfPosedParts(
  parts: readonly Pick<PartRenderData, "partId" | "aabb">[],
  transforms: ReadonlyMap<string, Mat4>,
): Bounds {
  if (parts.length === 0) {
    throw new RangeError("boundsOfPosedParts needs at least one part");
  }
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];

  for (const part of parts) {
    const { min: lo, max: hi } = part.aabb;
    assertFiniteVec3(`part ${part.partId} aabb.min`, lo);
    assertFiniteVec3(`part ${part.partId} aabb.max`, hi);
    const m = transforms.get(part.partId);
    if (m !== undefined && (m.length !== 16 || !m.every((c) => Number.isFinite(c)))) {
      throw new RangeError(`transform of part ${part.partId} must hold 16 finite numbers`);
    }
    for (let corner = 0; corner < 8; corner++) {
      const x = corner & 1 ? hi[0] : lo[0];
      const y = corner & 2 ? hi[1] : lo[1];
      const z = corner & 4 ? hi[2] : lo[2];
      let px = x;
      let py = y;
      let pz = z;
      if (m !== undefined) {
        px = (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number);
        py = (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number);
        pz = (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number);
      }
      if (px < min[0]) min[0] = px;
      if (py < min[1]) min[1] = py;
      if (pz < min[2]) min[2] = pz;
      if (px > max[0]) max[0] = px;
      if (py > max[1]) max[1] = py;
      if (pz > max[2]) max[2] = pz;
    }
  }
  return { min, max };
}
