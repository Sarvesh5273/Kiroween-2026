/**
 * Reference R2 for the finite straight-move verifier: radial clearance for a move along z. It
 * reads raw positions and triangles only, and uses no BVH, no winding number and no verifier code.
 *
 * Every point of a closed solid lies between two boundary points on the z-line through it, so the
 * solid's projection on the xy plane equals the projection of its boundary triangles. If every
 * vertex of the moving Part lies within `pinRadius` of the axis point (convex hull of its vertices
 * included), and every plate triangle projects at least `plateRadius` away from it, then a move
 * along z keeps the two Parts at least `plateRadius - pinRadius` apart at every travel.
 */
export interface MeshArrays {
  positions: ArrayLike<number>;
  triangles: ArrayLike<number>;
}

function value(values: ArrayLike<number>, index: number): number {
  const v = values[index];
  if (v === undefined) {
    throw new RangeError(`index ${index} is outside a list of ${values.length} numbers`);
  }
  return v;
}

/** Euclidean distance from (px, py) to the closed 2D triangle abc. */
function pointTriangleDistance2d(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const side = (x0: number, y0: number, x1: number, y1: number): number => (x1 - x0) * (py - y0) - (y1 - y0) * (px - x0);
  const s0 = side(ax, ay, bx, by);
  const s1 = side(bx, by, cx, cy);
  const s2 = side(cx, cy, ax, ay);
  if ((s0 >= 0 && s1 >= 0 && s2 >= 0) || (s0 <= 0 && s1 <= 0 && s2 <= 0)) {
    return 0;
  }
  const segment = (x0: number, y0: number, x1: number, y1: number): number => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length2 = dx * dx + dy * dy;
    const t = length2 > 0 ? Math.min(1, Math.max(0, ((px - x0) * dx + (py - y0) * dy) / length2)) : 0;
    return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
  };
  return Math.min(segment(ax, ay, bx, by), segment(bx, by, cx, cy), segment(cx, cy, ax, ay));
}

export function radialClearance(pin: MeshArrays, plate: MeshArrays, axisX: number, axisY: number): { pinRadius: number; plateRadius: number; clearance: number } {
  let pinRadius = 0;
  for (let i = 0; i + 2 < pin.positions.length; i += 3) {
    pinRadius = Math.max(pinRadius, Math.hypot(value(pin.positions, i) - axisX, value(pin.positions, i + 1) - axisY));
  }
  let plateRadius = Number.POSITIVE_INFINITY;
  for (let t = 0; t + 2 < plate.triangles.length; t += 3) {
    const a = 3 * value(plate.triangles, t);
    const b = 3 * value(plate.triangles, t + 1);
    const c = 3 * value(plate.triangles, t + 2);
    plateRadius = Math.min(
      plateRadius,
      pointTriangleDistance2d(
        axisX,
        axisY,
        value(plate.positions, a),
        value(plate.positions, a + 1),
        value(plate.positions, b),
        value(plate.positions, b + 1),
        value(plate.positions, c),
        value(plate.positions, c + 1),
      ),
    );
  }
  return { pinRadius, plateRadius, clearance: plateRadius - pinRadius };
}
