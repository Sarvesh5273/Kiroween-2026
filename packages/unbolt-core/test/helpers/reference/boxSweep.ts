import type { Vec3 } from "../../../src/types";

/**
 * Reference R1 for the finite straight-move verifier: exact separating-axis arithmetic for
 * boxes. It imports only types from `src/` and uses no BVH, no winding number and no verifier code.
 *
 * A box translated by `s * dir` for `s` in `[0, distance]` sweeps a zonotope with the generators
 * x, y, z and `dir`. A second box has the generators x, y and z. The facet normals of their
 * Minkowski difference are the cross products of generator pairs: x, y, z, x×dir, y×dir and
 * z×dir. The interiors meet for some `s` exactly when the open projections overlap on every one
 * of those axes.
 */
export interface Box {
  min: Vec3;
  max: Vec3;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * The smallest projection overlap of the swept moving box and the fixed box over the complete
 * axis set. A positive value means the interiors intersect at some travel; zero means they only
 * touch; a negative value is a gap of at least that size along the reported axis.
 */
export function sweptBoxOverlap(moving: Box, dir: Vec3, distance: number, fixed: Box): number {
  const half = (box: Box): Vec3 => [(box.max[0] - box.min[0]) / 2, (box.max[1] - box.min[1]) / 2, (box.max[2] - box.min[2]) / 2];
  const centre = (box: Box): Vec3 => [(box.max[0] + box.min[0]) / 2, (box.max[1] + box.min[1]) / 2, (box.max[2] + box.min[2]) / 2];
  const ha = half(moving);
  const hb = half(fixed);
  const ca0 = centre(moving);
  const ca: Vec3 = [ca0[0] + (distance / 2) * dir[0], ca0[1] + (distance / 2) * dir[1], ca0[2] + (distance / 2) * dir[2]];
  const cb = centre(fixed);
  const units: Vec3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const axes: Vec3[] = [...units];
  for (const unit of units) {
    const axis = cross(unit, dir);
    const length = Math.sqrt(dot(axis, axis));
    if (length > 1e-12) {
      axes.push([axis[0] / length, axis[1] / length, axis[2] / length]);
    }
  }
  let smallest = Number.POSITIVE_INFINITY;
  for (const n of axes) {
    const radiusA = ha[0] * Math.abs(n[0]) + ha[1] * Math.abs(n[1]) + ha[2] * Math.abs(n[2]) + (distance / 2) * Math.abs(dot(n, dir));
    const radiusB = hb[0] * Math.abs(n[0]) + hb[1] * Math.abs(n[1]) + hb[2] * Math.abs(n[2]);
    const separation = Math.abs(dot(n, [ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]]));
    smallest = Math.min(smallest, radiusA + radiusB - separation);
  }
  return smallest;
}

/** Signed depth of `point` inside `box`: the distance to the nearest face, negative outside. */
export function boxDepth(box: Box, point: Vec3): number {
  let depth = Number.POSITIVE_INFINITY;
  for (let j = 0; j < 3; j++) {
    const p = point[j] as number;
    depth = Math.min(depth, p - (box.min[j] as number), (box.max[j] as number) - p);
  }
  return depth;
}

/** `box` translated by `s * dir`. */
export function translatedBox(box: Box, dir: Vec3, s: number): Box {
  return {
    min: [box.min[0] + s * dir[0], box.min[1] + s * dir[1], box.min[2] + s * dir[2]],
    max: [box.max[0] + s * dir[0], box.max[1] + s * dir[1], box.max[2] + s * dir[2]],
  };
}

/** True when `inner` lies strictly inside `outer` on every axis. */
export function boxStrictlyInside(inner: Box, outer: Box): boolean {
  for (let j = 0; j < 3; j++) {
    if (!((inner.min[j] as number) > (outer.min[j] as number) && (inner.max[j] as number) < (outer.max[j] as number))) {
      return false;
    }
  }
  return true;
}
