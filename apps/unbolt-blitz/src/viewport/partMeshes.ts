import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshPhysicalMaterial,
} from "three";
import type { MaterialDescriptor, PartRenderData } from "../protocol";
import type { ResourceTracker } from "./resourceTracker";

/** One mesh per part, with lookups between meshes and part ids. */
export interface PartMeshSet {
  /** In the order of the input parts (ascending `partId`). */
  meshes: Mesh[];
  byPartId: Map<string, Mesh>;
  /** Part id for a mesh `Object3D.id`. */
  partIdByObjectId: Map<number, string>;
  /** Part id of a mesh, or undefined when the mesh is not one of this set. */
  partIdOf(mesh: { id: number }): string | undefined;
}

/** A new `MeshPhysicalMaterial` for one part. Parts never share a material. */
export function createPartMaterial(descriptor: MaterialDescriptor): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: new Color(descriptor.baseColor),
    metalness: descriptor.metalness,
    roughness: descriptor.roughness,
    transmission: descriptor.transmission,
    opacity: descriptor.opacity,
    transparent: descriptor.opacity < 1,
    emissive: new Color(descriptor.emissive),
    side: DoubleSide,
  });
}

/**
 * Builds the mesh of one part. The geometry uses the transferred buffers
 * directly and builds no BVH (Req 10.6). Bounding volumes are computed for
 * raycast rejection.
 */
export function createPartMesh(part: PartRenderData): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(part.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(part.normals, 3));
  geometry.setIndex(new BufferAttribute(part.indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  const mesh = new Mesh(geometry, createPartMaterial(part.material));
  mesh.name = part.partId;
  return mesh;
}

/**
 * Builds one mesh per part (Req 9.7). Geometry and material of each mesh are
 * registered with `tracker` when one is given.
 * Throws `RangeError` for a duplicate part id.
 */
export function buildPartMeshes(
  parts: readonly PartRenderData[],
  tracker?: ResourceTracker,
): PartMeshSet {
  const meshes: Mesh[] = [];
  const byPartId = new Map<string, Mesh>();
  const partIdByObjectId = new Map<number, string>();
  for (const part of parts) {
    if (byPartId.has(part.partId)) {
      throw new RangeError(`Duplicate part id "${part.partId}".`);
    }
    const mesh = createPartMesh(part);
    if (tracker !== undefined) {
      tracker.track(mesh.geometry);
      tracker.track(mesh.material as MeshPhysicalMaterial);
    }
    meshes.push(mesh);
    byPartId.set(part.partId, mesh);
    partIdByObjectId.set(mesh.id, part.partId);
  }
  return {
    meshes,
    byPartId,
    partIdByObjectId,
    partIdOf: (mesh) => partIdByObjectId.get(mesh.id),
  };
}
