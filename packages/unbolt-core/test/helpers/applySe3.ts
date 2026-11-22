import { Quaternion, Vector3, type Object3D } from "three";
import type { Se3Transform } from "../arbitraries/se3";

/**
 * Composes `transform` onto the root's existing local transform, then updates the world
 * matrices of the whole hierarchy. For a root with local pose `(p, q, s)` and an SE3 `(R, t)`:
 *   position' = R·p + t,  quaternion' = R·q,  scale' = s.
 * This equals the world matrix `T(R, t) · T(p, q, s)`, so non-uniform scale is preserved.
 * The root must be test-owned: this mutates its transform. Solver code never calls it.
 */
export function applySe3(root: Object3D, transform: Se3Transform): void {
  const [qx, qy, qz, qw] = transform.quaternion;
  const rotation = new Quaternion(qx, qy, qz, qw);
  root.position.applyQuaternion(rotation).add(new Vector3(...transform.translation));
  root.quaternion.premultiply(rotation);
  root.updateMatrixWorld(true);
}
