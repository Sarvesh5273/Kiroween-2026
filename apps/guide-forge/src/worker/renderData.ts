/**
 * Render data for the viewport, built from Stage 1 normalized Parts (Requirements 3.5, 5.8, 5.9).
 *
 * Stage 1 positions are already in normalized coordinates (maxExtent 1.0), so they are copied
 * as they are. Stage 0 Parts are in world coordinates and must not be passed here.
 *
 * Every returned Part owns its typed arrays. Nothing is shared with the Stage 1 Parts or with
 * another returned Part, so the worker can list each buffer once in a transfer list.
 */
import type { Mesh, Object3D } from "three";
import type { NormalizedPart, Vec3 } from "@unboltkit/core";
import type { MaterialDescriptor, PartRenderData } from "../protocol";
import { DEFAULT_MATERIAL_DESCRIPTOR, materialToDescriptor } from "../scene/materialDescriptor";

/** Resolves the surface of the source mesh at a Core node path. */
export type MaterialLookup = (nodePath: readonly number[]) => MaterialDescriptor;

function isMesh(object: Object3D): object is Mesh {
  return (object as Partial<Mesh>).isMesh === true;
}

/**
 * Walks `root.children[i]` for each index of `nodePath` (`[]` is the root itself) and reads the
 * material of the mesh found there. Returns the default descriptor when the path leaves the tree,
 * when the node is not a mesh, or when the mesh has no material.
 */
export function descriptorAtPath(root: Object3D, nodePath: readonly number[]): MaterialDescriptor {
  let node: Object3D = root;
  for (const index of nodePath) {
    const child: Object3D | undefined = node.children[index];
    if (child === undefined) return { ...DEFAULT_MATERIAL_DESCRIPTOR };
    node = child;
  }
  if (!isMesh(node)) return { ...DEFAULT_MATERIAL_DESCRIPTOR };
  return materialToDescriptor(node.material);
}

const FALLBACK_NORMAL: Vec3 = [0, 0, 1];

/**
 * Smoothed per-vertex normals.
 *
 * For each vertex, the finite `cornerNormals` of every corner that references it are summed and
 * normalized. When the sum has no usable length, the vertex takes the `faceNormals` entry of the
 * first triangle that references it. A vertex that no triangle references, or whose face normal
 * is also unusable, takes `(0, 0, 1)` so that every output normal has unit length.
 */
function smoothedNormals(part: NormalizedPart): Float32Array {
  const vertexCount = Math.floor(part.positions.length / 3);
  const triangleCount = Math.floor(part.triangles.length / 3);
  const sums = new Float64Array(vertexCount * 3);
  const firstTriangle = new Int32Array(vertexCount).fill(-1);

  for (let t = 0; t < triangleCount; t++) {
    for (let c = 0; c < 3; c++) {
      const v = part.triangles[t * 3 + c] ?? 0;
      if (v >= vertexCount) continue;
      if (firstTriangle[v] === -1) firstTriangle[v] = t;
      const nx = part.cornerNormals[t * 9 + c * 3] ?? Number.NaN;
      const ny = part.cornerNormals[t * 9 + c * 3 + 1] ?? Number.NaN;
      const nz = part.cornerNormals[t * 9 + c * 3 + 2] ?? Number.NaN;
      if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) continue;
      sums[v * 3] = (sums[v * 3] ?? 0) + nx;
      sums[v * 3 + 1] = (sums[v * 3 + 1] ?? 0) + ny;
      sums[v * 3 + 2] = (sums[v * 3 + 2] ?? 0) + nz;
    }
  }

  const normals = new Float32Array(vertexCount * 3);
  for (let v = 0; v < vertexCount; v++) {
    let x = sums[v * 3] ?? 0;
    let y = sums[v * 3 + 1] ?? 0;
    let z = sums[v * 3 + 2] ?? 0;
    let length = Math.hypot(x, y, z);

    if (!(length > 1e-12)) {
      const t = firstTriangle[v] ?? -1;
      if (t >= 0) {
        x = part.faceNormals[t * 3] ?? 0;
        y = part.faceNormals[t * 3 + 1] ?? 0;
        z = part.faceNormals[t * 3 + 2] ?? 0;
        length = Math.hypot(x, y, z);
      }
    }

    if (Number.isFinite(length) && length > 1e-12) {
      normals[v * 3] = x / length;
      normals[v * 3 + 1] = y / length;
      normals[v * 3 + 2] = z / length;
    } else {
      normals[v * 3] = FALLBACK_NORMAL[0];
      normals[v * 3 + 1] = FALLBACK_NORMAL[1];
      normals[v * 3 + 2] = FALLBACK_NORMAL[2];
    }
  }
  return normals;
}

function copyVec3(v: Vec3): Vec3 {
  return [v[0], v[1], v[2]];
}

/**
 * Builds one `PartRenderData` per Stage 1 Part, in the order given (Stage 1 sorts by Part_ID).
 *
 * @param parts Stage 1 normalized Parts.
 * @param materials Either the root of the source scene (the material is read at each Part's
 * `sourceNodePath`) or a lookup function that does the same. A Part whose material cannot be
 * found gets the default descriptor.
 */
export function buildRenderData(
  parts: readonly NormalizedPart[],
  materials: Object3D | MaterialLookup,
): PartRenderData[] {
  const lookup: MaterialLookup =
    typeof materials === "function"
      ? materials
      : (nodePath) => descriptorAtPath(materials, nodePath);

  return parts.map((part): PartRenderData => ({
    partId: part.partId,
    nodeName: part.sourceNodeName,
    nodePath: part.sourceNodePath.slice(),
    positions: Float32Array.from(part.positions),
    normals: smoothedNormals(part),
    indices: new Uint32Array(part.triangles),
    material: { ...lookup(part.sourceNodePath) },
    obbCenter: copyVec3(part.frame.obb.center),
    aabb: { min: copyVec3(part.aabb.min), max: copyVec3(part.aabb.max) },
  }));
}
