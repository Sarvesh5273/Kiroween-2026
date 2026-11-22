import type { Mesh } from "three";

/**
 * Records the Construction_Axis of a kit Part (Req 23.12, R10): a unit vector in the mesh's
 * local geometry frame, stored as a plain `[x, y, z]` array so it survives cloning and takes part
 * in the determinism comparison. The Core_Engine never reads `userData`; only kit tests do.
 */
export function setConstructionAxis(mesh: Mesh, axis: readonly [number, number, number]): void {
  const [x, y, z] = axis;
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length === 0) {
    throw new RangeError(`Construction_Axis of ${mesh.name || "mesh"} must be a finite non-zero vector`);
  }
  mesh.userData.constructionAxis = [x / length, y / length, z / length];
}

/** Local +Y, the axis used by every Y-up lathe and Y-extruded Part in the kits. */
export const AXIS_Y: readonly [number, number, number] = [0, 1, 0];
/** Local +X. */
export const AXIS_X: readonly [number, number, number] = [1, 0, 0];
/** Local +Z. */
export const AXIS_Z: readonly [number, number, number] = [0, 0, 1];
