import type { Material, Object3D } from "three";
import type { NodePath, NormalizedPart, Vec3 } from "@unboltkit/core";
import { deriveDisplayNames } from "../game/displayNames";
import type { MaterialDescriptor, PartRenderData } from "../protocol";
import { DEFAULT_MATERIAL_DESCRIPTOR, materialToDescriptor } from "../scene/materialDescriptor";

/** Walks child indices from the root. Returns null when the path leaves the tree. */
function nodeAtPath(root: Object3D, path: NodePath): Object3D | null {
  let node: Object3D = root;
  for (const index of path) {
    const child = node.children[index];
    if (child === undefined) return null;
    node = child;
  }
  return node;
}

function materialAtPath(root: Object3D, path: NodePath): MaterialDescriptor {
  const node = nodeAtPath(root, path);
  const material = (node as (Object3D & { material?: Material | Material[] }) | null)?.material;
  if (material === undefined) return { ...DEFAULT_MATERIAL_DESCRIPTOR };
  return materialToDescriptor(material);
}

/**
 * Per-vertex normals: the sum of the corner normals of every triangle corner that uses the
 * vertex, normalized. A vertex whose sum is zero uses the sum of its incident face normals, and
 * then (0, 0, 1).
 */
export function computeVertexNormals(part: NormalizedPart): Float32Array {
  const vertexCount = part.positions.length / 3;
  const triangleCount = part.triangles.length / 3;
  const corner = new Float64Array(vertexCount * 3);
  const face = new Float64Array(vertexCount * 3);

  for (let t = 0; t < triangleCount; t += 1) {
    for (let k = 0; k < 3; k += 1) {
      const vertex = part.triangles[3 * t + k] as number;
      for (let c = 0; c < 3; c += 1) {
        corner[3 * vertex + c] =
          (corner[3 * vertex + c] as number) + (part.cornerNormals[9 * t + 3 * k + c] as number);
        face[3 * vertex + c] = (face[3 * vertex + c] as number) + (part.faceNormals[3 * t + c] as number);
      }
    }
  }

  const out = new Float32Array(vertexCount * 3);
  for (let v = 0; v < vertexCount; v += 1) {
    const source = pickNonZero(corner, v) ?? pickNonZero(face, v);
    if (source === null) {
      out[3 * v + 2] = 1;
      continue;
    }
    out[3 * v] = source[0];
    out[3 * v + 1] = source[1];
    out[3 * v + 2] = source[2];
  }
  return out;
}

function pickNonZero(sums: Float64Array, vertex: number): Vec3 | null {
  const x = sums[3 * vertex] as number;
  const y = sums[3 * vertex + 1] as number;
  const z = sums[3 * vertex + 2] as number;
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length < 1e-12) return null;
  return [x / length, y / length, z / length];
}

function copyVec3(v: Vec3): Vec3 {
  return [v[0], v[1], v[2]];
}

/**
 * Render_Data for every part, in normalized coordinates (Stage 1 output). Each part owns fresh
 * buffers, so every `ArrayBuffer` appears once in a transfer list.
 */
export function buildRenderData(parts: readonly NormalizedPart[], root: Object3D): PartRenderData[] {
  const names = deriveDisplayNames(
    parts.map((part) => ({ partId: part.partId, nodeName: part.sourceNodeName })),
  );
  return parts.map((part) => ({
    partId: part.partId,
    displayName: names.get(part.partId) ?? part.partId,
    nodeName: part.sourceNodeName,
    positions: Float32Array.from(part.positions),
    normals: computeVertexNormals(part),
    indices: Uint32Array.from(part.triangles),
    material: materialAtPath(root, part.sourceNodePath),
    obb: {
      center: copyVec3(part.frame.obb.center),
      halfExtents: copyVec3(part.frame.obb.halfExtents),
    },
    aabb: { min: copyVec3(part.aabb.min), max: copyVec3(part.aabb.max) },
    isFastener: part.metrics.isFastener,
    principalAxis: copyVec3(part.frame.axes[0]),
    candidateAxes: part.candidateAxes.map(copyVec3),
  }));
}
